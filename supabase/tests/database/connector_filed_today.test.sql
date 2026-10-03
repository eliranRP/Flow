-- L1a. Today's connector filings carry currency and amount_original.
-- A pending line is not filed. Assistant approvals wait for MCP 3b.

begin;

select plan(14);

do $users$
begin
  perform tests.create_supabase_user('l1a_owner', 'l1a-owner@test.flow');
  perform tests.create_supabase_user('l1a_other', 'l1a-other@test.flow');
end
$users$;

create temp table l1a (label text primary key, id uuid);
grant all on l1a to authenticated, service_role;

select tests.authenticate_as('l1a_owner');
select lives_ok($$select public.create_company('חברה', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'אלפא', null, 'active')$$, 'owner opens אלפא');

insert into l1a (label, id) select 'company', id from public.companies;
insert into l1a (label, id) select 'alpha', id from public.projects where name = 'אלפא';
insert into l1a (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description, created_at
)
select c.id, 'expense', 'expense', 'project',
  -20000, -20000, 0, 'unknown',
  current_date, 'sumit', 'l1a:sumit', a.id, m.id, 'חול', now()
from l1a c
join l1a a on a.label = 'alpha'
join l1a m on m.label = 'materials'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, line_status, idempotency_key, project_id, category_id, description, created_at
)
select c.id, 'expense', 'expense', 'project',
  -15000, -15000, 0, 'unknown',
  current_date, 'sumit', 'pending', 'l1a:pending', a.id, m.id, 'ממתין', now()
from l1a c
join l1a a on a.label = 'alpha'
join l1a m on m.label = 'materials'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description, created_at
)
select c.id, 'expense', 'expense', 'project',
  -50000, -50000, 0, 'unknown',
  current_date, 'sumit', 'l1a:open', a.id, m.id, 'פתוח', now()
from l1a c
join l1a a on a.label = 'alpha'
join l1a m on m.label = 'materials'
where c.label = 'company';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_project'
from public.transactions t
where t.idempotency_key = 'l1a:open';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, created_at
)
select c.id, 'expense', 'expense', 'project',
  -70000, -70000, 0, 'unknown',
  current_date, 'manual', 'l1a:manual', 'ידני', now()
from l1a c
where c.label = 'company';

select tests.authenticate_as('l1a_other');
select lives_ok($$select public.create_company('אחרת', true)$$, 'the other user creates a company');

insert into l1a (label, id) select 'other_company', id from public.companies where name = 'אחרת';
insert into l1a (label, id)
select 'other_materials', id from public.categories
where company_id = (select id from l1a where label = 'other_company') and name = 'חומרים' and kind = 'expense';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, category_id, description, created_at
)
select c.id, 'income', 'invoice', 'project',
  80000, 80000, 0, 'unknown',
  current_date, 'sumit', 'l1a:other', m.id, 'הכנסה', now()
from l1a c
join l1a m on m.label = 'other_materials'
where c.label = 'other_company';

select is(
  private.is_connector_source('sumit'),
  true,
  'sumit is a connector source'
);

select is(
  private.is_connector_source('manual'),
  false,
  'a typed row is not a connector filing'
);

select tests.authenticate_as('l1a_owner');

select is(
  (
    select elem->>'currency'
    from jsonb_array_elements(public.list_auto_assigned_today()) elem
    where elem->>'description' = 'חול'
  ),
  'ILS',
  'a filed row carries its currency'
);

select is(
  (
    select (elem->>'amount_original')::bigint
    from jsonb_array_elements(public.list_auto_assigned_today()) elem
    where elem->>'description' = 'חול'
  ),
  20000::bigint,
  'a filed row carries the original gross minor units'
);

select is(
  (
    select elem->>'line_status'
    from jsonb_array_elements(public.list_auto_assigned_today()) elem
    where elem->>'description' = 'חול'
  ),
  'posted',
  'a filed row carries line_status'
);

select is(
  (
    select count(*)
    from jsonb_array_elements(public.list_auto_assigned_today()) elem
    where elem->>'description' in ('ממתין', 'פתוח', 'ידני', 'הכנסה')
  ),
  0::bigint,
  'pending, an open review, a typed row, and another company stay out'
);

select is(
  (select jsonb_array_length(public.list_auto_assigned_today())),
  1,
  'the owner count is today''s posted connector filing'
);

select is(
  (select (public.list_review() -> 0 ->> 'auto_approved_today')::int),
  (select jsonb_array_length(public.list_auto_assigned_today())),
  'the banner count matches the list'
);

select is(
  (select public.list_review() -> 0 ->> 'line_status'),
  'posted',
  'a review card carries line_status'
);

select is(
  (select public.list_review() -> 0 ->> 'currency'),
  'ILS',
  'a review card carries currency'
);

select tests.authenticate_as('l1a_other');

select is(
  (select jsonb_array_length(public.list_auto_assigned_today())),
  1,
  'the other user still sees their own connector filing'
);

select * from finish();
rollback;
