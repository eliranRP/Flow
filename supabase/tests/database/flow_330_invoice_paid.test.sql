-- FLOW-330 and FLOW-412. An open document marked paid stays marked (set_invoice_paid,
-- list_unpaid), MCP set_invoice_paid with idempotency and undo, viewer and cross-tenant
-- refusals with a positive control; list_project_category on the cash basis leaves unpaid
-- supplier invoices out. Invented data only. Amounts are agorot.

begin;

select plan(42);

do $users$
begin
  perform tests.create_supabase_user('ipm_owner', 'ipm-owner@example.com');
  perform tests.create_supabase_user('ipm_other', 'ipm-other@example.com');
  perform tests.create_supabase_user('ipm_viewer', 'ipm-viewer@example.com');
  perform tests.create_supabase_user('ipm_demo', 'ipm-demo@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('ipm_owner'), 'Example Marks LLC', false),
  (tests.get_supabase_uid('ipm_other'), 'Example Across LLC', false),
  (tests.get_supabase_uid('ipm_demo'), 'Example Marks Demo LLC', true);

create temp table ipm (label text primary key, id uuid);
grant all on ipm to authenticated, service_role;
insert into ipm (label, id) select 'co', id from public.companies where name = 'Example Marks LLC';
insert into ipm (label, id) select 'other_co', id from public.companies where name = 'Example Across LLC';
insert into ipm (label, id) select 'demo_co', id from public.companies where name = 'Example Marks Demo LLC';
insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('ipm_viewer'), id from ipm where label = 'demo_co';

insert into public.projects (company_id, name, status)
values ((select id from ipm where label = 'co'), 'Harbor', 'active');
insert into ipm (label, id) select 'harbor', id from public.projects where name = 'Harbor';

insert into public.categories (company_id, name, kind, sort_order, is_default)
values ((select id from ipm where label = 'co'), 'Fittings', 'expense', 90, false);
insert into ipm (label, id) select 'fittings', id from public.categories where name = 'Fittings';

-- Customer documents: two open invoices, one closed by a receipt, one in another company;
-- an expense line (not a document list_unpaid lists).
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, external_id, linked_external_id,
  project_id, category_id, description
)
select
  (select id from ipm where label = v.co),
  v.direction::public.txn_direction, v.doc_kind::public.doc_kind, v.pnl_role::public.pnl_role,
  'posted', 'ILS', v.amount, v.amount, abs(v.amount), 0, 'source',
  v.doc_date::date, v.cash_date::date, 'manual', v.ikey, v.ext, v.linked,
  case when v.co = 'co' and v.cat is not null then (select id from ipm where label = 'harbor') end,
  (select id from ipm where label = v.cat),
  v.ikey
from (values
  ('co',       'income',  'invoice', null,      50000, 'ipm:open_a',   'ext-a', null,    '2026-06-01', null,         null),
  ('co',       'income',  'invoice', null,      30000, 'ipm:open_b',   'ext-b', null,    '2026-06-02', null,         null),
  ('co',       'income',  'invoice', null,      20000, 'ipm:closed',   'ext-c', null,    '2026-06-03', null,         null),
  ('co',       'income',  'receipt', null,      20000, 'ipm:receipt',  'ext-r', 'ext-c', '2026-06-04', '2026-06-04', null),
  ('other_co', 'income',  'invoice', null,      40000, 'ipm:foreign',  'ext-f', null,    '2026-06-01', null,         null),
  ('co',       'expense', 'expense', 'project', -10000, 'ipm:paid_exp', null,   null,    '2026-06-05', '2026-06-05', 'fittings'),
  ('co',       'expense', 'invoice', 'project', -5000,  'ipm:unpaid_inv', 'ext-s', null, '2026-06-06', null,        'fittings')
) as v(co, direction, doc_kind, pnl_role, amount, ikey, ext, linked, doc_date, cash_date, cat);
insert into ipm (label, id) select replace(idempotency_key, 'ipm:', 'txn_'), id
from public.transactions where idempotency_key like 'ipm:%';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values
  (tests.get_supabase_uid('ipm_owner'), (select id from ipm where label = 'co'), 'hash-ipm-write', 'kid', array['write']::text[], '2099-01-01'),
  (tests.get_supabase_uid('ipm_owner'), (select id from ipm where label = 'co'), 'hash-ipm-read', 'kid', array['read']::text[], '2099-01-01');
insert into ipm (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-ipm-write';
insert into ipm (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-ipm-read';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('ipm_owner');
  tid uuid;
begin
  select id into tid from pg_temp.ipm where label = p_label;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

create or replace function pg_temp.txn(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.ipm where label = p_label; $$;
grant execute on function pg_temp.txn(text) to authenticated, service_role;

-- One list_unpaid row by its transaction label.
create or replace function pg_temp.unpaid(p_label text)
returns jsonb
language sql
as $$
  select u from jsonb_array_elements(public.list_unpaid()) u
  where (u->>'id')::uuid = (select id from pg_temp.ipm where label = p_label);
$$;
grant execute on function pg_temp.unpaid(text) to authenticated, service_role;

-- 1. The owner API.
select tests.authenticate_as('ipm_owner');
select is(jsonb_array_length(public.list_unpaid()), 3, 'list_unpaid lists the two open invoices and the unpaid supplier invoice');
select is(pg_temp.unpaid('txn_open_a')->'marked_paid_at', 'null'::jsonb, 'an unmarked row has marked_paid_at null');
select is(pg_temp.unpaid('txn_open_a')->>'currency', 'ILS', 'list_unpaid returns the currency');

select is(
  (public.set_invoice_paid(pg_temp.txn('txn_open_a'), true)->>'marked_paid')::boolean, true,
  'set_invoice_paid marks an open invoice'
);
select isnt(pg_temp.unpaid('txn_open_a')->'marked_paid_at', 'null'::jsonb, 'the row stays listed with marked_paid_at');
select is(jsonb_array_length(public.list_unpaid()), 3, 'a marked row stays in the list until the sync closes it');

-- Move the first mark's time back, as the database owner.
select tests.clear_authentication();
reset role;
update public.invoice_paid_marks set marked_at = '2026-06-10 08:00+00'
where transaction_id = (select id from ipm where label = 'txn_open_a');
select tests.authenticate_as('ipm_owner');
select is(
  (public.set_invoice_paid(pg_temp.txn('txn_open_a'), true)->>'marked_paid_at')::timestamptz,
  '2026-06-10 08:00+00'::timestamptz,
  'a second mark keeps the first time'
);
select throws_ok(
  format('update public.invoice_paid_marks set marked_at = now() where transaction_id = %L::uuid', pg_temp.txn('txn_open_a')),
  '42501', null, 'authenticated cannot update a mark directly'
);

select is(
  (public.set_invoice_paid(pg_temp.txn('txn_open_a'), false)->>'marked_paid')::boolean, false,
  'set_invoice_paid false clears the mark'
);
select is(pg_temp.unpaid('txn_open_a')->'marked_paid_at', 'null'::jsonb, 'the cleared row is unmarked again');
select is(
  (public.set_invoice_paid(pg_temp.txn('txn_open_a'), false)->>'marked_paid')::boolean, false,
  'clearing an unmarked row is a no-op'
);

select throws_ok(
  format('select public.set_invoice_paid(%L::uuid, true)', pg_temp.txn('txn_paid_exp')),
  'P0001', 'invoice not found', 'an expense line is not a document to mark'
);
select throws_ok(
  format('select public.set_invoice_paid(%L::uuid, true)', pg_temp.txn('txn_closed')),
  'P0001', 'invoice not found', 'a closed invoice is not marked'
);
select lives_ok(
  format('select public.set_invoice_paid(%L::uuid, false)', pg_temp.txn('txn_closed')),
  'clearing a mark on a closed invoice is allowed'
);
select throws_ok(
  format('select public.set_invoice_paid(%L::uuid, true)', pg_temp.txn('txn_foreign')),
  'P0001', 'invoice not found', 'another company''s invoice is not found'
);
select throws_ok(
  format(
    'insert into public.invoice_paid_marks (transaction_id, company_id) values (%L::uuid, %L::uuid)',
    pg_temp.txn('txn_open_b'), (select id from ipm where label = 'co')
  ),
  '42501', null, 'authenticated cannot insert a mark directly'
);

-- Cross-tenant: the other owner neither sees nor changes the mark; positive control on its own.
select lives_ok(
  format('select public.set_invoice_paid(%L::uuid, true)', pg_temp.txn('txn_open_b')),
  'the owner marks invoice b'
);
select tests.authenticate_as('ipm_other');
select is((select count(*)::int from public.invoice_paid_marks), 0, 'another company sees no marks');
select throws_ok(
  format('select public.set_invoice_paid(%L::uuid, false)', pg_temp.txn('txn_open_b')),
  'P0001', 'invoice not found', 'another company cannot clear the mark'
);
select is(
  (public.set_invoice_paid(pg_temp.txn('txn_foreign'), true)->>'marked_paid')::boolean, true,
  'positive control: the other owner marks its own invoice'
);
select tests.authenticate_as('ipm_owner');
select isnt(pg_temp.unpaid('txn_open_b')->'marked_paid_at', 'null'::jsonb, 'invoice b is still marked');

-- A viewer is refused.
select tests.authenticate_as('ipm_viewer');
select throws_ok(
  format('select public.set_invoice_paid(%L::uuid, true)', pg_temp.txn('txn_open_a')),
  '42501', 'forbidden', 'a viewer cannot mark'
);

-- 2. MCP.
select pg_temp.as_mcp('write');
select is(
  public.mcp_set_invoice_paid('ipm-1', pg_temp.txn('txn_open_a'), true)->'data'->>'marked_paid', 'true',
  'mcp_set_invoice_paid marks'
);
select is(
  public.mcp_set_invoice_paid('ipm-1', pg_temp.txn('txn_open_a'), true)->'data'->>'undo_kind', 'invoice_paid',
  'a replay returns the stored response'
);
select is(
  public.mcp_set_invoice_paid('ipm-1', pg_temp.txn('txn_open_a'), false)->'error'->>'code', 'conflict',
  'the same key with other arguments is conflict'
);
select is(
  public.mcp_set_invoice_paid('ipm-2', pg_temp.txn('txn_paid_exp'), true)->'error'->>'message', 'invoice not found',
  'mcp: an expense line is refused with a fixed message'
);
select is(
  public.mcp_set_invoice_paid('ipm-3', pg_temp.txn('txn_foreign'), true)->'error'->>'message', 'invoice not found',
  'mcp: another company''s invoice is refused'
);
select is(
  public.mcp_set_invoice_paid('ipm-4', null, true)->'error'->>'code', 'validation',
  'mcp: a missing id is validation'
);
select is(
  public.mcp_undo('ipm-u1', 'invoice_paid', pg_temp.txn('txn_open_a'))->>'ok', 'true',
  'undo invoice_paid takes the mark away'
);
select is(pg_temp.unpaid('txn_open_a')->'marked_paid_at', 'null'::jsonb, 'after undo invoice a is unmarked');
select is(
  public.mcp_undo('ipm-u2', 'invoice_paid', pg_temp.txn('txn_open_a'))->'error'->>'code', 'not_found',
  'a second undo finds nothing'
);

-- Undo of an unmark puts the mark back with its first time.
select is(
  public.mcp_set_invoice_paid('ipm-5', pg_temp.txn('txn_open_b'), false)->'data'->>'marked_paid', 'false',
  'mcp clears invoice b'
);
select is(
  public.mcp_undo('ipm-u3', 'invoice_paid', pg_temp.txn('txn_open_b'))->>'ok', 'true',
  'undo of the clear'
);
select is(
  (pg_temp.unpaid('txn_open_b')->>'marked_paid_at')::timestamptz,
  (select marked_at from public.invoice_paid_marks where transaction_id = pg_temp.txn('txn_open_b')),
  'invoice b is marked again'
);

-- Changed in the app after the write: undo is conflict.
select is(
  public.mcp_set_invoice_paid('ipm-6', pg_temp.txn('txn_open_a'), true)->>'ok', 'true',
  'mcp marks invoice a again'
);
select tests.authenticate_as('ipm_owner');
select lives_ok(
  format('select public.set_invoice_paid(%L::uuid, false)', pg_temp.txn('txn_open_a')),
  'the owner clears it in the app'
);
select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('ipm-u4', 'invoice_paid', pg_temp.txn('txn_open_a'))->'error'->>'code', 'conflict',
  'undo after an app change is conflict'
);

-- A read-only token cannot write.
select pg_temp.as_mcp('read');
select is(
  public.mcp_set_invoice_paid('ipm-7', pg_temp.txn('txn_open_a'), true)->'error'->>'code', 'forbidden',
  'a read token is refused'
);

-- 3. FLOW-412: the category drill-down on the cash basis.
select tests.authenticate_as('ipm_owner');
select is(
  (public.list_project_category(pg_temp.txn('harbor'), pg_temp.txn('fittings'))->>'total_agorot')::bigint,
  15000::bigint, 'invoiced (default): the paid expense and the unpaid supplier invoice'
);
select is(
  (public.list_project_category(pg_temp.txn('harbor'), pg_temp.txn('fittings'), p_basis => 'cash')->>'total_agorot')::bigint,
  10000::bigint, 'cash: the unpaid supplier invoice is left out'
);
select is(
  jsonb_array_length(public.list_project_category(pg_temp.txn('harbor'), pg_temp.txn('fittings'), p_basis => 'cash')->'rows'),
  1, 'cash: one row listed'
);
select is(
  (public.list_project_category(pg_temp.txn('harbor'), pg_temp.txn('fittings'), p_basis => 'cash')->>'total_agorot')::bigint,
  (select (c->>'amount_agorot')::bigint
   from jsonb_array_elements(public.get_project(pg_temp.txn('harbor'), 'cash')->'categories') c
   where (c->>'id')::uuid = pg_temp.txn('fittings')),
  'cash: the drill-down total matches get_project''s category row'
);

select * from finish();
rollback;
