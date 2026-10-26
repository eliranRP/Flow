-- A shared expense's אישור opens the split by categories and projects. The split takes the line
-- while its review is the shared one, saving it closes that review, and the sync does not reopen
-- it. Any other open review still blocks the split. Invented data only. Amounts are cents.

begin;

select plan(12);

select tests.create_supabase_user('ssl_owner', 'ssl-owner@example.com');

create temp table ssl (label text primary key, id uuid);
grant all on ssl to authenticated, service_role;
insert into ssl (label, id) values ('co', tests.fixture_company('ssl_owner', 'Example Shared Split LLC'));
insert into ssl (label, id) values
  ('north', tests.fixture_project((select id from ssl where label = 'co'), 'North')),
  ('south', tests.fixture_project((select id from ssl where label = 'co'), 'South')),
  ('repairs', tests.fixture_category((select id from ssl where label = 'co'), 'Repairs'));
insert into ssl (label, id) values
  ('shared', tests.fixture_line((select id from ssl where label = 'co'), 'ssl:shared', 16000, 'expense', null,
    (select id from ssl where label = 'repairs'), '2026-09-28', p_source => 'sumit', p_pnl_role => 'shared')),
  ('missing', tests.fixture_line((select id from ssl where label = 'co'), 'ssl:missing', 900, 'expense', null,
    null, '2026-09-28', p_source => 'sumit'));

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.ssl where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create function pg_temp.parts() returns jsonb language sql stable as $$
  select jsonb_build_array(
    jsonb_build_object('category_id', pg_temp.id('repairs'), 'project_id', pg_temp.id('north'), 'amount_minor', 10000),
    jsonb_build_object('category_id', pg_temp.id('repairs'), 'project_id', pg_temp.id('south'), 'amount_minor', 6000));
$$;
grant execute on function pg_temp.parts() to authenticated, service_role;

create function pg_temp.open_reason(p_label text) returns text language sql stable as $$
  select string_agg(q.reason, ',') from public.review_queue q where q.transaction_id = pg_temp.id(p_label) and q.status = 'open';
$$;
grant execute on function pg_temp.open_reason(text) to authenticated, service_role;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end;
$$;
grant execute on function pg_temp.as_service() to authenticated, service_role;

-- 1-2. The sync queues the shared line as unallocated_shared, and the other line as missing a category.
select pg_temp.as_service();
select public.sync_review_queue(pg_temp.id('co'));
select is(pg_temp.open_reason('shared'), 'unallocated_shared', 'a shared line with no split waits as unallocated_shared');
select is(pg_temp.open_reason('missing'), 'missing_category', 'a line with no category waits as missing_category');

-- 3-5. The split takes the shared line, previews it, and saving closes its review.
select tests.authenticate_as('ssl_owner');
select lives_ok($$ select public.save_line_split(pg_temp.id('shared'), pg_temp.parts(), true) $$,
  'the split previews a shared line in review');
select lives_ok($$ select public.save_line_split(pg_temp.id('shared'), pg_temp.parts()) $$,
  'the split saves a shared line in review');
select is((select q.status from public.review_queue q where q.transaction_id = pg_temp.id('shared') order by q.created_at desc limit 1),
  'changed', 'saving the split closes the shared line''s review');

-- 6. The sync does not reopen a shared line that has a split.
select pg_temp.as_service();
select public.sync_review_queue(pg_temp.id('co'));
select is(pg_temp.open_reason('shared'), null, 'the sync leaves a split shared line closed');

-- 7-11. With no split, a shared line in review is approved whole on one project.
select pg_temp.as_service();
insert into ssl (label, id) values
  ('whole', tests.fixture_line(pg_temp.id('co'), 'ssl:whole', 3000, 'expense', null,
    pg_temp.id('repairs'), '2026-09-28', p_source => 'sumit', p_pnl_role => 'shared'));
select public.sync_review_queue(pg_temp.id('co'));
select tests.authenticate_as('ssl_owner');
select throws_ok($$ select public.approve_shared_whole(pg_temp.id('missing'), pg_temp.id('north')) $$,
  'line is not a shared expense in review', 'only a shared expense in review is approved whole');
select throws_ok($$ select public.approve_shared_whole(pg_temp.id('whole'), gen_random_uuid()) $$,
  'project not found', 'the project is one of the company''s');
select lives_ok($$ select public.approve_shared_whole(pg_temp.id('whole'), pg_temp.id('north')) $$,
  'the shared line is approved whole on North');
select is((select row(t.pnl_role::text, t.project_id) from public.transactions t where t.id = pg_temp.id('whole')),
  row('project'::text, pg_temp.id('north')), 'it is North''s own cost');
select is((select q.status::text || '/' || q.prior_pnl_role::text from public.review_queue q where q.transaction_id = pg_temp.id('whole')),
  'changed/shared', 'its review closes as changed and keeps the line''s role before');

-- 12. Any other open review still blocks the split.
select tests.authenticate_as('ssl_owner');
select throws_ok(
  $$ select public.save_line_split(pg_temp.id('missing'), jsonb_build_array(
    jsonb_build_object('category_id', pg_temp.id('repairs'), 'project_id', pg_temp.id('north'), 'amount_minor', 500),
    jsonb_build_object('category_id', pg_temp.id('repairs'), 'project_id', pg_temp.id('south'), 'amount_minor', 400))) $$,
  'line has an open review', 'a line waiting for its category is still split from the queue only');

select * from finish();
rollback;
