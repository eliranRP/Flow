<a id="flow-159"></a>
# FLOW-159 · Prepaid: say when a schedule waits on a removed line, and test the job's deadlock skip
- **Type:** BACKLOG NIT · **Status:** ready · **Source:** reviewer of #852, round 2 (S1, S3).
- **Files:** a new migration (the list and get reads), `supabase/tests/database/prepaid_schedules.test.sql`, `prepaid_post_lock.test.sql`, the prepaid tool descriptions.

- [ ] When a bank sync removes or voids a schedule's payment line, the schedule stops posting with no signal. `list_prepaid_schedules` and `get_prepaid_schedule` should say so (for example `waiting: "the payment line was removed"`).
- [ ] `private.prepaid_post_due` skips a row when the job is the deadlock victim (posted on the next run). Only the lock-held skip is tested; add a two-session case that makes the job the victim.

**Acceptance:** pgTAP for both.
