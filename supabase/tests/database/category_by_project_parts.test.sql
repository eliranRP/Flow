-- FLOW-989: the category drill-down's split by project (get_breakdown_lines) counts a split line by its parts,
-- a shared cost by its allocations and a whole line by its project, as get_pnl_statement by project does.
-- Invented data only; amounts are cents.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('cbp_owner', 'cbp-owner@example.com');
end
$users$;

create temp table cbp_ref (label text primary key, id uuid);
grant all on cbp_ref to authenticated;

create function pg_temp.ref(l text) returns uuid
language sql stable
as $$ select id from cbp_ref where label = l $$;

grant execute on function pg_temp.ref(text) to authenticated;

select tests.authenticate_as('cbp_owner');
select public.create_company('Example Split Books LLC', true);
select public.upsert_project(null, 'Site Alpha', null, 'active');
select public.upsert_project(null, 'Site Beta', null, 'active');
select public.upsert_project(null, 'Site Gamma', null, 'active');
insert into cbp_ref (label, id) select 'co', id from public.companies where name = 'Example Split Books LLC';
insert into cbp_ref (label, id) select lower(replace(name, 'Site ', '')), id from public.projects where name like 'Site %';

reset role;

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values (pg_temp.ref('co'), 'Example repairs', 'expense', 61, false, false), (pg_temp.ref('co'), 'Example renovation', 'expense', 62, false, false);
insert into cbp_ref (label, id) select 'repairs', id from public.categories where company_id = pg_temp.ref('co') and name = 'Example repairs';
insert into cbp_ref (label, id) select 'reno', id from public.categories where company_id = pg_temp.ref('co') and name = 'Example renovation';

-- no-proj: a line with no project, split 450 Alpha + 350 Beta, both repairs.
-- on-beta: a line on Beta, split 2800 Beta renovation + 150 Alpha repairs + 120 Gamma repairs.
-- whole: 200 repairs on Alpha. loose: 50 repairs with no project. shared: 100 repairs, 60/40 Alpha/Beta.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select pg_temp.ref('co'), 'expense', 'expense', v.role::public.pnl_role, 'posted', 'USD', v.amount, v.amount, abs(v.amount), 0, 'source',
  v.d::date, v.d::date, 'manual', 'cbp:' || v.ikey, pg_temp.ref(v.proj), pg_temp.ref('repairs'), v.ikey, true
from (values
  ('no-proj', -80000,  '2026-08-29', null,   'project'),
  ('on-beta', -307000, '2026-05-05', 'beta', 'project'),
  ('whole',   -20000,  '2026-06-01', 'alpha', 'project'),
  ('loose',   -5000,   '2026-06-02', null,   'project'),
  ('shared',  -10000,  '2026-06-03', null,   'shared')
) as v(ikey, amount, d, proj, role);
insert into cbp_ref (label, id) select substr(idempotency_key, 5), id from public.transactions where idempotency_key like 'cbp:%';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, pg_temp.ref(s.proj), s.bp, t.amount_net * s.bp / 10000
from public.transactions t
join (values ('alpha', 6000), ('beta', 4000)) as s(proj, bp) on true
where t.idempotency_key = 'cbp:shared';
select private.set_line_parts(pg_temp.ref('co'), pg_temp.ref('no-proj'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.ref('repairs'), 'project_id', pg_temp.ref('alpha'), 'amount_minor', 45000),
  jsonb_build_object('category_id', pg_temp.ref('repairs'), 'project_id', pg_temp.ref('beta'), 'amount_minor', 35000)));
select private.set_line_parts(pg_temp.ref('co'), pg_temp.ref('on-beta'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.ref('reno'), 'project_id', pg_temp.ref('beta'), 'amount_minor', 280000),
  jsonb_build_object('category_id', pg_temp.ref('repairs'), 'project_id', pg_temp.ref('alpha'), 'amount_minor', 15000),
  jsonb_build_object('category_id', pg_temp.ref('repairs'), 'project_id', pg_temp.ref('gamma'), 'amount_minor', 12000)));

select tests.authenticate_as('cbp_owner');

create temp table cbp_out as
select public.get_breakdown_lines('expense', 'category', pg_temp.ref('repairs')::text, 'USD', '2026-01-01', '2026-12-31', 'cash') as body;

-- The split by project: each project's figure, and the 50 that really has no project.
select is(
  (select jsonb_object_agg(coalesce(x ->> 'name', '-'), (x ->> 'total_minor')::bigint) from cbp_out, jsonb_array_elements(body -> 'projects') x),
  jsonb_build_object('Site Alpha', 45000 + 15000 + 20000 + 6000, 'Site Beta', 35000 + 4000, 'Site Gamma', 12000, '-', 5000),
  'each part, allocation and whole line counts on its own project');
select is(
  (select array_agg(coalesce(x ->> 'name', '-') order by n) from cbp_out, jsonb_array_elements(body -> 'projects') with ordinality r(x, n)),
  array['Site Alpha', 'Site Beta', 'Site Gamma', '-'],
  'largest first');
select is(
  (select sum((x ->> 'total_minor')::bigint)::bigint from cbp_out, jsonb_array_elements(body -> 'projects') x),
  (select (body ->> 'total_minor')::bigint from cbp_out),
  'the projects add up to the category');

-- Each row of get_pnl_statement by project equals the split's figure for the project.
select is(
  (select jsonb_object_agg(x ->> 'name', (x ->> 'total_minor')::bigint) from cbp_out, jsonb_array_elements(body -> 'projects') x where x ->> 'project_id' is not null),
  (select jsonb_object_agg(p ->> 'name', (c ->> 'amount_minor')::bigint)
   from jsonb_array_elements(public.get_pnl_statement('2026-01-01', '2026-12-31', null, true, 'cash') -> 'projects') p,
     jsonb_array_elements(p -> 'currencies') cur,
     jsonb_array_elements(cur -> 'expense') c
   where p ->> 'project_id' is not null and cur ->> 'currency' = 'USD' and c ->> 'id' = pg_temp.ref('repairs')::text),
  'the split matches get_pnl_statement by project');

-- The rows: each part on its own project with its own amount; the part in another category is not here.
select is(
  (select array_agg((x ->> 'amount_minor') || ' ' || coalesce(x ->> 'project_name', '-') order by (x ->> 'amount_minor')::bigint desc)
   from cbp_out, jsonb_array_elements(body -> 'rows') x where x ->> 'transaction_id' = pg_temp.ref('no-proj')::text),
  array['45000 Site Alpha', '35000 Site Beta'],
  'a line with no project split over two projects is two rows');
select is(
  (select array_agg((x ->> 'amount_minor') || ' ' || coalesce(x ->> 'project_name', '-') order by (x ->> 'amount_minor')::bigint desc)
   from cbp_out, jsonb_array_elements(body -> 'rows') x where x ->> 'transaction_id' = pg_temp.ref('on-beta')::text),
  array['15000 Site Alpha', '12000 Site Gamma'],
  'a line on one project shows only its parts in this category, each on its project');
select is((select (body ->> 'count')::integer from cbp_out), 7, 'the count counts each part as a row');

-- One project's drill-down lists its parts, including parts of lines on another project.
select is(
  (select array_agg((x ->> 'amount_minor')::bigint order by (x ->> 'amount_minor')::bigint desc)
   from jsonb_array_elements(public.get_breakdown_lines('expense', 'category', pg_temp.ref('repairs')::text, 'USD', '2026-01-01', '2026-12-31', 'cash', false, 40, 0, pg_temp.ref('alpha')) -> 'rows') x),
  array[45000, 20000, 15000, 6000]::bigint[],
  'Alpha''s drill-down lists its parts and allocation');
select is(
  public.get_breakdown_lines('expense', 'category', pg_temp.ref('repairs')::text, 'USD', '2026-01-01', '2026-12-31', 'cash', false, 40, 0, pg_temp.ref('alpha')) -> 'projects',
  '[]'::jsonb,
  'one project''s read has no split');

select * from finish();
rollback;
