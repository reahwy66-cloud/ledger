-- The deferred balance trigger fires at COMMIT, after the calling
-- SECURITY DEFINER RPC has returned. Keep this trigger private and let it
-- read the protected ledger lines with its owner's privileges.
alter function rwa2.check_balance() security definer;
revoke all on function rwa2.check_balance() from public, anon, authenticated;
