-- FLOW-311 review. Each pnl_lines rule for a part: a part with a project is that project's
-- direct cost on a shared or unassigned line, a part on the overhead project is overhead, a
-- part with no project keeps the line's unassigned state (expense and income), and a removed
-- or pending line counts nothing. Invented data only. Amounts are cents.

begin;

select plan(16);

do $users$
begin
  perform tests.create_supabase_user('lsr_owner', 'lsr-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('lsr_owner'), 'Example Roles LLC', false);

create temp table lsr (label text primary key, id uuid);
grant all on lsr to authenticated;
insert into lsr (label, id) select 'co', id from public.companies where name = 'Example Roles LLC';

insert into public.projects (company_id, name, status)
select (select id from lsr where label = 'co'), v.name, 'active'
from (values ('North'), ('South'), ('Overhead')) as v(name);
insert into lsr (label, id)
select lower(name), id from public.projects
where company_id = (select id from lsr where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default)
select (select id from lsr where label = 'co'), v.name, v.kind::public.category_kind, 90, false
from (values ('Repairs', 'expense'), ('Insurance', 'expense'), ('Rent', 'income'), ('Fees', 'income')) as v(name, kind);
insert into lsr (label, id)
select lower(name), id from public.categories
where company_id = (select id from lsr where label = 'co') and name in ('Repairs', 'Insurance', 'Rent', 'Fees');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select (select id from lsr where label = 'co'), v.direction::public.txn_direction, v.doc_kind::public.doc_kind,
  v.role::public.pnl_role, v.status::public.line_status, 'USD',
  v.amount, v.amount, abs(v.amount), 0, 'source', '2026-06-10', '2026-06-10', 'manual', v.key,
  (select id from lsr where label = v.project), (select id from lsr where label = v.category), v.key, true
from (values
  ('lsr:shared',     'expense', 'expense', 'shared',  'posted',  -10000, null,    'repairs'),
  ('lsr:unassigned', 'expense', 'expense', 'project', 'posted',   -3000, null,    'repairs'),
  ('lsr:overhead',   'expense', 'expense', 'project', 'posted',   -2000, 'north', 'repairs'),
  ('lsr:inflow',     'income',  'receipt', null,      'posted',    5000, null,    'rent'),
  ('lsr:removed',    'expense', 'expense', 'project', 'posted',    -700, 'north', 'repairs'),
  ('lsr:pending',    'expense', 'expense', 'project', 'pending',   -900, 'north', 'repairs')
) as v(key, direction, doc_kind, role, status, amount, project, category);
insert into lsr (label, id) select replace(idempotency_key, 'lsr:', 'txn_'), id
from public.transactions where idempotency_key like 'lsr:%';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from lsr where label = 'co'), (select id from lsr where label = 'txn_shared'),
  (select id from lsr where label = v.project), 5000, -5000
from (values ('north'), ('south')) as v(project);

create function pg_temp.part(p_category text, p_amount bigint, p_project text default null)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'category_id', (select id from lsr where label = p_category),
    'project_id', (select id from lsr where label = p_project),
    'amount_minor', p_amount
  )
$$;
grant execute on function pg_temp.part(text, bigint, text) to authenticated;

create function pg_temp.cur(p_key text) returns bigint
language sql
as $$
  select (x ->> p_key)::bigint
  from jsonb_array_elements(public.get_dashboard(null, null, 'cash') -> 'by_currency') x
  where x ->> 'currency' = 'USD'
$$;
grant execute on function pg_temp.cur(text) to authenticated;

create function pg_temp.proj(p_project text, p_key text) returns bigint
language sql
as $$
  select (x ->> p_key)::bigint from jsonb_array_elements(
    public.get_project((select id from lsr where label = p_project), 'cash') -> 'by_currency'
  ) x
  where x ->> 'currency' = 'USD'
$$;
grant execute on function pg_temp.proj(text, text) to authenticated;

select tests.authenticate_as('lsr_owner');
select public.set_overhead_project((select id from lsr where label = 'overhead'));

select lives_ok(
  $$select public.save_line_split((select id from lsr where label = 'txn_shared'),
    jsonb_build_array(pg_temp.part('repairs', 6000, 'south'), pg_temp.part('insurance', 4000)))$$,
  'a shared line splits into a project part and a shared part');
select lives_ok(
  $$select public.save_line_split((select id from lsr where label = 'txn_unassigned'),
    jsonb_build_array(pg_temp.part('repairs', 1000, 'north'), pg_temp.part('insurance', 2000)))$$,
  'an unassigned line splits with one part on a project');
select lives_ok(
  $$select public.save_line_split((select id from lsr where label = 'txn_overhead'),
    jsonb_build_array(pg_temp.part('repairs', 500, 'overhead'), pg_temp.part('insurance', 1500)))$$,
  'a project line splits with one part on the overhead project');
select lives_ok(
  $$select public.save_line_split((select id from lsr where label = 'txn_inflow'),
    jsonb_build_array(pg_temp.part('rent', 3000, 'south'), pg_temp.part('fees', 2000)))$$,
  'an unassigned inflow splits with one part on a project');
select lives_ok(
  $$select public.save_line_split((select id from lsr where label = 'txn_removed'),
    jsonb_build_array(pg_temp.part('repairs', 300), pg_temp.part('insurance', 400)))$$,
  'a line that is later removed splits');
select lives_ok(
  $$select public.save_line_split((select id from lsr where label = 'txn_pending'),
    jsonb_build_array(pg_temp.part('repairs', 400), pg_temp.part('insurance', 500)))$$,
  'a pending line splits');

reset role;
update public.transactions set removed_at = '2026-06-20'
where id = (select id from lsr where label = 'txn_removed');
select tests.authenticate_as('lsr_owner');

-- Company buckets add up to the expense total: 8,500 direct + 4,000 shared + 500 overhead
-- + 2,000 unassigned = 15,000. The removed and pending lines count nothing.
select is(pg_temp.cur('expense_minor'), 15000::bigint, 'removed and pending split lines count nothing');
select is(pg_temp.cur('direct_minor'), 8500::bigint, 'a part with a project is direct, even on a shared or unassigned line');
select is(pg_temp.cur('shared_minor'), 4000::bigint, 'a part with no project on a shared line stays shared');
select is(pg_temp.cur('overhead_minor'), 500::bigint, 'a part on the overhead project is overhead');
select is(pg_temp.cur('unassigned_expense_minor'), 2000::bigint, 'only the part with no project stays unassigned');
select is(pg_temp.cur('unassigned_income_minor'), 2000::bigint, 'an income part with a project is not unassigned');

select is(pg_temp.proj('south', 'direct_minor'), 6000::bigint, 'South gets the project part of the shared line as direct');
select is(pg_temp.proj('south', 'shared_minor'), 2000::bigint, 'and half of the shared part');
select is(pg_temp.proj('south', 'income_minor'), 3000::bigint, 'and the income part');
select is(pg_temp.proj('north', 'direct_minor'), 2500::bigint, 'North gets its part of the unassigned line and the rest of the overhead line');

select * from finish();
rollback;
