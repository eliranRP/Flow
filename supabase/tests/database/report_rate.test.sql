-- FLOW-166: bump_report_rate, the per-user limit on flow-mcp's report route (10 files a minute, in a bucket
-- of its own in private.mcp_rate). Only the service role calls it. Invented ids only.

begin;

select plan(8);

select ok(not has_function_privilege('authenticated', 'public.bump_report_rate(uuid)', 'execute'), 'a signed-in user cannot call it');
select ok(not has_function_privilege('anon', 'public.bump_report_rate(uuid)', 'execute'), 'anon cannot call it');
select ok(has_function_privilege('service_role', 'public.bump_report_rate(uuid)', 'execute'), 'the service role calls it');

select throws_ok($$ select public.bump_report_rate(null) $$, 'validation', 'a missing user is refused');

-- A user with no files this minute gets one.
select is(
  public.bump_report_rate('f1660000-0000-4000-8000-000000000001') ->> 'allowed',
  'true',
  'the first file of the minute is allowed'
);
select is(
  (select bucket || ':' || hits from private.mcp_rate where subject_id = 'f1660000-0000-4000-8000-000000000001'),
  'report:1',
  'it counts in the report bucket, not the reads'
);

-- A user already at 10 this minute (and the next, so a call that lands on a new minute is still the 11th).
insert into private.mcp_rate (subject_id, subject_kind, bucket, window_start, hits)
select 'f1660000-0000-4000-8000-000000000002', 'user', 'report', minute, 10
from (values (date_trunc('minute', clock_timestamp())), (date_trunc('minute', clock_timestamp()) + interval '1 minute')) as w (minute);

create temp table rr_out (body jsonb);
insert into rr_out select public.bump_report_rate('f1660000-0000-4000-8000-000000000002');
select is((select body ->> 'allowed' from rr_out), 'false', 'the 11th file in a minute is refused');
select ok((select (body ->> 'retry_after_seconds')::integer between 1 and 60 from rr_out), 'it says when to come back');

select * from finish();
rollback;
