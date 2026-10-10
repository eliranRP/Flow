-- Project page speed. A test's tables start with no planner statistics, the state a small or
-- freshly synced company is in until autovacuum analyzes it. get_project must not depend on
-- them: with a 1-row guess for allocations it once looped every allocation over every project
-- line (n squared, minutes on this data). Invented data only.

begin;

select plan(3);

do $users$
begin
  perform tests.create_supabase_user('pps_owner', 'pps-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('pps_owner'), 'Example Speed LLC', false);

insert into public.projects (company_id, name, status)
select c.id, n, 'active'
from public.companies c
cross join (values ('Speed A'), ('Speed B')) v(n)
where c.name = 'Example Speed LLC';

create temp table pps_ref as
select
  (select id from public.companies where name = 'Example Speed LLC') as cid,
  (select id from public.projects where name = 'Speed A') as a,
  (select id from public.projects where name = 'Speed B') as b;
grant select on pps_ref to authenticated;

-- 1,500 direct lines and 60 income lines on project A, and 600 shared lines split 50/50
-- between A and B.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description, user_assigned
)
select r.cid, 'expense', 'expense', 'project', 'posted', 'ILS',
  -100 - n, -100 - n, 0, 'source',
  date '2026-01-01' + (n % 300), date '2026-01-01' + (n % 300), 'manual', 'pps:d:' || n, r.a,
  'example direct ' || n, true
from pps_ref r cross join generate_series(1, 1500) n;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description, user_assigned
)
select r.cid, 'income', 'invoice', 'project', 'posted', 'ILS',
  5000 + n, 5000 + n, 0, 'source',
  date '2026-01-01' + (n % 300), date '2026-01-01' + (n % 300), 'manual', 'pps:i:' || n, r.a,
  'example income ' || n, true
from pps_ref r cross join generate_series(1, 60) n;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description, user_assigned
)
select r.cid, 'expense', 'expense', 'shared', 'posted', 'ILS',
  -200, -200, 0, 'source',
  date '2026-01-01' + (n % 300), date '2026-01-01' + (n % 300), 'manual', 'pps:s:' || n, null,
  'example shared ' || n, true
from pps_ref r cross join generate_series(1, 600) n;

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select r.cid, t.id, s.project_id, 5000, -100
from pps_ref r
join public.transactions t on t.company_id = r.cid and t.idempotency_key like 'pps:s:%'
cross join lateral (values (r.a), (r.b)) s(project_id);

select tests.authenticate_as('pps_owner');

create temp table pps_run (started timestamptz, finished timestamptz, out jsonb);
grant all on pps_run to authenticated;

insert into pps_run (started) values (clock_timestamp());
update pps_run set out = public.get_project((select a from pps_ref), 'invoiced');
update pps_run set finished = clock_timestamp();

select is(
  (select (out->>'shared_agorot')::bigint from pps_run),
  60000::bigint,
  'the 600 shared lines count their half for project A'
);

select is(
  (select (out->>'direct_agorot')::bigint from pps_run),
  (select sum(100 + n)::bigint from generate_series(1, 1500) n),
  'the 1,500 direct lines count in full'
);

-- About 0.8 s on a fresh local database; the n-squared plans took about four minutes here.
select ok(
  (select finished - started from pps_run) < interval '3 seconds',
  'get_project on 2,100 lines stays fast with no planner statistics'
);

select diag((select (finished - started)::text from pps_run));
select * from finish();
rollback;
