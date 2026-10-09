-- FLOW-309 (prod QA). Filed today counts only lines filed without the owner: a connector
-- line the owner approved, changed or skipped in review stays off the banner and the list.
-- Invented data only.

begin;

select plan(7);

do $users$
begin
  perform tests.create_supabase_user('fto_owner', 'fto-owner@test.flow');
end
$users$;

create temp table fto (label text primary key, id uuid);
grant all on fto to authenticated, service_role;

select tests.authenticate_as('fto_owner');
select lives_ok($$select public.create_company('Filed Today Co', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'North', null, 'active')$$, 'owner opens North');
insert into fto (label, id) select 'company', id from public.companies where name = 'Filed Today Co';
insert into fto (label, id) select 'north', id from public.projects where name = 'North';
insert into fto (label, id)
select 'materials', id from public.categories
where name = 'חומרים' and kind = 'expense' and company_id = (select id from fto where label = 'company');

reset role;

-- Four filed connector lines from today: one filed by the sync, three the owner settled in review.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description, created_at
)
select c.id, 'expense', 'expense', 'project',
  v.amount, v.amount, 0, 'unknown',
  current_date, 'sumit', v.ikey, p.id, m.id, v.ikey, now()
from fto c
join fto p on p.label = 'north'
join fto m on m.label = 'materials'
cross join (values
  (-1000, 'fto:auto'),
  (-2000, 'fto:approved'),
  (-3000, 'fto:changed'),
  (-4000, 'fto:skipped')
) as v(amount, ikey)
where c.label = 'company';

insert into public.review_queue (company_id, transaction_id, status, reason, resolved_at)
select t.company_id, t.id, v.status::public.review_status, 'missing_project', now()
from public.transactions t
join (values
  ('fto:approved', 'approved'),
  ('fto:changed', 'changed'),
  ('fto:skipped', 'skipped')
) as v(ikey, status) on v.ikey = t.idempotency_key;

select tests.authenticate_as('fto_owner');
select is(
  (select jsonb_agg(elem->>'description' order by elem->>'description')
   from jsonb_array_elements(public.list_auto_assigned_today()) elem),
  '["fto:auto"]'::jsonb,
  'only the line filed without the owner is listed');
select is(
  (select count(*)::integer from private.filed_today_rows()),
  1,
  'the banner count leaves out the owner''s picks');

-- An open row is still review, not filed.
reset role;
update public.review_queue set status = 'open', resolved_at = null
where transaction_id = (select id from public.transactions where idempotency_key = 'fto:skipped');
select tests.authenticate_as('fto_owner');
select is(
  (select count(*)::integer from private.filed_today_rows()),
  1,
  'an open review row stays off filed today');
-- FLOW-309: the queue banner counts exactly the rows שויכו היום lists.
select is(
  (public.list_review() -> 0 ->> 'auto_approved_today')::integer,
  jsonb_array_length(public.list_auto_assigned_today()),
  'the banner count matches the filed-today list');

-- Once that open row leaves review with no owner action, the line counts as filed.
reset role;
delete from public.review_queue
where transaction_id = (select id from public.transactions where idempotency_key = 'fto:skipped');
select tests.authenticate_as('fto_owner');
select is(
  (select count(*)::integer from private.filed_today_rows()),
  2,
  'a line with no owner review row counts');

select * from finish();
rollback;
