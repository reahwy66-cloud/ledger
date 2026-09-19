# Studio Ledger MCP connector

This private connector lets ChatGPT read and update Studio Ledger through a small, allow-listed MCP server. It uses the Supabase service role only on the server; never add that key to `index.html` or commit it to GitHub.

## What it can do

- Read a company snapshot and list records.
- Add or update clients, team members, work, costs, projects, invoices and appointments.
- Record ad funding with a media budget plus either a fixed fee or percentage fee.
- Support prorated monthly salaries and a client's agreed share of an employee salary.
- Record client and wage payments after explicit confirmation.
- Queue appointment notifications and optionally send them to a webhook.
- Delete one record only after an explicit `DELETE` confirmation.
- Write every connector change to `audit_log`.

The connector records financial events. It does **not** initiate bank transfers.

## Setup

1. Re-run the repository's `supabase-setup.sql` in the Supabase SQL editor. It is idempotent and adds the new tables and policies without deleting existing data.
2. Copy `.env.example` to `.env` locally or configure the same values on your Node hosting provider.
3. In Supabase, enable **Authentication → OAuth Server**, enable dynamic client registration, and set the authorization path to `/oauth/consent` on the ledger site's domain.
4. Set `PUBLIC_MCP_URL` to the final HTTPS MCP URL. `MCP_AUTH_TOKEN` is optional and intended only for local MCP Inspector tests; ChatGPT authenticates through Supabase OAuth 2.1.
5. Install and run:

   ```bash
   npm install
   npm start
   ```

6. Deploy behind HTTPS and connect `https://your-host.example/mcp` in ChatGPT developer mode. ChatGPT discovers Supabase OAuth automatically and asks the signed-in owner to approve access.

## Appointment notifications

Without `NOTIFICATION_WEBHOOK_URL`, requested notifications remain safely queued in the `notifications` table. Point the webhook at your WhatsApp, email, SMS, Make, Zapier, or n8n workflow to deliver them. The payload includes the recipient, client, appointment title, date and time.
