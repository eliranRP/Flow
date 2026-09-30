-- MCP cycle 1: credential wrappers, rate limit, and single-use undo.

begin;

select plan(31);

do $users$
begin
  perform tests.create_supabase_user('mcp_owner', 'mcp-owner@test.flow');
  perform tests.create_supabase_user('mcp_other', 'mcp-other@test.flow');
  perform tests.create_supabase_user('mcp_none', 'mcp-none@test.flow');
end
$users$;

select tests.authenticate_as('mcp_owner');
select lives_ok($$select public.create_company('עוזר', true)$$, 'owner creates a company');

select tests.authenticate_as('mcp_other');
select lives_ok($$select public.create_company('אחר', true)$$, 'other owner creates a company');

select ok(
  not has_function_privilege('anon', 'public.store_mcp_credential(uuid, text, text[], timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.store_mcp_credential(uuid, text, text[], timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.revoke_mcp_credential(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.revoke_mcp_credential(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.mcp_credential_status(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.mcp_credential_status(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.lookup_mcp_credential(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.lookup_mcp_credential(text)', 'execute')
  and not has_function_privilege('anon', 'public.touch_mcp_credential(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.touch_mcp_credential(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.bump_mcp_rate(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.bump_mcp_rate(uuid, uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.note_auth_failure(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.note_auth_failure(text)', 'execute'),
  'anon and authenticated cannot call the credential wrappers'
);

select ok(
  has_function_privilege('service_role', 'public.store_mcp_credential(uuid, text, text[], timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.revoke_mcp_credential(uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.mcp_credential_status(uuid)', 'execute'),
  'service_role can store, revoke, and read status'
);

select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'store_mcp_credential',
        'revoke_mcp_credential',
        'mcp_credential_status',
        'lookup_mcp_credential',
        'touch_mcp_credential',
        'bump_mcp_rate',
        'note_auth_failure'
      )
      and exists (
        select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
        where cfg like 'search_path=%'
      )
  ),
  7::bigint,
  'each wrapper sets search_path'
);

reset role;

select throws_ok(
  format(
    $$select public.store_mcp_credential(%L::uuid, 'hash-no-company-0001', array['read'], now() + interval '1 day')$$,
    (select id from auth.users where email = 'mcp-none@test.flow')
  ),
  'P0001',
  'no company',
  'a user with no company is refused'
);

select lives_ok(
  format(
    $$select public.store_mcp_credential(%L::uuid, 'hash-owner-one-aaaa', array['read','write'], now() + interval '90 days')$$,
    (select id from auth.users where email = 'mcp-owner@test.flow')
  ),
  'store mints the owner token'
);

select is(
  (public.mcp_credential_status((select id from auth.users where email = 'mcp-owner@test.flow')) ->> 'state'),
  'connected',
  'status is connected'
);

select lives_ok(
  format(
    $$select public.store_mcp_credential(%L::uuid, 'hash-owner-two-bbbb', array['read'], now() + interval '90 days')$$,
    (select id from auth.users where email = 'mcp-owner@test.flow')
  ),
  'a second store replaces the active token'
);

select is(
  (public.lookup_mcp_credential('hash-owner-one-aaaa') ->> 'revoked_at') is not null,
  true,
  'the previous token is revoked'
);

select is(
  public.mcp_credential_status((select id from auth.users where email = 'mcp-owner@test.flow')) -> 'scope',
  '["read"]'::jsonb,
  'status returns only this user''s new scope'
);

select is(
  (public.lookup_mcp_credential('hash-owner-two-bbbb') ->> 'company_id'),
  (select id::text from public.companies where name = 'עוזר'),
  'company_id is the company owned by p_user'
);

select is(
  (
    public.revoke_mcp_credential(
      (select id from auth.users where email = 'mcp-other@test.flow'),
      (public.mcp_credential_status((select id from auth.users where email = 'mcp-owner@test.flow')) ->> 'id')::uuid
    ) ->> 'error'
  ),
  'not_found',
  'another user cannot revoke this token'
);

select is(
  (
    public.revoke_mcp_credential(
      (select id from auth.users where email = 'mcp-owner@test.flow'),
      (public.mcp_credential_status((select id from auth.users where email = 'mcp-owner@test.flow')) ->> 'id')::uuid
    ) ->> 'ok'
  ),
  'true',
  'the owner revokes their token'
);

select is(
  (public.mcp_credential_status((select id from auth.users where email = 'mcp-owner@test.flow')) ->> 'state'),
  'empty',
  'a revoked token is an empty status'
);

select lives_ok(
  format(
    $$select public.store_mcp_credential(%L::uuid, 'hash-owner-rate-cccc', array['read','write'], now() + interval '1 day')$$,
    (select id from auth.users where email = 'mcp-owner@test.flow')
  ),
  'store a token for the rate limit'
);

select is(
  (
    select bool_and(
      (public.bump_mcp_rate(
        (public.lookup_mcp_credential('hash-owner-rate-cccc') ->> 'id')::uuid,
        (select id from auth.users where email = 'mcp-owner@test.flow'),
        'read'
      ) ->> 'allowed')::boolean
    )
    from generate_series(1, 60)
  ),
  true,
  'sixty reads in a minute are allowed'
);

select lives_ok(
  format(
    $$select public.touch_mcp_credential(%L::uuid)$$,
    (public.lookup_mcp_credential('hash-owner-rate-cccc') ->> 'id')
  ),
  'touch records last use'
);

select is(
  (public.mcp_credential_status((select id from auth.users where email = 'mcp-owner@test.flow')) ->> 'last_used_at') is not null,
  true,
  'status shows last_used_at'
);

select is(
  (
    public.bump_mcp_rate(
      (public.lookup_mcp_credential('hash-owner-rate-cccc') ->> 'id')::uuid,
      (select id from auth.users where email = 'mcp-owner@test.flow'),
      'read'
    ) ->> 'allowed'
  )::boolean,
  false,
  'the sixty-first read is refused'
);

select is(
  (public.note_auth_failure('') ->> 'throttled')::boolean,
  false,
  'a blank address is not an unknown bucket'
);

select is(
  (public.note_auth_failure(null) ->> 'throttled')::boolean,
  false,
  'a missing address is not counted'
);

select is(
  (
    select bool_and((public.note_auth_failure('203.0.113.8') ->> 'throttled')::boolean = false)
    from generate_series(1, 30)
  ),
  true,
  'thirty failed secrets from one address are still unauthorized, not throttled'
);

select is(
  (public.note_auth_failure('203.0.113.8') ->> 'throttled')::boolean,
  true,
  'the thirty-first failed secret from that address is throttled'
);

reset role;

select is(
  (select count(*) from private.mcp_auth_failures where address = ''),
  0::bigint,
  'the blank address wrote no failure row'
);

select tests.authenticate_as('mcp_owner');
select throws_ok(
  $$select id from private.mcp_writes$$,
  '42501',
  null,
  'the owner cannot read mcp_writes'
);

reset role;

select ok(
  (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname = 'mcp_writes'
  ),
  'mcp_writes enables row level security'
);

select has_column('private', 'mcp_writes', 'undone_at', 'mcp_writes has undone_at');

insert into private.mcp_writes (token_id, user_id, review_id, kind, project_id, category_id, pnl_role, shares)
select
  id,
  user_id,
  '11111111-1111-4000-8000-000000000010',
  'review',
  null,
  null,
  null,
  '[]'::jsonb
from private.mcp_credentials
where token_hash = 'hash-owner-rate-cccc';

select is(
  private.consume_mcp_undo(
    (select id from auth.users where email = 'mcp-owner@test.flow'),
    (select id from private.mcp_writes)
  ),
  true,
  'the first undo consumes the write'
);

select is(
  private.consume_mcp_undo(
    (select id from auth.users where email = 'mcp-owner@test.flow'),
    (select id from private.mcp_writes)
  ),
  false,
  'a second undo is single-use'
);

select isnt(
  (select undone_at from private.mcp_writes),
  null,
  'undone_at is set after the undo'
);

select * from finish();
rollback;
