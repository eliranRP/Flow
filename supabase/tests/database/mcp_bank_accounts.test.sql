-- FLOW-938 (decision 0203): the MCP tools for the Mercury connections. list_bank_connections reads
-- each connection's accounts and which sync; set_bank_accounts and answer_bank_account save through
-- set_mercury_accounts with the idempotency key, the owner check and undo kind bank_accounts.
-- Invented names, ids and @example.com emails only.

begin;

select plan(27);

do $users$
begin
  perform tests.create_supabase_user('mba_owner', 'mba-owner@example.com');
  perform tests.create_supabase_user('mba_editor', 'mba-editor@example.com');
end
$users$;

create temp table mba (label text primary key, id uuid);
grant all on mba to authenticated, service_role;
create function pg_temp.mba_id(p_label text) returns uuid language sql as $$ select id from pg_temp.mba where label = p_label; $$;
grant execute on function pg_temp.mba_id(text) to authenticated, service_role;

insert into mba (label, id) values
  ('co', tests.fixture_company('mba_owner', 'Example Pier Books')),
  ('owner', tests.get_supabase_uid('mba_owner')),
  ('editor', tests.get_supabase_uid('mba_editor'));
insert into public.company_members (company_id, user_id, role) values (pg_temp.mba_id('co'), pg_temp.mba_id('editor'), 'editor');
insert into public.active_companies (user_id, company_id) values (pg_temp.mba_id('editor'), pg_temp.mba_id('co'));

-- Slot 1: chosen, two of three accounts synced, and a fourth account Mercury reported since (new).
-- Slot 2: connected, nothing chosen yet.
insert into public.connector_connections (
  company_id, provider, slot, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_ref, kek_version, envelope_version,
  account_labels, org_label, accounts_chosen_at, sync_account_ids, skip_account_ids, account_from, sync_cursor, import_from
) values
  (pg_temp.mba_id('co'), 'mercury', 1, '\x01', '\x0201', '\x03', '\x0401', 'MERCURY_KEK', '1', '3',
   '[{"id":"acct-chk","label":"Checking","last4":"4821","kind":"checking","balance_cents":125000},{"id":"acct-sav","label":"Savings","kind":"savings"},{"id":"acct-tre","label":"Treasury","kind":"treasury"},{"id":"acct-new","label":"Checking","last4":"6610","kind":"checking"}]',
   'Example Pier LLC', '2026-01-02T00:00:00Z', array['acct-chk', 'acct-sav'], array['acct-tre'], '{"acct-sav":"2026-05-01"}',
   '2026-10-01T00:00:00Z', date '2026-01-01'),
  (pg_temp.mba_id('co'), 'mercury', 2, '\x01', '\x0201', '\x03', '\x0401', 'MERCURY_KEK', '1', '3',
   '[{"id":"acct-ops","label":"Operations","kind":"checking"}]', null, null, null, '{}', '{}', null, null);
insert into mba (label, id)
select 'conn1', id from public.connector_connections where company_id = pg_temp.mba_id('co') and provider = 'mercury' and slot = 1;

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at) values
  (pg_temp.mba_id('owner'), pg_temp.mba_id('co'), 'hash-mba-owner', 'kid', array['read', 'write']::text[], '2099-01-01'),
  (pg_temp.mba_id('owner'), pg_temp.mba_id('co'), 'hash-mba-read', 'kid', array['read']::text[], '2099-01-01'),
  (pg_temp.mba_id('editor'), pg_temp.mba_id('co'), 'hash-mba-editor', 'kid', array['read', 'write']::text[], '2099-01-01');
insert into mba (label, id)
select replace(token_hash, 'hash-mba-', 'tok-'), id from private.mcp_credentials where token_hash like 'hash-mba-%';

create or replace function pg_temp.as_mcp(p_user text, p_token text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := pg_temp.mba_id(p_user);
  tid uuid := pg_temp.mba_id(p_token);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated, service_role;

-- 1-6. The read.
select pg_temp.as_mcp('owner', 'tok-owner');
select is(
  (select string_agg(c->>'slot' || ':' || coalesce(c->>'org_label', '-') || ':' || (c->>'accounts_chosen') || ':' || coalesce(c->>'import_from', '-'), ' | ')
   from jsonb_array_elements(public.mcp_bank_connections()->'connections') c),
  '1:Example Pier LLC:true:2026-01-01 | 2:-:false:-',
  'list_bank_connections lists each connection by slot with its organisation, choice and start');
select is(
  (select string_agg(a->>'id' || ':' || (a->>'synced') || ':' || (a->>'skipped') || ':' || (a->>'new') || ':' || coalesce(a->>'import_from', '-'), ' ' order by a->>'id')
   from jsonb_array_elements(public.mcp_bank_connections()->'connections'->0->'accounts') a),
  'acct-chk:true:false:false:2026-01-01 acct-new:false:false:true:- acct-sav:true:false:false:2026-05-01 acct-tre:false:true:false:-',
  'each account says whether it syncs, was left out, or waits for an answer, and where a synced one starts');
select is(
  public.mcp_bank_connections()->'connections'->0->'accounts'->0,
  '{"id":"acct-chk","name":"Checking","last4":"4821","kind":"checking","balance_minor":125000,"synced":true,"skipped":false,"new":false,"import_from":"2026-01-01"}'::jsonb,
  'an account has its name, last 4, kind and balance');
select is(
  public.mcp_bank_connections()->'connections'->0->'new_account_ids',
  '["acct-new"]'::jsonb,
  'the new account is listed as waiting');
select is(
  public.mcp_bank_connections()->'connections'->1->'new_account_ids',
  '[]'::jsonb,
  'a connection whose accounts are not chosen yet has no new account');
select pg_temp.as_mcp('editor', 'tok-editor');
select is(
  jsonb_array_length(public.mcp_bank_connections()->'connections'),
  2,
  'any member reads the connections');

-- 7-9. Who may write.
select is(
  public.mcp_set_bank_accounts('mba-editor', 1::smallint, array['acct-chk'], null) -> 'error',
  '{"code":"forbidden","message":"owner only"}'::jsonb,
  'an editor may not change the synced accounts');
select is(
  public.mcp_answer_bank_account('mba-editor-answer', 1::smallint, 'acct-new', true) -> 'error' ->> 'code',
  'forbidden',
  'nor answer a new account');
select pg_temp.as_mcp('owner', 'tok-read');
select is(
  public.mcp_set_bank_accounts('mba-read', 1::smallint, array['acct-chk'], null) -> 'error' ->> 'code',
  'forbidden',
  'a read-only key may not write');

-- 10-14. Refusals for the owner.
select pg_temp.as_mcp('owner', 'tok-owner');
select is(
  public.mcp_set_bank_accounts('mba-bad-1', 1::smallint, array['acct-ops'], null) -> 'error',
  '{"code":"validation","message":"account is not on this connection"}'::jsonb,
  'an account of another connection is refused');
select is(
  public.mcp_set_bank_accounts('mba-bad-2', 1::smallint, array['acct-new'], '2999-01-01') -> 'error',
  '{"code":"validation","message":"import date is after today"}'::jsonb,
  'a start after today is refused');
select is(
  public.mcp_set_bank_accounts('mba-bad-3', 1::smallint, array['acct-new'], '2026-02-30') -> 'error',
  '{"code":"validation","message":"import date is invalid"}'::jsonb,
  'a day that does not exist is refused');
select is(
  public.mcp_set_bank_accounts('mba-bad-4', 5::smallint, array['acct-chk'], null) -> 'error',
  '{"code":"not_found","message":"bank connection not found"}'::jsonb,
  'a slot with no connection is not found');
select is(
  public.mcp_set_bank_accounts('mba-bad-5', 1::smallint, array[]::text[], null) -> 'error' ->> 'code',
  'validation',
  'at least one account');

-- 15-20. Adding the treasury account from a day, the same key, and undo.
select is(
  public.mcp_set_bank_accounts('mba-set', 1::smallint, array['acct-chk', 'acct-sav', 'acct-tre'], '2026-04-01') -> 'data',
  jsonb_build_object('id', pg_temp.mba_id('conn1'), 'slot', 1, 'account_ids', jsonb_build_array('acct-chk', 'acct-sav', 'acct-tre'),
    'skipped_account_ids', jsonb_build_array('acct-new'), 'added', 1, 'import_from', '2026-01-01', 'reread', true,
    'undo_kind', 'bank_accounts'),
  'set_bank_accounts saves the accounts through set_mercury_accounts');
select is(
  (select a->>'import_from' from jsonb_array_elements(public.mcp_bank_connections()->'connections'->0->'accounts') a where a->>'id' = 'acct-tre'),
  '2026-04-01',
  'the added account starts on its day');
select is(
  public.mcp_set_bank_accounts('mba-set', 1::smallint, array['acct-tre', 'acct-sav', 'acct-chk'], '2026-04-01') -> 'data' ->> 'undo_kind',
  'bank_accounts',
  'the same key with the same accounts replays');
select is(
  public.mcp_set_bank_accounts('mba-set', 1::smallint, array['acct-chk'], '2026-04-01') -> 'error' ->> 'code',
  'conflict',
  'the same key with other accounts is a conflict');
select is(
  public.mcp_undo('mba-undo', 'bank_accounts', pg_temp.mba_id('conn1')) ->> 'ok',
  'true',
  'undo bank_accounts');
reset role;
select is(
  (select array_to_string(sync_account_ids, ',') || ' / ' || array_to_string(skip_account_ids, ',') || ' / ' || account_from::text || ' / ' || import_from::text
   from public.connector_connections where id = pg_temp.mba_id('conn1')),
  'acct-chk,acct-sav / acct-tre / {"acct-sav": "2026-05-01"} / 2026-01-01',
  'the accounts, the skipped list and the starts from before are back');

-- 21-25. The new account: yes, then undo, then no; an account already answered.
select pg_temp.as_mcp('owner', 'tok-owner');
select is(
  public.mcp_answer_bank_account('mba-yes', 1::smallint, 'acct-new', true) -> 'data' -> 'account_ids',
  '["acct-chk", "acct-new", "acct-sav"]'::jsonb,
  'yes adds the new account');
select is(
  (select a->>'import_from' from jsonb_array_elements(public.mcp_bank_connections()->'connections'->0->'accounts') a where a->>'id' = 'acct-new'),
  '2026-01-01',
  'from the connection''s own start');
select is(
  public.mcp_undo('mba-undo-yes', 'bank_accounts', pg_temp.mba_id('conn1')) ->> 'ok',
  'true',
  'undo the yes');
select is(
  public.mcp_answer_bank_account('mba-no', 1::smallint, 'acct-new', false) -> 'data' -> 'skipped_account_ids',
  '["acct-new", "acct-tre"]'::jsonb,
  'no leaves the new account out');
select is(
  public.mcp_answer_bank_account('mba-again', 1::smallint, 'acct-new', true) -> 'error',
  '{"code":"refused","message":"account is not waiting for an answer"}'::jsonb,
  'an account already answered is refused');

-- 26-27. A change since the write is a conflict; the undo log keeps the connection.
reset role;
update public.connector_connections set sync_account_ids = array['acct-chk'] where id = pg_temp.mba_id('conn1');
select pg_temp.as_mcp('owner', 'tok-owner');
select is(
  public.mcp_undo('mba-undo-no', 'bank_accounts', pg_temp.mba_id('conn1')) -> 'error' ->> 'code',
  'conflict',
  'undo after the accounts changed again is a conflict');
reset role;
select is(
  (select count(*)::integer from private.mcp_writes where kind = 'bank_accounts' and prior->>'connection_id' = pg_temp.mba_id('conn1')::text),
  3,
  'each write is in the undo log with its connection');

select * from finish();
rollback;
