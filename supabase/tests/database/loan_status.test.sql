-- FLOW-106 part 1: a loan can be paid off or closed (decision 0122).
-- update_loan sets status and closed_on, undo restores them, list_loans shows them,
-- and a closed loan takes only payments dated on or before closed_on.
-- Fixed dates. @example.com only.

begin;

select plan(26);

do $users$
begin
  perform tests.create_supabase_user('f106_owner', 'owner106@example.com');
end
$users$;

create temp table f106 (label text primary key, id uuid);
grant all on f106 to authenticated, service_role;

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid('f106_owner');
  select id into tid from pg_temp.f106 where label = 'write';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

-- A posted 300.00 line on p_date, split by the app (as the owner) into principal only.
create or replace function pg_temp.app_split(p_key text, p_date date)
returns void
language plpgsql
set search_path = ''
as $$
begin
  reset role;
  insert into public.transactions (
    company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
    vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
  )
  select c.id, 'expense', 'expense', 'posted', -30000, -30000, 30000, 0, 'unknown',
    p_date, 'USD', 'manual', p_key, 'Example loan payment'
  from pg_temp.f106 c where c.label = 'company';

  perform tests.authenticate_as('f106_owner');
  insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id)
  select t.company_id, (select id from pg_temp.f106 where label = 'loan'), t.id, v.part::public.loan_split_part,
    v.amount, v.amount, c.id
  from public.transactions t
  cross join (values
    ('interest', 0::bigint),
    ('escrow', 0::bigint),
    ('principal', 30000::bigint)
  ) as v(part, amount)
  join public.categories c
    on c.company_id = t.company_id and c.loan_part = v.part::public.loan_split_part and c.kind = 'expense'
  where t.idempotency_key = p_key;
  set constraints all immediate;
  set constraints all deferred;
  reset role;
end;
$$;
grant execute on function pg_temp.app_split(text, date) to authenticated, service_role;

create or replace function pg_temp.update_loan(p_key text, p_patch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_update_loan(p_key, (select id from pg_temp.f106 where label = 'loan'), p_patch);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.update_loan(text, jsonb) to authenticated, service_role;

create or replace function pg_temp.undo(p_key text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_undo(p_key, 'loan_update', (select id from pg_temp.f106 where label = 'loan'));
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.undo(text) to authenticated, service_role;

create or replace function pg_temp.listed()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  select l into result
  from jsonb_array_elements(public.mcp_list_loans()) l
  where l->>'id' = (select id::text from pg_temp.f106 where label = 'loan');
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.listed() to authenticated, service_role;

create or replace function pg_temp.loan_state()
returns text
language sql
set search_path = ''
as $$
  select l.status::text || ' ' || coalesce(l.closed_on::text, '-')
  from public.loans l
  where l.id = (select id from pg_temp.f106 where label = 'loan');
$$;
grant execute on function pg_temp.loan_state() to authenticated, service_role;

select tests.authenticate_as('f106_owner');
select public.create_company('Example Loan Status Co', true);
reset role;
insert into f106 (label, id) select 'company', id from public.companies where name = 'Example Loan Status Co';

select public.store_mcp_credential(
  tests.get_supabase_uid('f106_owner'), 'hash-f106-write-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into f106 (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-f106-write-1';

-- 100,000.00 at 6 percent over 360 months, 1,000.00 a month with 100.00 escrow.
select pg_temp.as_mcp();
insert into f106 (label, id)
select 'loan', (
  public.mcp_add_loan('f106-add', 'Example Bank', 10000000, 60000, 360, '2026-01-01'::date, 100000, 10000, 'USD')->'data'->>'id'
)::uuid;
reset role;

-- 1-2. A new loan is open.
select is(pg_temp.listed()->>'status', 'open', 'a new loan is open');
select is(pg_temp.listed()->'closed_on', 'null'::jsonb, 'and has no closed_on');

-- 3-8. Refusals and validation.
select is(
  pg_temp.update_loan('f106-no-date', '{"status": "paid_off"}')->'error'->>'message',
  'closed_on required',
  'paid_off without a date is refused'
);
select is(
  pg_temp.update_loan('f106-open-date', '{"closed_on": "2026-03-01"}')->'error'->>'message',
  'loan is open',
  'a date on an open loan is refused'
);
select is(
  pg_temp.update_loan('f106-bad-status', '{"status": "done", "closed_on": "2026-03-01"}')->'error'->>'code',
  'validation',
  'an unknown status is a validation error'
);
select is(
  pg_temp.update_loan('f106-bad-date', '{"status": "closed", "closed_on": "2026-02-30"}')->'error'->>'code',
  'validation',
  'an impossible date is a validation error'
);
select is(
  pg_temp.update_loan('f106-null-status', '{"status": null}')->'error'->>'code',
  'validation',
  'a null status is a validation error'
);
select is(pg_temp.loan_state(), 'open -', 'nothing was written by the refusals');

-- 9. A payment on 2026-02-01 blocks closing the loan before that day.
select pg_temp.app_split('f106:feb', '2026-02-01');
select is(
  pg_temp.update_loan('f106-too-early', '{"status": "paid_off", "closed_on": "2026-01-15"}')->'error'->>'message',
  'payments after closed_on',
  'closing before an attached payment is refused'
);

-- 10-13. Paid off on 2026-02-01. The response shows the principal Flow never saw paid.
select is(
  pg_temp.update_loan('f106-close', '{"status": "paid_off", "closed_on": "2026-02-01"}')->'data'->'balance_left',
  '9970000'::jsonb,
  'paid_off returns balance_left: 100,000.00 less the 300.00 attached'
);
select is(pg_temp.loan_state(), 'paid_off 2026-02-01', 'the loan is paid off on that day');
select is(pg_temp.listed()->>'status', 'paid_off', 'list_loans shows the status');
select is(pg_temp.listed()->>'closed_on', '2026-02-01', 'and closed_on');

-- 14-15. History on or before closed_on still attaches; a later payment does not.
select lives_ok(
  $$ select pg_temp.app_split('f106:jan', '2026-01-20') $$,
  'a payment dated before closed_on still attaches in the app'
);
select throws_ok(
  $$ select pg_temp.app_split('f106:mar', '2026-03-01') $$,
  '23514',
  'loan_closed',
  'a payment dated after closed_on is refused in the app'
);

-- 16. The MCP attach refuses it with a readable message.
reset role;
insert into public.transactions (
  company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
select c.id, 'expense', 'expense', 'posted', -30000, -30000, 30000, 0, 'unknown',
  '2026-04-01', 'USD', 'manual', 'f106:apr', 'Example loan payment'
from f106 c where c.label = 'company';
select pg_temp.as_mcp();
select is(
  public.mcp_attach_loan_payment(
    'f106-attach-late',
    (select id from public.transactions where idempotency_key = 'f106:apr'),
    (select id from f106 where label = 'loan'),
    '[{"part": "interest", "amount_minor": 0, "scheduled_minor": 0},
      {"part": "escrow", "amount_minor": 0, "scheduled_minor": 0},
      {"part": "principal", "amount_minor": 30000, "scheduled_minor": 30000}]'::jsonb
  )->'error'->>'message',
  'loan closed',
  'attach_loan_payment refuses a payment after closed_on'
);
reset role;

-- 17-18. Undo reopens the loan.
select is(pg_temp.undo('f106-undo-close')->>'ok', 'true', 'undo of the close succeeds');
select is(pg_temp.loan_state(), 'open -', 'and the loan is open again with no date');

-- 19-21. Reopening with status open clears the date.
select pg_temp.update_loan('f106-close-2', '{"status": "closed", "closed_on": "2026-02-15"}');
select is(pg_temp.loan_state(), 'closed 2026-02-15', 'closed on 2026-02-15');
select is(
  pg_temp.update_loan('f106-reopen', '{"status": "open"}')->'data'->>'status',
  'open',
  'status open reopens the loan'
);
select is(pg_temp.loan_state(), 'open -', 'and clears closed_on');

-- 22. Undoing the reopen would close the loan before a payment attached since.
select pg_temp.app_split('f106:mar', '2026-03-01');
select is(
  pg_temp.undo('f106-undo-reopen')->'error'->>'message',
  'payments after closed_on',
  'undo of a reopen is refused when a later payment was attached since'
);

-- 23. Undo is a conflict when the date changed after the edit.
select pg_temp.update_loan('f106-close-3', '{"status": "closed", "closed_on": "2026-03-01"}');
reset role;
update public.loans set closed_on = '2026-03-05' where id = (select id from f106 where label = 'loan');
select is(pg_temp.undo('f106-undo-close-3')->'error'->>'code', 'conflict', 'undo is a conflict once closed_on changed');
reset role;
update public.loans set status = 'open', closed_on = null where id = (select id from f106 where label = 'loan');

-- 24-25. An edit kept before this change (no status in its snapshot) still undoes, and
-- leaves the status alone.
select pg_temp.update_loan('f106-rename', '{"name": "Example Bank 2"}');
reset role;
update private.mcp_writes w
set prior = jsonb_build_object(
  'before', (w.prior->'before') - 'status' - 'closed_on',
  'after', (w.prior->'after') - 'status' - 'closed_on'
)
where w.id = (
  select w2.id from private.mcp_writes w2
  where w2.kind = 'loan_update' and w2.loan_id = (select id from f106 where label = 'loan')
  order by w2.created_at desc limit 1
);
update public.loans set status = 'closed', closed_on = '2026-03-10'
where id = (select id from f106 where label = 'loan');
select is(pg_temp.undo('f106-undo-rename')->>'ok', 'true', 'an older edit without status still undoes');
select is(
  (select l.name || ' ' || l.status::text from public.loans l where l.id = (select id from f106 where label = 'loan')),
  'Example Bank closed',
  'it restores the name and leaves the status as it is'
);

-- 26. The table refuses a closed loan without a date, whoever writes it.
select tests.authenticate_as('f106_owner');
select throws_ok(
  $$ update public.loans set closed_on = null where id = (select id from pg_temp.f106 where label = 'loan') $$,
  '23514',
  null,
  'a closed loan must have closed_on'
);
reset role;

select * from finish();
rollback;
