-- FLOW-311 review. merge_category moves split parts to the kept category, and refuses a line
-- with a part in each category for the same project. Invented data only. Amounts are cents.

begin;

select plan(5);

do $users$
begin
  perform tests.create_supabase_user('lsm_owner', 'lsm-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('lsm_owner'), 'Example Merge LLC', false);

create temp table lsm (label text primary key, id uuid);
grant all on lsm to authenticated;
insert into lsm (label, id) select 'co', id from public.companies where name = 'Example Merge LLC';

insert into public.projects (company_id, name, status)
values ((select id from lsm where label = 'co'), 'North', 'active');
insert into lsm (label, id) select 'north', id from public.projects where company_id = (select id from lsm where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default)
select (select id from lsm where label = 'co'), v.name, 'expense', 90, false
from (values ('Old'), ('Kept'), ('Other'), ('Spare')) as v(name);
insert into lsm (label, id)
select lower(name), id from public.categories
where company_id = (select id from lsm where label = 'co') and name in ('Old', 'Kept', 'Other', 'Spare');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select (select id from lsm where label = 'co'), 'expense', 'expense', 'project', 'posted', 'USD',
  v.amount, v.amount, abs(v.amount), 0, 'source', '2026-06-10', '2026-06-10', 'manual', v.key,
  (select id from lsm where label = 'north'), (select id from lsm where label = 'other'), v.key, true
from (values ('lsm:a', -1000), ('lsm:b', -2000)) as v(key, amount);
insert into lsm (label, id) select replace(idempotency_key, 'lsm:', 'txn_'), id
from public.transactions where idempotency_key like 'lsm:%';

create function pg_temp.part(p_category text, p_amount bigint) returns jsonb
language sql
as $$
  select jsonb_build_object('category_id', (select id from lsm where label = p_category), 'amount_minor', p_amount)
$$;
grant execute on function pg_temp.part(text, bigint) to authenticated;

create function pg_temp.cat(p_category text) returns bigint
language sql
as $$
  select (x ->> 'amount_minor')::bigint from jsonb_array_elements(
    public.get_project((select id from lsm where label = 'north'), 'cash') -> 'categories_by_currency') x
  where x ->> 'id' = (select id::text from lsm where label = p_category)
$$;
grant execute on function pg_temp.cat(text) to authenticated;

select tests.authenticate_as('lsm_owner');
select public.save_line_split((select id from lsm where label = 'txn_a'),
  jsonb_build_array(pg_temp.part('old', 400), pg_temp.part('other', 600)));

select lives_ok(
  $$select public.merge_category((select id from lsm where label = 'old'), (select id from lsm where label = 'kept'))$$,
  'Old merges into Kept');
select is(pg_temp.cat('kept'), 400::bigint, 'the part moves to Kept');
select is(pg_temp.cat('old'), null::bigint, 'and nothing is left under Old');

select public.save_line_split((select id from lsm where label = 'txn_b'),
  jsonb_build_array(pg_temp.part('spare', 500), pg_temp.part('kept', 1500)));
select throws_ok(
  $$select public.merge_category((select id from lsm where label = 'spare'), (select id from lsm where label = 'kept'))$$,
  'a split line has both categories', 'a line with a part in each category is refused');
select is(pg_temp.cat('spare'), 500::bigint, 'and the refused merge changed nothing');

select * from finish();
rollback;
