-- FLOW-160: get_pnl_statement, the P&L as a statement for the reports screen, its PDF and the MCP.
-- Its totals are get_breakdown's for the same range and basis: by category for the company, by
-- project key for one project and by project. A sub-category rolls up into its parent, a kept-out
-- category is listed apart with its account, and another company's project reads as unknown.
-- Invented data only.

begin;

select plan(47);

do $users$
begin
  perform tests.create_supabase_user('ps_owner', 'ps-owner@example.com');
  perform tests.create_supabase_user('ps_other', 'ps-other@example.com');
end
$users$;

create temp table ps_ref (label text primary key, id uuid);
create temp table ps_out (label text primary key, body jsonb);
grant all on ps_ref, ps_out to authenticated;

create function pg_temp.ref(l text) returns uuid
language sql stable
as $$ select id from ps_ref where label = l $$;

create function pg_temp.out_of(l text) returns jsonb
language sql stable
as $$ select body from ps_out where label = l $$;

-- One currency's statement from a statement's currencies[].
create function pg_temp.cur(p jsonb, c text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p -> 'currencies') x where x ->> 'currency' = c $$;

-- get_breakdown's total for one currency.
create function pg_temp.bd_total(p jsonb, c text) returns bigint
language sql immutable
as $$ select coalesce((select (x ->> 'amount_minor')::bigint from jsonb_array_elements(p -> 'totals') x where x ->> 'currency' = c), 0) $$;

-- get_breakdown by project: one key's amount in one currency.
create function pg_temp.bd_group(p jsonb, c text, k text) returns bigint
language sql immutable
as $$ select coalesce((select sum((x ->> 'amount_minor')::bigint) from jsonb_array_elements(p -> 'groups') x
  where x ->> 'currency' = c and x ->> 'key' = k), 0)::bigint $$;

-- One category node of a statement side.
create function pg_temp.node(p jsonb, side text, n text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p -> side) x where x ->> 'name' = n $$;

-- One project key's statement in by_project.
create function pg_temp.proj(p jsonb, k text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p -> 'projects') x where x ->> 'key' = k $$;

grant execute on function pg_temp.ref(text), pg_temp.out_of(text), pg_temp.cur(jsonb, text), pg_temp.bd_total(jsonb, text),
  pg_temp.bd_group(jsonb, text, text), pg_temp.node(jsonb, text, text), pg_temp.proj(jsonb, text) to authenticated;

select tests.authenticate_as('ps_owner');
select public.create_company('Example Statement LLC', true);
select public.upsert_project(null, 'Site Alpha', null, 'active');
select public.upsert_project(null, 'Site Beta', null, 'active');
select public.upsert_project(null, 'Office', null, 'active');
insert into ps_ref (label, id) select 'co', id from public.companies where name = 'Example Statement LLC';
insert into ps_ref (label, id) select 'alpha', id from public.projects where name = 'Site Alpha';
insert into ps_ref (label, id) select 'beta', id from public.projects where name = 'Site Beta';
insert into ps_ref (label, id) select 'office', id from public.projects where name = 'Office';
select public.set_overhead_project(pg_temp.ref('office'));

select tests.authenticate_as('ps_other');
select public.create_company('Other Statement Co', true);
select public.upsert_project(null, 'Other Site', null, 'active');
insert into ps_ref (label, id) select 'other_site', id from public.projects where name = 'Other Site';

reset role;

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values
  (pg_temp.ref('co'), 'Example rent', 'income', 60, false, false),
  (pg_temp.ref('co'), 'Example repairs', 'expense', 61, false, false),
  (pg_temp.ref('co'), 'Example office', 'expense', 62, false, false),
  (pg_temp.ref('co'), 'Example kept out', 'expense', 63, false, true);
insert into ps_ref (label, id) select 'rent', id from public.categories where name = 'Example rent';
insert into ps_ref (label, id) select 'repairs', id from public.categories where name = 'Example repairs';
insert into ps_ref (label, id) select 'office_cat', id from public.categories where name = 'Example office';
insert into ps_ref (label, id) select 'kept', id from public.categories where name = 'Example kept out';
insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl, parent_id)
values (pg_temp.ref('co'), 'Example plumbing', 'expense', 64, false, false, pg_temp.ref('repairs'));
insert into ps_ref (label, id) select 'plumbing', id from public.categories where name = 'Example plumbing';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select
  pg_temp.ref('co'),
  v.direction::public.txn_direction,
  v.doc_kind::public.doc_kind,
  v.pnl_role::public.pnl_role,
  v.status::public.line_status,
  cur.c,
  v.amount, v.amount, abs(v.amount), 0, 'source',
  '2026-06-10', case when v.paid then '2026-06-10'::date end,
  'manual', 'ps:' || cur.c || ':' || v.ikey,
  pg_temp.ref(v.proj),
  pg_temp.ref(v.cat),
  v.ikey,
  true
from (values ('ILS'), ('USD')) as cur(c),
(values
  ('income',  'invoice_receipt', null,       100000, 'alpha',  'rent',       true,  'posted',  'in-alpha'),
  ('income',  'invoice_receipt', null,        50000, 'beta',   'rent',       true,  'posted',  'in-beta'),
  ('income',  'invoice',         null,        30000, 'alpha',  'rent',       false, 'posted',  'in-alpha-open'),
  ('expense', 'expense',         'project',  -20000, 'alpha',  'repairs',    true,  'posted',  'ex-repairs'),
  ('expense', 'expense',         'project',   -8000, 'alpha',  'plumbing',   true,  'posted',  'ex-plumb-a'),
  ('expense', 'expense',         'project',   -4000, 'beta',   'plumbing',   true,  'posted',  'ex-plumb-b'),
  ('expense', 'expense',         'shared',   -10000, null,     'repairs',    true,  'posted',  'ex-shared'),
  ('expense', 'expense',         'project',   -3000, 'office', 'office_cat', true,  'posted',  'ex-office'),
  ('expense', 'expense',         null,        -1500, null,     'office_cat', true,  'posted',  'ex-norole'),
  ('expense', 'expense',         'project',   -2500, 'alpha',  'kept',       true,  'posted',  'ex-kept'),
  ('expense', 'expense',         'project',   -9000, 'alpha',  'repairs',    true,  'pending', 'ex-pending')
) as v(direction, doc_kind, pnl_role, amount, proj, cat, paid, status, ikey);

-- The shared repair splits 60/40 between Alpha and Beta.
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, pg_temp.ref(s.proj), s.bp, t.amount_net * s.bp / 10000
from public.transactions t
join (values ('alpha', 6000), ('beta', 4000)) as s(proj, bp) on true
where t.idempotency_key in ('ps:ILS:ex-shared', 'ps:USD:ex-shared');

-- One open review item on the ILS repair: it counts in June on the company and on Alpha, not in July.
insert into public.review_queue (company_id, transaction_id, status)
select t.company_id, t.id, 'open' from public.transactions t where t.idempotency_key = 'ps:ILS:ex-repairs';

-- The reads, as the owner.
select tests.authenticate_as('ps_owner');
insert into ps_out values
  ('co',        public.get_pnl_statement('2026-06-01', '2026-06-30', null, false, 'cash')),
  ('co_inv',    public.get_pnl_statement('2026-06-01', '2026-06-30', null, false, 'invoiced')),
  ('alpha',     public.get_pnl_statement('2026-06-01', '2026-06-30', pg_temp.ref('alpha'), false, 'cash')),
  ('byp',       public.get_pnl_statement('2026-06-01', '2026-06-30', null, true, 'cash')),
  ('all_time',  public.get_pnl_statement(null, null, null, false, 'cash')),
  ('july',      public.get_pnl_statement('2026-07-01', '2026-07-31', null, false, 'cash')),
  ('bd_in',     public.get_breakdown('income', '2026-06-01', '2026-06-30', 'category', 'cash')),
  ('bd_ex',     public.get_breakdown('expense', '2026-06-01', '2026-06-30', 'category', 'cash')),
  ('bd_in_inv', public.get_breakdown('income', '2026-06-01', '2026-06-30', 'category', 'invoiced')),
  ('bdp_in',    public.get_breakdown('income', '2026-06-01', '2026-06-30', 'project', 'cash')),
  ('bdp_ex',    public.get_breakdown('expense', '2026-06-01', '2026-06-30', 'project', 'cash')),
  ('dash',      public.get_dashboard('2026-06-01', '2026-06-30', 'cash')),
  ('own_other', public.get_pnl_statement(null, null, pg_temp.ref('other_site'), false, null)),
  ('own_other_byp', public.get_pnl_statement(null, null, pg_temp.ref('other_site'), true, null));

-- The company, by category: get_breakdown's totals.
select is((pg_temp.cur(pg_temp.out_of('co'), 'ILS') ->> 'income_minor')::bigint, pg_temp.bd_total(pg_temp.out_of('bd_in'), 'ILS'),
  'company income is get_breakdown''s income total (ILS, cash)');
select is((pg_temp.cur(pg_temp.out_of('co'), 'ILS') ->> 'income_minor')::bigint, 150000::bigint,
  'on cash the unpaid invoice is left out');
select is((pg_temp.cur(pg_temp.out_of('co'), 'ILS') ->> 'expense_minor')::bigint, pg_temp.bd_total(pg_temp.out_of('bd_ex'), 'ILS'),
  'company cost is get_breakdown''s expense total (ILS)');
select is((pg_temp.cur(pg_temp.out_of('co'), 'ILS') ->> 'expense_minor')::bigint, 46500::bigint,
  'cost counts every posted line in the P&L, overhead and unassigned included, kept out and pending not');
select is((pg_temp.cur(pg_temp.out_of('co'), 'ILS') ->> 'net_minor')::bigint, 103500::bigint, 'net is income minus cost');
select is((pg_temp.cur(pg_temp.out_of('co_inv'), 'ILS') ->> 'income_minor')::bigint, pg_temp.bd_total(pg_temp.out_of('bd_in_inv'), 'ILS'),
  'on invoiced, income is get_breakdown''s invoiced total');
select is((pg_temp.cur(pg_temp.out_of('co_inv'), 'ILS') ->> 'income_minor')::bigint, 180000::bigint,
  'on invoiced the open invoice counts');
select is(pg_temp.out_of('co') ->> 'basis', 'cash', 'the basis is echoed');

-- The sides list their categories, a sub-category under its parent.
select is((select sum((x ->> 'amount_minor')::bigint) from jsonb_array_elements(pg_temp.cur(pg_temp.out_of('co'), 'ILS') -> 'expense') x)::bigint,
  46500::bigint, 'the expense categories add up to the cost');
select is((pg_temp.node(pg_temp.cur(pg_temp.out_of('co'), 'ILS'), 'expense', 'Example repairs') ->> 'amount_minor')::bigint, 42000::bigint,
  'a parent holds its own lines and its sub-categories');
select is((pg_temp.node(pg_temp.cur(pg_temp.out_of('co'), 'ILS'), 'expense', 'Example repairs') ->> 'own_minor')::bigint, 30000::bigint,
  'a parent says how much is its own');
select is((select (x ->> 'amount_minor')::bigint from jsonb_array_elements(
    pg_temp.node(pg_temp.cur(pg_temp.out_of('co'), 'ILS'), 'expense', 'Example repairs') -> 'children') x where x ->> 'name' = 'Example plumbing'),
  12000::bigint, 'the sub-category is listed under its parent with its own amount');
select is(jsonb_array_length(pg_temp.node(pg_temp.cur(pg_temp.out_of('co'), 'ILS'), 'expense', 'Example office') -> 'children'), 0,
  'a category with no sub-categories has no children');
select is(jsonb_array_length(pg_temp.node(pg_temp.cur(pg_temp.out_of('co'), 'ILS'), 'expense', 'Example repairs') -> 'children'), 1,
  'a parent lists its sub-categories only; its own lines are own_minor, not a child row');
select is((pg_temp.node(pg_temp.cur(pg_temp.out_of('co'), 'ILS'), 'expense', 'Example plumbing')), null::jsonb,
  'a sub-category is not a top-level row');
select is((select x ->> 'name' from jsonb_array_elements(pg_temp.cur(pg_temp.out_of('co'), 'ILS') -> 'expense') x limit 1),
  'Example repairs', 'the largest category comes first');

-- Kept out of the P&L: listed apart, with the account it posts to.
select is((select (x ->> 'amount_minor')::bigint from jsonb_array_elements(pg_temp.cur(pg_temp.out_of('co'), 'ILS') -> 'kept_out') x
  where x ->> 'name' = 'Example kept out'), 2500::bigint, 'a kept-out category is listed with its amount');
select isnt((select x ->> 'account_name' from jsonb_array_elements(pg_temp.cur(pg_temp.out_of('co'), 'ILS') -> 'kept_out') x
  where x ->> 'name' = 'Example kept out'), null, 'a kept-out category names its balance-sheet account');

-- A second currency is its own statement, never added in.
select is((pg_temp.cur(pg_temp.out_of('co'), 'USD') ->> 'expense_minor')::bigint, pg_temp.bd_total(pg_temp.out_of('bd_ex'), 'USD'),
  'the USD statement is get_breakdown''s USD total');
select is((select x ->> 'currency' from jsonb_array_elements(pg_temp.out_of('co') -> 'currencies') x limit 1), 'ILS',
  'ILS comes first');

-- One project: get_breakdown by project for its key, the shared cost as its allocation.
select is((pg_temp.cur(pg_temp.out_of('alpha'), 'ILS') ->> 'income_minor')::bigint,
  pg_temp.bd_group(pg_temp.out_of('bdp_in'), 'ILS', pg_temp.ref('alpha')::text), 'a project''s income is its get_breakdown row');
select is((pg_temp.cur(pg_temp.out_of('alpha'), 'ILS') ->> 'expense_minor')::bigint,
  pg_temp.bd_group(pg_temp.out_of('bdp_ex'), 'ILS', pg_temp.ref('alpha')::text), 'a project''s cost is its get_breakdown row');
select is((pg_temp.cur(pg_temp.out_of('alpha'), 'ILS') ->> 'expense_minor')::bigint, 34000::bigint,
  'the project carries its 60% of the shared cost');
select is(pg_temp.out_of('alpha') ->> 'project_name', 'Site Alpha', 'the project is named');

-- By project: one statement per key, adding up to the company.
select is((select count(*)::integer from jsonb_array_elements(pg_temp.out_of('byp') -> 'projects')), 4,
  'by project lists Alpha, Beta, the overhead and the unassigned');
select is(pg_temp.proj(pg_temp.out_of('byp'), 'overhead') ->> 'project_id', null, 'the overhead key has no project id');
select is((select sum((pg_temp.cur(x, 'ILS') ->> 'net_minor')::bigint) from jsonb_array_elements(pg_temp.out_of('byp') -> 'projects') x)::bigint,
  (pg_temp.cur(pg_temp.out_of('byp'), 'ILS') ->> 'net_minor')::bigint, 'the projects add up to the company net');
select is((pg_temp.cur(pg_temp.out_of('byp'), 'ILS') ->> 'net_minor')::bigint, 103500::bigint, 'by project keeps the company line');
select is((pg_temp.cur(pg_temp.proj(pg_temp.out_of('byp'), pg_temp.ref('beta')::text), 'ILS') ->> 'expense_minor')::bigint,
  8000::bigint, 'Beta carries its plumbing and its 40% of the shared cost');
select is((select e.x ->> 'key' from jsonb_array_elements(pg_temp.out_of('byp') -> 'projects') with ordinality as e(x, n)
  order by e.n desc limit 1), 'unassigned', 'the unassigned key comes last');

-- Periods.
select is(jsonb_array_length(pg_temp.out_of('july') -> 'currencies'), 0, 'a period with no lines has no statement');
select ok((pg_temp.cur(pg_temp.out_of('all_time'), 'ILS') ->> 'income_minor')::bigint >= 150000, 'all time reads every date');
select throws_ok($$ select public.get_pnl_statement('2026-06-01', null, null, false, null) $$, 'validation',
  'one date alone is refused');
select throws_ok($$ select public.get_pnl_statement('2026-03-01', '2026-02-01', null, false, null) $$, 'validation',
  'from after to is refused');
select throws_ok($$ select public.get_pnl_statement(null, null, pg_temp.ref('alpha'), true, null) $$, 'validation',
  'a project and by_project together are refused');

select is((pg_temp.out_of('co') ->> 'review_count')::integer, 1, 'the company counts the open review item in the range');
select is((pg_temp.out_of('alpha') ->> 'review_count')::integer, 1, 'a project counts its own open review item');
select is((pg_temp.out_of('july') ->> 'review_count')::integer, 0, 'an item outside the range is not counted');

-- Another company's project reads as unknown; the owner still reads their own.
select is(pg_temp.out_of('own_other'), null::jsonb, 'another company''s project reads as unknown');
select is(pg_temp.out_of('own_other_byp'), null::jsonb,
  'another company''s project reads as unknown with by_project too: the company check comes first');
reset role;
select tests.authenticate_as('ps_other');
select is(jsonb_array_length(public.get_pnl_statement(null, null, null, false, null) -> 'currencies'), 0,
  'the other company sees none of company A''s lines');
select is(public.get_pnl_statement(null, null, pg_temp.ref('other_site'), false, null) ->> 'project_name', 'Other Site',
  'positive control: the other company reads its own project');

-- get_dashboard for the same range and basis: the company's totals and Alpha's income and profit.
select is((pg_temp.cur(pg_temp.out_of('co'), 'ILS') ->> 'income_minor')::bigint,
  (select (x ->> 'income_minor')::bigint from jsonb_array_elements(pg_temp.out_of('dash') -> 'by_currency') x where x ->> 'currency' = 'ILS'),
  'company income is get_dashboard''s');
select is((pg_temp.cur(pg_temp.out_of('co'), 'ILS') ->> 'expense_minor')::bigint,
  (select (x ->> 'expense_minor')::bigint from jsonb_array_elements(pg_temp.out_of('dash') -> 'by_currency') x where x ->> 'currency' = 'ILS'),
  'company cost is get_dashboard''s');
select is((pg_temp.cur(pg_temp.out_of('co'), 'ILS') ->> 'net_minor')::bigint,
  (select (x ->> 'net_profit_minor')::bigint from jsonb_array_elements(pg_temp.out_of('dash') -> 'by_currency') x where x ->> 'currency' = 'ILS'),
  'company net is get_dashboard''s net profit');
select is((pg_temp.cur(pg_temp.out_of('alpha'), 'ILS') ->> 'income_minor')::bigint,
  (select (x ->> 'income_minor')::bigint from jsonb_array_elements(pg_temp.out_of('dash') -> 'projects') p, jsonb_array_elements(p -> 'by_currency') x
   where p ->> 'name' = 'Site Alpha' and x ->> 'currency' = 'ILS'),
  'Alpha income is get_dashboard''s');
select is((pg_temp.cur(pg_temp.out_of('alpha'), 'ILS') ->> 'net_minor')::bigint,
  (select (x ->> 'profit_minor')::bigint from jsonb_array_elements(pg_temp.out_of('dash') -> 'projects') p, jsonb_array_elements(p -> 'by_currency') x
   where p ->> 'name' = 'Site Alpha' and x ->> 'currency' = 'ILS'),
  'Alpha net is get_dashboard''s profit');

select * from finish();
rollback;
