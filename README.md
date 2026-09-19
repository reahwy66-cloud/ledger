# رِواء ستوديو

رِواء ستوديو is a bilingual PWA for clients, invoices, team pay, costs and appointments. The browser app uses Supabase for authentication, Row Level Security and realtime sync.

- Run `supabase-setup.sql` in Supabase before using a new version.
- Import the private opening-data file once from Setup → Import. It is intentionally kept outside this public repository because it contains client and payroll information.
- Deploy the static files to Netlify or another static host that supports the included `_redirects` fallback.
- The private ChatGPT connector lives in `mcp-server/`; its README contains OAuth and deployment steps.
