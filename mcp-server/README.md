# رِواء ستوديو MCP connector

This private connector lets ChatGPT read and update رِواء ستوديو through a small, allow-listed MCP server. It uses the Supabase service role only on the server; never add that key to `index.html` or commit it to GitHub.

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

## Cloudflare Workers (free, no always-on server)

The connector includes `wrangler.jsonc` and an edge-safe stateless MCP route.

1. In Cloudflare Workers & Pages, import this GitHub repository and set the root directory to `mcp-server`.
2. Use build command `npm install` and deploy command `npm run deploy:cloudflare`.
3. Add encrypted secrets `SUPABASE_SERVICE_ROLE_KEY` and these variables:
   - `SUPABASE_URL=https://YOUR_PROJECT.supabase.co`
   - `PUBLIC_MCP_URL=https://YOUR_WORKER.workers.dev/mcp`
4. Deploy, then verify `https://YOUR_WORKER.workers.dev/health` returns `{"ok":true,...}`.

Never commit or screenshot a Supabase secret key. If one is exposed, revoke it and create a replacement before deploying.

## Appointment notifications

Without `NOTIFICATION_WEBHOOK_URL`, requested notifications remain safely queued in the `notifications` table. Point the webhook at your WhatsApp, email, SMS, Make, Zapier, or n8n workflow to deliver them. The payload includes the recipient, client, appointment title, date and time.


## Google Drive client archive

The staff portal can upload delivery files directly to Google Drive using a resumable upload session. The large file does not pass through Supabase, GitHub Pages, or the MCP server. Supabase stores only delivery metadata and the Drive file ID.

Required Cloudflare Worker secrets/variables:

- `GOOGLE_DRIVE_CLIENT_ID`
- `GOOGLE_DRIVE_CLIENT_SECRET`
- `GOOGLE_DRIVE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`

For a personal Google / Google One account, use OAuth credentials for the same Google account that owns the storage. The refresh token must include the `https://www.googleapis.com/auth/drive` scope.

Recommended root structure is created automatically below `GOOGLE_DRIVE_ROOT_FOLDER_ID`:

`Client Name / YYYY / MM / Videos|Designs|Posts|Shoots|Scripts|Voice|Other`

Workflow:

1. Staff selects a customer and delivery type, then chooses a file.
2. The backend creates the correct customer/month/type folders and returns a Google resumable upload session.
3. The browser uploads the file directly to Google Drive.
4. The staff submission is saved as pending with Drive metadata.
5. Before approval the Drive file remains private.
6. On owner approval, the backend makes the approved file readable by link, stores preview/download metadata on the work record, and sends the staff approval notification.
7. The client portal archive shows only approved work files.

After enabling this feature, run `supabase-drive-archive-v1.sql` in the same Supabase project used by the app.
