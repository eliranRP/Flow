-- MCP cycle 4: create_project, create_category, sync_bank, hide_category, undo.
-- Dates are fixed. Emails use @example.com.

begin;

select plan(53);

do $users$
begin
  perform tests.create_supabase_user('mcp4_owner', 'owner@example.com');
  perform tests.create_supabase_user('mcp4_other', 'other@example.com');
  perform tests.create_supabase_user('mcp4_viewer', 'viewer@example.com');
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

select tests.authenticate_as('mcp4_other');
select lives_ok($$select public.create_company('Other Co', true)$$, 'other creates a company');
insert into mcp4 (label, id) select 'other_company', id from public.companies where name = 'Other Co';

reset role;

select lives_ok(
  format(
    $$select public.store_mcp_credential(%L::uuid, 'hash-mcp4-write1', array['read','write'], now() + interval '90 days', 'pepper-1')$$,
    tests.get_supabase_uid('mcp4_owner')
  ),
  'store write token'
);
insert into mcp4 (label, id)
select 'write', id from private.mcp_credentials where token_hash = 'hash-mcp4-write1';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mcp4_owner'), c.id, 'hash-mcp4-read01', 'pepper-1', array['read'], now() + interval '90 days'
from mcp4 c where c.label = 'company';
insert into mcp4 (label, id)
select 'read', id from private.mcp_credentials where token_hash = 'hash-mcp4-read01';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mcp4_other'), c.id, 'hash-mcp4-otherw', 'pepper-1', array['read','write'], now() + interval '90 days'
from mcp4 c where c.label = 'other_company';
insert into mcp4 (label, id)
select 'other_write', id from private.mcp_credentials where token_hash = 'hash-mcp4-otherw';

-- A viewer of Fixture Co holding a write-scoped row for that company still cannot write.
-- Viewers attach only to a demo company.
update public.companies set is_demo = true where id = (select id from mcp4 where label = 'company');
insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('mcp4_viewer'), c.id from mcp4 c where c.label = 'company';
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mcp4_viewer'), c.id, 'hash-mcp4-viewer', 'pepper-1', array['read','write'], now() + interval '90 days'
from mcp4 c where c.label = 'company';
insert into mcp4 (label, id)
select 'viewer_write', id from private.mcp_credentials where token_hash = 'hash-mcp4-viewer';

-- create_project: result, replay, conflict, duplicate.
select pg_temp.as_mcp('write');
insert into mcp4 (label, id)
select 'gamma', (public.mcp_create_project('proj-new', 'Gamma Site', 'active')->'data'->>'id')::uuid;

select isnt((select id from mcp4 where label = 'gamma'), null, 'create_project returns an id');
select is(
  (select company_id from public.projects where id = (select id from mcp4 where label = 'gamma')),
  (select id from mcp4 where label = 'company'),
  'the project is in the owner''s company'
);
select is(
  public.mcp_create_project('proj-new', 'Gamma Site', 'active')->'data'->>'id',
  (select id::text from mcp4 where label = 'gamma'),
  'replay with the same key returns the same id'
);
select is(
  (select count(*)::int from public.projects where name = 'Gamma Site'),
  1,
  'replay creates no second row'
);
select is(
  public.mcp_create_project('proj-new', 'Delta Site', 'active')->'error'->>'code',
  'conflict',
  'same key with another name is conflict'
);
select is(
  (select count(*)::int from public.projects where name = 'Delta Site'),
  0,
  'conflict creates nothing'
);
select is(
  public.mcp_create_project('proj-dup', 'Gamma Site', 'active')->'error'->>'message',
  'project already exists',
  'duplicate name is refused'
);
select is(
  public.mcp_create_project('proj-he', 'שיפוץ מטבח', 'finished')->'ok',
  'true'::jsonb,
  'a Hebrew project name is created'
);
select is(
  (select status::text from public.projects where name = 'שיפוץ מטבח'),
  'finished',
  'status finished is kept'
);
select is(
  public.mcp_create_project('proj-bad', 'Bad Status', 'paused')->'error'->>'code',
  'validation',
  'an unknown status is validation'
);

-- Gates: read token and viewer token are forbidden; the other company writes only to itself.
select pg_temp.as_mcp('read');
select is(
  public.mcp_create_project('proj-read', 'Read Site', 'active')->'error'->>'code',
  'forbidden',
  'a read token cannot create a project'
);
select pg_temp.as_mcp('viewer_write', 'mcp4_viewer');
select is(
  public.mcp_create_category('cat-viewer', 'Viewer Cat', 'expense')->'error'->>'code',
  'forbidden',
  'a viewer cannot create a category'
);
select is(
  public.mcp_sync_bank_begin('sync-viewer')->'error'->>'code',
  'forbidden',
  'a viewer cannot start a bank sync'
);
select pg_temp.as_mcp('other_write', 'mcp4_other');
insert into mcp4 (label, id)
select 'other_proj', (public.mcp_create_project('proj-other', 'Gamma Site', 'active')->'data'->>'id')::uuid;
reset role;
select is(
  (select company_id from public.projects where id = (select id from mcp4 where label = 'other_proj')),
  (select id from mcp4 where label = 'other_company'),
  'the other user''s project lands in the other company'
);

-- undo project: success, second undo, conflict when used, cross-tenant refusal.
select pg_temp.as_mcp('write');
insert into mcp4 (label, id)
select 'undo_me', (public.mcp_create_project('proj-undo', 'Undo Me', 'active')->'data'->>'id')::uuid;
select is(
  public.mcp_undo('undo-proj', 'project', (select id from mcp4 where label = 'undo_me'))->'data'->>'kind',
  'project',
  'undo project succeeds'
);
select is(
  (select count(*)::int from public.projects where id = (select id from mcp4 where label = 'undo_me')),
  0,
  'undo deletes the project'
);
select is(
  public.mcp_undo('undo-proj-2', 'project', (select id from mcp4 where label = 'undo_me'))->'error'->>'code',
  'not_found',
  'a second undo is not_found'
);

insert into mcp4 (label, id)
select 'used', (public.mcp_create_project('proj-used', 'Used Site', 'active')->'data'->>'id')::uuid;
reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select c.id, 'expense', 'expense', 'project',
  -100, -100, 0, 'unknown',
  '2026-09-01', 'manual', 'mcp4:used', u.id, 'assigned'
from mcp4 c join mcp4 u on u.label = 'used'
where c.label = 'company';

select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('undo-used', 'project', (select id from mcp4 where label = 'used'))->'error'->>'code',
  'conflict',
  'undo of a project with a transaction is conflict'
);
select is(
  (select project_id from public.transactions where idempotency_key = 'mcp4:used'),
  (select id from mcp4 where label = 'used'),
  'the project and its assignment stay after the conflict'
);

insert into mcp4 (label, id)
select 'cross', (public.mcp_create_project('proj-cross', 'Cross Site', 'active')->'data'->>'id')::uuid;
select pg_temp.as_mcp('other_write', 'mcp4_other');
select is(
  public.mcp_undo('undo-cross', 'project', (select id from mcp4 where label = 'cross'))->'error'->>'code',
  'not_found',
  'another company''s user cannot undo the owner''s project'
);
select pg_temp.as_mcp('write');
select is(
  (select count(*)::int from public.projects where id = (select id from mcp4 where label = 'cross')),
  1,
  'the owner still sees the project'
);
select is(
  public.mcp_undo('undo-cross-own', 'project', (select id from mcp4 where label = 'cross'))->'data'->>'kind',
  'project',
  'the owner can still undo it'
);

-- create_category: result, replay, conflict, kind, duplicate.
insert into mcp4 (label, id)
select 'tools', (public.mcp_create_category('cat-new', 'Custom Tools', 'expense')->'data'->>'id')::uuid;
select isnt((select id from mcp4 where label = 'tools'), null, 'create_category returns an id');
select is(
  public.mcp_create_category('cat-new', 'Custom Tools', 'expense')->'data'->>'id',
  (select id::text from mcp4 where label = 'tools'),
  'category replay returns the same id'
);
select is(
  (select count(*)::int from public.categories where name = 'Custom Tools'),
  1,
  'category replay creates no second row'
);
select is(
  public.mcp_create_category('cat-new', 'Other Tools', 'expense')->'error'->>'code',
  'conflict',
  'same key with another category name is conflict'
);
select is(
  public.mcp_create_category('cat-bad', 'Custom Tools', 'asset')->'error'->>'code',
  'validation',
  'an unknown kind is validation'
);
select is(
  public.mcp_create_category('cat-dup', 'Custom Tools', 'expense')->'error'->>'message',
  'category already exists',
  'a duplicate category is refused'
);
select is(
  public.mcp_create_category('cat-inc', 'Custom Tools', 'income')->'ok',
  'true'::jsonb,
  'the same name with the other kind is allowed'
);

-- undo category: success, conflict when used.
insert into mcp4 (label, id)
select 'temp_cat', (public.mcp_create_category('cat-undo', 'Temp Cat', 'income')->'data'->>'id')::uuid;
select is(
  public.mcp_undo('undo-cat', 'category', (select id from mcp4 where label = 'temp_cat'))->'data'->>'kind',
  'category',
  'undo category succeeds'
);
select is(
  (select count(*)::int from public.categories where id = (select id from mcp4 where label = 'temp_cat')),
  0,
  'undo deletes the category'
);

insert into mcp4 (label, id)
select 'used_cat', (public.mcp_create_category('cat-used', 'Used Cat', 'expense')->'data'->>'id')::uuid;
reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, category_id, description
)
select c.id, 'expense', 'expense', 'overhead',
  -100, -100, 0, 'unknown',
  '2026-09-02', 'manual', 'mcp4:used-cat', u.id, 'categorised'
from mcp4 c join mcp4 u on u.label = 'used_cat'
where c.label = 'company';
select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('undo-used-cat', 'category', (select id from mcp4 where label = 'used_cat'))->'error'->>'code',
  'conflict',
  'undo of a category with a transaction is conflict'
);
select is(
  (select category_id from public.transactions where idempotency_key = 'mcp4:used-cat'),
  (select id from mcp4 where label = 'used_cat'),
  'the category and its assignment stay after the conflict'
);
select pg_temp.as_mcp('other_write', 'mcp4_other');
select is(
  public.mcp_undo('undo-cat-cross', 'category', (select id from mcp4 where label = 'tools'))->'error'->>'code',
  'not_found',
  'another company''s user cannot undo the owner''s category'
);
select pg_temp.as_mcp('write');

-- sync_bank begin/finish. The job flow is covered in mcp_sync_jobs.test.sql.
select is(
  public.mcp_sync_bank_begin('sync-none')->'error'->>'message',
  'bank is not connected',
  'sync without a connection is not_found'
);
reset role;
select is(
  (select count(*)::int from private.mcp_idempotency where idempotency_key = 'sync-none'),
  0,
  'the not-connected answer is not stored'
);

insert into public.connector_connections (
  company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version
)
select c.id, 'mercury', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'MERCURY_KEK', '1', '1'
from mcp4 c where c.label = 'company';

select pg_temp.as_mcp('write');
select is(
  public.mcp_sync_bank_begin('sync-none')->'data'->>'state',
  'proceed',
  'the same key proceeds once the bank is connected'
);
insert into mcp4 (label, id)
select 'sync_job', (public.mcp_sync_bank_begin('sync-1')->'data'->>'job_id')::uuid;
select isnt(
  (select id from mcp4 where label = 'sync_job'),
  null,
  'sync begin proceeds with a job (decision 0102)'
);
select public.mcp_sync_bank_finish(
  (select id from mcp4 where label = 'sync_job'),
  jsonb_build_object('ok', true, 'data', jsonb_build_object('added', 1, 'duplicates', 0, 'removed', 0, 'newest_date', null))
);
select is(
  public.mcp_sync_bank_begin('sync-1')->'data'->>'job_id',
  (select id::text from mcp4 where label = 'sync_job'),
  'a replay returns the same job'
);
select pg_temp.as_mcp('read');
select is(
  public.mcp_sync_bank_begin('sync-read')->'error'->>'code',
  'forbidden',
  'a read token cannot start a bank sync'
);
select pg_temp.as_mcp('other_write', 'mcp4_other');
select is(
  public.mcp_sync_bank_begin('sync-1')->'error'->>'message',
  'bank is not connected',
  'another company does not see the owner''s connection or stored counts'
);

-- hide_category + undo on a default category.
select pg_temp.as_mcp('write');
reset role;
insert into mcp4 (label, id)
select 'default_cat', c.id from public.categories c
join mcp4 co on co.label = 'company' and c.company_id = co.id
where c.kind = 'expense' and c.hidden = false and c.name <> 'Custom Tools' and c.name <> 'Used Cat'
order by c.name limit 1;
select pg_temp.as_mcp('write');
select is(
  public.mcp_hide_category('hide-1', (select id from mcp4 where label = 'default_cat'))->'data'->>'undo_kind',
  'category_hidden',
  'hide_category returns undo_kind'
);
select is(
  (select hidden from public.categories where id = (select id from mcp4 where label = 'default_cat')),
  true,
  'the category is hidden'
);
select is(
  public.mcp_undo('undo-hide', 'category_hidden', (select id from mcp4 where label = 'default_cat'))->'data'->>'kind',
  'category_hidden',
  'undo hide succeeds'
);
select is(
  (select hidden from public.categories where id = (select id from mcp4 where label = 'default_cat')),
  false,
  'the hidden flag is restored'
);

-- A category that was already hidden stays hidden after undo.
reset role;
insert into mcp4 (label, id)
select 'hidden_cat', c.id from public.categories c
join mcp4 co on co.label = 'company' and c.company_id = co.id
where c.kind = 'expense' and c.hidden = false and c.id <> (select id from mcp4 where label = 'default_cat')
  and c.name <> 'Custom Tools' and c.name <> 'Used Cat'
order by c.name limit 1;
update public.categories set hidden = true where id = (select id from mcp4 where label = 'hidden_cat');
select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('undo-hide-2', 'category_hidden', (
    public.mcp_hide_category('hide-2', (select id from mcp4 where label = 'hidden_cat'))->'data'->>'id'
  )::uuid)->'data'->>'kind',
  'category_hidden',
  'hide and undo on an already hidden category'
);
select is(
  (select hidden from public.categories where id = (select id from mcp4 where label = 'hidden_cat')),
  true,
  'undo restores the prior hidden flag, not false'
);

-- Undo locks the row it deletes; a row already gone elsewhere is not reported as undone.
do $gone$
begin
  perform set_config('mcp4.gone_project', public.mcp_create_project('proj-gone', 'Gone Site', 'active')->'data'->>'id', true);
  perform set_config('mcp4.gone_category', public.mcp_create_category('cat-gone', 'Gone Cat', 'expense')->'data'->>'id', true);
end;
$gone$;
reset role;
delete from public.projects where id = current_setting('mcp4.gone_project')::uuid;
delete from public.categories where id = current_setting('mcp4.gone_category')::uuid;
select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('undo-gone-p', 'project', current_setting('mcp4.gone_project')::uuid)->'error'->>'code',
  'not_found',
  'undo of a project deleted elsewhere is not_found'
);
select is(
  public.mcp_undo('undo-gone-c', 'category', current_setting('mcp4.gone_category')::uuid)->'error'->>'code',
  'not_found',
  'undo of a category deleted elsewhere is not_found'
);

select pg_temp.as_mcp('other_write', 'mcp4_other');
select is(
  public.mcp_hide_category('hide-cross', (select id from mcp4 where label = 'default_cat'))->'error'->>'message',
  'category not found',
  'another company cannot hide the owner''s category'
);

select * from finish();

rollback;
