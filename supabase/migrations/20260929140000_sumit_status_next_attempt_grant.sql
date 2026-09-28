-- sumit_status is security invoker. Authenticated can read the status
-- columns and not the key. next_attempt_at was selected without a grant,
-- so Settings failed with permission denied before SUMIT was connected.

grant select (next_attempt_at) on public.sumit_connections to authenticated;
