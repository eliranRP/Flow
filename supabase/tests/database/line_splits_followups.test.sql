-- FLOW-312 items 1 and 6. get_project.transactions lists a line that reaches the project
-- only through a part, with parts_minor; other_currencies.count in get_home and get_project
-- counts each bank line once, not once per part. Invented data only. USD amounts are cents.

begin;

select plan(16);

do $users$
begin
  perform tests.create_supabase_user('lsf_owner', 'lsf-owner@example.com');
  perform tests.create_supabase_user('lsf_other', 'lsf-other@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('lsf_owner'), 'Example Parts LLC', false),
  (tests.get_supabase_uid('lsf_other'), 'Example Parts Neighbour LLC', false);

create temp table lsf (label text primary key, id uuid);
grant all on lsf to authenticated;
insert into lsf (label, id) select 'co', id from public.companies where name = 'Example Parts LLC';
insert into lsf (label, id) select 'other_co', id from public.companies where name = 'Example Parts Neighbour LLC';

insert into public.projects (company_id, name, status)
select (select id from lsf where label = 'co'), v.name, 'active'
from (values ('East'), ('West'), ('Quiet')) as v(name);
insert into lsf (label, id) select lower(name), id from public.projects
where name in ('East', 'West', 'Quiet') and company_id = (select id from lsf where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default)
select (select id from lsf where label = 'co'), v.name, 'expense', 90, false
from (values ('Repairs'), ('Upgrades')) as v(name);
insert into lsf (label, id) select lower(name), id from public.categories
where name in ('Repairs', 'Upgrades') and company_id = (select id from lsf where label = 'co');

-- On East: a USD bill split later between East and West, a plain bill, a bill whose parts all
-- go to West, and a mortgage payment split into its three loan parts.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select (select id from lsf where label = 'co'), 'expense', 'expense', 'project', 'posted', 'USD',
  v.amount, v.amount, abs(v.amount), 0, 'source', '2026-06-10', '2026-06-10', 'manual', v.key,
  (select id from lsf where label = 'east'), (select id from lsf where label = 'repairs'), v.key, true
from (values ('lsf:split', -300000), ('lsf:plain', -5000), ('lsf:moved', -20000), ('lsf:loan', -100000)) as v(key, amount);
insert into lsf (label, id) select replace(idempotency_key, 'lsf:', 'txn_'), id
from public.transactions where idempotency_key like 'lsf:%';

insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values ((select id from lsf where label = 'co'), 'Example mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'USD');

insert into public.loan_splits (
  company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
)
select t.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount,
  (select k.id from public.categories k where k.company_id = t.company_id and k.name = v.cat and k.kind = 'expense')
from public.transactions t
join public.loans l on l.company_id = t.company_id
join (values
  ('interest', 70000, 'ריבית משכנתא'),
  ('escrow', 20000, 'מסים וביטוח'),
  ('principal', 10000, 'תשלומי הלוואה')
) as v(part, amount, cat) on t.idempotency_key = 'lsf:loan';

create function pg_temp.row_of(p_project text, p_txn text) returns jsonb
language sql
as $$
  select x from jsonb_array_elements(
    public.get_project((select id from lsf where label = p_project), 'cash') -> 'transactions'
  ) x
  where x ->> 'id' = (select id::text from lsf where label = p_txn)
$$;
grant execute on function pg_temp.row_of(text, text) to authenticated;

create function pg_temp.proj_count(p_project text) returns int
language sql
as $$
  select (x ->> 'count')::int from jsonb_array_elements(
    public.get_project((select id from lsf where label = p_project), 'cash') -> 'other_currencies'
  ) x
  where x ->> 'currency' = 'USD'
$$;
grant execute on function pg_temp.proj_count(text) to authenticated;

create function pg_temp.home_count() returns int
language sql
as $$
  select (x ->> 'count')::int from jsonb_array_elements(public.get_home() -> 'other_currencies') x
  where x ->> 'currency' = 'USD'
$$;
grant execute on function pg_temp.home_count() to authenticated;

select tests.authenticate_as('lsf_owner');

-- Before the split: West has no line, the East row carries a null parts_minor.
select is(pg_temp.row_of('west', 'txn_split'), null, 'before the split West does not list the line');
select is(pg_temp.row_of('east', 'txn_split') -> 'parts_minor', 'null'::jsonb,
  'a line with no split by category has a null parts_minor');

-- Two parts on East (one with no project, so it keeps the line's project) and one on West.
select public.save_line_split((select id from lsf where label = 'txn_split'), jsonb_build_array(
  jsonb_build_object('category_id', (select id from lsf where label = 'repairs'), 'project_id', null, 'amount_minor', 100000),
  jsonb_build_object('category_id', (select id from lsf where label = 'upgrades'), 'project_id', (select id from lsf where label = 'east'), 'amount_minor', 50000),
  jsonb_build_object('category_id', (select id from lsf where label = 'upgrades'), 'project_id', (select id from lsf where label = 'west'), 'amount_minor', 150000)
));
select public.save_line_split((select id from lsf where label = 'txn_moved'), jsonb_build_array(
  jsonb_build_object('category_id', (select id from lsf where label = 'repairs'), 'project_id', (select id from lsf where label = 'west'), 'amount_minor', 15000),
  jsonb_build_object('category_id', (select id from lsf where label = 'upgrades'), 'project_id', (select id from lsf where label = 'west'), 'amount_minor', 5000)
));

select isnt(pg_temp.row_of('west', 'txn_split'), null, 'West lists a line that reaches it only through a part');
select is((pg_temp.row_of('west', 'txn_split') ->> 'parts_minor')::bigint, 150000::bigint,
  'West''s parts_minor is its part');
select is((pg_temp.row_of('east', 'txn_split') ->> 'parts_minor')::bigint, 150000::bigint,
  'East''s parts_minor adds its own part and the part with no project');
select is(pg_temp.row_of('quiet', 'txn_split'), null, 'a project with no part does not list the line');
select is(pg_temp.row_of('east', 'txn_plain') -> 'parts_minor', 'null'::jsonb,
  'an unsplit line on the same project keeps a null parts_minor');
select is((pg_temp.row_of('east', 'txn_moved') ->> 'parts_minor')::bigint, 0::bigint,
  'a line filed to East with every part on West lists 0 on East');
select is((pg_temp.row_of('west', 'txn_moved') ->> 'parts_minor')::bigint, 20000::bigint,
  'West holds the whole of that line through its parts');
select is(pg_temp.row_of('east', 'txn_loan') -> 'parts_minor', 'null'::jsonb,
  'a loan split is not a split by category, so parts_minor stays null');

-- Counts: East has the split line (two parts), the plain line and the loan payment (two
-- parts in the P&L); West has the split line and the moved line; Home has all four.
select is(pg_temp.proj_count('east'), 3, 'get_project other_currencies counts a split line and a loan payment once each');
select is(pg_temp.proj_count('west'), 2, 'West counts each line its parts come from once');
select is(pg_temp.home_count(), 4, 'get_home other_currencies counts each split line and loan payment once');
select is(
  (select (x ->> 'count')::int from jsonb_array_elements(
    public.get_project((select id from lsf where label = 'west'), 'cash') -> 'other_currencies') x
   where x ->> 'currency' = 'USD'),
  2,
  'the moved line counts on West, not on East');
select is(
  (select (x ->> 'expense_minor')::bigint from jsonb_array_elements(
    public.get_project((select id from lsf where label = 'east'), 'cash') -> 'other_currencies') x
   where x ->> 'currency' = 'USD'),
  -245000::bigint,
  'East''s USD expense is its parts, the plain line and the loan interest and escrow');

-- Cross-tenant: the neighbour reads nothing of this company's project.
select tests.authenticate_as('lsf_other');
select is(public.get_project((select id from lsf where label = 'west'), 'cash'), null,
  'another company cannot read the project');

select * from finish();
rollback;
