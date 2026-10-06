-- MCP cycle 5: loan tools.
-- Fixed dates. @example.com only.

begin;

select plan(42);

do $users$
begin
  perform tests.create_supabase_user('mcp5_owner', 'owner5@example.com');
  perform tests.create_supabase_user('mcp5_other', 'other5@example.com');
end
$users$;

create temp table mcp5 (label text primary key, id uuid);
grant all on mcp5 to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text, p_user text default 'mcp5_owner')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  select id into tid from pg_temp.mcp5 where label = p_label;
  if uid is null or tid is null then
    raise exception 'missing mcp actor %', p_label;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', uid,
      'role', 'authenticated',
      'aal', 'aal1',
      'mcp_tid', tid
    )::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated, service_role;

select tests.authenticate_as('mcp5_owner');
select lives_ok($$select public.create_company('Loan MCP Co', true)$$, 'owner creates a company');
insert into mcp5 (label, id) select 'company', id from public.companies where name = 'Loan MCP Co';

select tests.authenticate_as('mcp5_other');
select lives_ok($$select public.create_company('Other Loan Co', true)$$, 'other creates a company');
insert into mcp5 (label, id) select 'other_company', id from public.companies where name = 'Other Loan Co';

reset role;

select lives_ok(
  format(
    $$select public.store_mcp_credential(%L::uuid, 'hash-mcp5-write', array['read','write'], now() + interval '90 days', 'pepper-1')$$,
    tests.get_supabase_uid('mcp5_owner')
  ),
  'store write token'
);
insert into mcp5 (label, id)
select 'write', id from private.mcp_credentials where token_hash = 'hash-mcp5-write';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mcp5_owner'), c.id, 'hash-mcp5-read0', 'pepper-1', array['read'], now() + interval '90 days'
from mcp5 c where c.label = 'company';
insert into mcp5 (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-mcp5-read0';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mcp5_other'), c.id, 'hash-mcp5-other', 'pepper-1', array['read','write'], now() + interval '90 days'
from mcp5 c where c.label = 'other_company';
insert into mcp5 (label, id) select 'other_write', id from private.mcp_credentials where token_hash = 'hash-mcp5-other';

select pg_temp.as_mcp('write');
insert into mcp5 (label, id)
select 'loan_a', (
  public.mcp_add_loan(
    'loan-new-1', 'Example Bank', 12000000, 68750, 360, '2026-01-01'::date, 100000, 10000, 'USD'
  )->'data'->>'id'
)::uuid;

select isnt((select id from mcp5 where label = 'loan_a'), null, 'add_loan returns an id');
select is(
  public.mcp_add_loan('loan-new-1', 'Example Bank', 12000000, 68750, 360, '2026-01-01', 100000, 10000, 'USD')->'data'->>'id',
  (select id::text from mcp5 where label = 'loan_a'),
  'replay returns the same id'
);
select is(
  public.mcp_add_loan('loan-new-1', 'Other Name', 12000000, 68750, 360, '2026-01-01', 100000, 10000, 'USD')->'error'->>'code',
  'conflict',
  'same key different body is conflict'
);
select is(
  public.mcp_add_loan('loan-bad', 'Bad Loan', 12000000, 68750, 360, '2026-01-01', 10000, 10000, 'USD')->'error'->>'message',
  'invalid loan terms',
  'invalid terms are refused'
);

select pg_temp.as_mcp('read');
select is(jsonb_array_length(public.mcp_list_loans()), 1, 'list_loans returns one loan');
select is(public.mcp_company_loan_currency(), 'ILS', 'default currency with no lines is ILS');

select pg_temp.as_mcp('write');
select is(
  public.mcp_update_loan(
    'loan-up-1',
    (select id from mcp5 where label = 'loan_a'),
    jsonb_build_object('name', 'Example Bank Updated')
  )->'data'->>'undo_kind',
  'loan_update',
  'update_loan records undo kind'
);
select is(
  (select name from public.loans where id = (select id from mcp5 where label = 'loan_a')),
  'Example Bank Updated',
  'update applies'
);
select is(
  public.mcp_undo('undo-up', 'loan_update', (select id from mcp5 where label = 'loan_a'))->'data'->>'kind',
  'loan_update',
  'undo update succeeds'
);
select is(
  (select name from public.loans where id = (select id from mcp5 where label = 'loan_a')),
  'Example Bank',
  'undo restores prior name'
);

select is(
  public.mcp_update_loan(
    'loan-up-2',
    (select id from mcp5 where label = 'loan_a'),
    jsonb_build_object('name', 'Changed Again')
  )->'ok',
  'true'::jsonb,
  'second update succeeds'
);
update public.loans set name = 'Manual Edit' where id = (select id from mcp5 where label = 'loan_a');
select is(
  public.mcp_undo('undo-up-2', 'loan_update', (select id from mcp5 where label = 'loan_a'))->'error'->>'code',
  'conflict',
  'undo after a later change is conflict'
);

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
select c.id, 'expense', 'expense', -100000, -100000, 100000, 0, 'unknown',
  '2026-01-01', 'USD', 'manual', 'mcp5:pay', 'Example payment'
from mcp5 c where c.label = 'company';
insert into mcp5 (label, id)
select 'txn', id from public.transactions where idempotency_key = 'mcp5:pay';

select pg_temp.as_mcp('write');
select is(
  public.mcp_attach_loan_payment(
    'split-1',
    (select id from mcp5 where label = 'txn'),
    (select id from mcp5 where label = 'loan_a'),
    jsonb_build_array(
      jsonb_build_object('part', 'interest', 'amount_minor', 50000, 'scheduled_minor', 50000),
      jsonb_build_object('part', 'escrow', 'amount_minor', 10000, 'scheduled_minor', 10000),
      jsonb_build_object('part', 'principal', 'amount_minor', 40000, 'scheduled_minor', 40000)
    )
  )->'data'->>'undo_kind',
  'loan_split',
  'attach returns undo kind'
);
select is(
  (select count(*)::int from public.loan_splits where transaction_id = (select id from mcp5 where label = 'txn')),
  3,
  'attach inserts three parts'
);
select is(
  (select sum(amount_minor)::bigint from public.loan_splits where transaction_id = (select id from mcp5 where label = 'txn')),
  100000,
  'parts sum to the line'
);
select is(
  public.mcp_attach_loan_payment(
    'split-2',
    (select id from mcp5 where label = 'txn'),
    (select id from mcp5 where label = 'loan_a'),
    '[]'::jsonb
  )->'error'->>'message',
  'loan already attached',
  'second attach is refused'
);

select pg_temp.as_mcp('other_write', 'mcp5_other');
select is(
  public.mcp_update_loan(
    'loan-cross',
    (select id from mcp5 where label = 'loan_a'),
    jsonb_build_object('name', 'Hacked')
  )->'error'->>'message',
  'loan not found',
  'cross-tenant update is refused'
);
select is(
  public.mcp_attach_loan_payment(
    'split-cross',
    (select id from mcp5 where label = 'txn'),
    (select id from mcp5 where label = 'loan_a'),
    '[]'::jsonb
  )->'error'->>'message',
  'transaction not found',
  'cross-tenant attach on txn is refused'
);
select pg_temp.as_mcp('write');
select is(
  public.mcp_update_loan(
    'loan-own',
    (select id from mcp5 where label = 'loan_a'),
    jsonb_build_object('name', 'Owner OK')
  )->'ok',
  'true'::jsonb,
  'owner positive control on update'
);

select is(
  public.mcp_undo('undo-loan-del', 'loan', (select id from mcp5 where label = 'loan_a'))->'error'->>'code',
  'conflict',
  'undo loan with splits is conflict'
);
select is(
  public.mcp_undo('undo-split', 'loan_split', (select id from mcp5 where label = 'txn'))->'data'->>'kind',
  'loan_split',
  'undo split deletes'
);
select is(
  (select count(*)::int from public.loan_splits where transaction_id = (select id from mcp5 where label = 'txn')),
  0,
  'undo split removes rows'
);
select is(
  public.mcp_undo('undo-loan-ok', 'loan', (select id from mcp5 where label = 'loan_a'))->'data'->>'kind',
  'loan',
  'undo loan after split undo succeeds'
);

insert into public.transactions (
  company_id, direction, doc_kind, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
select c.id, 'expense', 'expense', -50000, -50000, 50000, 0, 'unknown',
  '2026-02-01', 'ILS', 'manual', 'mcp5:ils', 'Shekel line'
from mcp5 c where c.label = 'company';
insert into mcp5 (label, id) select 'txn_ils', id from public.transactions where idempotency_key = 'mcp5:ils';

insert into mcp5 (label, id)
select 'loan_b', (
  public.mcp_add_loan('loan-b', 'USD Loan', 5000000, 0, 120, '2026-02-01'::date, 50000, 0, 'USD')->'data'->>'id'
)::uuid;

select is(
  public.mcp_attach_loan_payment(
    'split-curr',
    (select id from mcp5 where label = 'txn_ils'),
    (select id from mcp5 where label = 'loan_b'),
    jsonb_build_array(
      jsonb_build_object('part', 'interest', 'amount_minor', 0, 'scheduled_minor', 0),
      jsonb_build_object('part', 'escrow', 'amount_minor', 0, 'scheduled_minor', 0),
      jsonb_build_object('part', 'principal', 'amount_minor', 50000, 'scheduled_minor', 50000)
    )
  )->'error'->>'message',
  'loan currency mismatch',
  'currency mismatch is refused'
);

insert into public.transactions (
  company_id, direction, doc_kind, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
select c.id, 'expense', 'expense', -50000000, -50000000, 50000000, 0, 'unknown',
  '2026-02-01', 'USD', 'manual', 'mcp5:big', 'Large payment'
from mcp5 c where c.label = 'company';
insert into mcp5 (label, id) select 'txn_big', id from public.transactions where idempotency_key = 'mcp5:big';

select is(
  public.mcp_attach_loan_payment(
    'split-bal',
    (select id from mcp5 where label = 'txn_big'),
    (select id from mcp5 where label = 'loan_b'),
    jsonb_build_array(
      jsonb_build_object('part', 'interest', 'amount_minor', 0, 'scheduled_minor', 0),
      jsonb_build_object('part', 'escrow', 'amount_minor', 0, 'scheduled_minor', 0),
      jsonb_build_object('part', 'principal', 'amount_minor', 50000000, 'scheduled_minor', 50000000)
    )
  )->'error'->>'message',
  'loan balance exceeded',
  'over balance is refused'
);

select pg_temp.as_mcp('read');
select is(
  public.mcp_add_loan('loan-read', 'Read Loan', 100, 0, 12, '2026-01-01', 100, 0, 'USD')->'error'->>'code',
  'forbidden',
  'read token cannot add a loan'
);

select * from finish();

rollback;
