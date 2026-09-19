import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PUBLIC_MCP_URL'];
const missingConfig = required.filter(key => !process.env[key]);
const db = missingConfig.length ? null : createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const TABLES = Object.freeze({
  clients: 'customers',
  team: 'employees',
  work: 'work',
  client_payments: 'payments',
  invoices: 'invoices',
  ad_funding: 'fundings',
  advances: 'advances',
  wage_payments: 'payouts',
  costs: 'costs',
  appointments: 'shoots',
  outside_income: 'outside',
  projects: 'projects'
});

const resourceSchema = z.enum(Object.keys(TABLES));
const editableResourceSchema = z.enum(['clients', 'team', 'work', 'costs', 'outside_income', 'projects']);
const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const id = () => crypto.randomUUID();
const today = () => new Date().toISOString().slice(0, 10);

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function audit(action, resource, recordId, data = {}) {
  const { error } = await db.from('audit_log').insert({
    action, resource, record_id: recordId, actor: 'chatgpt-mcp', data
  });
  if (error) throw error;
}

async function rows(resource) {
  const { data, error } = await db.from(TABLES[resource]).select('id,data,updated_at');
  if (error) throw error;
  return (data || []).map(row => ({ id: row.id, ...row.data, updatedAt: row.updated_at }));
}

async function resolveByName(resource, value) {
  if (!value) return null;
  const all = await rows(resource);
  const normalized = String(value).trim().toLocaleLowerCase();
  return all.find(item => item.id === value || String(item.name || '').trim().toLocaleLowerCase() === normalized) || null;
}

async function upsert(resource, recordId, data, action = 'upsert') {
  const record = { id: recordId || id(), data, updated_at: new Date().toISOString() };
  const { error } = await db.from(TABLES[resource]).upsert(record);
  if (error) throw error;
  await audit(action, resource, record.id, data);
  return { id: record.id, ...data };
}

async function queueNotification(appointment, customer) {
  const notification = {
    id: id(),
    data: {
      type: 'appointment_confirmation',
      status: 'queued',
      appointmentId: appointment.id,
      recipient: appointment.contact || customer?.email || customer?.phone || '',
      customerName: customer?.name || '',
      title: appointment.title,
      date: appointment.date,
      time: appointment.time,
      createdAt: new Date().toISOString()
    },
    updated_at: new Date().toISOString()
  };
  const { error } = await db.from('notifications').upsert(notification);
  if (error) throw error;

  if (process.env.NOTIFICATION_WEBHOOK_URL) {
    try {
      const response = await fetch(process.env.NOTIFICATION_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(process.env.NOTIFICATION_WEBHOOK_SECRET ? { authorization: `Bearer ${process.env.NOTIFICATION_WEBHOOK_SECRET}` } : {})
        },
        body: JSON.stringify(notification.data)
      });
      notification.data.status = response.ok ? 'sent' : `queued_webhook_${response.status}`;
    } catch (_error) {
      notification.data.status = 'queued_webhook_failed';
    }
    await db.from('notifications').upsert({ ...notification, data: notification.data, updated_at: new Date().toISOString() });
  }
  return notification.data.status;
}

function buildServer() {
  const server = new McpServer(
    { name: 'studio-ledger', version: '1.0.0' },
    { instructions: 'Resolve names with list_records before writes. Never record a client payment or wage payment without explicit user confirmation. Never delete without explicit confirmation. Creating an invoice or appointment is allowed when the requested details are complete.' }
  );

  server.registerTool('company_snapshot', {
    title: 'Company snapshot',
    description: 'Read a compact summary of clients, team, invoices, payments, costs and appointments.',
    inputSchema: { month: z.string().regex(/^\d{4}-\d{2}$/).optional() },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ month = today().slice(0, 7) }) => {
    const [clients, team, invoices, payments, fundings, costs, appointments] = await Promise.all([
      rows('clients'), rows('team'), rows('invoices'), rows('client_payments'), rows('ad_funding'), rows('costs'), rows('appointments')
    ]);
    const inMonth = item => String(item.date || '').slice(0, 7) === month;
    return text({
      month,
      activeClients: clients.filter(x => x.active !== false).length,
      activeTeam: team.filter(x => x.active !== false).length,
      invoices: invoices.filter(inMonth).length,
      invoiced: invoices.filter(inMonth).reduce((sum, inv) => sum + (inv.items || []).reduce((s, x) => s + Number(x.amount || 0), 0), 0),
      clientPayments: payments.filter(inMonth).reduce((sum, x) => sum + Number(x.amount || 0), 0),
      adFunding: fundings.filter(inMonth).reduce((sum, x) => sum + Number(x.budget || 0) + (x.feeMode === 'percent' ? Number(x.budget || 0) * Number(x.feeValue || 0) / 100 : Number(x.feeValue || 0)), 0),
      costs: costs.filter(inMonth).reduce((sum, x) => sum + Number(x.amount || 0), 0),
      appointments: appointments.filter(inMonth).length
    });
  });

  server.registerTool('list_records', {
    title: 'List ledger records',
    description: 'List records from one ledger area, optionally filtered by month or search text.',
    inputSchema: {
      resource: resourceSchema,
      month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      query: z.string().optional()
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ resource, month, query }) => {
    let result = await rows(resource);
    if (month) result = result.filter(x => String(x.date || x.period || '').slice(0, 7) === month);
    if (query) {
      const needle = query.toLocaleLowerCase();
      result = result.filter(x => JSON.stringify(x).toLocaleLowerCase().includes(needle));
    }
    return text(result);
  });

  server.registerTool('save_business_record', {
    title: 'Add or update a business record',
    description: 'Create or update a client, team member, work entry, cost, outside-income entry, or project. For a new record omit id.',
    inputSchema: {
      resource: editableResourceSchema,
      id: z.string().optional(),
      data: z.record(z.string(), z.unknown())
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ resource, id: recordId, data }) => {
    let merged = data;
    if (recordId) {
      const existing = (await rows(resource)).find(item => item.id === recordId);
      if (!existing) throw new Error(`Record not found: ${recordId}`);
      merged = { ...existing, ...data }; delete merged.id; delete merged.updatedAt;
    }
    return text(await upsert(resource, recordId, merged));
  });

  server.registerTool('save_client', {
    title: 'Add or update a client',
    description: 'Create a client or update an existing client resolved by id or exact name.',
    inputSchema: {
      lookup: z.string().optional().describe('Existing client id or exact name; omit to create'),
      name: z.string(),
      billing: z.enum(['package', 'per_video', 'per_design', 'prepaid']).default('package'),
      monthlyFee: z.number().nonnegative().default(0), videoRate: z.number().nonnegative().default(0),
      designRate: z.number().nonnegative().default(0), adSpend: z.number().nonnegative().default(0),
      videosIncluded: z.number().nonnegative().default(0), designsIncluded: z.number().nonnegative().default(0), postsIncluded: z.number().nonnegative().default(0),
      email: z.string().email().optional(), phone: z.string().optional(), notes: z.string().optional(), active: z.boolean().default(true)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async args => {
    const existing = args.lookup ? await resolveByName('clients', args.lookup) : null;
    const data = {
      ...(existing || {}), name: args.name, billing: args.billing, monthlyFee: args.monthlyFee,
      rate: args.videoRate, drate: args.designRate, adSpend: args.adSpend, videos: args.videosIncluded,
      designs: args.designsIncluded, posts: args.postsIncluded, email: args.email || '', phone: args.phone || '', note: args.notes || '',
      active: args.active, startMonth: existing?.startMonth || today().slice(0, 7), endMonth: existing?.endMonth || '',
      credit: existing?.credit || 0, openingDue: existing?.openingDue || 0
    };
    delete data.id; delete data.updatedAt;
    return text(await upsert('clients', existing?.id, data, existing ? 'update_client' : 'create_client'));
  });

  server.registerTool('save_team_member', {
    title: 'Add or update a team member',
    description: 'Create or update an employee, freelancer or partner and set the pay method and rate.',
    inputSchema: {
      lookup: z.string().optional().describe('Existing team member id or exact name; omit to create'),
      name: z.string(), role: z.string(),
      payType: z.enum(['monthly', 'per_video', 'per_task', 'percent']),
      rate: z.number().nonnegative(), email: z.string().email().optional(), phone: z.string().optional(),
      startDate: z.string().optional(), endDate: z.string().optional(),
      sharedCustomer: z.string().optional(), sharedPercent: z.number().min(0).max(100).default(0),
      notes: z.string().optional(), active: z.boolean().default(true)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async args => {
    const existing = args.lookup ? await resolveByName('team', args.lookup) : null;
    const sharedCustomer = args.sharedCustomer ? await resolveByName('clients', args.sharedCustomer) : null;
    if (args.sharedCustomer && !sharedCustomer) throw new Error(`Client not found: ${args.sharedCustomer}`);
    const data = {
      ...(existing || {}), name: args.name, role: args.role, payType: args.payType, rate: args.rate,
      startDate: args.startDate || existing?.startDate || '', endDate: args.endDate || '',
      sharedCustomerId: sharedCustomer?.id || '', sharedPct: args.sharedPercent,
      email: args.email || '', phone: args.phone || '', note: args.notes || '', active: args.active
    };
    delete data.id; delete data.updatedAt;
    return text(await upsert('team', existing?.id, data, existing ? 'update_team_member' : 'create_team_member'));
  });

  server.registerTool('create_invoice', {
    title: 'Create an invoice',
    description: 'Create a draft or issued invoice before payment. Use line items for services, designs, videos, and funded ads.',
    inputSchema: {
      customer: z.string().describe('Existing client id or exact name'),
      number: z.string().optional(),
      issueDate: z.string().default(today()),
      dueDate: z.string(),
      period: z.string().regex(/^\d{4}-\d{2}$/),
      status: z.enum(['draft', 'sent']).default('draft'),
      items: z.array(z.object({ description: z.string(), amount: z.number().nonnegative(), kind: z.enum(['service', 'video', 'design', 'ads', 'other']).default('other') })).min(1),
      notes: z.string().optional()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async args => {
    const customer = await resolveByName('clients', args.customer);
    if (!customer) throw new Error(`Client not found: ${args.customer}`);
    const existing = await rows('invoices');
    const year = new Date().getFullYear();
    const max = existing.reduce((current, invoice) => {
      const match = String(invoice.number || '').match(new RegExp(`^INV-${year}-(\\d+)$`));
      return match ? Math.max(current, Number(match[1])) : current;
    }, 0);
    const number = args.number || `INV-${year}-${String(max + 1).padStart(3, '0')}`;
    const invoice = await upsert('invoices', null, {
      number, customerId: customer.id, date: args.issueDate, dueDate: args.dueDate,
      period: args.period, status: args.status, items: args.items, notes: args.notes || '', createdAt: new Date().toISOString()
    }, 'create_invoice');
    return text({ invoice, total: args.items.reduce((sum, item) => sum + item.amount, 0) });
  });

  server.registerTool('create_ad_funding', {
    title: 'Create ad funding',
    description: 'Record a client ad-funding charge with a media budget and either a fixed fee or percentage fee. This records the ledger only and does not buy ads.',
    inputSchema: {
      customer: z.string(), date: z.string().default(today()), platform: z.string().default('Meta'),
      budget: z.number().positive(), feeMode: z.enum(['fixed', 'percent']), feeValue: z.number().nonnegative(),
      spentAmount: z.number().nonnegative().default(0), paidByEmployee: z.string().optional(),
      note: z.string().optional(), confirmed: z.boolean()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async args => {
    if (!args.confirmed) return text({ needsConfirmation: true, message: 'Confirm client, media budget, fee method, fee value and payer before recording.' });
    const customer = await resolveByName('clients', args.customer);
    if (!customer) throw new Error(`Client not found: ${args.customer}`);
    const payer = args.paidByEmployee ? await resolveByName('team', args.paidByEmployee) : null;
    if (args.paidByEmployee && !payer) throw new Error(`Team member not found: ${args.paidByEmployee}`);
    const fee = args.feeMode === 'percent' ? args.budget * args.feeValue / 100 : args.feeValue;
    const funding = await upsert('ad_funding', null, {
      customerId: customer.id, date: args.date, platform: args.platform, budget: args.budget,
      feeMode: args.feeMode, feeValue: args.feeValue, spentAmount: args.spentAmount,
      payer: payer?.id || 'box', note: args.note || '', status: 'active'
    }, 'create_ad_funding');
    return text({ funding, mediaBudget: args.budget, fee, clientTotal: args.budget + fee });
  });

  server.registerTool('record_client_payment', {
    title: 'Record a client payment',
    description: 'Record money received from a client. This records a payment; it does not move money at a bank.',
    inputSchema: {
      customer: z.string(),
      amount: z.number().positive(),
      date: z.string().default(today()),
      method: z.enum(['cash', 'bank', 'other']).default('bank'),
      invoice: z.string().optional().describe('Invoice id or invoice number'),
      funding: z.string().optional().describe('Ad-funding record id'),
      note: z.string().optional(),
      confirmed: z.boolean().describe('Must be true only after the user explicitly confirms the payment details')
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async args => {
    if (!args.confirmed) return text({ needsConfirmation: true, message: 'Confirm client, amount, date and method before recording.' });
    const customer = await resolveByName('clients', args.customer);
    if (!customer) throw new Error(`Client not found: ${args.customer}`);
    if (args.invoice && args.funding) throw new Error('Link the payment to an invoice or ad funding, not both');
    const invoice = args.invoice ? (await rows('invoices')).find(x => x.id === args.invoice || x.number === args.invoice) : null;
    const funding = args.funding ? (await rows('ad_funding')).find(x => x.id === args.funding) : null;
    if (args.invoice && !invoice) throw new Error(`Invoice not found: ${args.invoice}`);
    if (args.funding && !funding) throw new Error(`Ad funding not found: ${args.funding}`);
    if (invoice && invoice.customerId !== customer.id) throw new Error('The invoice belongs to a different client');
    if (funding && funding.customerId !== customer.id) throw new Error('The ad funding belongs to a different client');
    const payment = await upsert('client_payments', null, {
      customerId: customer.id, amount: args.amount, date: args.date, method: args.method,
      invoiceId: invoice?.id || '', fundingId: funding?.id || '', note: args.note || '', kind: funding ? 'funding' : 'payment'
    }, 'record_payment');
    if (invoice) {
      const paid = (await rows('client_payments')).filter(p => p.invoiceId === invoice.id && p.kind !== 'funding').reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const total = (invoice.items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
      if (total > 0 && paid >= total - 0.005) {
        const clean = { ...invoice, status: 'paid' }; delete clean.id; delete clean.updatedAt;
        await upsert('invoices', invoice.id, clean, 'mark_invoice_paid');
      }
    }
    return text(payment);
  });

  server.registerTool('record_wage_payment', {
    title: 'Record a wage payment',
    description: 'Record a salary or wage handed to a team member. This does not initiate a bank transfer.',
    inputSchema: {
      employee: z.string(), amount: z.number().positive(), date: z.string().default(today()),
      note: z.string().optional(), confirmed: z.boolean()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async args => {
    if (!args.confirmed) return text({ needsConfirmation: true, message: 'Confirm employee, amount and date before recording.' });
    const employee = await resolveByName('team', args.employee);
    if (!employee) throw new Error(`Team member not found: ${args.employee}`);
    return text(await upsert('wage_payments', null, {
      employeeId: employee.id, amount: args.amount, date: args.date, note: args.note || '', kind: 'wage'
    }, 'record_wage_payment'));
  });

  server.registerTool('record_advance_or_draw', {
    title: 'Record an advance or owner draw',
    description: 'Record an employee salary advance or a partner draw against their share. This does not initiate a transfer.',
    inputSchema: {
      employee: z.string(), kind: z.enum(['advance', 'draw']).default('advance'), amount: z.number().positive(),
      date: z.string().default(today()), note: z.string().optional(), confirmed: z.boolean()
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async args => {
    if (!args.confirmed) return text({ needsConfirmation: true, message: 'Confirm person, type, amount and date before recording.' });
    const employee = await resolveByName('team', args.employee);
    if (!employee) throw new Error(`Team member not found: ${args.employee}`);
    return text(await upsert('advances', null, {
      employeeId: employee.id, kind: args.kind, amount: args.amount, date: args.date, note: args.note || ''
    }, args.kind === 'draw' ? 'record_draw' : 'record_advance'));
  });

  server.registerTool('save_appointment', {
    title: 'Add or update an appointment',
    description: 'Create or update an appointment and optionally queue a confirmation notification.',
    inputSchema: {
      id: z.string().optional(), title: z.string(), date: z.string(), time: z.string(),
      kind: z.enum(['meeting', 'shoot', 'call', 'delivery', 'other']).default('meeting'),
      status: z.enum(['planned', 'confirmed', 'done', 'cancelled']).default('planned'),
      customer: z.string().optional(), employee: z.string().optional(), contact: z.string().optional(),
      hours: z.number().nonnegative().default(1), notes: z.string().optional(), sendNotification: z.boolean().default(false)
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async args => {
    const customer = args.customer ? await resolveByName('clients', args.customer) : null;
    const employee = args.employee ? await resolveByName('team', args.employee) : null;
    const appointment = await upsert('appointments', args.id, {
      title: args.title, date: args.date, time: args.time, kind: args.kind, status: args.status,
      customerId: customer?.id || '', employeeId: employee?.id || '', contact: args.contact || '',
      hours: args.hours, notes: args.notes || ''
    }, args.id ? 'update_appointment' : 'create_appointment');
    let notification = 'not_requested';
    if (args.sendNotification) notification = await queueNotification(appointment, customer);
    return text({ appointment, notification });
  });

  server.registerTool('delete_record', {
    title: 'Delete a ledger record',
    description: 'Permanently delete one record. The confirmation phrase must be DELETE and should only be supplied after explicit user confirmation.',
    inputSchema: { resource: resourceSchema, id: z.string(), confirmation: z.literal('DELETE') },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
  }, async ({ resource, id: recordId }) => {
    const { data: existing, error: readError } = await db.from(TABLES[resource]).select('data').eq('id', recordId).maybeSingle();
    if (readError) throw readError;
    if (!existing) throw new Error('Record not found');
    const { error } = await db.from(TABLES[resource]).delete().eq('id', recordId);
    if (error) throw error;
    await audit('delete', resource, recordId, { previous: existing.data });
    return text({ deleted: true, resource, id: recordId });
  });

  server.registerTool('audit_history', {
    title: 'Connector audit history',
    description: 'Read recent changes made through the connector.',
    inputSchema: { limit: z.number().int().min(1).max(100).default(25) },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ limit }) => {
    const { data, error } = await db.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return text(data || []);
  });

  return server;
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => res.status(missingConfig.length ? 503 : 200).json({
  ok: missingConfig.length === 0,
  service: 'studio-ledger-mcp',
  missingConfig
}));
app.use((req, res, next) => {
  if (missingConfig.length) {
    return res.status(503).json({ error: 'Service configuration is incomplete', missingConfig });
  }
  next();
});
app.get('/.well-known/oauth-protected-resource', (_req, res) => res.json({
  resource: process.env.PUBLIC_MCP_URL,
  authorization_servers: [`${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`],
  bearer_methods_supported: ['header'],
  scopes_supported: ['openid', 'email', 'profile']
}));

async function authorize(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const metadata = `${new URL(process.env.PUBLIC_MCP_URL).origin}/.well-known/oauth-protected-resource`;
  const challenge = `Bearer resource_metadata="${metadata}", scope="openid email profile"`;
  if (!token) return res.set('WWW-Authenticate', challenge).status(401).json({ error: 'Unauthorized' });
  if (process.env.MCP_AUTH_TOKEN && safeEqual(token, process.env.MCP_AUTH_TOKEN)) return next();
  try {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user) throw error || new Error('Invalid access token');
    const { data: profile, error: profileError } = await db.from('profiles').select('role,active').eq('id', data.user.id).maybeSingle();
    if (profileError || !profile || profile.role !== 'owner' || !profile.active) {
      return res.status(403).json({ error: 'Only the active owner may use this connector' });
    }
    req.user = data.user;
    next();
  } catch (_error) {
    return res.set('WWW-Authenticate', challenge).status(401).json({ error: 'Invalid or expired access token' });
  }
}

/* Stateless transport keeps the connector reliable on edge/serverless hosts:
   every POST is self-contained, so no in-memory session has to survive between
   requests or across Cloudflare isolates. */
app.post('/mcp', authorize, async (req, res) => {
  let transport;
  try {
    if (!isInitializeRequest(req.body) && !req.body?.method) {
      return res.status(400).json({ error: 'Invalid MCP request' });
    }
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await buildServer().connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  } finally {
    if (transport) await transport.close().catch(() => {});
  }
});
app.get('/mcp', authorize, (_req, res) => res.status(405).json({ error: 'Use POST for this stateless MCP endpoint' }));
app.delete('/mcp', authorize, (_req, res) => res.status(405).json({ error: 'No persistent MCP session' }));

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Studio Ledger MCP listening on :${port}`));
