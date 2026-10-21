-- FLOW-938 (decision 0202): several Mercury connections per company, the accounts each one syncs and
-- where each account imports from. Invented names, ids and @example.com emails only.

begin;

select plan(37);

do $users$
begin
  perform tests.create_supabase_user('mc_owner', 'mc-owner@example.com');
  perform tests.create_supabase_user('mc_editor', 'mc-editor@example.com');
end
$users$;

create temp table mc (label text primary key, id uuid);
grant all on mc to authenticated, service_role;
create function pg_temp.mc_id(p_label text) returns uuid language sql as $$ select id from pg_temp.mc where label = p_label; $$;
grant execute on function pg_temp.mc_id(text) to authenticated, service_role;

insert into mc (label, id) values
  ('a', tests.fixture_company('mc_owner', 'Example Harbor Books')),
  ('owner', tests.get_supabase_uid('mc_owner')),
  ('editor', tests.get_supabase_uid('mc_editor'));
insert into public.company_members (company_id, user_id, role) values (pg_temp.mc_id('a'), pg_temp.mc_id('editor'), 'editor');
insert into public.active_companies (user_id, company_id) values (pg_temp.mc_id('editor'), pg_temp.mc_id('a'));

-- Slot 1 as the rows from before this change look once migrated (chosen, every account synced);
-- slot 2 a second organisation that has just been connected (nothing chosen yet).
insert into public.connector_connections (
  company_id, provider, slot, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_ref, kek_version, envelope_version,
  account_labels, org_label, accounts_chosen_at, sync_account_ids, sync_cursor, import_from
) values
  (pg_temp.mc_id('a'), 'mercury', 1, '\x01', '\x0201', '\x03', '\x0401', 'MERCURY_KEK', '1', '3',
   '[{"id":"acct-chk","label":"Checking","last4":"4821","kind":"checking"},{"id":"acct-sav","label":"Savings","kind":"savings"},{"id":"acct-tre","label":"Treasury","kind":"treasury"}]',
   'Example Harbor LLC', pg_catalog.now(), array['acct-chk', 'acct-sav'], '2026-10-01T00:00:00Z', date '2026-01-01'),
  (pg_temp.mc_id('a'), 'mercury', 2, '\x01', '\x0201', '\x03', '\x0401', 'MERCURY_KEK', '1', '3',
   '[{"id":"acct-ops","label":"Operations","kind":"checking"},{"id":"acct-card","label":"IO Credit","kind":"credit"}]',
   'Example Harbor Holdings LLC', null, null, null, null);

-- The key.
select throws_ok(
  format($$insert into public.connector_connections (company_id, provider, slot, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_ref, kek_version, envelope_version)
    values (%L, 'mercury', 2, '\x01', '\x0201', '\x03', '\x0401', 'MERCURY_KEK', '1', '3')$$, pg_temp.mc_id('a')),
  '23505', null, 'a slot holds one connection');
select throws_ok(
  format($$insert into public.connector_connections (company_id, provider, slot, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_ref, kek_version, envelope_version)
    values (%L, 'sumit', 2, '\x01', '\x0201', '\x03', '\x0401', 'SUMIT_KEK', '1', '2')$$, pg_temp.mc_id('a')),
  '23514', null, 'SUMIT has one connection, on slot 1');
select throws_ok(
  format($$insert into public.connector_connections (company_id, provider, slot, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_ref, kek_version, envelope_version)
    values (%L, 'mercury', 10, '\x01', '\x0201', '\x03', '\x0401', 'MERCURY_KEK', '1', '3')$$, pg_temp.mc_id('a')),
  '23514', null, 'and Mercury at most nine');

-- What the owner reads.
select tests.authenticate_as('mc_owner');
select is(
  (select string_agg(slot::text || ':' || coalesce(org_label, '-') || ':' || accounts_chosen::text || ':' || coalesce(array_to_string(sync_account_ids, ','), '-'), ' | ' order by slot)
   from public.connector_connection_status where provider = 'mercury'),
  '1:Example Harbor LLC:true:acct-chk,acct-sav | 2:Example Harbor Holdings LLC:false:-',
  'the status lists each connection with its organisation, whether its accounts are chosen, and the synced ones');

-- Saving the accounts: refusals first.
select throws_ok($$select public.set_mercury_accounts(2::smallint, array[]::text[], null)$$, 'P0001', 'choose at least one account',
  'at least one account syncs');
select throws_ok($$select public.set_mercury_accounts(2::smallint, array['acct-chk'], null)$$, 'P0001', 'account is not on this connection',
  'an account of another connection is refused');
select throws_ok($$select public.set_mercury_accounts(2::smallint, array['acct-ops'], '2999-01-01')$$, 'P0001', 'import date is after today',
  'a start after today is refused');
select throws_ok($$select public.set_mercury_accounts(2::smallint, array['acct-ops'], 'soon')$$, 'P0001', 'import date is invalid',
  'a start that is not a date is refused');
select throws_ok($$select public.set_mercury_accounts(2::smallint, array['acct-ops'], '2026-02-30')$$, 'P0001', 'import date is invalid',
  'and so is a day that does not exist');
select throws_ok($$select public.set_mercury_accounts(5::smallint, array['acct-ops'], null)$$, 'P0001', 'connector is not connected',
  'a slot with no connection is refused');

-- The first choice on the new connection: the start applies to every account; the rest is skipped.
select is(
  public.set_mercury_accounts(2::smallint, array['acct-ops'], '2026-03-01')->>'synced',
  '1',
  'the owner saves the new connection''s accounts');
reset role;
select is(
  (select array_to_string(sync_account_ids, ',') || ' / ' || array_to_string(skip_account_ids, ',') || ' / ' || import_from::text
     || ' / ' || (accounts_chosen_at is not null)::text || ' / ' || account_from::text
   from public.connector_connections where company_id = pg_temp.mc_id('a') and slot = 2),
  'acct-ops / acct-card / 2026-03-01 / true / {}',
  'the chosen account syncs from the date, the card left out is skipped, and the choice is stamped');
select is(
  (select array_to_string(sync_account_ids, ',') from public.connector_connections where company_id = pg_temp.mc_id('a') and slot = 1),
  'acct-chk,acct-sav',
  'the other connection is untouched');

-- Later: an account added with no start begins today, keeps the cursor and the connection's start.
select tests.authenticate_as('mc_owner');
select is(
  public.set_mercury_accounts(2::smallint, array['acct-ops', 'acct-card'], null)->>'reread',
  'false',
  'an account added from today needs no re-read');
reset role;
select is(
  (select array_to_string(skip_account_ids, ',') || ' / ' || import_from::text || ' / '
     || (account_from->>'acct-card')
   from public.connector_connections where company_id = pg_temp.mc_id('a') and slot = 2),
  ' / 2026-03-01 / ' || ((pg_catalog.now() at time zone 'Asia/Jerusalem')::date)::text,
  'it starts today, kept per account, after the connection''s own start');

-- On slot 1 (from before the change): add the treasury account from the start; it clears the cursor.
select tests.authenticate_as('mc_owner');
select is(
  public.set_mercury_accounts(1::smallint, array['acct-chk', 'acct-sav', 'acct-tre'], 'start')->>'reread',
  'true',
  'an account added from the start re-reads');
reset role;
select is(
  (select coalesce(import_from::text, 'start') || ' / ' || coalesce(sync_cursor, 'no cursor') || ' / ' || account_from::text
   from public.connector_connections where company_id = pg_temp.mc_id('a') and slot = 1),
  'start / no cursor / {"acct-chk": "2026-01-01", "acct-sav": "2026-01-01"}',
  'the connection now starts at the start, and the accounts already synced keep their own start');

-- Dropping an account keeps everything else.
update public.connector_connections set sync_cursor = 'kept-cursor' where company_id = pg_temp.mc_id('a') and slot = 1;
select tests.authenticate_as('mc_owner');
select lives_ok($$select public.set_mercury_accounts(1::smallint, array['acct-chk', 'acct-tre'], null)$$, 'the owner unchecks an account');
reset role;
select is(
  (select array_to_string(skip_account_ids, ',') || ' / ' || sync_cursor || ' / ' || coalesce(import_from::text, 'start')
   from public.connector_connections where company_id = pg_temp.mc_id('a') and slot = 1),
  'acct-sav / kept-cursor / start',
  'the unchecked account is skipped; the cursor and the start stay');

-- Owner only.
select tests.authenticate_as('mc_editor');
select throws_ok($$select public.set_mercury_accounts(1::smallint, array['acct-chk'], null)$$, 'P0001', 'no company',
  'an editor cannot change the synced accounts');
select throws_ok($$select public.disconnect_connector('mercury', 2::smallint)$$, 'P0001', 'no company',
  'or disconnect a connection');

-- The sync functions address one slot.
reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;
update public.connector_connections set sync_cursor = 'c1' where company_id = pg_temp.mc_id('a') and slot = 1;
update public.connector_connections set sync_cursor = 'c2' where company_id = pg_temp.mc_id('a') and slot = 2;
select throws_ok(
  format($$select public.upsert_connector_lines(%L, 'mercury', '{"lines": []}'::jsonb, 'c2-next', 'c1', 2::smallint)$$, pg_temp.mc_id('a')),
  'P0001', 'sync_cursor_conflict', 'the cursor compared is the slot''s own');
select lives_ok(
  format($$select public.upsert_connector_lines(%L, 'mercury', '{"lines": []}'::jsonb, 'c2-next', 'c2', 2::smallint)$$, pg_temp.mc_id('a')),
  'a run on slot 2 commits');
select is(
  (select string_agg(slot::text || ':' || sync_cursor, ',' order by slot) from public.connector_connections where company_id = pg_temp.mc_id('a') and provider = 'mercury'),
  '1:c1,2:c2-next',
  'and moves only slot 2''s cursor');

select lives_ok(format($$select public.note_connector_failure(%L, 'mercury', 'auth', 1::smallint)$$, pg_temp.mc_id('a')),
  'a failure is noted on one slot');
select lives_ok(format($$select public.stamp_connector_sync(%L, 'mercury', 2::smallint)$$, pg_temp.mc_id('a')),
  'and a stamp on the other');
select is(
  (select string_agg(slot::text || ':' || coalesce(last_error, 'ok') || ':' || (last_sync_at is not null)::text, ',' order by slot)
   from public.connector_connections where company_id = pg_temp.mc_id('a') and provider = 'mercury'),
  '1:auth:false,2:ok:true',
  'each lands on its own connection');
select throws_ok(format($$select public.stamp_connector_sync(%L, 'mercury', 7::smallint)$$, pg_temp.mc_id('a')),
  'P0001', 'could not stamp the sync', 'a stamp on a slot with no connection fails');

-- A key goes into its slot: a new slot inserts, the same slot replaces and keeps the chosen accounts.
select lives_ok(
  format($$select public.replace_connector_connection(%L, 'mercury', '0a', '0b', '0c', '0d', '1', '3', true, '{}'::jsonb, 3::smallint)$$, pg_temp.mc_id('a')),
  'a third organisation''s key lands on slot 3');
select lives_ok(
  format($$select public.replace_connector_connection(%L, 'mercury', '1a', '1b', '1c', '1d', '1', '3', true, '{}'::jsonb, 2::smallint)$$, pg_temp.mc_id('a')),
  'a new key for slot 2 replaces its key');
select is(
  (select string_agg(slot::text || ':' || (accounts_chosen_at is not null)::text || ':' || coalesce(last_error, 'ok'), ',' order by slot)
   from public.connector_connections where company_id = pg_temp.mc_id('a') and provider = 'mercury'),
  '1:true:auth,2:true:ok,3:false:ok',
  'slot 3 waits for its accounts; slot 2 keeps its choice');
select is(
  (select encode(key_ciphertext, 'hex') from public.connector_connections where company_id = pg_temp.mc_id('a') and slot = 2),
  '1a',
  'and holds the new key');

-- The daily refresh queues a company once, however many connections it has.
select set_config('request.jwt.claim.role', 'service_role', true);
delete from public.connector_refresh_requests where company_id = pg_temp.mc_id('a');
insert into public.connector_refresh_requests (company_id, provider)
select distinct c.company_id, c.provider
from public.connector_connections c
where c.company_id = pg_temp.mc_id('a')
  and not exists (
    select 1 from public.connector_refresh_requests r
    where r.company_id = c.company_id and r.provider = c.provider and r.claimed_at is null
  );
select is(
  (select count(*)::integer from public.connector_refresh_requests where company_id = pg_temp.mc_id('a') and provider = 'mercury'),
  1,
  'three connections queue one refresh');
select ok(
  position('select distinct c.company_id, c.provider' in pg_get_functiondef('private.schedule_connector_jobs()'::regprocedure)) > 0,
  'which is the daily job''s command');

-- Disconnecting one connection keeps the others.
reset role;
select tests.authenticate_as('mc_owner');
select lives_ok($$select public.disconnect_connector('mercury', 3::smallint)$$, 'the owner disconnects slot 3');
select is(
  (select string_agg(slot::text, ',' order by slot) from public.connector_connection_status where provider = 'mercury'),
  '1,2',
  'the other two stay');

reset role;
select ok(
  has_function_privilege('authenticated', 'public.set_mercury_accounts(smallint,text[],text)', 'execute')
    and not has_function_privilege('anon', 'public.set_mercury_accounts(smallint,text[],text)', 'execute')
    and not has_function_privilege('authenticated', 'public.upsert_connector_lines(uuid,public.connector_provider,jsonb,text,text,smallint)', 'execute')
    and not has_function_privilege('authenticated', 'public.replace_connector_connection(uuid,public.connector_provider,text,text,text,text,text,text,boolean,jsonb,smallint)', 'execute'),
  'the owner''s RPC is callable by the app; the sync ones stay with the service role');

select * from finish();
rollback;
