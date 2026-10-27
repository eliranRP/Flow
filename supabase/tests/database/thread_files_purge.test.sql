-- FLOW-978 (decision 0226): a company's files go with it, and removed notes and files are kept 7
-- days. public.thread_files_to_purge lists the transaction-files objects mercury-sync removes through
-- the Storage API: a deleted company's at once, and any object no row names a day after upload.
-- private.expire_removed_thread_items deletes notes and files removed more than 7 days ago. Only the
-- service role lists; no client role runs either. Invented names only.

begin;

select plan(14);

select tests.create_supabase_user('tp_owner', 'tp-owner@example.com');
select tests.create_supabase_user('tp_other', 'tp-other@example.com');

create temp table tp (label text primary key, id uuid);
grant all on tp to authenticated, service_role;
insert into tp (label, id) values
  ('kept', tests.fixture_company('tp_other', 'Example Kept Files LLC')),
  ('doomed', tests.fixture_company('tp_owner', 'Example Doomed Files LLC'));
insert into tp (label, id) values
  ('kept_line', tests.fixture_line((select id from tp where label = 'kept'), 'tp:kept', 1200, 'expense', null, null, '2026-10-20')),
  ('doomed_line', tests.fixture_line((select id from tp where label = 'doomed'), 'tp:doomed', 3400, 'expense', null, null, '2026-10-20'));

create function pg_temp.path(p_company text, p_name text) returns text language sql stable as $$
  select (select id from pg_temp.tp where label = p_company)::text || '/'
    || (select id from pg_temp.tp where label = p_company || '_line')::text || '/' || p_name;
$$;
grant execute on function pg_temp.path(text, text) to authenticated, service_role;

-- An object uploaded p_age ago, and the row that names it when p_removed is not 'none'.
create function pg_temp.file(p_company text, p_name text, p_age interval, p_removed text) returns void language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, created_at)
  values ('transaction-files', pg_temp.path(p_company, p_name), now() - p_age);
  if p_removed <> 'none' then
    insert into public.transaction_files (company_id, transaction_id, source, storage_path, file_name, mime, bytes, created_at, removed_at)
    values (
      (select id from pg_temp.tp where label = p_company), (select id from pg_temp.tp where label = p_company || '_line'),
      'flow', pg_temp.path(p_company, p_name), p_name, 'image/jpeg', 100, now() - p_age,
      case p_removed when 'live' then null else now() - p_removed::interval end
    );
  end if;
end;
$$;

select pg_temp.file('kept', 'live.jpg', '30 days', 'live');
select pg_temp.file('kept', 'in-flight.jpg', '2 hours', 'none');
select pg_temp.file('kept', 'never-recorded.jpg', '2 days', 'none');
select pg_temp.file('kept', 'removed-old.jpg', '9 days', '8 days');
select pg_temp.file('kept', 'removed-recent.jpg', '4 days', '3 days');
select pg_temp.file('doomed', 'doomed.jpg', '1 hour', 'live');
-- Any name a writer can upload is a thread file: Hebrew letters, a sub-folder.
select pg_temp.file('doomed', 'e-חשבונית.pdf', '1 hour', 'live');
select pg_temp.file('doomed', 'f-sub/scan..pdf', '1 hour', 'live');
-- Not a thread file's path: never listed, however old (the Storage API would not take it either).
insert into storage.objects (bucket_id, name, created_at) values
  ('transaction-files', pg_temp.path('kept', '../old.jpg'), now() - interval '2 days'),
  ('transaction-files', pg_temp.path('kept', '/old.jpg'), now() - interval '2 days'),
  ('transaction-files', 'not-a-company/old.jpg', now() - interval '2 days');

insert into public.transaction_notes (company_id, transaction_id, source, body, removed_at)
select (select id from tp where label = 'kept'), (select id from tp where label = 'kept_line'), 'flow', v.body, v.removed
from (values ('live note', null::timestamptz), ('old removed note', now() - interval '8 days'),
  ('recent removed note', now() - interval '3 days')) v(body, removed);

create function pg_temp.due() returns text[] language sql as $$
  select coalesce(array_agg(split_part(n, '/', 3) order by split_part(n, '/', 3)), '{}')
  from jsonb_array_elements_text(public.thread_files_to_purge(100)) n;
$$;
grant execute on function pg_temp.due() to authenticated, service_role;

-- Clients run neither.
select tests.authenticate_as('tp_owner');
select throws_ok($$ select public.thread_files_to_purge(10) $$, '42501', null, 'an owner cannot list files to purge');
select throws_ok($$ select private.expire_removed_thread_items() $$, '42501', null, 'an owner cannot expire removed items');
reset role;
select ok(not has_function_privilege('service_role', 'private.expire_removed_thread_items()', 'execute'),
  'only the nightly job (postgres) expires removed items');

-- 1. Only the object no row has named for a day is due; a live, a recent or a removed file is not.
set local role service_role;
select is(pg_temp.due(), array['never-recorded.jpg'], 'an object no row names is due a day after upload, not before');
reset role;

-- 2. Expiry deletes what was removed more than 7 days ago, and keeps the rest.
select is(private.expire_removed_thread_items(), '{"files": 1, "notes": 1}'::jsonb, 'one file and one note expire');
select is((select array_agg(file_name order by file_name) from public.transaction_files),
  array['doomed.jpg', 'e-חשבונית.pdf', 'f-sub/scan..pdf', 'live.jpg', 'removed-recent.jpg'], 'a file removed 3 days ago stays for undo');
select is((select array_agg(body order by body) from public.transaction_notes),
  array['live note', 'recent removed note'], 'a note removed 3 days ago stays for undo');
set local role service_role;
select is(pg_temp.due(), array['never-recorded.jpg', 'removed-old.jpg'], 'the expired file''s object is due next');
reset role;

-- 3. Deleting a company makes every one of its objects due at once, however new.
select tests.authenticate_as('tp_owner');
select lives_ok($$ select public.delete_company((select id from pg_temp.tp where label = 'doomed'), 'Example Doomed Files LLC') $$,
  'the owner deletes the company');
reset role;
select is((select count(*)::int from public.transaction_files where file_name = 'doomed.jpg'), 0, 'its file rows go with it');
set local role service_role;
select is(pg_temp.due(), array['doomed.jpg', 'e-חשבונית.pdf', 'f-sub', 'never-recorded.jpg', 'removed-old.jpg'],
  'its objects are due at once, whatever their name; the other company''s live ones are not');
select is(jsonb_array_length(public.thread_files_to_purge(1)), 1, 'the limit holds');
reset role;

-- 4. The jobs: nightly expiry, and the hourly purge only where pg_net and the vault secrets are set.
select ok(
  not exists (select 1 from pg_extension where extname = 'pg_cron')
    or exists (select 1 from cron.job where jobname = 'flow-thread-items-expire' and schedule = '7 2 * * *'),
  'flow-thread-items-expire runs nightly where pg_cron is installed'
);
select ok(
  not exists (select 1 from pg_extension where extname = 'pg_cron')
    or not exists (select 1 from cron.job where jobname = 'flow-thread-files-purge')
    or exists (select 1 from cron.job where jobname = 'flow-thread-files-purge' and schedule = '23 * * * *'
      and command like '%purge-files%'),
  'flow-thread-files-purge, when scheduled, posts purge-files hourly'
);

select * from finish();
rollback;
