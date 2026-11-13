-- FLOW-1171 (decision 0230): the project page read, faster, the same figures (20261113163849).
-- (1) private.project_investment reads the owner's cash switch from the joined line instead of
-- calling private.line_in_cash per row, and the direct branch reads only the project's lines: its
-- rehab figures equal the previous query, kept below as pg_temp references, on a shared line, a
-- split line, a category and a line not in cash, a switch on and off, a guessed category and a loan
-- part. (2) get_project(..., p_lines false), what the app asks, leaves out the lines and the
-- arrays it never reads and gives every other key the same value. (3) The default answer, which
-- flow-mcp gets, keeps every key. Invented data only. Amounts are agorot.

begin;

select plan(29);

do $users$
begin
  perform tests.create_supabase_user('gps_owner', 'gps-owner@example.com');
end
$users$;

create temp table gps (label text primary key, id uuid);
grant all on gps to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.gps where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into gps (label, id) values ('co', tests.fixture_company('gps_owner', 'Example Speed LLC', true));
insert into gps (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('barn', tests.fixture_project(pg_temp.id('co'), 'Example Barn')),
  ('shed', tests.fixture_project(pg_temp.id('co'), 'Example Shed')),
  ('materials', tests.fixture_category(pg_temp.id('co'), 'Materials')),
  ('tiles', tests.fixture_category(pg_temp.id('co'), 'Tiles')),
  ('cashoff', tests.fixture_category(pg_temp.id('co'), 'Off cash')),
  ('purchase', tests.fixture_category(pg_temp.id('co'), 'Purchase', 'expense', true)),
  ('sales', tests.fixture_category(pg_temp.id('co'), 'Sales', 'income')),
  ('rent_out', tests.fixture_category(pg_temp.id('co'), 'Deposits', 'income', true));
update public.categories set parent_id = pg_temp.id('materials') where id = pg_temp.id('tiles');
update public.categories set in_cash = false where id = pg_temp.id('cashoff');
insert into gps (label, id)
select 'interest', c.id from public.categories c
where c.company_id = pg_temp.id('co') and c.loan_part = 'interest';

-- House: counted lines, a line whose category is off cash, one the owner switched on, one the owner
-- switched off, a guessed category, a kept-out purchase, no category, an unpaid invoice, a pending
-- line and income.
insert into gps (label, id) values
  ('m1', tests.fixture_line(pg_temp.id('co'), 'gps:m1', 100000, p_project => pg_temp.id('house'), p_category => pg_temp.id('materials'))),
  ('t1', tests.fixture_line(pg_temp.id('co'), 'gps:t1', 25000, p_project => pg_temp.id('house'), p_category => pg_temp.id('tiles'))),
  ('c1', tests.fixture_line(pg_temp.id('co'), 'gps:c1', 40000, p_project => pg_temp.id('house'), p_category => pg_temp.id('cashoff'))),
  ('c2', tests.fixture_line(pg_temp.id('co'), 'gps:c2', 30000, p_project => pg_temp.id('house'), p_category => pg_temp.id('cashoff'))),
  ('m2', tests.fixture_line(pg_temp.id('co'), 'gps:m2', 9000, p_project => pg_temp.id('house'), p_category => pg_temp.id('materials'))),
  ('g1', tests.fixture_line(pg_temp.id('co'), 'gps:g1', 12000, p_project => pg_temp.id('house'), p_category => pg_temp.id('cashoff'), p_suggested => true)),
  ('k1', tests.fixture_line(pg_temp.id('co'), 'gps:k1', 5000000, p_project => pg_temp.id('house'), p_category => pg_temp.id('purchase'))),
  ('n1', tests.fixture_line(pg_temp.id('co'), 'gps:n1', 20000, p_project => pg_temp.id('house'))),
  ('u1', tests.fixture_line(pg_temp.id('co'), 'gps:u1', 7000, p_project => pg_temp.id('house'), p_category => pg_temp.id('materials'), p_doc_kind => 'invoice')),
  ('pend', tests.fixture_line(pg_temp.id('co'), 'gps:pend', 3000, p_project => pg_temp.id('house'), p_category => pg_temp.id('materials'), p_line_status => 'pending')),
  ('pend_usd', tests.fixture_line(pg_temp.id('co'), 'gps:pend_usd', 1500, p_project => pg_temp.id('house'), p_category => pg_temp.id('materials'), p_currency => 'USD', p_line_status => 'pending')),
  ('inc', tests.fixture_line(pg_temp.id('co'), 'gps:inc', 99900, 'income', pg_temp.id('house'), pg_temp.id('sales'))),
  ('inc_out', tests.fixture_line(pg_temp.id('co'), 'gps:inc_out', 5000, 'income', pg_temp.id('house'), pg_temp.id('rent_out'))),
  ('usd', tests.fixture_line(pg_temp.id('co'), 'gps:usd', 5000, p_project => pg_temp.id('barn'), p_category => pg_temp.id('materials'), p_currency => 'USD')),
  ('s1', tests.fixture_line(pg_temp.id('co'), 'gps:s1', 40000, p_category => pg_temp.id('materials'), p_pnl_role => 'shared')),
  ('s2', tests.fixture_line(pg_temp.id('co'), 'gps:s2', 20000, p_category => pg_temp.id('cashoff'), p_pnl_role => 'shared')),
  ('sp', tests.fixture_line(pg_temp.id('co'), 'gps:sp', 60000, p_category => pg_temp.id('materials'))),
  ('pay', tests.fixture_line(pg_temp.id('co'), 'gps:pay', 100000, p_project => pg_temp.id('house'), p_category => pg_temp.id('interest')));
update public.transactions set cash_date = null where id = pg_temp.id('u1');
update public.transactions set in_cash_override = true where id = pg_temp.id('c2');
update public.transactions set in_cash_override = false where id = pg_temp.id('m2');

-- A shared line: a quarter to the house, the rest to the barn. A second one in the category that is
-- off cash, which no project counts as renovation.
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net) values
  (pg_temp.id('co'), pg_temp.id('s1'), pg_temp.id('house'), 2500, -10000),
  (pg_temp.id('co'), pg_temp.id('s1'), pg_temp.id('barn'), 7500, -30000),
  (pg_temp.id('co'), pg_temp.id('s2'), pg_temp.id('house'), 5000, -10000),
  (pg_temp.id('co'), pg_temp.id('s2'), pg_temp.id('barn'), 5000, -10000);

-- A split line: 200.00 to the house in Materials, 100.00 to the barn in Materials, 300.00 to the
-- house in the category that is off cash.
select tests.line_split(pg_temp.id('sp'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('materials'), 'project_id', pg_temp.id('house'), 'amount_minor', 20000),
  jsonb_build_object('category_id', pg_temp.id('materials'), 'project_id', pg_temp.id('barn'), 'amount_minor', 10000),
  jsonb_build_object('category_id', pg_temp.id('cashoff'), 'project_id', pg_temp.id('house'), 'amount_minor', 30000)));

-- A loan payment on the house in four parts. Its fees part sits in Materials, which counts as rehab,
-- but a loan part stays out of rehab unless its category is switched on.
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency, project_id
)
values (pg_temp.id('co'), 'House mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 0, 'ILS', pg_temp.id('house'));
select tests.loan_split(pg_temp.id('pay'), (select id from public.loans where name = 'House mortgage'), (
  select jsonb_agg(jsonb_build_object('part', v.part, 'amount_minor', v.amount, 'scheduled_minor', v.amount,
    'category_id', coalesce(
      (select c.id from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = v.part::public.loan_split_part),
      pg_temp.id('materials')),
    'needs_review', false) order by v.n)
  from (values (1, 'interest', 60000), (2, 'escrow', 10000), (3, 'principal', 20000), (4, 'fees', 10000)) as v(n, part, amount)));

-- The previous project_investment costs query, with private.line_in_cash as it was (20261102120327).
create or replace function pg_temp.old_line_in_cash(p_transaction_id uuid, p_category_id uuid, p_part public.loan_split_part)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    t.in_cash_override,
    not private.line_category_out(
      c.in_cash is false,
      t.category_suggested and p_category_id is not distinct from t.category_id,
      p_part
    )
  )
  from public.transactions t
  left join public.categories c on c.id = p_category_id and c.company_id = t.company_id
  where t.id = p_transaction_id;
$$;
grant execute on function pg_temp.old_line_in_cash(uuid, uuid, public.loan_split_part) to authenticated, service_role;

-- Old rehab rows by currency and category.
create or replace function pg_temp.old_costs(p_company uuid, p_project uuid)
returns table (currency text, category_id uuid, amount_minor bigint)
language sql
stable
set search_path = ''
as $$
  with costs as (
    select l.currency, l.category_id, l.amount_net
    from private.pnl_lines l
    left join public.categories c on c.id = l.category_id
    where l.company_id = p_company
      and l.project_id = p_project
      and l.kind = 'expense'
      and l.pnl_role = 'project'
      and not l.unpaid
      and private.category_in_rehab(c.rehab, c.excluded_from_pnl, coalesce(c.loan_part, l.part))
      and coalesce(pg_temp.old_line_in_cash(l.transaction_id, l.category_id, l.part), true)
    union all
    select l.currency, l.category_id, coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    from private.pnl_lines l
    cross join lateral (
      select a.amount_net from public.allocations a
      where a.transaction_id = l.transaction_id and a.project_id = p_project
      offset 0
    ) a
    left join public.categories c on c.id = l.category_id
    where l.transaction_id = any(array(
        select a2.transaction_id from public.allocations a2
        where a2.company_id = p_company and a2.project_id = p_project
      ))
      and l.company_id = p_company
      and l.kind = 'expense'
      and l.pnl_role = 'shared'
      and not l.unpaid
      and private.category_in_rehab(c.rehab, c.excluded_from_pnl, coalesce(c.loan_part, l.part))
      and coalesce(pg_temp.old_line_in_cash(l.transaction_id, l.category_id, l.part), true)
  )
  select x.currency, x.category_id, (-sum(x.amount_net))::bigint from costs x group by x.currency, x.category_id;
$$;
grant execute on function pg_temp.old_costs(uuid, uuid) to authenticated, service_role;

-- The new answer's rehab figures as the same rows: the project's currency here is ILS, so
-- rehab_by_category carries the ILS rows and rehab_other_currencies the rest.
create or replace function pg_temp.new_costs(p_project text)
returns table (currency text, category_id uuid, amount_minor bigint)
language sql
stable
as $$
  select 'ILS', (e->>'category_id')::uuid, (e->>'amount_minor')::bigint
  from jsonb_array_elements(private.project_investment(pg_temp.id('co'), pg_temp.id(p_project))->'rehab_by_category') e
  union all
  select e->>'currency', null::uuid, (e->>'amount_minor')::bigint
  from jsonb_array_elements(private.project_investment(pg_temp.id('co'), pg_temp.id(p_project))->'rehab_other_currencies') e;
$$;
grant execute on function pg_temp.new_costs(text) to authenticated, service_role;

-- The previous rows as the new answer reports them: a cost in another currency has no category row.
create or replace function pg_temp.old_rows(p_project text)
returns jsonb
language sql
stable
as $$
  select jsonb_agg(jsonb_build_object('currency', o.currency, 'category_id', case when o.currency = 'ILS' then o.category_id end,
    'amount_minor', o.amount_minor) order by o.currency, o.category_id nulls last)
  from pg_temp.old_costs(pg_temp.id('co'), pg_temp.id(p_project)) o;
$$;
grant execute on function pg_temp.old_rows(text) to authenticated, service_role;

create or replace function pg_temp.inv(p_project text)
returns jsonb
language sql
as $$ select private.project_investment(pg_temp.id('co'), pg_temp.id(p_project)); $$;
grant execute on function pg_temp.inv(text) to authenticated, service_role;

create or replace function pg_temp.gp(p_project text, p_basis text default 'cash', p_lines boolean default true,
  p_from date default null, p_to date default null)
returns jsonb
language sql
as $$ select public.get_project(pg_temp.id(p_project), p_basis, p_from, p_to, p_lines); $$;
grant execute on function pg_temp.gp(text, text, boolean, date, date) to authenticated, service_role;

create or replace function pg_temp.unused()
returns text[]
language sql
as $$
  select array['transactions', 'category_rollups', 'category_rollups_by_currency', 'excluded_categories_by_currency',
    'excluded_category_rollups_by_currency', 'pending_agorot', 'pending_other_currencies'];
$$;
grant execute on function pg_temp.unused() to authenticated, service_role;

select tests.authenticate_as('gps_owner');

-- (1) project_investment.
select is((pg_temp.inv('house')->>'rehab_minor')::bigint, 217000::bigint,
  'house rehab: counted lines, the switched-on and guessed ones, a shared share, a split part; not the switched-off, off-cash or loan-part ones');
select is(
  (select jsonb_agg(jsonb_build_array(c.name, e->>'amount_minor') order by c.name nulls last)
   from jsonb_array_elements(pg_temp.inv('house')->'rehab_by_category') e
   left join public.categories c on c.id = (e->>'category_id')::uuid),
  '[["Materials", "130000"], ["Off cash", "42000"], ["Tiles", "25000"], [null, "20000"]]'::jsonb,
  'by category: Materials 1000 + shared 100 + split 200; Off cash only the switched-on 300 and the guessed 120; a sub-category; no category');
select is((pg_temp.inv('barn')->>'rehab_minor')::bigint, 40000::bigint,
  'barn rehab: its shared share 300 and its split part 100; the shared line in the category off cash is out');
select is(pg_temp.inv('barn')->'rehab_other_currencies', '[{"currency": "USD", "amount_minor": 5000}]'::jsonb,
  'a cost in another currency is listed apart');
select is((pg_temp.inv('shed')->>'rehab_minor')::bigint, 0::bigint, 'a project with no lines has none');
select is(
  (select jsonb_agg(to_jsonb(n) order by n.currency, n.category_id nulls last) from pg_temp.new_costs('house') n),
  pg_temp.old_rows('house'),
  'house: the rows equal the previous per-line query');
select is(
  (select jsonb_agg(to_jsonb(n) order by n.currency, n.category_id nulls last) from pg_temp.new_costs('barn') n),
  pg_temp.old_rows('barn'),
  'barn: the rows equal the previous per-line query');
select is(
  (select count(*) from pg_temp.old_costs(pg_temp.id('co'), pg_temp.id('shed'))), 0::bigint,
  'shed: the previous query found nothing either');
select is(to_regprocedure('private.line_in_cash(uuid, uuid, public.loan_split_part)'), null,
  'private.line_in_cash, which nothing calls now, is dropped');

-- The owner's switch moves the figure, and the new query still equals the old one.
reset role;
update public.transactions set in_cash_override = null where id = pg_temp.id('c2');
select tests.authenticate_as('gps_owner');
select is((pg_temp.inv('house')->>'rehab_minor')::bigint, 187000::bigint,
  'taking the owner''s switch off a line in the off-cash category takes it out of rehab');
reset role;
update public.transactions set in_cash_override = true where id = pg_temp.id('c1');
select tests.authenticate_as('gps_owner');
select is((pg_temp.inv('house')->>'rehab_minor')::bigint, 227000::bigint,
  'and switching one on brings it in');
select is(
  (select jsonb_agg(to_jsonb(n) order by n.currency, n.category_id nulls last) from pg_temp.new_costs('house') n),
  pg_temp.old_rows('house'),
  'house after the switches: still equal to the previous query');

-- (2) get_project with p_lines false.
select ok(not (pg_temp.gp('house', 'cash', false) ?| pg_temp.unused()),
  'p_lines false: no lines, no roll-ups, no excluded categories, no pending sums');
select ok(pg_temp.gp('house', 'cash', false) ?& array['pending_count', 'categories', 'categories_by_currency', 'investment', 'loans', 'by_currency', 'excluded_income_by_currency', 'other_currencies'],
  'p_lines false: every key the app reads is there');
select is(pg_temp.gp('house', 'cash', false), pg_temp.gp('house', 'cash', true) - pg_temp.unused(),
  'p_lines false equals the full answer less those keys (house, cash)');
select is(pg_temp.gp('house', 'invoiced', false), pg_temp.gp('house', 'invoiced', true) - pg_temp.unused(),
  'house, invoiced');
select is(pg_temp.gp('barn', 'cash', false), pg_temp.gp('barn', 'cash', true) - pg_temp.unused(),
  'barn, cash (a shared share, a split part, a cost in dollars)');
select is(pg_temp.gp('house', 'cash', false, '2026-06-01', '2026-06-30'), pg_temp.gp('house', 'cash', true, '2026-06-01', '2026-06-30') - pg_temp.unused(),
  'a period');
select is(pg_temp.gp('shed', 'cash', false), pg_temp.gp('shed', 'cash', true) - pg_temp.unused(), 'a project with no lines');
select ok(octet_length(pg_temp.gp('house', 'cash', false)::text) < octet_length(pg_temp.gp('house', 'cash', true)::text),
  'and the answer is smaller');
select is(pg_temp.gp('house', 'cash', false)->'investment', pg_temp.inv('house'), 'the investment block is the same function''s');

-- (3) The default answer.
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.get_project(pg_temp.id('house'), 'cash')) k),
  array['after_overhead', 'base_currency', 'budget_agorot', 'by_currency', 'categories', 'categories_by_currency',
    'category_rollups', 'category_rollups_by_currency', 'direct_agorot', 'excluded_categories_by_currency',
    'excluded_category_rollups_by_currency', 'excluded_income_by_currency', 'from', 'id', 'income_agorot', 'investment',
    'is_overhead', 'loans', 'name', 'other_currencies', 'overhead_share_agorot', 'overhead_share_minor',
    'overhead_weighted', 'pending_agorot', 'pending_count', 'pending_other_currencies', 'profit_after_overhead_agorot',
    'profit_agorot', 'shared_agorot', 'state_label', 'status', 'sumit_budget_section_id', 'to', 'transactions'],
  'the default answer, flow-mcp''s, has all 34 keys it had');
select is(public.get_project(pg_temp.id('house'), 'cash'), pg_temp.gp('house', 'cash', true),
  'omitting p_lines is p_lines true');
select is(public.get_project(pg_temp.id('house')), public.get_project(pg_temp.id('house'), 'invoiced'),
  'the one-argument form still reads the invoiced answer');
select is((select jsonb_array_length(public.get_project(pg_temp.id('house'), 'cash')->'transactions')), 15,
  'the default lists the project''s lines: filed, shared and split to it; pending ones are not');
select is((public.get_project(pg_temp.id('house'), 'cash')->>'pending_agorot')::bigint, 12000::bigint,
  'and the waiting shekel sum: the line whose category is a guess');

-- Privileges are what the four-argument form had.
reset role;
select is(to_regprocedure('public.get_project(uuid, text, date, date)'), null, 'the four-argument signature is gone');
select ok(has_function_privilege('authenticated', 'public.get_project(uuid, text, date, date, boolean)', 'execute')
  and has_function_privilege('service_role', 'public.get_project(uuid, text, date, date, boolean)', 'execute'),
  'authenticated and service_role execute the new signature');
select ok(not has_function_privilege('anon', 'public.get_project(uuid, text, date, date, boolean)', 'execute'),
  'anon does not');

select * from finish();
rollback;
