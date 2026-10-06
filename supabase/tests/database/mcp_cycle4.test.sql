-- MCP cycle 4: create_project, create_category, sync_bank, hide_category, undo.
-- Dates are fixed. Emails use @example.com.

begin;

select plan(26);

do $users$
begin
  perform tests.create_supabase_user('mcp4_owner', 'owner@example.com');
  perform tests.create_supabase_user('mcp4_other', 'other@example.com');
end
$users$;

create temp table mcp4 (label text primary key, id uuid);
grant all on mcp4 to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text, p_user text default 'mcp4_owner')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  select id into tid from pg_temp.mcp4 where label = p_label;
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

select tests.authenticate_as('mcp4_owner');
select lives_ok($$select public.create_company('Fixture Co', true)$$, 'owner creates a company');

insert into mcp4 (label, id) select 'company', id from public.companies;

select lives_ok(
  format(
    $$select public.store_mcp_credential(%L::uuid, 'hash-mcp4-write1', array['read','write'], now() + interval '90 days', 'pepper-1')$$,
    (select id from auth.users where email = 'owner@example.com')
  ),
  'store write token'
);

insert into mcp4 (label, id)
select 'write', id from private.mcp_credentials where token_hash = 'hash-mcp4-write1';

select tests.authenticate_as('mcp4_other');
select lives_ok($$select public.create_company('Other Co', true)$$, 'other creates a company');
insert into mcp4 (label, id) select 'other_company', id from public.companies where name = 'Other Co';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select
  (select id from auth.users where email = 'other@example.com'),
  (select id from mcp4 where label = 'other_company'),
  'hash-mcp4-otherw',
  'pepper-1',
  array['read','write'],
  now() + interval '90 days';

insert into mcp4 (label, id)
select 'other_write', id from private.mcp_credentials where token_hash = 'hash-mcp4-otherw';

select pg_temp.as_mcp('write');

select is(
  (public.mcp_create_project('proj-new', 'Gamma Site', 'active')->'data'->>'undo_kind'),
  'project',
  'create_project returns undo_kind project'
);

select isnt(
  (public.mcp_create_project('proj-new', 'Gamma Site', 'active')->'data'->>'id'),
  null,
  'replay returns the same id'
);

select is(
  (
    select count(*)::int
    from public.projects p
    join mcp4 c on c.label = 'company' and p.company_id = c.id
    where p.name = 'Gamma Site'
  ),
  1,
  'one project row'
);

select is(
  (public.mcp_create_project('proj-new', 'Delta Site', 'active')->'error'->>'code'),
  'conflict',
  'same key different name is conflict'
);

select is(
  (public.mcp_create_project('proj-dup', 'Gamma Site', 'active')->'error'->>'message'),
  'project already exists',
  'duplicate name refused'
);

select pg_temp.as_mcp('write');

select is(
  (public.mcp_undo('undo-proj', 'project', (
    public.mcp_create_project('proj-undo', 'Undo Me', 'active')->'data'->>'id'
  )::uuid)->'data'->>'kind'),
  'project',
  'undo project succeeds'
);

select is(
  (public.mcp_undo('undo-proj-2', 'project', (
    public.mcp_create_project('proj-undo-2', 'Undo Twice', 'active')->'data'->>'id'
  )::uuid)->'error'->>'code'),
  'not_found',
  'second undo is not_found'
);

select pg_temp.as_mcp('write');

do $assign$
declare
  pid uuid;
begin
  pid := (public.mcp_create_project('proj-used', 'Used Site', 'active')->'data'->>'id')::uuid;
  insert into public.transactions (
    company_id, direction, doc_kind, pnl_role,
    amount_gross, amount_net, vat_amount, vat_status,
    doc_date, source, idempotency_key, project_id, description
  )
  select c.id, 'expense', 'expense', 'project',
    -100, -100, 0, 'unknown',
    '2026-09-01', 'manual', 'mcp4:used', pid, 'assigned'
  from mcp4 c where c.label = 'company';
  perform set_config('mcp4.used_project', pid::text, true);
end;
$assign$;

select is(
  (public.mcp_undo('undo-used', 'project', current_setting('mcp4.used_project')::uuid)->'error'->>'code'),
  'conflict',
  'undo with transaction reference is conflict'
);

select is(
  (
    select count(*)::int
    from public.projects p
    where p.id = current_setting('mcp4.used_project')::uuid
  ),
  1,
  'project stays after conflict'
);

select pg_temp.as_mcp('other_write', 'mcp4_other');

select is(
  (public.mcp_undo('undo-cross', 'project', current_setting('mcp4.used_project')::uuid)->'error'->>'code'),
  'not_found',
  'other user undo is not_found'
);

select pg_temp.as_mcp('write');

select is(
  (
    select count(*)::int
    from public.projects p
    where p.id = current_setting('mcp4.used_project')::uuid
  ),
  1,
  'owner still sees project after other undo'
);

select is(
  (public.mcp_create_category('cat-new', 'Custom Tools', 'expense')->'data'->>'undo_kind'),
  'category',
  'create_category undo_kind'
);

select is(
  (public.mcp_create_category('cat-new', 'Custom Tools', 'expense')->'data'->>'id'),
  (public.mcp_create_category('cat-new', 'Custom Tools', 'expense')->'data'->>'id'),
  'category replay same id'
);

select is(
  (public.mcp_create_category('cat-bad', 'Custom Tools', 'asset')->'error'->>'code'),
  'validation',
  'bad kind validation'
);

select is(
  (public.mcp_create_category('cat-dup', 'Custom Tools', 'expense')->'error'->>'message'),
  'category already exists',
  'duplicate category refused'
);

select pg_temp.as_mcp('write');

select is(
  (public.mcp_undo('undo-cat', 'category', (
    public.mcp_create_category('cat-undo', 'Temp Cat', 'income')->'data'->>'id'
  )::uuid)->'data'->>'kind'),
  'category',
  'undo category deletes'
);

select is(
  (public.mcp_sync_bank_begin('sync-none')->'error'->>'message'),
  'bank is not connected',
  'sync without connection is not_found'
);

select pg_temp.as_mcp('write');

insert into public.connector_connections (
  company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version
)
select c.id, 'mercury', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'MERCURY_KEK', '1', '1'
from mcp4 c where c.label = 'company';

select is(
  (public.mcp_sync_bank_begin('sync-1')->'data'->>'state'),
  'proceed',
  'sync begin proceed'
);

select public.mcp_sync_bank_finish(
  'sync-1',
  jsonb_build_object('ok', true, 'data', jsonb_build_object('added', 1, 'duplicates', 0, 'removed', 0, 'newest_date', null))
);

select is(
  (public.mcp_sync_bank_begin('sync-1')->'data'->>'added'),
  '1',
  'sync replay stored counts'
);

select pg_temp.as_mcp('write');

select is(
  (public.mcp_hide_category('hide-1', (
    select id from public.categories where name = 'Custom Tools' and kind = 'expense' limit 1
  ))->'data'->>'undo_kind'),
  'category_hidden',
  'hide_category returns undo_kind'
);

select is(
  (
    select hidden from public.categories
    where name = 'Custom Tools' and kind = 'expense'
    limit 1
  ),
  true,
  'category is hidden'
);

select is(
  (public.mcp_undo('undo-hide', 'category_hidden', (
    select id from public.categories where name = 'Custom Tools' and kind = 'expense' limit 1
  ))->'data'->>'kind'),
  'category_hidden',
  'undo hide restores'
);

select is(
  (
    select hidden from public.categories
    where name = 'Custom Tools' and kind = 'expense'
    limit 1
  ),
  false,
  'hidden flag restored'
);

select * from finish();

rollback;
