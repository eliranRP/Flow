-- FLOW-311. A line split by category counts once per part, under the part's category and
-- project, on both bases, in USD and ILS. Kept-out parts go to the excluded totals.
-- Invented data only. USD amounts are cents, ILS amounts are agorot.

begin;

select plan(42);

do $users$
begin
  perform tests.create_supabase_user('lsp_owner', 'lsp-owner@example.com');
  perform tests.create_supabase_user('lsp_other', 'lsp-other@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('lsp_owner'), 'Example Split LLC', false),
  (tests.get_supabase_uid('lsp_other'), 'Example Other LLC', false);

create temp table lsp (label text primary key, id uuid);
grant all on lsp to authenticated;
insert into lsp (label, id) select 'co', id from public.companies where name = 'Example Split LLC';
insert into lsp (label, id) select 'other_co', id from public.companies where name = 'Example Other LLC';

insert into public.projects (company_id, name, status)
select (select id from lsp where label = 'co'), v.name, 'active'
from (values ('North'), ('South')) as v(name);
insert into public.projects (company_id, name, status)
values ((select id from lsp where label = 'other_co'), 'Foreign', 'active');
insert into lsp (label, id) select lower(name), id from public.projects where name in ('North', 'South', 'Foreign');

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select (select id from lsp where label = 'co'), v.name, v.kind::public.category_kind, 90, false, v.excluded
from (values
  ('Repairs', 'expense', false),
  ('Closing fees', 'expense', false),
  ('Insurance', 'expense', false),
  ('Purchase price', 'expense', true),
  ('Rent', 'income', false),
  ('Late fees', 'income', false),
  ('Security deposit', 'income', true)
) as v(name, kind, excluded);
insert into public.categories (company_id, name, kind, sort_order, is_default)
values ((select id from lsp where label = 'other_co'), 'Foreign repairs', 'expense', 90, false);
insert into lsp (label, id)
select lower(replace(name, ' ', '_')), id from public.categories
where name in ('Repairs', 'Closing fees', 'Insurance', 'Purchase price', 'Rent', 'Late fees',
  'Security deposit', 'Foreign repairs');

-- Lines: a USD repair bill for two projects, a USD closing wire, a USD inflow of rent and a
-- deposit, an ILS bill, and a shared USD bill. All posted, no VAT.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select (select id from lsp where label = 'co'), v.direction::public.txn_direction, v.doc_kind::public.doc_kind,
  v.role::public.pnl_role, 'posted', v.currency,
  v.amount, v.amount, abs(v.amount), 0, 'source', '2026-06-10', '2026-06-10', 'manual', v.key,
  (select id from lsp where label = v.project), (select id from lsp where label = v.category), v.key, true
from (values
  ('lsp:repair',  'expense', 'expense', 'project', 'USD', -317000, 'north', 'repairs'),
  ('lsp:closing', 'expense', 'expense', 'project', 'USD', -100000, 'south', 'closing_fees'),
  ('lsp:inflow',  'income',  'receipt', null,      'USD',  340000, 'north', 'rent'),
  ('lsp:ils',     'expense', 'expense', 'project', 'ILS',  -50000, 'north', 'repairs'),
  ('lsp:shared',  'expense', 'expense', 'shared',  'USD',  -10000, null,    'repairs')
) as v(key, direction, doc_kind, role, currency, amount, project, category);
insert into lsp (label, id) select replace(idempotency_key, 'lsp:', 'txn_'), id
from public.transactions where idempotency_key like 'lsp:%';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from lsp where label = 'co'), (select id from lsp where label = 'txn_shared'),
  (select id from lsp where label = v.project), 5000, -5000
from (values ('north'), ('south')) as v(project);

create function pg_temp.part(p_category text, p_amount bigint, p_project text default null)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'category_id', (select id from lsp where label = p_category),
    'project_id', (select id from lsp where label = p_project),
    'amount_minor', p_amount
  )
$$;
grant execute on function pg_temp.part(text, bigint, text) to authenticated;

create function pg_temp.cur(p_basis text, p_currency text) returns jsonb
language sql
as $$
  select x from jsonb_array_elements(public.get_dashboard(null, null, p_basis) -> 'by_currency') x
  where x ->> 'currency' = p_currency
$$;
grant execute on function pg_temp.cur(text, text) to authenticated;

create function pg_temp.proj(p_project text, p_currency text) returns jsonb
language sql
as $$
  select x from jsonb_array_elements(
    public.get_project((select id from lsp where label = p_project), 'cash') -> 'by_currency'
  ) x
  where x ->> 'currency' = p_currency
$$;
grant execute on function pg_temp.proj(text, text) to authenticated;

create function pg_temp.proj_cat(p_project text, p_category text) returns bigint
language sql
as $$
  select (x ->> 'amount_minor')::bigint from jsonb_array_elements(
    public.get_project((select id from lsp where label = p_project), 'cash') -> 'categories_by_currency'
  ) x
  where x ->> 'id' = (select id::text from lsp where label = p_category)
    and x ->> 'currency' = 'USD'
$$;
grant execute on function pg_temp.proj_cat(text, text) to authenticated;

select tests.authenticate_as('lsp_owner');

-- Baseline.
select is((pg_temp.cur('cash', 'USD') ->> 'expense_minor')::bigint, 427000::bigint, 'before: USD expense is the three bills');
select is((pg_temp.proj('north', 'USD') ->> 'direct_minor')::bigint, 317000::bigint, 'before: the repair bill is all North');

-- Refusals.
select throws_ok(
  $$select public.save_line_split((select id from lsp where label = 'txn_repair'),
    jsonb_build_array(pg_temp.part('repairs', 25000, 'north'), pg_temp.part('repairs', 291999, 'south')))$$,
  'parts must sum to the line', 'parts one cent short are refused');
select throws_ok(
  $$select public.save_line_split((select id from lsp where label = 'txn_repair'),
    jsonb_build_array(pg_temp.part('repairs', 317000, 'north')))$$,
  'validation', 'one part is refused');
select throws_ok(
  $$select public.save_line_split((select id from lsp where label = 'txn_repair'),
    jsonb_build_array(pg_temp.part('repairs', 17000, 'north'), pg_temp.part('repairs', 300000, 'north')))$$,
  'validation', 'the same category and project twice is refused');
select throws_ok(
  $$select public.save_line_split((select id from lsp where label = 'txn_repair'),
    jsonb_build_array(pg_temp.part('repairs', 17000, 'north'), pg_temp.part('rent', 300000)))$$,
  'a reversal part needs a project', 'an income part on a bill with no project of its own is refused');
select throws_ok(
  $$select public.save_line_split((select id from lsp where label = 'txn_repair'),
    jsonb_build_array(pg_temp.part('repairs', 17000, 'north'), pg_temp.part('repairs', 300000, 'foreign')))$$,
  'project not found', 'another company''s project is refused');
select throws_ok(
  $$select public.save_line_split((select id from lsp where label = 'txn_repair'),
    jsonb_build_array(pg_temp.part('repairs', 17000, 'north'), pg_temp.part('foreign_repairs', 300000, 'south')))$$,
  'category not found', 'another company''s category is refused');
select throws_ok(
  $$select public.save_line_split((select id from lsp where label = 'txn_repair'),
    jsonb_build_array(pg_temp.part('repairs', 0, 'north'), pg_temp.part('repairs', 317000, 'south')))$$,
  'validation', 'a zero part is refused');
select throws_ok(
  $$select public.save_line_split((select id from lsp where label = 'txn_repair'),
    jsonb_build_array(pg_temp.part('repairs', 17000, 'north') || '{"share": 5}'::jsonb, pg_temp.part('repairs', 300000, 'south')))$$,
  'validation', 'an unknown key is refused');
select is((select count(*)::integer from public.line_splits), 0, 'nothing was written by the refusals');

-- Exact cents across two projects, same category.
select is(
  public.save_line_split((select id from lsp where label = 'txn_repair'),
    jsonb_build_array(pg_temp.part('repairs', 25000, 'north'), pg_temp.part('repairs', 292000, 'south'))),
  jsonb_build_array(pg_temp.part('repairs', 25000, 'north'), pg_temp.part('repairs', 292000, 'south')),
  'the split saves and returns its parts in order');
select is((pg_temp.proj('north', 'USD') ->> 'direct_minor')::bigint, 25000::bigint, 'North gets exactly 250.00');
select is((pg_temp.proj('south', 'USD') ->> 'direct_minor')::bigint, 392000::bigint, 'South gets exactly 2,920.00 plus the closing wire');
select is((pg_temp.cur('cash', 'USD') ->> 'expense_minor')::bigint, 427000::bigint, 'the company total is unchanged');
select is((pg_temp.cur('invoiced', 'USD') ->> 'expense_minor')::bigint, 427000::bigint, 'and the same on the invoiced basis');
select is((pg_temp.cur('cash', 'USD') ->> 'count')::integer, 4, 'a split line still counts as one line');

-- A closing wire: a kept-out purchase price, fees on another project, insurance on the line's project.
select lives_ok(
  $$select public.save_line_split((select id from lsp where label = 'txn_closing'),
    jsonb_build_array(
      pg_temp.part('purchase_price', 80000),
      pg_temp.part('closing_fees', 15000, 'north'),
      pg_temp.part('insurance', 5000)))$$,
  'a three-part closing wire saves');
select is((pg_temp.cur('cash', 'USD') ->> 'excluded_expense_minor')::bigint, 80000::bigint, 'the purchase price is kept out');
select is((pg_temp.cur('cash', 'USD') ->> 'expense_minor')::bigint, 347000::bigint, 'and leaves the expense total');
select is(pg_temp.proj_cat('north', 'closing_fees'), 15000::bigint, 'fees count on North under their own category');
select is(pg_temp.proj_cat('south', 'insurance'), 5000::bigint, 'a part with no project keeps the line''s project');
select is(pg_temp.proj_cat('south', 'closing_fees'), null::bigint, 'the line''s own category gets nothing');
select is(
  (select (x ->> 'amount_minor')::bigint from jsonb_array_elements(
    public.get_project((select id from lsp where label = 'south'), 'cash') -> 'excluded_categories_by_currency') x
   where x ->> 'id' = (select id::text from lsp where label = 'purchase_price')),
  80000::bigint, 'the project lists the purchase price as kept out');

-- An inflow of rent, a late fee, and a kept-out deposit.
select lives_ok(
  $$select public.save_line_split((select id from lsp where label = 'txn_inflow'),
    jsonb_build_array(
      pg_temp.part('rent', 200000),
      pg_temp.part('late_fees', 40000, 'south'),
      pg_temp.part('security_deposit', 100000)))$$,
  'an inflow with two income categories and a deposit saves');
select is((pg_temp.cur('cash', 'USD') ->> 'income_minor')::bigint, 240000::bigint, 'rent and the late fee count as income');
select is((pg_temp.cur('cash', 'USD') ->> 'excluded_income_minor')::bigint, 100000::bigint, 'the deposit is kept out');
select is((pg_temp.proj('north', 'USD') ->> 'income_minor')::bigint, 200000::bigint, 'rent stays on North');
select is((pg_temp.proj('south', 'USD') ->> 'income_minor')::bigint, 40000::bigint, 'the late fee counts on South');

-- ILS, both bases.
select lives_ok(
  $$select public.save_line_split((select id from lsp where label = 'txn_ils'),
    jsonb_build_array(pg_temp.part('repairs', 30000), pg_temp.part('insurance', 20000, 'south')))$$,
  'an ILS bill splits');
select is((public.get_dashboard(null, null, 'cash') ->> 'expense_agorot')::bigint, 50000::bigint, 'ILS expense is unchanged on the cash basis');
select is((public.get_dashboard(null, null, 'invoiced') ->> 'expense_agorot')::bigint, 50000::bigint, 'and on the invoiced basis');
select is((public.get_project((select id from lsp where label = 'south'), 'cash') ->> 'direct_agorot')::bigint, 20000::bigint, 'South gets the ILS insurance part');
select is((public.get_project((select id from lsp where label = 'north'), 'cash') ->> 'direct_agorot')::bigint, 30000::bigint, 'North keeps the rest');

-- A shared bill: parts with no project are shared by the line's allocations, in proportion.
select lives_ok(
  $$select public.save_line_split((select id from lsp where label = 'txn_shared'),
    jsonb_build_array(pg_temp.part('repairs', 6000), pg_temp.part('insurance', 4000)))$$,
  'a shared bill splits');
select is(pg_temp.proj_cat('north', 'insurance'), 2000::bigint, 'North''s shared half of the insurance part');
select is((pg_temp.proj('north', 'USD') ->> 'shared_minor')::bigint, 5000::bigint, 'the shared total is still half the line');

-- A line split by category takes no loan split.
reset role;
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency)
values ((select id from lsp where label = 'co'), 'Example note', 1000000, 60000, 360, '2026-01-01', 10000, 0, 'USD');
select throws_ok(
  $$insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id)
    select t.company_id, l.id, t.id, 'interest', 100, 100, (select id from lsp where label = 'repairs')
    from public.transactions t join public.loans l on l.company_id = t.company_id
    where t.id = (select id from lsp where label = 'txn_repair')$$,
  'line has a split by category', 'a loan split on a split line is refused');

-- A re-sync that changes the amount makes the line count whole until the parts are fixed.
update public.transactions set amount_net = -320000, amount_gross = -320000
where id = (select id from lsp where label = 'txn_repair');
select tests.authenticate_as('lsp_owner');
select is((pg_temp.proj('north', 'USD') ->> 'direct_minor')::bigint, 335000::bigint, 'a split that no longer sums counts whole on the line''s project (plus North''s closing fees)');
select is(
  public.get_line_split((select id from lsp where label = 'txn_repair')) -> 'parts_match',
  'false'::jsonb, 'get_line_split reports the mismatch');

-- Clearing restores the whole line.
select is(public.save_line_split((select id from lsp where label = 'txn_closing'), '[]'::jsonb), '[]'::jsonb, 'an empty array clears the split');
select is((pg_temp.cur('cash', 'USD') ->> 'excluded_expense_minor')::bigint, 0::bigint, 'the cleared wire counts whole again');

select * from finish();
rollback;
