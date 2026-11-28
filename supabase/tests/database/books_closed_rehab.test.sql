-- FLOW-863: a category's rehab flag is a closed-period setting too. A person's change of
-- categories.rehab that would move a closed line's part of a project's rehab (private.project_investment:
-- the category's posted, paid expense lines filed to a project or shared to one by an allocation) is
-- refused with the other settings' words (FLOW-1170). Allowed with no closed date; allowed when no line
-- the change reaches is closed (open lines only, a line filed to no project, an unpaid invoice, an
-- income line); refused with the exact message when one is (a line filed to a project, a closed shared
-- cost's allocation, a closed line's split part); a change to the same value, or one that leaves the
-- category's rehab as it comes to, allowed; the undo refused; the service role allowed; the MCP envelope
-- answers refused; company A's date never affects company B.
-- Invented names and figures, @example.com only. Dates follow current_date.
-- Covers private.books_closed_setting_guard, public.set_category_rehab, public.mcp_set_category_rehab

begin;

select plan(26);

do $users$
begin
  perform tests.create_supabase_user('br_owner', 'br-owner@example.com');
  perform tests.create_supabase_user('br_other', 'br-other@example.com');
end
$users$;

create temp table br (label text primary key, id uuid);
grant all on br to authenticated, service_role;
create temp table res (label text primary key, r jsonb);
grant all on res to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid language sql set search_path = '' as $$ select id from pg_temp.br where label = p_label; $$;

-- The closed date is the last day of month -6; shut is a day in it, open a day three months later.
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
  select 'the books are closed through ' || to_char(pg_temp.closed(), 'YYYY-MM-DD') || ': this setting changes them';
$$;
create or replace function pg_temp.refused()
returns jsonb language sql set search_path = '' as $$ select jsonb_build_object('code', 'refused', 'message', pg_temp.msg()); $$;

-- A person (br_<who>), as the app (role authenticated) or as flow-mcp (with the credential tok_<who>).
create or replace function pg_temp.as_user(p_who text)
returns void language plpgsql set search_path = '' as $$
declare
  uid uuid := tests.get_supabase_uid('br_' || p_who);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1',
    'mcp_tid', pg_temp.id('tok_' || p_who))::text, true);
end; $$;
create or replace function pg_temp.nobody()
returns void language sql set search_path = '' as $$
  select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true),
    set_config('request.jwt.claim.role', '', true);
$$;
-- One app call: 'ok', or the error's message.
create or replace function pg_temp.try(p_sql text, p_who text default 'owner')
returns text language plpgsql set search_path = '' as $$
begin
  perform pg_temp.as_user(p_who);
  execute p_sql;
  reset role;
  perform pg_temp.nobody();
  return 'ok';
exception when others then
  reset role;
  perform pg_temp.nobody();
  return sqlerrm;
end; $$;
-- One MCP call.
create or replace function pg_temp.mcp(p_sql text, p_who text default 'owner')
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_user(p_who);
  execute p_sql into r;
  reset role;
  perform pg_temp.nobody();
  return r;
end; $$;
-- A write with no user, as the service role (a sync or a job).
create or replace function pg_temp.service(p_sql text)
returns text language plpgsql set search_path = '' as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  set local role service_role;
  execute p_sql;
  reset role;
  perform pg_temp.nobody();
  return 'ok';
exception when others then
  reset role;
  perform pg_temp.nobody();
  return sqlerrm;
end; $$;
create or replace function pg_temp.rehab(p_label text)
returns boolean language sql set search_path = '' as $$
  select c.rehab from public.categories c where c.id = pg_temp.id(p_label);
$$;
create or replace function pg_temp.set_rehab(p_label text, p_rehab boolean)
returns text language sql set search_path = '' as $$
  select pg_temp.try(format('select public.set_category_rehab(%L, %L::boolean)', pg_temp.id(p_label), p_rehab));
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- Company A (an owner) and company B; credentials for flow-mcp.
insert into br (label, id) values
  ('co', tests.fixture_company('br_owner', 'Example Rehab Lock Co')),
  ('co_b', tests.fixture_company('br_other', 'Example Other Rehab Co'));
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values
  (tests.get_supabase_uid('br_owner'), pg_temp.id('co'), 'hash-br-owner-0001', 'pepper-1', array['read', 'write'], now() + interval '90 days'),
  (tests.get_supabase_uid('br_other'), pg_temp.id('co_b'), 'hash-br-other-0001', 'pepper-1', array['read', 'write'], now() + interval '90 days');
insert into br (label, id)
select 'tok_' || v.who, c.id from private.mcp_credentials c
join (values ('owner', 'hash-br-owner-0001'), ('other', 'hash-br-other-0001')) v(who, h) on c.token_hash = v.h;

insert into br (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example Cedar house')),
  ('studio', tests.fixture_project(pg_temp.id('co'), 'Example Cedar studio')),
  ('reno', tests.fixture_category(pg_temp.id('co'), 'Example renovation', 'expense')),
  ('paint', tests.fixture_category(pg_temp.id('co'), 'Example paint', 'expense')),
  ('tools', tests.fixture_category(pg_temp.id('co'), 'Example tools', 'expense')),
  ('unfiled', tests.fixture_category(pg_temp.id('co'), 'Example unfiled', 'expense')),
  ('unpaid', tests.fixture_category(pg_temp.id('co'), 'Example unpaid bills', 'expense')),
  ('shared', tests.fixture_category(pg_temp.id('co'), 'Example shared costs', 'expense')),
  ('parts', tests.fixture_category(pg_temp.id('co'), 'Example split parts', 'expense')),
  ('kept', tests.fixture_category(pg_temp.id('co'), 'Example kept out', 'expense', true)),
  ('sales', tests.fixture_category(pg_temp.id('co'), 'Example sales', 'income')),
  ('b_house', tests.fixture_project(pg_temp.id('co_b'), 'Example B house')),
  ('b_reno', tests.fixture_category(pg_temp.id('co_b'), 'Example B renovation', 'expense'));

create or replace function pg_temp.line(p_co text, p_key text, p_date date, p_project text, p_category text,
  p_direction text default 'expense', p_doc_kind text default 'receipt')
returns uuid language sql set search_path = '' as $$
  select tests.fixture_line(pg_temp.id(p_co), 'br:' || p_key, 12345, p_direction, pg_temp.id(p_project),
    pg_temp.id(p_category), p_date, 'ILS', 'posted', 'manual', 'project', p_doc_kind);
$$;
-- Paid receipts (cash date = document date) unless said otherwise.
insert into br (label, id) values
  ('s_reno', pg_temp.line('co', 's-reno', pg_temp.shut(), 'house', 'reno')),
  ('o_paint', pg_temp.line('co', 'o-paint', pg_temp.open(), 'house', 'paint')),
  ('s_unfiled', pg_temp.line('co', 's-unfiled', pg_temp.shut(), null, 'unfiled')),
  ('s_unpaid', pg_temp.line('co', 's-unpaid', pg_temp.shut(), 'house', 'unpaid', 'expense', 'invoice')),
  ('s_shared', pg_temp.line('co', 's-shared', pg_temp.shut(), 'house', 'shared')),
  ('s_split', pg_temp.line('co', 's-split', pg_temp.shut(), 'house', 'tools')),
  ('s_kept', pg_temp.line('co', 's-kept', pg_temp.shut(), 'house', 'kept')),
  ('s_sales', pg_temp.line('co', 's-sales', pg_temp.shut(), 'house', 'sales', 'income')),
  ('bl_reno', pg_temp.line('co_b', 'b-reno', pg_temp.shut(), 'b_house', 'b_reno'));
-- An invoice not paid yet; a shared cost, half on each project; a line split, one part filed to parts.
update public.transactions set cash_date = null where id = pg_temp.id('s_unpaid');
update public.transactions set pnl_role = 'shared', project_id = null where id = pg_temp.id('s_shared');
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net) values
  (pg_temp.id('co'), pg_temp.id('s_shared'), pg_temp.id('house'), 5000, -6173),
  (pg_temp.id('co'), pg_temp.id('s_shared'), pg_temp.id('studio'), 5000, -6172);
select tests.line_split(pg_temp.id('s_split'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('parts'), 'amount_minor', 10000),
  jsonb_build_object('category_id', pg_temp.id('tools'), 'amount_minor', 2345)));
select is(
  (select count(*)::integer from public.legs l where l.transaction_id = pg_temp.id('s_split') and l.category_id = pg_temp.id('parts')),
  1, 'the closed split line has a part filed to parts');

-- ---------------------------------------------------------------------------------------------
-- No closed date: the flag changes, through flow-mcp, so it has an undo.
-- ---------------------------------------------------------------------------------------------
insert into res values ('t_reno', pg_temp.mcp(format('select public.mcp_set_category_rehab(%L, %L::uuid, false)', 'br-reno',
  pg_temp.id('reno'))));
select is((select r->>'ok' from res where label = 't_reno'), 'true', 'no closed date: a category leaves rehab');
select is(pg_temp.rehab('reno'), false, 'and its flag is false');

-- A closes its books through the end of month -6. B has no closed date.
update public.companies set books_closed_through = pg_temp.closed() where id = pg_temp.id('co');

-- ---------------------------------------------------------------------------------------------
-- A line the change reaches is closed: refused.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.set_rehab('reno', true), pg_temp.msg(),
  'a category with a closed paid cost filed to a project cannot come back into rehab');
select is(pg_temp.rehab('reno'), false, 'and its flag stays');
select is(pg_temp.set_rehab('reno', false), 'ok', 'setting the same flag is allowed');
select is(pg_temp.mcp(format('select public.mcp_set_category_rehab(%L, %L::uuid, null)', 'br-reno-2', pg_temp.id('reno')))->'error',
  pg_temp.refused(), 'set_category_rehab through flow-mcp answers refused with the same words');
select is(pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'br-undo-reno', 'category_rehab', pg_temp.id('reno')))->'error',
  pg_temp.refused(), 'the undo of a rehab flag is refused');
select is(pg_temp.rehab('reno'), false, 'and the flag stays');
select is(pg_temp.set_rehab('shared', false), pg_temp.msg(),
  'a category with a closed shared cost''s allocation to a project is refused');
select is(pg_temp.set_rehab('parts', false), pg_temp.msg(),
  'a category with a closed line''s split part on a project is refused');
select is(pg_temp.set_rehab('kept', true), pg_temp.msg(),
  'a kept-out category with a closed cost on a project cannot be added to rehab');
select is(pg_temp.rehab('kept'), null::boolean, 'and it keeps the default');

-- ---------------------------------------------------------------------------------------------
-- No line the change reaches is closed, or no line's rehab moves: allowed.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.set_rehab('paint', false), 'ok', 'a category whose costs are all open leaves rehab');
select is(pg_temp.set_rehab('unfiled', false), 'ok', 'a category whose closed cost is filed to no project changes');
select is(pg_temp.set_rehab('unpaid', false), 'ok', 'a category whose closed cost is an unpaid invoice changes');
select is(pg_temp.set_rehab('sales', false), 'ok', 'an income category with a closed line changes');
select is(pg_temp.set_rehab('shared', true), 'ok',
  'a category counted in rehab by default is set to true: no closed line moves');
select is(pg_temp.set_rehab('kept', false), 'ok',
  'a kept-out category is set to false, as its default already is');
select is(pg_temp.set_rehab('shared', false), pg_temp.msg(), 'and then taken out of rehab, it is refused');

-- ---------------------------------------------------------------------------------------------
-- The service role (a sync or a job) is not refused.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.service(format('update public.categories set rehab = true where id = %L', pg_temp.id('reno'))), 'ok',
  'the service role changes a closed category''s rehab flag');
select is(pg_temp.rehab('reno'), true, 'and the flag is true');

-- ---------------------------------------------------------------------------------------------
-- A's closed date never reaches B: B's cost dated in A's closed period is open for B.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.mcp(format('select public.mcp_set_category_rehab(%L, %L::uuid, false)', 'br-b-reno', pg_temp.id('b_reno')),
  'other')->>'ok', 'true', 'B takes a category out of rehab');
select is(pg_temp.rehab('b_reno'), false, 'and its flag is false');
-- Once B closes the same period, its own cost is closed.
update public.companies set books_closed_through = pg_temp.closed() where id = pg_temp.id('co_b');
select is(pg_temp.mcp(format('select public.mcp_set_category_rehab(%L, %L::uuid, true)', 'br-b-reno-2', pg_temp.id('b_reno')),
  'other')->'error', pg_temp.refused(), 'B''s own closed date refuses B');
select is(pg_temp.rehab('b_reno'), false, 'and B''s flag stays');

select * from finish();
rollback;
