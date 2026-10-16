-- FLOW-367, server part. list_unpaid's match and days_open, a linked invoice leaves the list,
-- link_invoice_payment and dismiss_invoice_match (owner only, with the viewer and cross-tenant
-- refusals), the MCP link and dismiss with idempotency and undo, and unpaid_overview's keys.
-- A match needs the same amount and the same customer. Invented data only. Amounts are agorot.

begin;

select plan(56);

do $users$
begin
  perform tests.create_supabase_user('ibm_owner', 'ibm-owner@example.com');
  perform tests.create_supabase_user('ibm_other', 'ibm-other@example.com');
  perform tests.create_supabase_user('ibm_viewer', 'ibm-viewer@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('ibm_owner'), 'Example Match LLC', false),
  (tests.get_supabase_uid('ibm_other'), 'Example Elsewhere LLC', false);

create temp table ibm (label text primary key, id uuid);
grant all on ibm to authenticated, service_role;
insert into ibm (label, id) select 'co', id from public.companies where name = 'Example Match LLC';
insert into ibm (label, id) select 'other_co', id from public.companies where name = 'Example Elsewhere LLC';
insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('ibm_viewer'), id from ibm where label = 'co';

insert into public.customers (company_id, name)
values
  ((select id from ibm where label = 'co'), 'Example Client One'),
  ((select id from ibm where label = 'co'), 'Example Client Two');
insert into ibm (label, id) select 'c1', id from public.customers where name = 'Example Client One';
insert into ibm (label, id) select 'c2', id from public.customers where name = 'Example Client Two';

-- Invoices A to E, and the Mercury deposits that do or do not match them:
--   A 50000 client one 06-01 pays with D1 (50000, client one, 06-05).
--   B 30000 client two 06-02: D2 (30000) is client one's, so it does not match; D5 does.
--   C 20000 client one 06-03: D3 is before the invoice, so D4 (06-09) matches.
--   E 30000 client two 06-04 also matches D5 (only D5 is dated after it).
-- A supplier invoice and a SUMIT receipt in another company are not listed.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, external_id, customer_id, description
)
select
  (select id from ibm where label = v.co),
  v.direction::public.txn_direction, v.doc_kind::public.doc_kind, null,
  'posted', 'ILS', v.amount, v.amount, abs(v.amount), 0, 'source',
  v.doc_date::date, v.doc_date::date, v.source::public.txn_source, v.ikey, v.ext,
  case when v.cust is null then null else (select id from ibm where label = v.cust) end,
  v.descr
from (values
  ('co',       'income',  'invoice', 50000, 'ibm:inv_a', 'ext-a', 'c1', '2026-06-01', 'sumit',   'Invoice A'),
  ('co',       'income',  'invoice', 30000, 'ibm:inv_b', 'ext-b', 'c2', '2026-06-02', 'sumit',   'Invoice B'),
  ('co',       'income',  'invoice', 20000, 'ibm:inv_c', 'ext-c', 'c1', '2026-06-03', 'sumit',   'Invoice C'),
  ('co',       'income',  'invoice', 30000, 'ibm:inv_e', 'ext-e', 'c2', '2026-06-04', 'sumit',   'Invoice E'),
  ('co',       'income',  'other',   50000, 'ibm:dep_1', null,    'c1', '2026-06-05', 'mercury', 'Example wire one'),
  ('co',       'income',  'other',   30000, 'ibm:dep_2', null,    'c1', '2026-06-04', 'mercury', 'Example wire two'),
  ('co',       'income',  'other',   20000, 'ibm:dep_3', null,    'c1', '2026-06-02', 'mercury', 'Example wire three'),
  ('co',       'income',  'other',   20000, 'ibm:dep_4', null,    'c1', '2026-06-09', 'mercury', 'Example wire four'),
  ('co',       'income',  'other',   30000, 'ibm:dep_5', null,    'c2', '2026-06-10', 'mercury', 'Example wire five'),
  ('co',       'expense', 'invoice', -5000, 'ibm:bill',  'ext-s', null, '2026-06-06', 'sumit',   'Supplier bill'),
  ('other_co', 'income',  'invoice', 40000, 'ibm:foreign', 'ext-f', null, '2026-06-01', 'sumit', 'Foreign invoice')
) as v(co, direction, doc_kind, amount, ikey, ext, cust, doc_date, source, descr);

insert into ibm (label, id) select replace(idempotency_key, 'ibm:', 't_'), id
from public.transactions where idempotency_key like 'ibm:%';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values
  (tests.get_supabase_uid('ibm_owner'), (select id from ibm where label = 'co'), 'hash-ibm-write', 'kid', array['write']::text[], '2099-01-01'),
  (tests.get_supabase_uid('ibm_owner'), (select id from ibm where label = 'co'), 'hash-ibm-read', 'kid', array['read']::text[], '2099-01-01');
insert into ibm (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-ibm-write';
insert into ibm (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-ibm-read';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('ibm_owner');
  tid uuid;
begin
  select id into tid from pg_temp.ibm where label = p_label;
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
as $$ select id from pg_temp.ibm where label = p_label; $$;
grant execute on function pg_temp.txn(text) to authenticated, service_role;

-- One list_unpaid row by its transaction label.
create or replace function pg_temp.unpaid(p_label text)
returns jsonb
language sql
as $$
  select u from jsonb_array_elements(public.list_unpaid()) u
  where (u->>'id')::uuid = (select id from pg_temp.ibm where label = p_label);
$$;
grant execute on function pg_temp.unpaid(text) to authenticated, service_role;

-- 1. Listing and matches, as the owner.
select tests.authenticate_as('ibm_owner');
select is(jsonb_array_length(public.list_unpaid()), 5, 'list_unpaid lists the four customer invoices and the supplier bill');
select is(pg_temp.unpaid('t_inv_a')->'match'->>'transaction_id', pg_temp.txn('t_dep_1')::text, 'A matches the deposit of the same amount and customer');
select is((pg_temp.unpaid('t_inv_a')->'match'->>'amount_minor')::bigint, 50000::bigint, 'the match carries the deposit amount');
select is(pg_temp.unpaid('t_inv_a')->'match'->>'raw_description', 'Example wire one', 'the match carries the bank description');
select is(pg_temp.unpaid('t_inv_b')->'match'->>'transaction_id', pg_temp.txn('t_dep_5')::text, 'B skips the deposit of the same amount from another customer');
select is(pg_temp.unpaid('t_inv_c')->'match'->>'transaction_id', pg_temp.txn('t_dep_4')::text, 'C skips a deposit dated before the invoice');
select is(pg_temp.unpaid('t_inv_e')->'match'->>'transaction_id', pg_temp.txn('t_dep_5')::text, 'E matches the deposit after it, same amount and customer');
select is(pg_temp.unpaid('t_inv_a')->'days_open', to_jsonb(current_date - date '2026-06-01'), 'days_open counts from the document date');
select is(pg_temp.unpaid('t_inv_a')->'match'->>'account_name', null::text, 'account_name is null without a bank connection');
select is(pg_temp.unpaid('t_bill')->'match', 'null'::jsonb, 'a supplier bill has no match');

-- 2. The link and the dismissal, as the owner API.
select throws_ok(
  format('select public.link_invoice_payment(%L::uuid, %L::uuid)', pg_temp.txn('t_inv_b'), pg_temp.txn('t_dep_2')),
  'P0001', 'payment not matched', 'a deposit of another customer does not link'
);
select throws_ok(
  format('select public.link_invoice_payment(%L::uuid, %L::uuid)', pg_temp.txn('t_inv_a'), pg_temp.txn('t_dep_2')),
  'P0001', 'payment not matched', 'a deposit of another amount does not link'
);
select throws_ok(
  format('select public.link_invoice_payment(%L::uuid, %L::uuid)', pg_temp.txn('t_inv_a'), pg_temp.txn('t_foreign')),
  'P0001', 'payment not matched', 'a deposit of another company does not link'
);
select is(
  (public.link_invoice_payment(pg_temp.txn('t_inv_b'), pg_temp.txn('t_dep_5'))->>'linked')::boolean, true,
  'link_invoice_payment links an invoice to its deposit'
);
select is(jsonb_array_length(public.list_unpaid()), 4, 'a linked invoice leaves the list');
select is(pg_temp.unpaid('t_inv_e')->'match', 'null'::jsonb, 'a deposit already linked is not offered again');
select throws_ok(
  format('select public.link_invoice_payment(%L::uuid, %L::uuid)', pg_temp.txn('t_inv_e'), pg_temp.txn('t_dep_5')),
  'P0001', 'payment already linked', 'a linked deposit cannot pay a second invoice'
);
select throws_ok(
  format('select public.link_invoice_payment(%L::uuid, %L::uuid)', pg_temp.txn('t_inv_b'), pg_temp.txn('t_dep_5')),
  'P0001', 'invoice not found', 'a linked invoice is not listed, so it cannot be linked again'
);
select is(
  (public.link_invoice_payment(pg_temp.txn('t_inv_a'), pg_temp.txn('t_dep_1'))->>'linked')::boolean, true,
  'a second link to another deposit works'
);
select is(jsonb_array_length(public.list_unpaid()), 3, 'the list shrinks by one per link');
select throws_ok(
  format('select public.dismiss_invoice_match(%L::uuid, %L::uuid)', pg_temp.txn('t_dep_1'), pg_temp.txn('t_dep_2')),
  'P0001', 'invoice not found', 'a deposit is not an open invoice'
);
select throws_ok(
  format('select public.dismiss_invoice_match(%L::uuid, %L::uuid)', pg_temp.txn('t_inv_c'), pg_temp.txn('t_foreign')),
  'P0001', 'payment not matched', 'a dismissal names a deposit of the company'
);
select is(
  (public.dismiss_invoice_match(pg_temp.txn('t_inv_c'), pg_temp.txn('t_dep_4'))->>'dismissed')::boolean, true,
  'dismiss_invoice_match says a deposit is not the payment'
);
select is(pg_temp.unpaid('t_inv_c')->'match', 'null'::jsonb, 'a dismissed deposit is not offered for that invoice');
select is(
  (public.dismiss_invoice_match(pg_temp.txn('t_inv_c'), pg_temp.txn('t_dep_4'))->>'dismissed_at')::timestamptz,
  (select dismissed_at from public.invoice_match_dismissals where transaction_id = pg_temp.txn('t_inv_c')),
  'dismissing again keeps the first time'
);

-- 3. Viewers and other companies are refused, with a positive control.
select tests.clear_authentication();
reset role;
select tests.authenticate_as('ibm_viewer');
select throws_ok(
  format('select public.link_invoice_payment(%L::uuid, %L::uuid)', pg_temp.txn('t_inv_c'), pg_temp.txn('t_dep_4')),
  '42501', 'forbidden', 'a viewer cannot link'
);
select throws_ok(
  format('select public.dismiss_invoice_match(%L::uuid, %L::uuid)', pg_temp.txn('t_inv_c'), pg_temp.txn('t_dep_4')),
  '42501', 'forbidden', 'a viewer cannot dismiss'
);
select is(jsonb_array_length(public.list_unpaid()), 3, 'a viewer reads the same list');
select tests.clear_authentication();
reset role;
select tests.authenticate_as('ibm_other');
select throws_ok(
  format('select public.link_invoice_payment(%L::uuid, %L::uuid)', pg_temp.txn('t_inv_c'), pg_temp.txn('t_dep_4')),
  'P0001', 'invoice not found', 'another company cannot link an invoice of this one'
);
select is(jsonb_array_length(public.list_unpaid()), 1, 'another company lists only its own invoice');
select tests.clear_authentication();
reset role;
select tests.authenticate_as('ibm_owner');

-- 4. The MCP writes: idempotency, the refusals, and undo.
select pg_temp.as_mcp('write');
select is(
  public.mcp_link_invoice_payment('mlink-1', pg_temp.txn('t_inv_c'), pg_temp.txn('t_dep_4'))->'data'->>'undo_kind',
  'invoice_link', 'mcp_link_invoice_payment links and names the undo kind'
);
select is(
  public.mcp_link_invoice_payment('mlink-1', pg_temp.txn('t_inv_c'), pg_temp.txn('t_dep_4'))->'data'->>'undo_kind',
  'invoice_link', 'the same key replays the same answer'
);
select is(
  public.mcp_link_invoice_payment('mlink-2', pg_temp.txn('t_inv_c'), pg_temp.txn('t_dep_4'))->'error'->>'message',
  'invoice not found', 'a second link of the invoice is refused with the fixed message'
);
select is(
  public.mcp_link_invoice_payment('mlink-3', pg_temp.txn('t_inv_e'), pg_temp.txn('t_dep_2'))->'error'->>'message',
  'payment not matched', 'an MCP link of a deposit that does not match is refused'
);
select is(
  public.mcp_undo('mundo-1', 'invoice_link', pg_temp.txn('t_inv_c'))->'data'->>'kind',
  'invoice_link', 'undo of invoice_link takes the link away'
);
select is(pg_temp.unpaid('t_inv_c')->>'id', pg_temp.txn('t_inv_c')::text, 'the undone invoice is listed again');
select is(
  public.mcp_undo('mundo-2', 'invoice_link', pg_temp.txn('t_inv_c'))->'error'->>'code',
  'not_found', 'a second undo of the same link finds nothing to undo'
);
select is(
  public.mcp_dismiss_invoice_match('mdis-1', pg_temp.txn('t_inv_c'), pg_temp.txn('t_dep_4'))->'data'->>'undo_kind',
  'invoice_dismiss', 'mcp_dismiss_invoice_match names the undo kind'
);
select is(
  public.mcp_undo('mundo-3', 'invoice_dismiss', pg_temp.txn('t_inv_c'))->'data'->>'kind',
  'invoice_dismiss', 'undo of invoice_dismiss takes the dismissal away'
);
select is(pg_temp.unpaid('t_inv_c')->'match', 'null'::jsonb, 'an undo keeps a dismissal that was there before');
select is(
  public.mcp_dismiss_invoice_match('mdis-2', pg_temp.txn('t_inv_a'), pg_temp.txn('t_dep_4'))->'error'->>'message',
  'invoice not found', 'an invoice that is linked cannot be dismissed'
);
select is(
  public.mcp_link_invoice_payment('mlink-4', pg_temp.txn('t_inv_c'), pg_temp.txn('t_dep_4'))->'data'->>'linked',
  'true', 'the link can be made again after its undo'
);
select is(
  public.mcp_undo('mundo-4', 'invoice_link', pg_temp.txn('t_inv_c'))->'data'->>'kind',
  'invoice_link', 'undo again takes it away'
);
select tests.clear_authentication();
reset role;
select pg_temp.as_mcp('read');
select is(
  public.mcp_link_invoice_payment('mlink-5', pg_temp.txn('t_inv_c'), pg_temp.txn('t_dep_4'))->'error'->>'code',
  'forbidden', 'a read token cannot link'
);
select tests.clear_authentication();
reset role;

-- 5. The totals' keys and the bar's sums are the company's own.
select tests.authenticate_as('ibm_owner');
select ok(public.unpaid_overview() ? 'issued_since', 'unpaid_overview names the issued-since date');
select ok(
  (public.unpaid_overview()->>'paid_minor')::bigint = (public.unpaid_overview()->>'billed_minor')::bigint - (public.unpaid_overview()->>'open_minor')::bigint,
  'paid is billed less open'
);

select * from finish();
rollback;
