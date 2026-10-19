-- The danger zone (decision 0194): public.delete_company deletes the request's company and all of
-- its data, for its owner only and only after the owner types its name. Every other company, the
-- auth user and the user's own rows stay, and the user can start a new company. Invented data only.

begin;

select plan(28);

do $users$
begin
  perform tests.create_supabase_user('dz_owner', 'dz-owner@example.com');
  perform tests.create_supabase_user('dz_editor', 'dz-editor@example.com');
  perform tests.create_supabase_user('dz_viewer', 'dz-viewer@example.com');
  perform tests.create_supabase_user('dz_outsider', 'dz-outsider@example.com');
  perform tests.create_supabase_user('dz_other_owner', 'dz-other-owner@example.com');
end
$users$;

create temp table dz (label text primary key, id uuid);
grant all on dz to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.dz where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into dz (label, id) values
  ('owner', tests.get_supabase_uid('dz_owner')),
  ('other_owner', tests.get_supabase_uid('dz_other_owner')),
  ('doomed', tests.fixture_company('dz_owner', 'Example Danger Works')),
  ('kept', tests.fixture_company('dz_other_owner', 'Example Bystander Ltd'));

-- One of nearly everything a company holds: books, a loan, a review, Jev's rows, a connector key,
-- a flow-mcp credential with its writes, batches, jobs, idempotency and rate rows, the team,
-- setup flags and audit rows. Written as postgres, the way the fixtures write.
create or replace function pg_temp.seed(p_company uuid, p_owner uuid, p_tag text)
returns void
language plpgsql
as $$
declare
  project uuid;
  category uuid;
  line uuid;
  suggestion uuid;
  token uuid;
begin
  project := tests.fixture_project(p_company, p_tag || ' project');
  category := tests.fixture_category(p_company, p_tag || ' category');
  line := tests.fixture_line(p_company, p_tag || ':line', 12300, 'expense', project, category);
  perform tests.fixture_line(p_company, p_tag || ':income', 45600, 'income', project, null);

  insert into public.project_groups (company_id, name) values (p_company, p_tag || ' group');
  insert into public.loans (
    company_id, name, principal_minor, annual_rate_ppm, term_months,
    start_date, payment_minor, escrow_minor, currency
  )
  values (p_company, p_tag || ' mortgage', 120000000, 60000, 360, '2026-01-01', 1000000, 100000, 'ILS');
  insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm)
  select p_company, l.id, '2026-06-01', 55000 from public.loans l where l.company_id = p_company;
  insert into public.review_queue (company_id, transaction_id, status) values (p_company, line, 'open');
  insert into public.suppliers (company_id, name) values (p_company, p_tag || ' supplier');
  insert into public.customers (company_id, name) values (p_company, p_tag || ' customer');
  insert into public.connector_refresh_requests (company_id, provider) values (p_company, 'mercury');
  insert into public.recurring_dismissals (user_id, company_id, kind, alert_key)
  values (p_owner, p_company, 'missing', p_tag || '-alert');

  insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
  values (
    p_company, line,
    jsonb_build_object('project', jsonb_build_object('choice', project), 'category', jsonb_build_object('choice', category)),
    0.9, 'test', 'test'
  )
  returning id into suggestion;
  insert into public.jev_outcomes (company_id, transaction_id, suggestion_id, model_version, confidence, review_status)
  values (p_company, line, suggestion, 'test', 0.9, 'approved')
  on conflict do nothing;
  insert into public.jev_prefills (company_id, transaction_id, project_id, category_id)
  values (p_company, line, project, category);
  insert into public.jev_line_failures (company_id, transaction_id, model_version, retry_after)
  values (p_company, line, 'test', now() + interval '1 day');
  insert into public.jev_usage (company_id, run_id, reserved) values (p_company, gen_random_uuid(), 3);
  insert into public.company_integrations (company_id, provider, enabled, mode, threshold)
  values (p_company, 'jev', true, 'shadow', 0.9);

  insert into public.connector_connections (
    company_id, provider, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_ref, kek_version, envelope_version
  )
  values (p_company, 'mercury', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, 'MERCURY_KEK', '1', '1');

  insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
  values (p_owner, p_company, 'hash-dz-' || p_tag, 'kid', array['write']::text[], '2099-01-01')
  returning id into token;
  insert into private.mcp_writes (token_id, user_id, transaction_id, review_id, kind, company_id)
  values (token, p_owner, line, gen_random_uuid(), 'review', p_company);
  insert into private.mcp_batches (token_id, user_id, company_id, idempotency_key)
  values (token, p_owner, p_company, 'dz-batch-' || p_tag);
  insert into private.mcp_sync_jobs (token_id, user_id, company_id, state, started_at)
  values (token, p_owner, p_company, 'running', now());
  insert into private.mcp_idempotency (token_id, idempotency_key, request_hash, response)
  values (token, 'dz-key-' || p_tag, 'hash', '{}'::jsonb);
  insert into private.mcp_rate (subject_id, subject_kind, bucket, window_start, hits)
  values (token, 'token', 'write', date_trunc('minute', now()), 1);

  insert into public.company_invites (company_id, email, role, invited_by)
  values (p_company, 'dz-invitee-' || p_tag || '@example.com', 'viewer', p_owner);
  insert into public.setup_states (user_id, company_id, state) values (p_owner, p_company, '{}'::jsonb);
  insert into public.audit_log (company_id, actor_id, action, entity)
  values (p_company, p_owner, 'insert', 'transactions');
end;
$$;

select pg_temp.seed(pg_temp.id('doomed'), pg_temp.id('owner'), 'doomed');
select pg_temp.seed(pg_temp.id('kept'), pg_temp.id('other_owner'), 'kept');

insert into public.company_members (company_id, user_id, role) values
  (pg_temp.id('doomed'), tests.get_supabase_uid('dz_editor'), 'editor'),
  (pg_temp.id('doomed'), tests.get_supabase_uid('dz_viewer'), 'viewer'),
  -- The doomed company's owner also edits the bystander's books; that seat stays.
  (pg_temp.id('kept'), pg_temp.id('owner'), 'editor');
insert into public.active_companies (user_id, company_id) values
  (pg_temp.id('owner'), pg_temp.id('doomed')),
  (tests.get_supabase_uid('dz_editor'), pg_temp.id('doomed'));
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values (pg_temp.id('owner'), 'https://fcm.googleapis.com/fcm/send/dz-owner-example', repeat('p', 87), 'dzOwnerAuthExample1');

-- Rows per table for one company: every table in public and private with a company_id, and the
-- company row itself. Read from the catalog, so a table added later is swept too.
create or replace function pg_temp.company_rows(p_company uuid)
returns table (rel text, n bigint)
language plpgsql
as $$
declare
  t record;
begin
  rel := 'public.companies';
  select count(*) into n from public.companies c where c.id = p_company;
  return next;
  for t in
    select format('%I.%I', ns.nspname, cl.relname) as name
    from pg_attribute a
    join pg_class cl on cl.oid = a.attrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    where a.attname = 'company_id'
      and not a.attisdropped
      and cl.relkind in ('r', 'p')
      and ns.nspname in ('public', 'private')
    order by 1
  loop
    rel := t.name;
    execute format('select count(*) from %s where company_id = $1', t.name) into n using p_company;
    return next;
  end loop;
end;
$$;

create temp table dz_kept_before as select * from pg_temp.company_rows(pg_temp.id('kept'));
create temp table dz_doomed_before as select * from pg_temp.company_rows(pg_temp.id('doomed'));

-- 1. The seed reaches most of the company's tables, so the sweep after the delete means something.
select cmp_ok(
  (select count(*)::integer from pg_temp.company_rows(pg_temp.id('doomed')) where n > 0),
  '>=',
  28,
  'the doomed company holds rows in at least 28 tables'
);

-- 2-4. The owner with the wrong confirmation, or another company's id, changes nothing.
select tests.authenticate_as('dz_owner');
select throws_ok(
  $$select public.delete_company(pg_temp.id('doomed'), 'Example Danger')$$,
  '22023',
  'confirmation_mismatch',
  'the owner with the wrong name is refused'
);
select throws_ok(
  $$select public.delete_company(pg_temp.id('doomed'), 'example danger works')$$,
  '22023',
  'confirmation_mismatch',
  'the name must match exactly, case included'
);
select throws_ok(
  $$select public.delete_company(pg_temp.id('kept'), 'Example Bystander Ltd')$$,
  '42501',
  'forbidden',
  'the owner cannot name a company they only edit'
);
select throws_ok(
  $$select public.delete_company(null, 'Example Danger Works')$$,
  '42501',
  'forbidden',
  'a missing company id is refused'
);
reset role;
select is(
  (select coalesce(array_agg(b.rel order by b.rel), '{}')
   from dz_doomed_before b
   left join pg_temp.company_rows(pg_temp.id('doomed')) a on a.rel = b.rel
   where a.n is distinct from b.n),
  '{}'::text[],
  'after the refusals the doomed company has every row it had'
);
select is(
  (select count(*)::integer from public.transactions where company_id = pg_temp.id('doomed')),
  2,
  'its lines are still there'
);

-- 7-8. An editor and a viewer of the company are refused.
select tests.authenticate_as('dz_editor');
select throws_ok(
  $$select public.delete_company(pg_temp.id('doomed'), 'Example Danger Works')$$,
  '42501',
  'forbidden',
  'an editor is refused'
);
select tests.authenticate_as('dz_viewer');
select throws_ok(
  $$select public.delete_company(pg_temp.id('doomed'), 'Example Danger Works')$$,
  '42501',
  'forbidden',
  'a viewer is refused'
);

-- 9-11. An outsider is refused, with or without the company's header, and the bystander's owner
-- cannot reach it from their own company.
select tests.authenticate_as('dz_outsider');
select throws_ok(
  $$select public.delete_company(pg_temp.id('doomed'), 'Example Danger Works')$$,
  'P0001',
  'no company',
  'an outsider with no company is refused'
);
select set_config('request.headers', json_build_object('x-flow-company', pg_temp.id('doomed'))::text, true);
select throws_ok(
  $$select public.delete_company(pg_temp.id('doomed'), 'Example Danger Works')$$,
  'P0001',
  'no company',
  'an outsider who sends the company''s header is refused'
);
select set_config('request.headers', '', true);
select tests.authenticate_as('dz_other_owner');
select throws_ok(
  $$select public.delete_company(pg_temp.id('doomed'), 'Example Danger Works')$$,
  '42501',
  'forbidden',
  'another company''s owner is refused'
);
reset role;
select is(
  (select count(*)::integer from public.companies where id = pg_temp.id('doomed')),
  1,
  'every refusal left the company in place'
);

-- 13-14. The owner with the right name, spaces around it, deletes the company.
select tests.authenticate_as('dz_owner');
select is(
  public.delete_company(pg_temp.id('doomed'), '  Example Danger Works  ') - 'id',
  jsonb_build_object('name', 'Example Danger Works', 'deleted', true),
  'the owner with the right name deletes the company'
);
select is(
  (select count(*)::integer from public.companies where id = pg_temp.id('doomed')),
  0,
  'the owner no longer reads the company'
);
reset role;

-- 15-21. Nothing of it is left.
select is(
  (select coalesce(array_agg(rel || ':' || n order by rel), '{}') from pg_temp.company_rows(pg_temp.id('doomed')) where n > 0),
  '{}'::text[],
  'no table in public or private holds a row of the deleted company'
);
select is(
  (select count(*)::integer from private.mcp_idempotency i where i.idempotency_key = 'dz-key-doomed'),
  0,
  'the flow-mcp idempotency rows went with the credential'
);
select is(
  (select count(*)::integer from private.mcp_rate r
   where r.subject_kind = 'token'
     and r.subject_id not in (select id from private.mcp_credentials)),
  0,
  'the flow-mcp rate counters of the deleted credential are gone'
);
select is(
  (select count(*)::integer from public.company_members m
   where m.user_id in (tests.get_supabase_uid('dz_editor'), tests.get_supabase_uid('dz_viewer'))),
  0,
  'the members lost their seats'
);
select is(
  (select count(*)::integer from public.active_companies a where a.company_id = pg_temp.id('doomed')),
  0,
  'no one still has the company open'
);
select is(
  (select count(*)::integer from public.categories c
   where c.company_id not in (select id from public.companies)),
  0,
  'no category outlives its company'
);
select is(
  (select count(*)::integer from public.audit_log l
   where l.company_id not in (select id from public.companies)),
  0,
  'the company''s audit rows are gone, and the delete wrote none'
);

-- 22-24. The bystander's company is untouched, and the user keeps their own rows.
select is(
  (select coalesce(array_agg(b.rel || ':' || b.n || '->' || coalesce(a.n, -1) order by b.rel), '{}')
   from dz_kept_before b
   left join pg_temp.company_rows(pg_temp.id('kept')) a on a.rel = b.rel
   where a.n is distinct from b.n),
  '{}'::text[],
  'the other company has every row it had'
);
select is(
  (select role from public.company_members where company_id = pg_temp.id('kept') and user_id = pg_temp.id('owner')),
  'editor',
  'the owner keeps their seat in the other company'
);
select ok(
  exists (select 1 from auth.users where id = pg_temp.id('owner'))
  and exists (select 1 from public.push_subscriptions where user_id = pg_temp.id('owner')),
  'the auth user and their push subscription stay'
);

-- 25-27. The user starts a new company the way setup does.
select tests.authenticate_as('dz_owner');
select lives_ok(
  $$select public.create_company('Example Fresh Start', true)$$,
  'the user creates a new company'
);
select is(
  (select c.name from public.companies c where c.id = private.owner_company_id()),
  'Example Fresh Start',
  'the new company is the one the user now owns and opens'
);
select is(
  (select jsonb_array_length(public.list_my_companies() -> 'companies')),
  2,
  'the user lists the new company and the one they edit'
);
reset role;

select * from finish();
rollback;
