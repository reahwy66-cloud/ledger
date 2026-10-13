# Riwaa company ledger v2

Deployment: `/dashboard-v2/`. Legacy `/dashboard/` remains available. New records and immutable accounting live in the private `rwa2` schema and guarded public RPCs. Existing customer/employee imports contain directory data only. No legacy monetary balance was carried forward and no financial entry is seeded.

The owner must approve opening cash, receivables, customer credits, wages, ad funds, supplier/partner obligations, equipment and prepaid rent before production use. The rent agreement and65/35 split are draft planning records effective November1 until their actual date is confirmed. All equipment belongs to the company; breakup valuations are distinct from book values. Liquidation must account for all assets, debts and settlement costs before net division.

Features: dated contracts/packages, deferred/earned revenue, invoice allocation, credit notes, monthly continuous-service accrual, multi-person tasks, wage accrual/payment/advances, commission on allocated service collections, agency ad budget and fee accounting, supplier costs/payments, partner capital/loans/drawings/distributions, original USD/SYP cash, carrying-cost FX gain/loss, company asset register/depreciation/valuation, prepaid rent consumption, period locking, reversals, customer statements, journal/general ledger/trial balance/profit report, CSV and JSON export, CRM leads/quotes/appointment conflict detection and role assignment.

No rapid polling: reload after confirmed command, on manual refresh, after an authorized server revision event or another local tab's completed operation, and when returning to a visible tab after30seconds. Revision equality suppresses unchanged repaints. Modal data is preserved. Legacy realtime redraws only for changed business data and does not interrupt open forms.

Security: private tables deny direct clients; RPCs validate active profile/explicit v2 membership and owner-only setup. Partners cannot write. Sales get only permitted operational records, employees only own tasks/own wage totals. Every financial command is transactional, idempotent and balanced; posted rows are immutable. Optimistic versions reject stale record writes. Period lock and original-currency liquidity checks run server-side.

Run `node --test tests/v2-core.test.mjs` and syntax checks. SQL test suites in `tests/v2-ledger.sql` and `tests/v2-extended.sql` impersonate existing test roles inside a transaction and always ROLLBACK; never remove rollback for testing. Database baseline is `supabase-riwaa-v2.sql`. SQL was deployed and verified against the live project's isolated v2 schema. Migration history contains incremental fixes; the checked-in baseline includes their final definitions.

No password or service-role key is shipped. The frontend uses the existing project's public anon key with Supabase Auth and pinned client2.116.0.

Operational limitations: initial client portal remains the legacy portal; v2 financial statements are downloadable/printable but are not wired into the old token-based client portal. The old connector keeps reporting legacy books until it is explicitly migrated. User onboarding requires an Auth account/profile; no account for Ayham has been created without his email. The4,000 contribution is unposted until its payment and terms are confirmed. Asset evaluation and rent settlement records are reviewable inputs, not automatically booked real transactions.

Realtime publishes only an authenticated revision number, not private ledger rows. No periodic polling is used. Deferred updates wait until forms close.
