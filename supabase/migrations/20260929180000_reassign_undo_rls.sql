-- Decision 0068, r17. Append-only. Do not edit 20260929170000 or anything older.
-- reassign_undo is already revoked from anon and authenticated.
-- Only the security-definer reassign and undo functions write it, and they run as the owner.
-- RLS is on with no policies. The owner bypasses it. Everyone else is denied.

alter table public.reassign_undo enable row level security;
