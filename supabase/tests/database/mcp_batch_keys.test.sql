-- MCP cycle 6: a batch key leaves room for ':' and a three-digit ordinal.
-- Row keys are key:ordinal and every per-row wrapper caps keys at 128.
-- Dates are fixed. Emails use @example.com.

begin;

select plan(5);

do $users$
begin
  perform tests.create_supabase_user('mcp6k_owner', 'keys-owner@example.com');
end
$users$;

create temp table mcp6k (label text primary key, id uuid);
grant all on mcp6k to authenticated, service_role;

select tests.authenticate_as('mcp6k_owner');
select lives_ok($$select public.create_company('Key Fixture Co', true)$$, 'owner creates a company');
select public.upsert_project(null, 'Key Site', null, 'active');
insert into mcp6k (label, id) select 'company', id from public.companies;
insert into mcp6k (label, id) select 'project', id from public.projects where name = 'Key Site';
insert into mcp6k (label, id)
select 'category', id from public.categories where name = 'חומרים' and kind = 'expense';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, user_assigned
)
select c.id, 'expense', 'expense', 'overhead',
  -1000, -1000, 0, 'unknown',
  '2026-09-05', 'manual', 'mcp6k:row', 'Key row', false
from mcp6k c
where c.label = 'company';
insert into mcp6k (label, id) select 'txn', id from public.transactions where idempotency_key = 'mcp6k:row';

select public.store_mcp_credential(
  tests.get_supabase_uid('mcp6k_owner'), 'hash-mcp6k-write1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into mcp6k (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-mcp6k-write1';

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claim.sub', tests.get_supabase_uid('mcp6k_owner')::text, true);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', tests.get_supabase_uid('mcp6k_owner'),
    'role', 'authenticated',
    'aal', 'aal1',
    'mcp_tid', (select id from mcp6k where label = 'write')
  )::text,
  true
);

create temp table mcp6k_body as
select jsonb_build_array(jsonb_build_object(
  'transaction_id', (select id::text from mcp6k where label = 'txn'),
  'project_id', (select id::text from mcp6k where label = 'project'),
  'category_id', (select id::text from mcp6k where label = 'category')
)) as body;

select is(
  public.mcp_assign_expenses(repeat('k', 125), (select body from mcp6k_body))->'error'->>'code',
  'validation',
  'a batch key over 124 characters is refused up front, not per row'
);

insert into mcp6k (label, id)
select 'batch', (public.mcp_assign_expenses(repeat('k', 124), (select body from mcp6k_body))->'data'->>'batch_key')::uuid;

select is(
  public.mcp_assign_expenses(repeat('k', 124), (select body from mcp6k_body))->'data'->>'ok_count',
  '1',
  'a 124-character batch key applies its row'
);

select is(
  public.mcp_undo_batch(repeat('u', 125), (select id::text from mcp6k where label = 'batch'))->'error'->>'code',
  'validation',
  'an undo_batch key over 124 characters is refused up front'
);

select is(
  public.mcp_undo_batch(repeat('u', 124), (select id::text from mcp6k where label = 'batch'))->'data'->>'ok_count',
  '1',
  'a 124-character undo_batch key undoes its row'
);

select * from finish();

rollback;
