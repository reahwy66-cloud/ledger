import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import webpush from 'web-push';
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

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pushKeys() {
  const seed = crypto.createHash('sha256')
    .update(String(process.env.SUPABASE_SERVICE_ROLE_KEY || 'riwa-studio-push'))
    .digest();
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(seed);
  return {
    privateKey: b64url(ecdh.getPrivateKey()),
    publicKey: b64url(ecdh.getPublicKey())
  };
}

const PUSH_KEYS = missingConfig.length ? null : pushKeys();
if (PUSH_KEYS) {
  webpush.setVapidDetails(
    new URL(process.env.PUBLIC_MCP_URL).origin,
    PUSH_KEYS.publicKey,
    PUSH_KEYS.privateKey
  );
}

async function savePushSubscription(userId, subscription, userAgent = '') {
  const key = crypto.createHash('sha256').update(String(subscription.endpoint || '')).digest('hex').slice(0, 32);
  const record = {
    id: `push_${key}`,
    data: {
      type: 'push_subscription',
      userId,
      subscription,
      userAgent,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    updated_at: new Date().toISOString()
  };
  const { error } = await db.from('notifications').upsert(record);
  if (error) throw error;
  return record.id;
}

async function sendPush(payload, userId = null) {
  let query = db.from('notifications').select('id,data');
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data || []).filter(row =>
    row.data?.type === 'push_subscription' &&
    row.data?.active !== false &&
    (!userId || row.data?.userId === userId)
  );

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await webpush.sendNotification(row.data.subscription, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (err) {
      failed++;
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        const clean = { ...row.data, active: false, updatedAt: new Date().toISOString() };
        await db.from('notifications').upsert({ id: row.id, data: clean, updated_at: new Date().toISOString() });
      }
    }
  }
  return { sent, failed, total: rows.length };
}

async function savePortalPushSubscription(employeeId, subscription, userAgent = '') {
  const key = crypto.createHash('sha256').update(String(subscription.endpoint || '')).digest('hex').slice(0, 32);
  const record = {
    id: `portal_push_${key}`,
    data: {
      type: 'portal_staff_push_subscription',
      employeeId,
      subscription,
      userAgent,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    updated_at: new Date().toISOString()
  };
  const { error } = await db.from('notifications').upsert(record);
  if (error) throw error;
  return record.id;
}

async function sendPortalStaffPush(employeeId, payload) {
  const { data, error } = await db.from('notifications').select('id,data');
  if (error) throw error;
  const rows = (data || []).filter(row =>
    row.data?.type === 'portal_staff_push_subscription' &&
    row.data?.active !== false &&
    row.data?.employeeId === employeeId
  );
  let sent = 0, failed = 0;
  for (const row of rows) {
    try {
      await webpush.sendNotification(row.data.subscription, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (err) {
      failed++;
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        const clean = { ...row.data, active: false, updatedAt: new Date().toISOString() };
        await db.from('notifications').upsert({ id: row.id, data: clean, updated_at: new Date().toISOString() });
      }
    }
  }
  return { sent, failed, total: rows.length };
}

async function portalEmployeeFromToken(token) {
  const { data, error } = await db.rpc('portal_entity', { p_kind: 'staff', p_token: token });
  if (error || !data) return null;
  return String(data);
}

async function googleDriveAccessToken() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error('google_drive_not_configured');

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  });

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error(data.error_description || data.error || 'google_drive_token_failed');
  return data.access_token;
}

function driveSafeName(value) {
  return String(value || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled';
}

async function driveFindFolder(accessToken, parentId, name) {
  const q = [
    `name='${String(name).replace(/'/g, "\\'")}'`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
    `'${parentId}' in parents`
  ].join(' and ');
  const url = new URL('https://www.googleapis.com/drive/v3/files');
  url.searchParams.set('q', q);
  url.searchParams.set('fields', 'files(id,name)');
  url.searchParams.set('pageSize', '10');
  const r = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || 'drive_folder_lookup_failed');
  return data.files?.[0] || null;
}

async function driveCreateFolder(accessToken, parentId, name) {
  const r = await fetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: driveSafeName(name),
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error?.message || 'drive_folder_create_failed');
  return data;
}

async function driveEnsureFolder(accessToken, parentId, name) {
  const safe = driveSafeName(name);
  return (await driveFindFolder(accessToken, parentId, safe)) || driveCreateFolder(accessToken, parentId, safe);
}

async function ensureClientArchiveFolder(customer, workType, dateValue) {
  const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootId) throw new Error('google_drive_root_folder_missing');
  const accessToken = await googleDriveAccessToken();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || '')) ? new Date(dateValue + 'T00:00:00Z') : new Date();
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const category = ({ video:'Videos', design:'Designs', post:'Posts', shoot:'Shoots', script:'Scripts', voice:'Voice', task:'Other' })[workType] || 'Other';

  const client = await driveEnsureFolder(accessToken, rootId, customer.data?.name || customer.id);
  const yearFolder = await driveEnsureFolder(accessToken, client.id, year);
  const monthFolder = await driveEnsureFolder(accessToken, yearFolder.id, month);
  const typeFolder = await driveEnsureFolder(accessToken, monthFolder.id, category);
  return { accessToken, folderId: typeFolder.id, path: [customer.data?.name || customer.id, year, month, category].join(' / ') };
}

async function createScheduledPush({ title = 'رِواء ستوديو', body, dueAt, url = './', tag = 'riwa-reminder', userId = null }) {
  const when = new Date(dueAt);
  if (!Number.isFinite(when.getTime())) throw new Error('Invalid dueAt');
  if (when.getTime() <= Date.now()) throw new Error('dueAt must be in the future');

  const record = {
    id: `scheduled_${id()}`,
    data: {
      type: 'scheduled_push',
      status: 'pending',
      title,
      body,
      dueAt: when.toISOString(),
      url,
      tag,
      userId,
      createdAt: new Date().toISOString()
    },
    updated_at: new Date().toISOString()
  };
  const { error } = await db.from('notifications').insert(record);
  if (error) throw error;
  return { id: record.id, ...record.data };
}

function appointmentMoment(appointment) {
  const date = String(appointment.date || '').trim();
  const time = String(appointment.time || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(time)) {
    throw new Error('Appointment date/time must use YYYY-MM-DD and HH:MM');
  }
  const hhmm = time.length === 4 ? '0' + time : time;
  const offset = String(process.env.STUDIO_TIMEZONE_OFFSET || '+03:00');
  const moment = new Date(`${date}T${hhmm}:00${offset}`);
  if (!Number.isFinite(moment.getTime())) throw new Error('Invalid appointment date/time');
  return moment;
}

async function cancelAppointmentReminders(appointmentId, reason = 'rescheduled') {
  const { data, error } = await db.from('notifications').select('id,data');
  if (error) throw error;
  const pending = (data || []).filter(row =>
    row.data?.type === 'scheduled_push' &&
    row.data?.source === 'appointment_reminder' &&
    row.data?.appointmentId === appointmentId &&
    row.data?.status === 'pending'
  );
  for (const row of pending) {
    const next = {
      ...row.data,
      status: 'cancelled',
      cancelReason: reason,
      cancelledAt: new Date().toISOString()
    };
    await db.from('notifications').upsert({ id: row.id, data: next, updated_at: new Date().toISOString() });
  }
  return pending.length;
}

async function scheduleAppointmentReminders(appointment) {
  await cancelAppointmentReminders(appointment.id, 'rescheduled');
  if (appointment.status === 'done' || appointment.status === 'cancelled') return [];

  const at = appointmentMoment(appointment).getTime();
  const safeId = String(appointment.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const title = appointment.title || 'موعد';
  const stages = [
    { key: '3h', delta: -180 * 60 * 1000, body: `${title} — باقي 3 ساعات على الموعد` },
    { key: '2h', delta: -120 * 60 * 1000, body: `${title} — باقي ساعتين على الموعد` },
    { key: '1h', delta: -60 * 60 * 1000, body: `${title} — باقي ساعة على الموعد` },
    { key: '30m', delta: -30 * 60 * 1000, body: `${title} — باقي نص ساعة على الموعد` },
    {
      key: 'confirm30',
      delta: 30 * 60 * 1000,
      body: `مرّ نصف ساعة على موعد ${title}. الرجاء التأكيد إذا تم الإجراء.`,
      url: `./?confirmAppointment=${encodeURIComponent(appointment.id)}`,
      confirmation: true
    }
  ];

  const created = [];
  for (const stage of stages) {
    const dueAt = new Date(at + stage.delta);
    if (dueAt.getTime() <= Date.now()) continue;
    const record = {
      id: `appt_${safeId}_${stage.key}`,
      data: {
        type: 'scheduled_push',
        source: 'appointment_reminder',
        status: 'pending',
        appointmentId: appointment.id,
        appointmentTitle: title,
        reminderStage: stage.key,
        confirmation: !!stage.confirmation,
        title: 'رِواء ستوديو',
        body: stage.body,
        dueAt: dueAt.toISOString(),
        url: stage.url || './',
        tag: `appointment-${safeId}-${stage.key}`,
        userId: null,
        createdAt: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    };
    const { error } = await db.from('notifications').upsert(record);
    if (error) throw error;
    created.push({ id: record.id, dueAt: record.data.dueAt, stage: stage.key });
  }
  return created;
}

async function ensureOneOffManualPush() {
  const manualId = 'manual_bana_mahmoud_20260919_2225';
  const { data: existing, error: readError } = await db
    .from('notifications')
    .select('id')
    .eq('id', manualId)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return;

  const record = {
    id: manualId,
    data: {
      type: 'scheduled_push',
      status: 'pending',
      title: 'رِواء ستوديو',
      body: 'بانة خلصي فيديو محمود',
      dueAt: new Date(Date.now() - 1000).toISOString(),
      url: './',
      tag: manualId,
      userId: null,
      createdAt: new Date().toISOString(),
      source: 'chatgpt_manual_once'
    },
    updated_at: new Date().toISOString()
  };
  const { error } = await db.from('notifications').insert(record);
  if (error) throw error;
}

async function ensureBanaVideoTestAppointment() {
  const appointmentId = 'test_bana_video_20260919_2240';
  const reminderId = 'scheduled_bana_video_20260919_2240';

  const { data: existingAppointment, error: appointmentReadError } = await db
    .from('shoots')
    .select('id')
    .eq('id', appointmentId)
    .maybeSingle();
  if (appointmentReadError) throw appointmentReadError;

  if (!existingAppointment) {
    const appointment = {
      id: appointmentId,
      data: {
        title: 'فيديو بانة',
        date: '2026-09-19',
        time: '22:40',
        kind: 'other',
        status: 'planned',
        customerId: '',
        employeeId: '',
        contact: '',
        hours: 0.5,
        notes: 'اختبار تذكير من رِواء'
      },
      updated_at: new Date().toISOString()
    };
    const { error } = await db.from('shoots').insert(appointment);
    if (error) throw error;
  }

  const { data: existingReminder, error: reminderReadError } = await db
    .from('notifications')
    .select('id')
    .eq('id', reminderId)
    .maybeSingle();
  if (reminderReadError) throw reminderReadError;

  if (!existingReminder) {
    const record = {
      id: reminderId,
      data: {
        type: 'scheduled_push',
        source: 'appointment_test',
        status: 'pending',
        appointmentId,
        appointmentTitle: 'فيديو بانة',
        title: 'رِواء ستوديو',
        body: 'فيديو بانة — حان موعده الآن',
        dueAt: '2026-09-19T22:40:00+03:00',
        url: './',
        tag: 'bana-video-2240',
        userId: null,
        createdAt: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    };
    const { error } = await db.from('notifications').insert(record);
    if (error) throw error;
  }
}

export async function runDueNotifications(now = new Date()) {
  if (!db) return { ok: false, reason: 'not_configured', checked: 0, sent: 0, failed: 0 };
  await ensureOneOffManualPush();
  await ensureBanaVideoTestAppointment();
  const { data, error } = await db.from('notifications').select('id,data');
  if (error) throw error;

  const nowMs = now.getTime();
  const due = (data || []).filter(row => {
    if (row.data?.type !== 'scheduled_push' || row.data?.status !== 'pending') return false;
    const dueMs = new Date(row.data?.dueAt || 0).getTime();
    return Number.isFinite(dueMs) && dueMs <= nowMs;
  });

  let sent = 0;
  let failed = 0;
  for (const row of due) {
    const d = row.data || {};
    try {
      if (d.appointmentId) {
        const { data: apptRow } = await db.from('shoots').select('data').eq('id', d.appointmentId).maybeSingle();
        if (apptRow?.data?.status === 'done' || apptRow?.data?.status === 'cancelled') {
          const skipped = { ...d, status: 'cancelled', cancelReason: 'appointment_closed', cancelledAt: new Date().toISOString() };
          await db.from('notifications').upsert({ id: row.id, data: skipped, updated_at: new Date().toISOString() });
          continue;
        }
      }
      const result = await sendPush({
        title: d.title || 'رِواء ستوديو',
        body: d.body || '',
        url: d.url || './',
        tag: d.tag || `scheduled-${row.id}`,
        dir: 'rtl',
        lang: 'ar'
      }, d.userId || null);

      const delivered = result.sent > 0;
      const next = {
        ...d,
        status: delivered ? 'sent' : 'failed',
        sentAt: new Date().toISOString(),
        delivery: result
      };
      await db.from('notifications').upsert({ id: row.id, data: next, updated_at: new Date().toISOString() });
      if (delivered) sent++; else failed++;
    } catch (err) {
      failed++;
      const next = {
        ...d,
        status: 'failed',
        failedAt: new Date().toISOString(),
        error: String(err?.message || err).slice(0, 500)
      };
      await db.from('notifications').upsert({ id: row.id, data: next, updated_at: new Date().toISOString() });
    }
  }
  return { ok: true, checked: due.length, sent, failed };
}

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

  let pushResult = { sent: 0, failed: 0, total: 0 };
  try {
    pushResult = await sendPush({
      title: 'رِواء ستوديو',
      body: [appointment.title, appointment.date, appointment.time].filter(Boolean).join(' · '),
      url: './',
      tag: `appointment-${appointment.id}`,
      dir: 'rtl',
      lang: 'ar'
    });
    if (pushResult.sent > 0) notification.data.status = 'push_sent';
  } catch (_pushError) {
    notification.data.status = 'queued_push_failed';
  }

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
  }

  notification.data.push = pushResult;
  await db.from('notifications').upsert({ ...notification, data: notification.data, updated_at: new Date().toISOString() });
  return notification.data.status;
}

function buildServer() {
  const server = new McpServer(
    { name: 'riwa-studio', version: '1.0.0' },
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
    const reminders = await scheduleAppointmentReminders(appointment);
    let notification = 'not_requested';
    if (args.sendNotification) notification = await queueNotification(appointment, customer);
    return text({ appointment, notification, reminders });
  });

  server.registerTool('schedule_push_notification', {
    title: 'Schedule a push notification',
    description: 'Schedule a one-time رِواء ستوديو push notification. dueAt must be an ISO 8601 timestamp with an explicit timezone offset.',
    inputSchema: {
      body: z.string().min(1),
      dueAt: z.string().describe('ISO 8601 timestamp including timezone offset, e.g. 2026-09-19T22:30:00+03:00'),
      title: z.string().default('رِواء ستوديو'),
      url: z.string().default('./'),
      tag: z.string().default('riwa-reminder')
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ body, dueAt, title, url, tag }) => {
    return text(await createScheduledPush({ title, body, dueAt, url, tag }));
  });

  server.registerTool('list_scheduled_notifications', {
    title: 'List scheduled push notifications',
    description: 'List pending or recently processed رِواء ستوديو scheduled notifications.',
    inputSchema: {
      status: z.enum(['pending', 'sent', 'failed', 'cancelled', 'all']).default('pending'),
      limit: z.number().int().min(1).max(100).default(25)
    },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, async ({ status, limit }) => {
    const { data, error } = await db.from('notifications').select('id,data,updated_at').order('updated_at', { ascending: false }).limit(250);
    if (error) throw error;
    let items = (data || []).filter(row => row.data?.type === 'scheduled_push');
    if (status !== 'all') items = items.filter(row => row.data?.status === status);
    return text(items.slice(0, limit).map(row => ({ id: row.id, ...row.data, updatedAt: row.updated_at })));
  });

  server.registerTool('cancel_scheduled_notification', {
    title: 'Cancel a scheduled push notification',
    description: 'Cancel one pending رِواء ستوديو scheduled notification by id.',
    inputSchema: { id: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ id: notificationId }) => {
    const { data: row, error } = await db.from('notifications').select('id,data').eq('id', notificationId).maybeSingle();
    if (error) throw error;
    if (!row || row.data?.type !== 'scheduled_push') throw new Error('Scheduled notification not found');
    if (row.data?.status !== 'pending') return text({ id: notificationId, status: row.data?.status || 'unknown', changed: false });
    const next = { ...row.data, status: 'cancelled', cancelledAt: new Date().toISOString() };
    const { error: writeError } = await db.from('notifications').upsert({ id: notificationId, data: next, updated_at: new Date().toISOString() });
    if (writeError) throw writeError;
    return text({ id: notificationId, status: 'cancelled', changed: true });
  });

  server.registerTool('send_push_notification', {
    title: 'Send a push notification',
    description: 'Send a Web Push notification to devices that enabled notifications for رِواء ستوديو.',
    inputSchema: {
      title: z.string().default('رِواء ستوديو'),
      body: z.string(),
      url: z.string().default('./'),
      tag: z.string().default('riwa-studio')
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, async ({ title, body, url, tag }) => {
    return text(await sendPush({ title, body, url, tag, dir: 'rtl', lang: 'ar' }));
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
app.get('/push/config', (_req, res) => {
  if (!PUSH_KEYS) return res.status(503).json({ error: 'Push is not configured' });
  res.set('Access-Control-Allow-Origin', '*');
  return res.json({ publicKey: PUSH_KEYS.publicKey });
});

app.options('/push/subscribe', (_req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }).status(204).end();
});

app.post('/push/subscribe', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' });
    const subscription = req.body?.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    const id = await savePushSubscription(data.user.id, subscription, String(req.body?.userAgent || ''));
    let testSent = false;
    try {
      await webpush.sendNotification(subscription, JSON.stringify({
        title: 'رِواء ستوديو',
        body: 'تم تفعيل التنبيهات بنجاح ✓',
        url: './',
        tag: 'riwa-push-enabled',
        dir: 'rtl',
        lang: 'ar'
      }), { TTL: 300 });
      testSent = true;
    } catch (_pushError) {
      testSent = false;
    }
    return res.json({ ok: true, id, testSent });
  } catch (_error) {
    return res.status(500).json({ error: 'Could not save subscription' });
  }
});

app.options('/push/test', (_req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }).status(204).end();
});

app.post('/push/test', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' });

    const subscription = req.body?.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }

    await savePushSubscription(data.user.id, subscription, String(req.body?.userAgent || ''));

    try {
      await webpush.sendNotification(subscription, JSON.stringify({
        title: 'رِواء ستوديو',
        body: 'تنبيه تجريبي — الإشعارات شغّالة ✓',
        url: './',
        tag: 'riwa-push-test',
        dir: 'rtl',
        lang: 'ar'
      }), { TTL: 300 });
      return res.json({ ok: true, sent: 1 });
    } catch (pushError) {
      return res.status(502).json({
        ok: false,
        error: 'Push provider rejected the notification',
        statusCode: pushError?.statusCode || null,
        providerBody: typeof pushError?.body === 'string' ? pushError.body.slice(0, 500) : null,
        providerMessage: String(pushError?.message || '').slice(0, 500)
      });
    }
  } catch (_error) {
    return res.status(500).json({ error: 'Could not send test push' });
  }
});

app.options('/portal/drive/upload-session', (_req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }).status(204).end();
});

app.post('/portal/drive/upload-session', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const portalToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!portalToken) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const employeeId = await portalEmployeeFromToken(portalToken);
    if (!employeeId) return res.status(401).json({ error: 'Invalid portal session' });

    const customerId = String(req.body?.customerId || '');
    const fileName = driveSafeName(req.body?.fileName || '');
    const mimeType = String(req.body?.mimeType || 'application/octet-stream');
    const size = Number(req.body?.size || 0);
    const workType = String(req.body?.workType || 'task');
    const date = String(req.body?.date || today());

    if (!customerId || !fileName || !Number.isFinite(size) || size <= 0) {
      return res.status(400).json({ error: 'Invalid upload request' });
    }

    const { data: customer, error: customerError } = await db.from('customers').select('id,data').eq('id', customerId).maybeSingle();
    if (customerError) throw customerError;
    if (!customer || customer.data?.active === false) return res.status(404).json({ error: 'Customer not found' });

    const archive = await ensureClientArchiveFolder(customer, workType, date);
    const metadata = {
      name: fileName,
      parents: [archive.folderId],
      appProperties: {
        riwaCustomerId: customerId,
        riwaEmployeeId: employeeId,
        riwaWorkType: workType,
        riwaDate: date
      }
    };

    const upload = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${archive.accessToken}`,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': mimeType,
        'x-upload-content-length': String(size)
      },
      body: JSON.stringify(metadata)
    });

    if (!upload.ok) {
      const err = await upload.text();
      throw new Error(err || 'drive_resumable_session_failed');
    }

    const uploadUrl = upload.headers.get('location');
    if (!uploadUrl) throw new Error('drive_upload_location_missing');

    return res.json({
      ok: true,
      uploadUrl,
      archivePath: archive.path,
      fileName,
      mimeType,
      size
    });
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || 'Could not prepare Drive upload') });
  }
});

app.get('/drive/status', async (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const configured = Boolean(
    process.env.GOOGLE_DRIVE_CLIENT_ID &&
    process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN &&
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
  );
  return res.json({ ok: true, configured });
});

app.options('/portal/push/subscribe', (_req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }).status(204).end();
});

app.post('/portal/push/subscribe', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const employeeId = await portalEmployeeFromToken(token);
    if (!employeeId) return res.status(401).json({ error: 'Invalid portal session' });
    const subscription = req.body?.subscription;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: 'Invalid subscription' });
    }
    const id = await savePortalPushSubscription(employeeId, subscription, String(req.body?.userAgent || ''));
    let testSent = false;
    try {
      await webpush.sendNotification(subscription, JSON.stringify({
        title: 'رِواء ستوديو',
        body: 'تم تفعيل تنبيهات الفريق بنجاح ✓',
        url: './staff-portal.html',
        tag: 'riwa-staff-push-enabled',
        dir: 'rtl',
        lang: 'ar'
      }), { TTL: 300 });
      testSent = true;
    } catch (_e) {}
    return res.json({ ok: true, id, testSent });
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || 'Could not save portal subscription') });
  }
});

app.options('/portal/submissions/review', (_req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }).status(204).end();
});

app.post('/portal/submissions/review', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data: authData, error: authError } = await db.auth.getUser(token);
    if (authError || !authData?.user) return res.status(401).json({ error: 'Invalid token' });
    const { data: profile, error: profileError } = await db.from('profiles').select('role,active').eq('id', authData.user.id).maybeSingle();
    if (profileError || !profile || profile.role !== 'owner' || !profile.active) {
      return res.status(403).json({ error: 'Owner only' });
    }

    const submissionId = String(req.body?.id || '');
    const action = String(req.body?.action || '');
    const note = String(req.body?.note || '');
    if (!submissionId || !['approve','reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid review request' });
    }

    const { data: row, error: rowError } = await db.from('portal_submissions')
      .select('id,employee_id,data,status').eq('id', submissionId).maybeSingle();
    if (rowError) throw rowError;
    if (!row) return res.status(404).json({ error: 'Submission not found' });

    let result;
    if (row.status !== 'pending') {
      result = { ok: true, status: row.status };
    } else if (action === 'approve') {
      const workId = crypto.randomUUID();
      const workData = { ...(row.data || {}), editorId: row.employee_id };
      const { error: workError } = await db.from('work').insert({
        id: workId,
        data: workData,
        updated_at: new Date().toISOString(),
        updated_by: authData.user.id
      });
      if (workError) throw workError;
      const { error: reviewError } = await db.from('portal_submissions').update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: authData.user.id,
        work_id: workId,
        rejection_note: null
      }).eq('id', submissionId);
      if (reviewError) throw reviewError;
      result = { ok: true, status: 'approved', workId };
    } else {
      const { error: reviewError } = await db.from('portal_submissions').update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_by: authData.user.id,
        rejection_note: note.trim() || null
      }).eq('id', submissionId);
      if (reviewError) throw reviewError;
      result = { ok: true, status: 'rejected' };
    }

    const typeNames = { video:'فيديو', post:'بوست', design:'تصميم', shoot:'تصوير', voice:'فويس', script:'سكربت', task:'مهمة' };
    const typeName = typeNames[row.data?.type] || row.data?.type || 'عمل';
    const qty = Number(row.data?.qty || 1);
    const approved = action === 'approve';
    const push = await sendPortalStaffPush(row.employee_id, {
      title: approved ? 'تمت الموافقة على التسليم ✓' : 'تم رفض التسليم',
      body: approved
        ? `تمت الموافقة على ${qty} × ${typeName} وإضافته إلى رصيدك.`
        : `تم رفض ${qty} × ${typeName}${note ? ' — ' + note : ''}`,
      url: './staff-portal.html',
      tag: `portal-submission-${submissionId}`,
      dir: 'rtl',
      lang: 'ar'
    });
    return res.json({ ok: true, result, push });
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || 'Could not review submission') });
  }
});

app.options('/appointments/delete', (_req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }).status(204).end();
});

app.post('/appointments/delete', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data: authData, error: authError } = await db.auth.getUser(token);
    if (authError || !authData?.user) return res.status(401).json({ error: 'Invalid token' });
    const appointmentId = String(req.body?.id || '');
    if (!appointmentId) return res.status(400).json({ error: 'Appointment id is required' });
    await cancelAppointmentReminders(appointmentId, 'appointment_deleted');
    const { error } = await db.from('shoots').delete().eq('id', appointmentId);
    if (error) throw error;
    return res.json({ ok: true, id: appointmentId });
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || 'Could not delete appointment') });
  }
});

app.options('/appointments/complete', (_req, res) => {
  res.set({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }).status(204).end();
});

app.post('/appointments/complete', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data: authData, error: authError } = await db.auth.getUser(token);
    if (authError || !authData?.user) return res.status(401).json({ error: 'Invalid token' });

    const appointmentId = String(req.body?.id || '');
    if (!appointmentId) return res.status(400).json({ error: 'Appointment id is required' });

    const { data: row, error } = await db.from('shoots').select('id,data').eq('id', appointmentId).maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ error: 'Appointment not found' });

    const next = {
      ...row.data,
      status: 'done',
      completedAt: new Date().toISOString(),
      completedBy: authData.user.id
    };
    const { error: writeError } = await db.from('shoots').upsert({ id: row.id, data: next, updated_at: new Date().toISOString() });
    if (writeError) throw writeError;
    await cancelAppointmentReminders(appointmentId, 'appointment_completed');
    return res.json({ ok: true, appointment: { id: row.id, ...next } });
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || 'Could not complete appointment') });
  }
});

function protectedResourceMetadata(_req, res) {
  return res.json({
    resource: process.env.PUBLIC_MCP_URL,
    authorization_servers: [`${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`],
    bearer_methods_supported: ['header'],
    scopes_supported: ['openid', 'email', 'profile']
  });
}
app.get('/.well-known/oauth-protected-resource', protectedResourceMetadata);
app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceMetadata);

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
app.listen(port, () => console.log(`رِواء ستوديو MCP listening on :${port}`));
