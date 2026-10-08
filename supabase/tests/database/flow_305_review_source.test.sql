-- FLOW-305. list_review returns each line's source and line_status for the statement row.

begin;

select plan(4);

do $users$
begin
  perform tests.create_supabase_user('f305_owner', 'f305-owner@test.flow');
end
$users$;

create temp table f305 (label text primary key, id uuid);
grant all on f305 to authenticated, service_role;

select tests.authenticate_as('f305_owner');
select lives_ok($$select public.create_company('חברה', true)$$, 'owner creates a company');

insert into f305 (label, id) select 'company', id from public.companies;

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, line_status, idempotency_key, description, created_at
)
select c.id, 'expense', 'expense', 'project',
  -120050, -120050, 0, 'unknown',
  current_date, 'sumit', 'pending', 'f305:pending', 'חשמל השרון', now()
from f305 c
where c.label = 'company';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_project'
from public.transactions t
where t.idempotency_key = 'f305:pending';

select tests.authenticate_as('f305_owner');

select is(
  (select public.list_review() -> 0 ->> 'source'),
  'sumit',
  'a review row carries its source'
);

select is(
  (select public.list_review() -> 0 ->> 'line_status'),
  'pending',
  'a review row carries its line status'
);

select ok(
  (public.list_review() -> 0) ? 'auto_approved_today',
  'the other keys are unchanged'
);

select * from finish();
rollback;
