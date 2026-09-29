-- Decision 0070. Append-only.
-- 0069 granted SELECT on reassign_undo so a test could observe zero rows.
-- The undo log stays revoked. Row level security stays on, with no policies.

revoke select on table public.reassign_undo from authenticated;
