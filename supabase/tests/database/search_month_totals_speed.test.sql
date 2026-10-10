-- Search month totals speed (FLOW-908). The first page of search_transactions adds up every
-- matching line, so an unfiltered search on a large company reads all its lines' P&L state.
-- A test's tables start with no planner statistics, as a freshly synced company does. Invented
-- data only.

begin;

select plan(4);

do $users$
begin
  perform tests.create_supabase_user('smts_owner', 'smts-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('smts_owner'), 'Example Search Speed LLC', false);

insert into public.projects (company_id, name, status)
select c.id, 'Search Speed A', 'active'
from public.companies c
where c.name = 'Example Search Speed LLC';

create temp table smts_ref as
select
  (select id from public.companies where name = 'Example Search Speed LLC') as cid,
  (select id from public.projects where name = 'Search Speed A') as a;
grant select on smts_ref to authenticated;

-- 3,800 expense lines and 200 income lines over ten months.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description, user_assigned
)
select r.cid, 'expense', 'expense', 'project', 'posted', 'ILS',
  -100 - n, -100 - n, 0, 'source',
  date '2026-01-01' + (n % 300), date '2026-01-01' + (n % 300), 'manual', 'smts:e:' || n, r.a,
  'example expense ' || n, true
from smts_ref r cross join generate_series(1, 3800) n;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description, user_assigned
)
select r.cid, 'income', 'invoice', 'project', 'posted', 'ILS',
  5000 + n, 5000 + n, 0, 'source',
  date '2026-01-01' + (n % 300), date '2026-01-01' + (n % 300), 'manual', 'smts:i:' || n, r.a,
  'example income ' || n, true
from smts_ref r cross join generate_series(1, 200) n;

select tests.authenticate_as('smts_owner');

create temp table smts_run (label text primary key, started timestamptz, finished timestamptz, out jsonb);
grant all on smts_run to authenticated;

insert into smts_run (label, started) values ('later', clock_timestamp());
update smts_run set out = public.search_transactions(p_offset => 50) where label = 'later';
update smts_run set finished = clock_timestamp() where label = 'later';

insert into smts_run (label, started) values ('first', clock_timestamp());
update smts_run set out = public.search_transactions() where label = 'first';
update smts_run set finished = clock_timestamp() where label = 'first';

select is(
  (select sum((e->>'expense_minor')::bigint)::bigint from smts_run, jsonb_array_elements(out->'months') e where label = 'first'),
  (select sum(100 + n)::bigint from generate_series(1, 3800) n),
  'the first page adds up all 3,800 expense lines, not the 50 it lists'
);

select is(
  (select sum((e->>'income_minor')::bigint)::bigint from smts_run, jsonb_array_elements(out->'months') e where label = 'first'),
  (select sum(5000 + n)::bigint from generate_series(1, 200) n),
  'and all 200 income lines'
);

-- The search page opens in 0.7 s through REST, which costs 150 to 500 ms on its own. The bound
-- is loose for slow CI; the diag lines show the real figures for the review.
select ok(
  (select finished - started from smts_run where label = 'first') < interval '1 second',
  'the first page with month totals on 4,000 lines stays fast with no planner statistics'
);

select ok(
  (select finished - started from smts_run where label = 'first')
    < (select finished - started from smts_run where label = 'later') + interval '400 milliseconds',
  'the month totals add under 0.4 s to a page'
);

select diag('first page ' || (select (finished - started)::text from smts_run where label = 'first')
  || ', later page ' || (select (finished - started)::text from smts_run where label = 'later'));

select * from finish();
rollback;
