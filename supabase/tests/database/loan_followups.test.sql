-- FLOW-114: flagged loan parts on removed or void lines are not counted or listed, and
-- service_role cannot clear a review flag. Fixed dates. @example.com only.

begin;

select plan(6);

select tests.create_supabase_user('f114_owner', 'owner114@example.com');

create temp table f114 (label text primary key, id uuid);
grant all on f114 to authenticated, service_role;

select tests.authenticate_as('f114_owner');
select public.create_company('Example Loan Followups Co', true);
reset role;
insert into f114 (label, id) select 'company', id from public.companies where name = 'Example Loan Followups Co';

select public.store_mcp_credential(
  tests.get_supabase_uid('f114_owner'), 'hash-f114-read-0001', array['read'], now() + interval '90 days', 'pepper-1'
);
insert into f114 (label, id) select 'token', id from private.mcp_credentials where token_hash = 'hash-f114-read-0001';

insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency)
select id, 'Example Loan', 1000000, 0, 10, '2026-01-01', 100000, 0, 'USD' from f114 where label = 'company';
insert into f114 (label, id) select 'loan', id from public.loans where name = 'Example Loan';

insert into public.transactions (
  company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
select c.id, 'expense', 'expense', 'posted', -100000, -100000, 100000, 0, 'unknown',
  '2026-02-01', 'USD', 'manual', k, 'Example loan payment'
from f114 c
cross join (values ('f114:kept'), ('f114:removed'), ('f114:void')) as v(k)
where c.label = 'company';

insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review)
select t.company_id, (select id from f114 where label = 'loan'), t.id, v.part::public.loan_split_part, v.amount, v.amount, c.id, true
from public.transactions t
cross join (values
  ('interest', 'ריבית משכנתא', 0::bigint),
  ('escrow', 'מסים וביטוח', 0::bigint),
  ('principal', 'תשלומי הלוואה', 100000::bigint)
) as v(part, category, amount)
join public.categories c on c.company_id = t.company_id and c.name = v.category and c.kind = 'expense'
where t.idempotency_key like 'f114:%';
set constraints all immediate;
set constraints all deferred;

update public.transactions set removed_at = now() where idempotency_key = 'f114:removed';
update public.transactions set line_status = 'void' where idempotency_key = 'f114:void';

select is(
  (select count(*)::integer from public.loan_splits where loan_id = (select id from f114 where label = 'loan') and needs_review),
  9, 'all nine parts are still flagged');

select tests.authenticate_as('f114_owner');
select is(
  (select flagged_parts from public.loan_balances where loan_id = (select id from f114 where label = 'loan')),
  3, 'flagged_parts counts only the parts on the line still on the books');
select is(
  (select balance_minor from public.loan_balances where loan_id = (select id from f114 where label = 'loan')),
  1000000::bigint, 'flagged parts still do not lower the balance');
reset role;

do $mcp$
declare
  uid uuid := tests.get_supabase_uid('f114_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'mcp_tid', (select id from pg_temp.f114 where label = 'token'))::text, true);
end
$mcp$;
select is(
  (select l->'flagged_transaction_ids' from jsonb_array_elements(public.mcp_list_loans()) l
   where l->>'id' = (select id from f114 where label = 'loan')::text),
  jsonb_build_array((select id from public.transactions where idempotency_key = 'f114:kept')),
  'list_loans names only the line still on the books');
select is(
  (select (l->>'flagged_parts')::integer from jsonb_array_elements(public.mcp_list_loans()) l
   where l->>'id' = (select id from f114 where label = 'loan')::text),
  3, 'and counts its parts');
reset role;

select ok(
  not has_function_privilege('service_role', 'public.clear_loan_split_review(uuid)', 'execute'),
  'service_role cannot clear a review flag');

select * from finish();
rollback;
