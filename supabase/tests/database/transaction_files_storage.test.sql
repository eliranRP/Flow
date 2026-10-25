-- FLOW-957 fix: the transaction-files bucket reads the company from the path, not from the request.
-- Storage calls carry no x-flow-company, so an owner of two companies uploads under the one it shows
-- even when the server's last opened company is the other. A viewer uploads nothing; an outsider
-- neither uploads nor reads. Invented names only.

begin;

select plan(7);

select tests.create_supabase_user('fs_owner', 'fs-owner@example.com');
select tests.create_supabase_user('fs_viewer', 'fs-viewer@example.com');
select tests.create_supabase_user('fs_other', 'fs-other@example.com');

create temp table fs (label text primary key, id uuid);
grant all on fs to authenticated;
insert into fs (label, id) values
  ('shown', tests.fixture_company('fs_owner', 'Example Files Shown LLC')),
  ('last', tests.fixture_company('fs_owner', 'Example Files Last LLC'));
insert into fs (label, id) values
  ('line', tests.fixture_line((select id from fs where label = 'shown'), 'fs:line', 99700, 'expense', null, null, '2026-10-20')),
  ('last_line', tests.fixture_line((select id from fs where label = 'last'), 'fs:last', 500, 'expense', null, null, '2026-10-20'));

create function pg_temp.path(p_company text, p_line text, p_name text) returns text language sql stable as $$
  select (select id from pg_temp.fs where label = p_company)::text || '/'
    || (select id from pg_temp.fs where label = p_line)::text || '/' || p_name;
$$;
grant execute on function pg_temp.path(text, text, text) to authenticated;

-- The server's last opened company is the other one; the viewer is a viewer of the shown one.
insert into public.active_companies (user_id, company_id)
values (tests.get_supabase_uid('fs_owner'), (select id from fs where label = 'last'));
insert into public.company_members (company_id, user_id, role)
values ((select id from fs where label = 'shown'), tests.get_supabase_uid('fs_viewer'), 'viewer');

select tests.authenticate_as('fs_owner');
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('transaction-files', %L) $$, pg_temp.path('shown', 'line', 'image.jpg')),
  'an owner uploads under the company it shows, whatever company the server opened last');
select is((select count(*)::int from storage.objects where name = pg_temp.path('shown', 'line', 'image.jpg')), 1,
  'and reads it back');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('transaction-files', %L) $$, pg_temp.path('shown', 'last_line', 'x.jpg')),
  '42501', null, 'a line of another company under this company''s folder is refused');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('transaction-files', 'not-a-company/x/y.jpg') $$,
  '42501', null, 'a path that names no company is refused');

select tests.authenticate_as('fs_viewer');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('transaction-files', %L) $$, pg_temp.path('shown', 'line', 'v.jpg')),
  '42501', null, 'a viewer uploads nothing');

select tests.authenticate_as('fs_other');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('transaction-files', %L) $$, pg_temp.path('shown', 'line', 'o.jpg')),
  '42501', null, 'an outsider uploads nothing');
select is((select count(*)::int from storage.objects where bucket_id = 'transaction-files'
  and name like (select id from fs where label = 'shown')::text || '/%'), 0, 'and reads nothing');

select * from finish();
rollback;
