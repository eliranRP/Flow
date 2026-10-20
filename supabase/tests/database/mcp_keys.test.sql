-- FLOW-939 (decision 0202): several AI (MCP) keys per owner and company. A new key leaves the
-- others working; each has a name and an assistant; the list is per company; at most 20 are
-- active; a revoke can be undone for 10 minutes. Invented names and @example.com emails only.

begin;

select plan(26);

do $users$
begin
  perform tests.create_supabase_user('mk_owner', 'mk-owner@example.com');
  perform tests.create_supabase_user('mk_other', 'mk-other@example.com');
end
$users$;

create temp table mk (label text primary key, id uuid);
grant all on mk to authenticated, service_role;
insert into mk (label, id) values
  ('a', tests.fixture_company('mk_owner', 'Example Keys')),
  ('other_co', tests.fixture_company('mk_other', 'Example Other')),
  ('owner', tests.get_supabase_uid('mk_owner')),
  ('other', tests.get_supabase_uid('mk_other'));

select tests.authenticate_as('mk_owner');
insert into mk (label, id) select 'b', public.create_company('Example Keys Two', true);
select public.switch_company((select id from mk where label = 'a'));
reset role;

create or replace function pg_temp.uid(p_label text) returns uuid
language sql as $$ select id from pg_temp.mk where label = p_label $$;

create or replace function pg_temp.mint(p_hash text, p_name text, p_client text, p_hint uuid default null)
returns uuid
language sql
as $$
  select public.store_mcp_credential(pg_temp.uid('owner'), p_hash, array['read', 'write'],
    now() + interval '90 days', 'pepper-1', p_hint, p_name, p_client);
$$;

create or replace function pg_temp.keys(p_hint uuid default null) returns jsonb
language sql as $$ select public.mcp_credential_status(pg_temp.uid('owner'), p_hint) $$;

-- 1. The wrappers stay service_role only.
select ok(
  not has_function_privilege('anon', 'public.restore_mcp_credential(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.restore_mcp_credential(uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.restore_mcp_credential(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.mcp_credential_status(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.store_mcp_credential(uuid, text, text[], timestamptz, text, uuid, text, text)', 'execute'),
  'only service_role calls the key wrappers'
);
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc
   where oid = 'public.restore_mcp_credential(uuid, uuid)'::regprocedure),
  'restore is security definer with an empty search_path'
);
select hasnt_function('public', 'store_mcp_credential', array['uuid', 'text', 'text[]', 'timestamptz', 'text', 'uuid'],
  'the six-argument store is replaced, so a call cannot be ambiguous');
select hasnt_function('public', 'mcp_credential_status', array['uuid'], 'the one-argument status is replaced');

-- 2. A key made the old way (no name, no assistant) keeps working, and a new key does not revoke it.
insert into mk (label, id)
select 'legacy', public.store_mcp_credential(pg_temp.uid('owner'), 'hash-mk-legacy-0001', array['read'],
  now() + interval '30 days', 'pepper-1');
insert into mk (label, id) select 'work', pg_temp.mint('hash-mk-work-00001', '  Claude במחשב העבודה ', 'claude-code');
insert into mk (label, id) select 'phone', pg_temp.mint('hash-mk-phone-0001', '', 'claude-ai');

select is((public.lookup_mcp_credential('hash-mk-legacy-0001', 'pepper-1') ->> 'revoked_at'), null,
  'the key from before still resolves, unrevoked');
select is((select name from private.mcp_credentials where id = pg_temp.uid('work')), 'Claude במחשב העבודה',
  'the name is stored trimmed');
select is((select name from private.mcp_credentials where id = pg_temp.uid('phone')), null, 'a blank name is null');
select is((select client from private.mcp_credentials where id = pg_temp.uid('phone')), 'claude-ai', 'the assistant is stored');
select throws_ok($$select pg_temp.mint('hash-mk-long-00001', repeat('א', 61), 'other')$$, 'P0001', 'validation',
  'a name over 60 characters is refused');
select throws_ok($$select pg_temp.mint('hash-mk-bad-000001', 'x', 'copilot')$$, 'P0001', 'validation',
  'an unknown assistant is refused');

-- 3. The list: this company's open keys, oldest first, with what the key page shows.
select is(pg_temp.keys() ->> 'state', 'connected', 'connected with active keys');
select is(
  (select jsonb_agg(k ->> 'id') from jsonb_array_elements(pg_temp.keys() -> 'keys') k),
  jsonb_build_array(pg_temp.uid('legacy'), pg_temp.uid('work'), pg_temp.uid('phone')),
  'three keys, in the order they were made'
);
select is(
  (select k - 'created_at' - 'expires_at' - 'id' from jsonb_array_elements(pg_temp.keys() -> 'keys') k where k ->> 'id' = pg_temp.uid('work')::text),
  '{"name": "Claude במחשב העבודה", "client": "claude-code", "scope": ["read", "write"], "last_used_at": null, "expired": false}'::jsonb,
  'a key carries its name, assistant, scope, last use and whether it expired'
);
select ok(not (pg_temp.keys() ? 'token_hash') and not (pg_temp.keys() -> 'keys' -> 0 ? 'token_hash'), 'no hash in the list');
select is(jsonb_array_length(pg_temp.keys(pg_temp.uid('b')) -> 'keys'), 0, 'the other company the owner owns has its own (empty) list');
-- The owner edits mk_other's company too: showing that company lists nothing, as a mint there makes nothing.
insert into public.company_members (company_id, user_id, role) values (pg_temp.uid('other_co'), pg_temp.uid('owner'), 'editor');
select is(public.mcp_credential_status(pg_temp.uid('owner'), pg_temp.uid('other_co')) -> 'keys', '[]'::jsonb,
  'a company the owner only edits lists nothing');
select is(public.mcp_credential_status(pg_temp.uid('other')) ->> 'state', 'empty', 'another user sees none of these keys');

-- 4. Revoke one, undo it within 10 minutes; nobody else can.
select is(public.revoke_mcp_credential(pg_temp.uid('owner'), pg_temp.uid('phone')) ->> 'ok', 'true', 'revoke one key');
select is(jsonb_array_length(pg_temp.keys() -> 'keys'), 2, 'the others stay');
select is(public.restore_mcp_credential(pg_temp.uid('other'), pg_temp.uid('phone')) ->> 'error', 'not_found',
  'another user cannot undo it');
select is(public.restore_mcp_credential(pg_temp.uid('owner'), pg_temp.uid('phone')) ->> 'ok', 'true', 'the owner undoes it');
select is((public.lookup_mcp_credential('hash-mk-phone-0001', 'pepper-1') ->> 'revoked_at'), null, 'the key works again');
update private.mcp_credentials set revoked_at = now() - interval '11 minutes' where id = pg_temp.uid('phone');
select is(public.restore_mcp_credential(pg_temp.uid('owner'), pg_temp.uid('phone')) ->> 'error', 'not_found',
  'after 10 minutes a revoke is final');

-- 5. Only expired keys left: the state says so. At most 20 active keys; expired ones do not count.
update private.mcp_credentials set expires_at = now() - interval '1 day', revoked_at = null
where user_id = pg_temp.uid('owner') and company_id = pg_temp.uid('a');
select is(pg_temp.keys() ->> 'state', 'expired', 'expired when no key is active');
select lives_ok(
  $$select pg_temp.mint('hash-mk-cap-' || lpad(n::text, 6, '0'), null, 'other') from generate_series(1, 20) n$$,
  'twenty active keys'
);
select throws_ok($$select pg_temp.mint('hash-mk-cap-000021', null, 'other')$$, 'P0001', 'too many keys',
  'the twenty-first is refused');

select * from finish();
rollback;
