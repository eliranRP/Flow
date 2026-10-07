-- FLOW-203. get_project lists its 40 newest lines by doc_date, then created_at, then id.
-- Lines inserted in one transaction share created_at, so only the id breaks the tie.
-- Invented data only.

begin;

select plan(4);

do $users$
begin
  perform tests.create_supabase_user('gps_owner', 'gps-owner@example.com');
  perform tests.create_supabase_user('gps_other', 'gps-other@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('gps_owner'), 'Example Sort LLC', false),
  (tests.get_supabase_uid('gps_other'), 'Example Other LLC', false);

insert into public.projects (company_id, name, status)
select c.id, 'Sort Site', 'active'
from public.companies c where c.name = 'Example Sort LLC';

-- 41 expense lines on one date: one more than the list holds.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description, user_assigned
)
select c.id, 'expense', 'expense', 'project', 'posted', 'ILS',
  -100, -100, 0, 'source',
  '2026-06-10', '2026-06-10', 'manual', 'gps:' || n, p.id, 'example ' || n, true
from public.companies c
join public.projects p on p.company_id = c.id
cross join generate_series(1, 41) n
where c.name = 'Example Sort LLC';

create temp table gps_ref as
select p.id from public.projects p where p.name = 'Sort Site';
grant select on gps_ref to authenticated;

select tests.authenticate_as('gps_owner');

select is(
  jsonb_array_length(public.get_project((select id from gps_ref), 'cash')->'transactions'),
  40,
  'get_project lists 40 lines'
);

select is(
  (select array_agg((x->>'id')::uuid order by o)
   from jsonb_array_elements(public.get_project((select id from gps_ref), 'cash')->'transactions')
     with ordinality as e(x, o)),
  (select array_agg(t.id order by t.id desc)
   from (
     select t.id from public.transactions t
     where t.project_id = (select id from gps_ref)
     order by t.id desc
     limit 40
   ) t),
  'equal dates and created_at sort by id, newest id first'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements(public.get_project((select id from gps_ref), 'cash')->'transactions') x
    where (x->>'id')::uuid = (
      select min(t.id) from public.transactions t where t.project_id = (select id from gps_ref)
    )
  ),
  'the lowest id is the line left out'
);

select tests.authenticate_as('gps_other');

select is(
  public.get_project((select id from gps_ref), 'cash'),
  null,
  'another company reads null for the project'
);

select * from finish();
rollback;
