-- FLOW-311 review r3. A part with no project on a line filed to the overhead project keeps
-- the overhead role; a part with another project on that line is that project's direct cost.
-- Invented data only. Amounts are cents.

begin;

select plan(4);

do $users$
begin
  perform tests.create_supabase_user('lso_owner', 'lso-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('lso_owner'), 'Example Overhead Line LLC', false);

create temp table lso (label text primary key, id uuid);
grant all on lso to authenticated;
insert into lso (label, id) select 'co', id from public.companies where name = 'Example Overhead Line LLC';

insert into public.projects (company_id, name, status)
select (select id from lso where label = 'co'), v.name, 'active'
from (values ('North'), ('Overhead')) as v(name);
insert into lso (label, id)
select lower(name), id from public.projects where company_id = (select id from lso where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default)
select (select id from lso where label = 'co'), v.name, 'expense', 90, false
from (values ('Repairs'), ('Insurance')) as v(name);
insert into lso (label, id)
select lower(name), id from public.categories
where company_id = (select id from lso where label = 'co') and name in ('Repairs', 'Insurance');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
values ((select id from lso where label = 'co'), 'expense', 'expense', 'project', 'posted', 'USD',
  -2000, -2000, 2000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'lso:office',
  (select id from lso where label = 'overhead'), (select id from lso where label = 'repairs'), 'lso:office', true);
insert into lso (label, id) select 'txn_office', id from public.transactions where idempotency_key = 'lso:office';

create function pg_temp.cur(p_key text) returns bigint
language sql
as $$
  select (x ->> p_key)::bigint
  from jsonb_array_elements(public.get_dashboard(null, null, 'cash') -> 'by_currency') x
  where x ->> 'currency' = 'USD'
$$;
grant execute on function pg_temp.cur(text) to authenticated;

select tests.authenticate_as('lso_owner');
select public.set_overhead_project((select id from lso where label = 'overhead'));

select lives_ok(
  $$select public.save_line_split((select id from lso where label = 'txn_office'), jsonb_build_array(
    jsonb_build_object('category_id', (select id from lso where label = 'repairs'),
      'project_id', (select id from lso where label = 'north'), 'amount_minor', 500),
    jsonb_build_object('category_id', (select id from lso where label = 'insurance'), 'amount_minor', 1500)))$$,
  'a line on the overhead project splits');
select is(pg_temp.cur('overhead_minor'), 1500::bigint, 'the part with no project stays overhead');
select is(pg_temp.cur('direct_minor'), 500::bigint, 'the part on North is direct');
select is(pg_temp.cur('expense_minor'), 2000::bigint, 'and the line counts once in total');

select * from finish();
rollback;
