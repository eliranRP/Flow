-- FLOW-856: the closed-date reads hold the company row until the write commits
-- (20261120090001_flow_856_closed_date_lock.sql). The books-closed guards and Jev read
-- companies.books_closed_through FOR SHARE, so a close (which takes the row FOR UPDATE) waits for a
-- write in flight, and the write waits for the close and then reads the new date. Two sessions cannot
-- race in pgTAP, so the structure is asserted from each function's definition: private.books_closed_guard,
-- private.books_closed_check, private.books_closed_setting_guard, public.jev_prefill and
-- public.jev_prefill_loan read the date with FOR SHARE, and no unlocked read of it is left. Then the
-- behaviour in one session: a person's write to an open line still goes through, one to a closed line
-- is still refused with `the books are closed through YYYY-MM-DD`, a line's parts likewise, the category
-- setting guard still refuses a closed change, a write with no user still passes, and Jev still skips a
-- closed line.
-- Invented names and figures, @example.com only. Dates follow current_date.

begin;

select plan(25);

do $users$
begin
  perform tests.create_supabase_user('sl_owner', 'sl-owner@example.com');
end
$users$;

create temp table sl (label text primary key, id uuid);
grant all on sl to authenticated, service_role;
create temp table res (label text primary key, r jsonb);
grant all on res to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid language sql set search_path = '' as $$ select id from pg_temp.sl where label = p_label; $$;

-- The first day of the month k months from this one; the closed date is the last day of month -6.
create or replace function pg_temp.m1(k integer)
returns date language sql set search_path = '' as $$
  select (date_trunc('month', current_date) + make_interval(months => k))::date;
$$;
create or replace function pg_temp.closed()
returns date language sql set search_path = '' as $$ select pg_temp.m1(-5) - 1; $$;
create or replace function pg_temp.shut()
returns date language sql set search_path = '' as $$ select pg_temp.m1(-6) + 9; $$;
create or replace function pg_temp.open()
returns date language sql set search_path = '' as $$ select pg_temp.m1(-3) + 9; $$;
create or replace function pg_temp.msg()
returns text language sql set search_path = '' as $$
  select 'the books are closed through ' || to_char(pg_temp.closed(), 'YYYY-MM-DD');
$$;

-- The owner, as the app (role authenticated).
create or replace function pg_temp.as_owner()
returns void language plpgsql set search_path = '' as $$
declare
  uid uuid := tests.get_supabase_uid('sl_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1',
    'mcp_tid', pg_temp.id('tok'))::text, true);
end; $$;
-- No user: a bank sync or a job.
create or replace function pg_temp.nobody()
returns void language sql set search_path = '' as $$
  select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true),
    set_config('request.jwt.claim.role', '', true);
$$;
-- One app call as the owner: 'ok', or the error's message.
create or replace function pg_temp.try(p_sql text)
returns text language plpgsql set search_path = '' as $$
begin
  perform pg_temp.as_owner();
  execute p_sql;
  reset role;
  perform pg_temp.nobody();
  return 'ok';
exception when others then
  reset role;
  perform pg_temp.nobody();
  return sqlerrm;
end; $$;
-- A statement as postgres with the owner's claims (a person's write the app makes in a definer).
create or replace function pg_temp.person_sql(p_sql text)
returns text language plpgsql set search_path = '' as $$
begin
  perform pg_temp.as_owner();
  reset role;
  execute p_sql;
  perform pg_temp.nobody();
  return 'ok';
exception when others then
  perform pg_temp.nobody();
  return sqlerrm;
end; $$;
-- A statement as postgres with no user.
create or replace function pg_temp.nobody_sql(p_sql text)
returns text language plpgsql set search_path = '' as $$
begin
  perform pg_temp.nobody();
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end; $$;
-- A line's parts (set_line_parts), written by a person.
create or replace function pg_temp.set_parts(p_label text)
returns text language plpgsql set search_path = '' as $$
begin
  perform pg_temp.as_owner();
  reset role;
  perform private.set_line_parts(pg_temp.id('co'), pg_temp.id(p_label), jsonb_build_array(
    jsonb_build_object('category_id', pg_temp.id('repairs'), 'amount_minor', 10000),
    jsonb_build_object('category_id', pg_temp.id('supplies'), 'amount_minor', 2345)));
  perform pg_temp.nobody();
  return 'ok';
exception when others then
  perform pg_temp.nobody();
  return sqlerrm;
end; $$;
create or replace function pg_temp.cat_of(p_label text)
returns uuid language sql set search_path = '' as $$
  select t.category_id from public.transactions t where t.id = pg_temp.id(p_label);
$$;
-- A function's definition, for the structure checks.
create or replace function pg_temp.def(p_fn text)
returns text language sql set search_path = '' as $$ select pg_catalog.pg_get_functiondef(p_fn::regprocedure); $$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- The structure: each closed-date read holds the company row (FOR SHARE), and no unlocked read of
-- it is left.
-- ---------------------------------------------------------------------------------------------
create temp table fns (fn text primary key);
insert into fns values
  ('private.books_closed_guard()'),
  ('private.books_closed_check(uuid,uuid)'),
  ('private.books_closed_setting_guard()'),
  ('public.jev_prefill(uuid,uuid,uuid,uuid,text,numeric)'),
  ('public.jev_prefill_loan(uuid,uuid,uuid,jsonb,text,numeric)');

select ok(pg_temp.def(fn) ~* 'books_closed_through[^;]*from public\.companies c\s+where c\.id = [a-z_]+\s+for share',
  fn || ' reads the closed date FOR SHARE')
from fns order by fn;
select ok(pg_temp.def(fn) !~* 'from public\.companies c\s+where c\.id = [a-z_]+\s*[;)]',
  fn || ' has no unlocked read of the company row')
from fns order by fn;
select is((select p.provolatile from pg_catalog.pg_proc p where p.oid = 'private.books_closed_check(uuid,uuid)'::regprocedure),
  'v'::"char", 'books_closed_check is volatile, so its locking read is allowed');

-- ---------------------------------------------------------------------------------------------
-- The fixtures: a company with a flow-mcp credential, a project, categories, lines in the closed
-- month (s_) and in an open month (o_).
-- ---------------------------------------------------------------------------------------------
insert into sl (label, id) values ('co', tests.fixture_company('sl_owner', 'Example Share Lock Co'));
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('sl_owner'), pg_temp.id('co'), 'hash-sl-owner-0001', 'pepper-1',
  array['read', 'write'], now() + interval '90 days');
insert into sl (label, id) select 'tok', id from private.mcp_credentials where token_hash = 'hash-sl-owner-0001';
insert into sl (label, id) values ('maple', tests.fixture_project(pg_temp.id('co'), 'Example Maple house'));
insert into sl (label, id) values
  ('repairs', tests.fixture_category(pg_temp.id('co'), 'Example repairs', 'expense')),
  ('supplies', tests.fixture_category(pg_temp.id('co'), 'Example supplies', 'expense')),
  ('tidy', tests.fixture_category(pg_temp.id('co'), 'Example tidy-up', 'expense'));

create or replace function pg_temp.line(p_key text, p_date date, p_category text)
returns uuid language sql set search_path = '' as $$
  select tests.fixture_line(pg_temp.id('co'), 'sl:' || p_key, 12345, 'expense', pg_temp.id('maple'), pg_temp.id(p_category),
    p_date, 'ILS', 'posted');
$$;
insert into sl (label, id) values
  ('s_file', pg_temp.line('s-file', pg_temp.shut(), 'repairs')),
  ('o_file', pg_temp.line('o-file', pg_temp.open(), 'repairs')),
  ('o_move', pg_temp.line('o-move', pg_temp.open(), 'repairs')),
  ('s_parts', pg_temp.line('s-parts', pg_temp.shut(), 'repairs')),
  ('o_parts', pg_temp.line('o-parts', pg_temp.open(), 'repairs')),
  ('s_sync', pg_temp.line('s-sync', pg_temp.shut(), 'repairs')),
  ('s_jev', pg_temp.line('s-jev', pg_temp.shut(), 'repairs')),
  ('o_tidy', pg_temp.line('o-tidy', pg_temp.open(), 'tidy'));

-- Jev's closed line is not the owner's filing and has an open review row.
update public.transactions set user_assigned = false, category_assigned = false where id = pg_temp.id('s_jev');
insert into public.review_queue (company_id, transaction_id, status, reason)
select pg_temp.id('co'), pg_temp.id('s_jev'), 'open', 'suggested'
where not exists (select 1 from public.review_queue q where q.transaction_id = pg_temp.id('s_jev') and q.status = 'open');

-- The owner closes the books through the end of month -6.
update public.companies set books_closed_through = pg_temp.closed() where id = pg_temp.id('co');

-- ---------------------------------------------------------------------------------------------
-- A person's write to a line (books_closed_guard).
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try(format('select public.reassign_transaction(%L, %L, %L)', pg_temp.id('o_file'), pg_temp.id('maple'),
  pg_temp.id('supplies'))), 'ok', 'a person files an open line');
select is(pg_temp.cat_of('o_file'), pg_temp.id('supplies'), 'which takes the new category');
select is(pg_temp.try(format('select public.reassign_transaction(%L, %L, %L)', pg_temp.id('s_file'), pg_temp.id('maple'),
  pg_temp.id('supplies'))), pg_temp.msg(), 'a person''s filing of a closed line is refused, with the closed date');
select is(pg_temp.cat_of('s_file'), pg_temp.id('repairs'), 'and the line keeps its category');
select is(pg_temp.person_sql(format('update public.transactions set doc_date = %L where id = %L', pg_temp.shut(),
  pg_temp.id('o_move'))), pg_temp.msg(), 'moving an open line into the closed month is refused');
select is(pg_temp.person_sql(format('update public.transactions set doc_date = %L where id = %L', pg_temp.open() + 1,
  pg_temp.id('o_move'))), 'ok', 'moving it within the open months goes through');

-- ---------------------------------------------------------------------------------------------
-- A line's parts (books_closed_check).
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.set_parts('o_parts'), 'ok', 'a person writes the parts of an open line');
select is(pg_temp.set_parts('s_parts'), pg_temp.msg(), 'and is refused the parts of a closed line');

-- ---------------------------------------------------------------------------------------------
-- A category setting (books_closed_setting_guard).
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try(format('select public.set_category_cash(%L, false)', pg_temp.id('repairs'))),
  pg_temp.msg() || ': this setting changes them', 'a category with a closed line cannot leave the cash view');
select is((select c.in_cash from public.categories c where c.id = pg_temp.id('repairs')), true, 'and its flag stays');
select is(pg_temp.try(format('select public.set_category_cash(%L, false)', pg_temp.id('tidy'))), 'ok',
  'a category whose lines are all open changes');

-- ---------------------------------------------------------------------------------------------
-- No user: the guards return before reading the date.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.nobody_sql(format('update public.transactions set category_id = %L where id = %L', pg_temp.id('supplies'),
  pg_temp.id('s_sync'))), 'ok', 'a write with no user to a closed line is not refused here');

-- ---------------------------------------------------------------------------------------------
-- Jev, as the service role, still skips a closed line.
-- ---------------------------------------------------------------------------------------------
do $jev$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into pg_temp.res values ('jev', public.jev_prefill(pg_temp.id('co'), pg_temp.id('s_jev'), null,
    pg_temp.id('supplies'), 'example-model', 0.9));
  perform pg_temp.nobody();
end
$jev$;
select is((select r->>'skipped' from res where label = 'jev'), 'closed_month', 'Jev skips a line in the closed period');
select is(pg_temp.cat_of('s_jev'), pg_temp.id('repairs'), 'and the line keeps its category');

select * from finish();
rollback;
