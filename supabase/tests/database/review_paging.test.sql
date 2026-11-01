-- FLOW-984: list_review_page returns the open review items in pages (keyset on doc date, created-at, id),
-- with the total and the next cursor, and list_review() stays the same read. Invented data only.

begin;

select plan(40);

do $users$
begin
  perform tests.create_supabase_user('rp_a', 'rp-a@example.com');
  perform tests.create_supabase_user('rp_b', 'rp-b@example.com');
  perform tests.create_supabase_user('rp_c', 'rp-c@example.com');
  perform tests.create_supabase_user('rp_none', 'rp-none@example.com');
end
$users$;

create temp table rp (label text primary key, id uuid);
grant all on rp to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.rp where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- Company A: seven open items, a tie on date and created-at (l4, l5), and three lines that are not listed.
insert into rp (label, id) values
  ('a', tests.fixture_company('rp_a', 'Example Paging A LLC')),
  ('b', tests.fixture_company('rp_b', 'Example Paging B LLC')),
  ('c', tests.fixture_company('rp_c', 'Example Paging C LLC'));
insert into rp (label, id) values
  ('px', tests.fixture_project(pg_temp.id('a'), 'Example Project X')),
  ('py', tests.fixture_project(pg_temp.id('a'), 'Example Project Y')),
  ('pb', tests.fixture_project(pg_temp.id('b'), 'Example Project B'));
insert into rp (label, id) values
  ('l1', tests.fixture_line(pg_temp.id('a'), 'rp:l1', 10000, 'expense', pg_temp.id('py'), null, '2026-06-01')),
  ('l2', tests.fixture_line(pg_temp.id('a'), 'rp:l2', 20000, 'expense', pg_temp.id('px'), null, '2026-06-01')),
  ('l3', tests.fixture_line(pg_temp.id('a'), 'rp:l3', 30000, 'expense', pg_temp.id('py'), null, '2026-06-02')),
  ('l4', tests.fixture_line(pg_temp.id('a'), 'rp:l4', 40000, 'expense', pg_temp.id('py'), null, '2026-06-03')),
  ('l5', tests.fixture_line(pg_temp.id('a'), 'rp:l5', 50000, 'expense', pg_temp.id('px'), null, '2026-06-03')),
  ('l6', tests.fixture_line(pg_temp.id('a'), 'rp:l6', 60000, 'expense', null, null, '2026-06-04')),
  ('l7', tests.fixture_line(pg_temp.id('a'), 'rp:l7', 70000, 'income', pg_temp.id('px'), null, '2026-06-05')),
  ('pend', tests.fixture_line(pg_temp.id('a'), 'rp:pend', 80000, 'expense', pg_temp.id('px'), null, '2026-06-01', 'ILS', 'pending')),
  ('gone', tests.fixture_line(pg_temp.id('a'), 'rp:gone', 90000, 'expense', pg_temp.id('px'), null, '2026-06-01')),
  ('done', tests.fixture_line(pg_temp.id('a'), 'rp:done', 11000, 'expense', pg_temp.id('px'), null, '2026-06-01')),
  ('b1', tests.fixture_line(pg_temp.id('b'), 'rp:b1', 12000, 'expense', pg_temp.id('pb'), null, '2026-06-01'));
update public.transactions set removed_at = now() where id = pg_temp.id('gone');
insert into public.review_queue (company_id, transaction_id, status, reason, created_at)
select t.company_id, t.id, case when t.id = pg_temp.id('done') then 'approved'::public.review_status else 'open' end,
  'missing_category',
  case t.idempotency_key
    when 'rp:l1' then '2026-06-10 10:00:00+00'::timestamptz
    when 'rp:l2' then '2026-06-10 10:00:01+00'
    when 'rp:l3' then '2026-06-10 10:00:00+00'
    when 'rp:l4' then '2026-06-10 10:00:05.123456+00'
    when 'rp:l5' then '2026-06-10 10:00:05.123456+00'
    else '2026-06-10 10:00:00+00'
  end
from public.transactions t
where t.idempotency_key like 'rp:%';

-- Company C: 205 open items from one insert, all with the same created-at and doc date: ties all the way.
insert into rp (label, id)
select 'c' || g, tests.fixture_line(pg_temp.id('c'), 'rpc:' || g, 1000 + g)
from generate_series(1, 205) g;
insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_category'
from public.transactions t
where t.idempotency_key like 'rpc:%';

-- Walks every page from the first with the given size; the items in order, and how many pages it took.
create function pg_temp.walk(p_limit integer, p_project uuid default null) returns jsonb
language plpgsql
as $$
declare
  cur jsonb;
  page jsonb;
  items jsonb := '[]';
  pages integer := 0;
begin
  loop
    page := public.list_review_page(
      p_limit, (cur->>'doc_date')::date, (cur->>'created_at')::timestamptz, (cur->>'id')::uuid, p_project);
    pages := pages + 1;
    items := items || (page->'items');
    exit when page->'next' = 'null'::jsonb or pages > 500;
    cur := page->'next';
  end loop;
  return jsonb_build_object('items', items, 'pages', pages);
end
$$;
grant execute on function pg_temp.walk(integer, uuid) to authenticated;

-- The transaction ids of an items array.
create function pg_temp.txns(p_items jsonb) returns jsonb
language sql
as $$ select coalesce(jsonb_agg(i->'transaction_id' order by o), '[]') from jsonb_array_elements(p_items) with ordinality t(i, o); $$;
grant execute on function pg_temp.txns(jsonb) to authenticated;

-- What the page order should be: doc date, created-at, then the queue id.
create function pg_temp.expected(p_project uuid default null) returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(to_jsonb(q.transaction_id) order by t.doc_date, q.created_at, q.id), '[]')
  from public.review_queue q join public.transactions t on t.id = q.transaction_id
  where q.status = 'open' and t.removed_at is null and t.line_status <> 'pending'
    and (p_project is null or t.project_id = p_project);
$$;
grant execute on function pg_temp.expected(uuid) to authenticated;

select tests.authenticate_as('rp_a');

-- Order, the total, the end of the list.
select is(pg_temp.txns(public.list_review_page(100)->'items'), pg_temp.expected(), 'the page lists the open items by doc date, created-at, then id');
select is(jsonb_array_length(public.list_review_page(100)->'items'), 7, 'a pending line, a removed line and an approved item are not listed');
select is((public.list_review_page(100)->>'total')::int, 7, 'the total counts the open items');
select is(public.list_review_page(100)->'next', 'null'::jsonb, 'a page that holds them all has no next cursor');
select ok((pg_temp.expected()->>0)::uuid = pg_temp.id('l1') and (pg_temp.expected()->>6)::uuid = pg_temp.id('l7'),
  'control: the oldest date is first, the newest last');
select isnt(pg_temp.expected(), '[]'::jsonb, 'control: there are rows to page');

-- Cursor: pages of 3 walk the list with no gap and no overlap.
select is(jsonb_array_length(public.list_review_page(3)->'items'), 3, 'a page holds the limit');
select is((public.list_review_page(3)->>'total')::int, 7, 'a page carries the total, not its size');
select isnt(public.list_review_page(3)->'next', 'null'::jsonb, 'a page with more behind it has a next cursor');
select is(pg_temp.txns(pg_temp.walk(3)->'items'), pg_temp.expected(), 'pages of 3 add up to the whole list, in order');
select is((pg_temp.walk(3)->>'pages')::int, 3, 'seven items in pages of 3 take three pages');
select is(pg_temp.txns(pg_temp.walk(1)->'items'), pg_temp.expected(), 'pages of 1 add up to the whole list, ties included');
select is(pg_temp.txns(pg_temp.walk(2)->'items'), pg_temp.expected(), 'pages of 2 split the tie on date and created-at without a gap');
select is(public.list_review_page(
    3, (public.list_review_page(6)->'next'->>'doc_date')::date, (public.list_review_page(6)->'next'->>'created_at')::timestamptz,
    (public.list_review_page(6)->'next'->>'id')::uuid)->'next',
  'null'::jsonb, 'the last page has a null next');
-- The exact-limit boundary.
select is(public.list_review_page(7)->'next', 'null'::jsonb, 'a limit equal to what is left leaves no next cursor');
select isnt(public.list_review_page(6)->'next', 'null'::jsonb, 'a limit one under leaves a next cursor');
select is(jsonb_array_length(public.list_review_page(
    6, (public.list_review_page(6)->'next'->>'doc_date')::date, (public.list_review_page(6)->'next'->>'created_at')::timestamptz,
    (public.list_review_page(6)->'next'->>'id')::uuid)->'items'), 1, 'and the page after it holds the one left');

-- The project argument.
select is(pg_temp.txns(public.list_review_page(100, null, null, null, pg_temp.id('px'))->'items'), pg_temp.expected(pg_temp.id('px')),
  'the project argument lists only that project, in the same order');
select is((public.list_review_page(100, null, null, null, pg_temp.id('px'))->>'total')::int, 3, 'and its total counts that project');
select is(pg_temp.txns(pg_temp.walk(2, pg_temp.id('px'))->'items'), pg_temp.expected(pg_temp.id('px')), 'a project walks in pages too');
select is(public.list_review_page(100, null, null, null, pg_temp.id('pb'))->'items', '[]'::jsonb, 'another company''s project gives no items');
select is((public.list_review_page(100, null, null, null, pg_temp.id('pb'))->>'total')::int, 0, 'and a total of zero');

-- list_review() is the same read: the whole list is the pages put together, item for item.
select is(public.list_review(), pg_temp.walk(3)->'items', 'list_review() equals the pages of 3 put together');
select is(public.list_review(), public.list_review_page(100)->'items', 'list_review() equals one page of everything');
select is(public.list_review()->0, public.list_review_page(1)->'items'->0, 'the first item is the same in both reads');
select ok(public.list_review()->0 ? 'forecast_match' and public.list_review()->0 ? 'receipts' and public.list_review()->0 ? 'kept_out',
  'the per-row parts are in the items');
select is(public.list_review_page(5, '2026-06-03', null, null), public.list_review_page(5), 'a cursor with only a date reads from the start');
-- One item by its review id.
select is(public.list_review_page(1, null, null, null, null, (select q.id from public.review_queue q where q.transaction_id = pg_temp.id('l5')))->'items'->0->>'transaction_id',
  pg_temp.id('l5')::text, 'p_item reads that one open item');
select is(jsonb_array_length(public.list_review_page(50, null, null, null, null, (select q.id from public.review_queue q where q.transaction_id = pg_temp.id('l5')))->'items'), 1,
  'and only that item');
select is(public.list_review_page(1, null, null, null, null, (select q.id from public.review_queue q where q.transaction_id = pg_temp.id('l5')))->'items'->0,
  (select e from jsonb_array_elements(public.list_review()) e where e->>'transaction_id' = pg_temp.id('l5')::text), 'it is the same row list_review() holds');
select is(public.list_review_page(1, null, null, null, null, (select q.id from public.review_queue q where q.transaction_id = pg_temp.id('done')))->'items', '[]'::jsonb,
  'an item that is no longer open gives nothing');

-- Another company, and a user with no company.
select tests.authenticate_as('rp_b');
select is(pg_temp.txns(public.list_review_page(100)->'items'), jsonb_build_array(pg_temp.id('b1')), 'company B lists only its own item');
select is((public.list_review_page(100)->>'total')::int, 1, 'and counts only its own');
select is(pg_temp.txns(public.list_review_page(100, null, null, null, pg_temp.id('px'))->'items'), '[]'::jsonb, 'company A''s project gives B nothing');
select tests.authenticate_as('rp_none');
select is(public.list_review_page(100), '{"items": [], "total": 0, "next": null}'::jsonb, 'a user with no company gets an empty page');

-- The limit.
select tests.authenticate_as('rp_c');
select is(jsonb_array_length(public.list_review_page(1000)->'items'), 200, 'the limit is capped at 200');
select is(jsonb_array_length(public.list_review_page(0)->'items'), 1, 'a limit under 1 gives one item');
select is(jsonb_array_length(public.list_review_page(null)->'items'), 50, 'no limit gives the first 50');
select is(public.list_review(), pg_temp.walk(50)->'items', 'list_review() equals the pages for 205 items tied on date and created-at');

-- Grants.
select tests.clear_authentication();
select ok(has_function_privilege('authenticated', 'public.list_review_page(integer, date, timestamptz, uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.list_review_page(integer, date, timestamptz, uuid, uuid, uuid)', 'execute'),
  'signed-in users can read a page; anon cannot');

select * from finish();
rollback;
