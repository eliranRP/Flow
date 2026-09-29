-- has_shared_share is true only on a line that includes a shared-cost share.

begin;

select plan(7);

do $users$
begin
  perform tests.create_supabase_user('r16_a', 'r16-a@test.flow');
end
$users$;

select tests.authenticate_as('r16_a');
select lives_ok($$select public.create_company('סבב 16', true)$$, 'owner creates a company');

create temp table r16 (label text primary key, id uuid);
grant all on r16 to authenticated, service_role;
insert into r16 (label, id) select 'company', id from public.companies;
select lives_ok($$select public.upsert_project(null, 'אלפא', null, 'active')$$, 'owner opens אלפא');
insert into r16 (label, id) select 'alpha', id from public.projects where name = 'אלפא';
insert into r16 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into r16 (label, id)
select 'haul', id from public.categories where name = 'הובלה' and kind = 'expense';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project',
  -2000, -2000, 0, 'unknown',
  '2026-09-02', 'manual', 'r16:materials', p.id, m.id, true, 'מלט'
from r16 c
join r16 p on p.label = 'alpha'
join r16 m on m.label = 'materials'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project',
  -3000, -3000, 0, 'unknown',
  '2026-09-03', 'manual', 'r16:haul', p.id, h.id, true, 'שינוע'
from r16 c
join r16 p on p.label = 'alpha'
join r16 h on h.label = 'haul'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'shared',
  -10000, -10000, 0, 'unknown',
  '2026-09-04', 'manual', 'r16:shared', h.id, true, 'שינוע משותף'
from r16 c
join r16 h on h.label = 'haul'
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, p.id, 10000, -4000
from public.transactions t
join r16 p on p.label = 'alpha'
where t.idempotency_key = 'r16:shared';

select tests.authenticate_as('r16_a');

select is(
  (
    select (row->>'has_shared_share')::boolean
    from jsonb_array_elements(public.get_project((select id from r16 where label = 'alpha')) -> 'categories') row
    where row->>'name' = 'חומרים'
  ),
  false,
  'a line with no shared share is not marked'
);

select is(
  (
    select (row->>'has_shared_share')::boolean
    from jsonb_array_elements(public.get_project((select id from r16 where label = 'alpha')) -> 'categories') row
    where row->>'name' = 'הובלה'
  ),
  true,
  'a line that includes a shared share is marked'
);

select is(
  (
    select (row->>'amount_agorot')::bigint
    from jsonb_array_elements(public.get_project((select id from r16 where label = 'alpha')) -> 'categories') row
    where row->>'name' = 'הובלה'
  ),
  7000::bigint,
  'the marked line is the direct expense plus the share'
);

select is(
  (
    select (row->>'amount_agorot')::bigint
    from jsonb_array_elements(public.get_project((select id from r16 where label = 'alpha')) -> 'categories') row
    where row->>'name' = 'חומרים'
  ),
  2000::bigint,
  'the unmarked line is only its own expenses'
);

select is(
  (public.list_project_category(
    (select id from r16 where label = 'alpha'),
    (select id from r16 where label = 'haul')
  ) ->> 'total_agorot')::bigint,
  7000::bigint,
  'the drill-down of a shared line still matches the line'
);

select * from finish();
rollback;
