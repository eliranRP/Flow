-- FLOW-1170: a setting that would move a figure in a closed period is refused when a person changes
-- it (20261114094800_books_closed_settings.sql): the cash basis, a category's P&L flag, cash flag and
-- account, and the overhead project. Per setting: allowed with no closed date; allowed when no line it
-- reaches is closed; refused with the exact message when one is; a change to the same value allowed;
-- the undo refused; the service role allowed; the editor and the viewer as before; company A's date
-- never affects company B. Also: a rename keeps the flag in a closed period, the refusal reaches the
-- MCP envelope, and a category merge that reaches a closed line is refused by the line lock.
-- Invented names and figures, @example.com only. Dates follow current_date.

begin;

select plan(70);

do $users$
begin
  perform tests.create_supabase_user('bs_owner', 'bs-owner@example.com');
  perform tests.create_supabase_user('bs_editor', 'bs-editor@example.com');
  perform tests.create_supabase_user('bs_viewer', 'bs-viewer@example.com');
  perform tests.create_supabase_user('bs_other', 'bs-other@example.com');
end
$users$;

create temp table bs (label text primary key, id uuid);
grant all on bs to authenticated, service_role;
create temp table res (label text primary key, r jsonb);
grant all on res to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid language sql set search_path = '' as $$ select id from pg_temp.bs where label = p_label; $$;

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
create or replace function pg_temp.line_msg()
returns text language sql set search_path = '' as $$
  select 'the books are closed through ' || to_char(pg_temp.closed(), 'YYYY-MM-DD');
$$;
create or replace function pg_temp.msg()
returns text language sql set search_path = '' as $$ select pg_temp.line_msg() || ': this setting changes them'; $$;
create or replace function pg_temp.refused()
returns jsonb language sql set search_path = '' as $$ select jsonb_build_object('code', 'refused', 'message', pg_temp.msg()); $$;

-- A person (bs_<who>), as the app (role authenticated) or as flow-mcp (with the credential tok_<who>).
create or replace function pg_temp.as_user(p_who text)
returns void language plpgsql set search_path = '' as $$
declare
  uid uuid := tests.get_supabase_uid('bs_' || p_who);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1',
    'mcp_tid', pg_temp.id('tok_' || p_who))::text, true);
end; $$;
-- No user: what the setup statements below run as.
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
create or replace function pg_temp.cat(p_label text)
returns public.categories language sql set search_path = '' as $$
  select c from public.categories c where c.id = pg_temp.id(p_label);
$$;
create or replace function pg_temp.co(p_label text)
returns public.companies language sql set search_path = '' as $$
  select c from public.companies c where c.id = pg_temp.id(p_label);
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- Company A (an owner, an editor, a viewer) and company B; credentials for flow-mcp.
insert into bs (label, id) values
  ('co', tests.fixture_company('bs_owner', 'Example Closed Settings Co')),
  ('co_b', tests.fixture_company('bs_other', 'Example Other Settings Co'));
insert into public.company_members (company_id, user_id, role) values
  (pg_temp.id('co'), tests.get_supabase_uid('bs_editor'), 'editor'),
  (pg_temp.id('co'), tests.get_supabase_uid('bs_viewer'), 'viewer');
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values
  (tests.get_supabase_uid('bs_owner'), pg_temp.id('co'), 'hash-bs-owner-0001', 'pepper-1', array['read', 'write'], now() + interval '90 days'),
  (tests.get_supabase_uid('bs_editor'), pg_temp.id('co'), 'hash-bs-editor-001', 'pepper-1', array['read', 'write'], now() + interval '90 days'),
  (tests.get_supabase_uid('bs_viewer'), pg_temp.id('co'), 'hash-bs-viewer-001', 'pepper-1', array['read', 'write'], now() + interval '90 days'),
  (tests.get_supabase_uid('bs_other'), pg_temp.id('co_b'), 'hash-bs-other-0001', 'pepper-1', array['read', 'write'], now() + interval '90 days');
insert into bs (label, id)
select 'tok_' || v.who, c.id from private.mcp_credentials c
join (values ('owner', 'hash-bs-owner-0001'), ('editor', 'hash-bs-editor-001'), ('viewer', 'hash-bs-viewer-001'),
  ('other', 'hash-bs-other-0001')) v(who, h) on c.token_hash = v.h;

-- A's projects and categories. birch has a closed line; oak and pine only open ones; shared has a
-- closed shared cost's allocation.
insert into bs (label, id) values
  ('maple', tests.fixture_project(pg_temp.id('co'), 'Example Maple house')),
  ('birch', tests.fixture_project(pg_temp.id('co'), 'Example Birch office')),
  ('oak', tests.fixture_project(pg_temp.id('co'), 'Example Oak office')),
  ('pine', tests.fixture_project(pg_temp.id('co'), 'Example Pine office')),
  ('shared', tests.fixture_project(pg_temp.id('co'), 'Example Shared office')),
  ('repairs', tests.fixture_category(pg_temp.id('co'), 'Example repairs', 'expense')),
  ('supplies', tests.fixture_category(pg_temp.id('co'), 'Example supplies', 'expense')),
  ('parts', tests.fixture_category(pg_temp.id('co'), 'Example split parts', 'expense')),
  ('override', tests.fixture_category(pg_temp.id('co'), 'Example own cash', 'expense')),
  ('kept', tests.fixture_category(pg_temp.id('co'), 'Example kept out', 'expense', true)),
  ('kept_open', tests.fixture_category(pg_temp.id('co'), 'Example kept out later', 'expense', true)),
  ('rent', tests.fixture_category(pg_temp.id('co'), 'Example rent', 'income'));
-- B: the same shapes, dated in A's closed period.
insert into bs (label, id) values
  ('b_proj', tests.fixture_project(pg_temp.id('co_b'), 'Example B house')),
  ('b_proj2', tests.fixture_project(pg_temp.id('co_b'), 'Example B office')),
  ('b_repairs', tests.fixture_category(pg_temp.id('co_b'), 'Example B repairs', 'expense')),
  ('b_rent_cat', tests.fixture_category(pg_temp.id('co_b'), 'Example B rent', 'income'));

create or replace function pg_temp.line(p_co text, p_key text, p_date date, p_project text, p_category text,
  p_direction text default 'expense')
returns uuid language sql set search_path = '' as $$
  select tests.fixture_line(pg_temp.id(p_co), 'bs:' || p_key, 12345, p_direction, pg_temp.id(p_project),
    pg_temp.id(p_category), p_date);
$$;
-- Every line is a paid receipt (cash date = document date), so an expense line reads the same on
-- both bases; the income receipt is counted on the paid basis only.
insert into bs (label, id) values
  ('s_repairs', pg_temp.line('co', 's-repairs', pg_temp.shut(), 'maple', 'repairs')),
  ('s_split', pg_temp.line('co', 's-split', pg_temp.shut(), 'maple', 'supplies')),
  ('o_supplies', pg_temp.line('co', 'o-supplies', pg_temp.open(), 'maple', 'supplies')),
  ('s_override', pg_temp.line('co', 's-override', pg_temp.shut(), 'maple', 'override')),
  ('s_kept', pg_temp.line('co', 's-kept', pg_temp.shut(), 'maple', 'kept')),
  ('o_kept', pg_temp.line('co', 'o-kept', pg_temp.open(), 'maple', 'kept_open')),
  ('s_birch', pg_temp.line('co', 's-birch', pg_temp.shut(), 'birch', 'supplies')),
  ('o_oak', pg_temp.line('co', 'o-oak', pg_temp.open(), 'oak', 'supplies')),
  ('o_pine', pg_temp.line('co', 'o-pine', pg_temp.open(), 'pine', 'supplies')),
  ('s_shared', pg_temp.line('co', 's-shared', pg_temp.shut(), 'maple', 'supplies')),
  ('o_rent', pg_temp.line('co', 'o-rent', pg_temp.open(), 'maple', 'rent', 'income')),
  ('s_rent', pg_temp.line('co', 's-rent', pg_temp.shut(), 'maple', 'rent', 'income')),
  ('bl_rent', pg_temp.line('co_b', 'b-rent', pg_temp.shut(), 'b_proj', 'b_rent_cat', 'income')),
  ('bl_repairs', pg_temp.line('co_b', 'b-repairs', pg_temp.shut(), 'b_proj', 'b_repairs'));
-- The closed income receipt is added once the basis has been checked without it.
update public.transactions set line_status = 'pending' where id = pg_temp.id('s_rent');
-- A closed line split, one part filed to the parts category; a closed line with its own cash choice.
select tests.line_split(pg_temp.id('s_split'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('parts'), 'amount_minor', 10000),
  jsonb_build_object('category_id', pg_temp.id('supplies'), 'amount_minor', 2345)));
update public.transactions set in_cash_override = true where id = pg_temp.id('s_override');
-- A closed shared cost, half on maple and half on the shared project.
update public.transactions set pnl_role = 'shared', project_id = null where id = pg_temp.id('s_shared');
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net) values
  (pg_temp.id('co'), pg_temp.id('s_shared'), pg_temp.id('maple'), 5000, -6173),
  (pg_temp.id('co'), pg_temp.id('s_shared'), pg_temp.id('shared'), 5000, -6172);
-- A balance-sheet account for the kept-out categories.
insert into res values ('acct', pg_temp.mcp(format('select public.mcp_create_account(%L, %L, %L, null)',
  'bs-acct', 'Example owner loan', 'liability')));
insert into bs (label, id) select 'acct', (r->'data'->>'id')::uuid from res where label = 'acct';
select isnt(pg_temp.id('acct'), null, 'a balance-sheet account for the kept-out categories');

-- ---------------------------------------------------------------------------------------------
-- No closed date: every setting changes, through flow-mcp, so each has an undo.
-- ---------------------------------------------------------------------------------------------
insert into res values
  ('t_basis', pg_temp.mcp(format('select public.mcp_set_cash_basis(%L, %L)', 'bs-basis', 'invoice'))),
  ('t_pnl', pg_temp.mcp(format('select public.mcp_set_category_pnl(%L, %L::uuid, true)', 'bs-pnl', pg_temp.id('repairs')))),
  ('t_cash', pg_temp.mcp(format('select public.mcp_set_category_cash(%L, %L::uuid, false)', 'bs-cash', pg_temp.id('repairs')))),
  ('t_acct', pg_temp.mcp(format('select public.mcp_set_category_account(%L, %L::uuid, %L::uuid)', 'bs-account',
    pg_temp.id('kept'), pg_temp.id('acct')))),
  ('t_over', pg_temp.mcp(format('select public.mcp_set_overhead_project(%L, %L::uuid)', 'bs-over', pg_temp.id('birch'))));
select is((select r->>'ok' from res where label = 't_basis'), 'true', 'no closed date: the basis changes');
select is((select r->>'ok' from res where label = 't_pnl'), 'true', 'no closed date: a category leaves the P&L');
select is((select r->>'ok' from res where label = 't_cash'), 'true', 'no closed date: a category leaves the cash view');
select is((select r->>'ok' from res where label = 't_acct'), 'true', 'no closed date: a category posts to another account');
select is((select r->>'ok' from res where label = 't_over'), 'true', 'no closed date: the overhead project changes');

-- A closes its books through the end of month -6. B has no closed date.
update public.companies set books_closed_through = pg_temp.closed() where id = pg_temp.id('co');

-- ---------------------------------------------------------------------------------------------
-- The cash basis.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try($$select public.set_cash_basis('paid')$$), 'ok',
  'the basis changes while every closed line reads the same on both bases');
select is(pg_temp.try($$select public.set_cash_basis('paid')$$), 'ok', 'setting the same basis again is allowed');
update public.transactions set line_status = 'posted' where id = pg_temp.id('s_rent');
select is(pg_temp.try($$select public.set_cash_basis('invoice')$$), pg_temp.msg(),
  'with a closed income receipt the switch is refused, with the closed date');
select is((pg_temp.co('co')).cash_basis, 'paid', 'and the basis stays');
select is(pg_temp.try($$select public.set_cash_basis('paid')$$), 'ok', 'the same basis is still allowed');
-- A closed expense paid in an open month moves between the bases too.
update public.transactions set line_status = 'pending' where id = pg_temp.id('s_rent');
update public.transactions set cash_date = pg_temp.open() where id = pg_temp.id('s_repairs');
select is(pg_temp.try($$select public.set_cash_basis('invoice')$$), pg_temp.msg(),
  'a closed expense paid in an open month is refused too');
update public.transactions set cash_date = doc_date where id = pg_temp.id('s_repairs');
update public.transactions set line_status = 'posted' where id = pg_temp.id('s_rent');
select is(pg_temp.mcp(format('select public.mcp_set_cash_basis(%L, %L)', 'bs-basis-2', 'invoice'))->'error',
  pg_temp.refused(), 'set_cash_basis through flow-mcp answers refused with the same words');
select is(pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'bs-undo-basis', 'cash_basis', pg_temp.id('co')))->'error',
  jsonb_build_object('code', 'conflict', 'message', 'conflict'), 'the basis undo meets the later change first');
-- Put back the value the undo ticket wrote, as postgres with no user, then the undo is refused.
update public.companies set cash_basis = 'invoice' where id = pg_temp.id('co');
select is(pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'bs-undo-basis-2', 'cash_basis', pg_temp.id('co')))->'error',
  pg_temp.refused(), 'the undo of a basis change is refused');
select is((pg_temp.co('co')).cash_basis, 'invoice', 'and the basis stays');

-- ---------------------------------------------------------------------------------------------
-- A category's P&L flag.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try(format('select public.set_category_excluded_from_pnl(%L, false)', pg_temp.id('repairs'))), pg_temp.msg(),
  'a category with a closed line cannot come back into the P&L');
select is((pg_temp.cat('repairs')).excluded_from_pnl, true, 'and stays out');
select is(pg_temp.try(format('select public.set_category_excluded_from_pnl(%L, true)', pg_temp.id('repairs'))), 'ok',
  'setting the same flag is allowed');
select is(pg_temp.try(format('select public.set_category_excluded_from_pnl(%L, true)', pg_temp.id('parts'))), pg_temp.msg(),
  'a category whose split part of a closed line is filed to it is refused');
select is(pg_temp.try(format('select public.set_category_excluded_from_pnl(%L, true)', pg_temp.id('override'))), pg_temp.msg(),
  'a closed line''s own cash choice does not free its category''s P&L flag');
select is(pg_temp.try(format('select public.set_category_excluded_from_pnl(%L, true)', pg_temp.id('kept_open'))), 'ok',
  'a category whose lines are all open changes');
select is(pg_temp.mcp(format('select public.mcp_set_category_pnl(%L, %L::uuid, false)', 'bs-pnl-2', pg_temp.id('repairs')))->'error',
  pg_temp.refused(), 'set_category_pnl through flow-mcp answers refused');
select is(pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'bs-undo-pnl', 'category_pnl', pg_temp.id('repairs')))->'error',
  pg_temp.refused(), 'the undo of a P&L flag is refused');
select is((pg_temp.cat('repairs')).excluded_from_pnl, true, 'and the flag stays');

-- ---------------------------------------------------------------------------------------------
-- A category's cash flag.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try(format('select public.set_category_cash(%L, true)', pg_temp.id('repairs'))), pg_temp.msg(),
  'a category with a closed line cannot come back into the cash view');
select is((pg_temp.cat('repairs')).in_cash, false, 'and stays out');
select is(pg_temp.try(format('select public.set_category_cash(%L, false)', pg_temp.id('repairs'))), 'ok',
  'setting the same flag is allowed');
select is(pg_temp.try(format('select public.set_category_cash(%L, false)', pg_temp.id('parts'))), pg_temp.msg(),
  'a category with a closed split part is refused');
select is(pg_temp.try(format('select public.set_category_cash(%L, false)', pg_temp.id('override'))), 'ok',
  'a category whose only closed line has its own cash choice changes');
select is(pg_temp.try(format('select public.set_category_cash(%L, false)', pg_temp.id('kept_open'))), 'ok',
  'a category whose lines are all open changes');
select is(pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'bs-undo-cash', 'category_cash', pg_temp.id('repairs')))->'error',
  pg_temp.refused(), 'the undo of a cash flag is refused');
select is((pg_temp.cat('repairs')).in_cash, false, 'and the flag stays');

-- ---------------------------------------------------------------------------------------------
-- A category's account.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.mcp(format('select public.mcp_set_category_account(%L, %L::uuid, null)', 'bs-acct-2', pg_temp.id('kept')))->'error',
  pg_temp.refused(), 'a kept-out category with a closed line keeps its account');
select is((pg_temp.cat('kept')).ledger_account_id, pg_temp.id('acct'), 'and its binding stays');
select is(pg_temp.mcp(format('select public.mcp_set_category_account(%L, %L::uuid, %L::uuid)', 'bs-acct-3', pg_temp.id('kept'),
  pg_temp.id('acct')))->>'ok', 'true', 'binding the same account again is allowed');
select is(pg_temp.mcp(format('select public.mcp_set_category_account(%L, %L::uuid, %L::uuid)', 'bs-acct-4', pg_temp.id('kept_open'),
  pg_temp.id('acct')))->>'ok', 'true', 'a kept-out category whose lines are all open is bound');
select is(pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'bs-undo-acct', 'category_account', pg_temp.id('kept')))->'error',
  pg_temp.refused(), 'the undo of an account binding is refused');
select is((pg_temp.cat('kept')).ledger_account_id, pg_temp.id('acct'), 'and the binding stays');

-- ---------------------------------------------------------------------------------------------
-- The overhead project (birch since the first write).
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try(format('select public.set_overhead_project(%L)', pg_temp.id('oak'))), pg_temp.msg(),
  'moving the overhead project off a project with a closed line is refused');
select is((pg_temp.co('co')).overhead_project_id, pg_temp.id('birch'), 'and birch stays the overhead project');
select is(pg_temp.try(format('select public.set_overhead_project(%L)', pg_temp.id('birch'))), 'ok',
  'setting the same project is allowed');
select is(pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'bs-undo-over', 'overhead_project', pg_temp.id('co')))->'error',
  pg_temp.refused(), 'the undo of the overhead project is refused');
-- From a project with only open lines: to another such project, or to none, it moves.
update public.companies set overhead_project_id = pg_temp.id('oak') where id = pg_temp.id('co');
select is(pg_temp.try(format('select public.set_overhead_project(%L)', pg_temp.id('pine'))), 'ok',
  'between two projects with only open lines it moves');
select is(pg_temp.try('select public.set_overhead_project(null)'), 'ok', 'and to none');
select is(pg_temp.try(format('select public.set_overhead_project(%L)', pg_temp.id('shared'))), pg_temp.msg(),
  'onto a project with a closed shared cost''s allocation it is refused');
select is(pg_temp.mcp(format('select public.mcp_set_overhead_project(%L, %L::uuid)', 'bs-over-2', pg_temp.id('birch')))->'error',
  pg_temp.refused(), 'set_overhead_project through flow-mcp answers refused');
select is((pg_temp.co('co')).overhead_project_id, null::uuid, 'and no overhead project is set');

-- ---------------------------------------------------------------------------------------------
-- The service role (a sync or a job) is not refused.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.service(format($$update public.companies set cash_basis = 'paid' where id = %L$$, pg_temp.id('co'))), 'ok',
  'the service role changes the basis');
select is(pg_temp.service(format('update public.categories set excluded_from_pnl = false, in_cash = true where id = %L',
  pg_temp.id('repairs'))), 'ok', 'and a category''s P&L and cash flags');
select is(pg_temp.service(format('update public.categories set ledger_account_id = null where id = %L', pg_temp.id('kept'))), 'ok',
  'and its account');
select is(pg_temp.service(format('update public.companies set overhead_project_id = %L where id = %L', pg_temp.id('birch'),
  pg_temp.id('co'))), 'ok', 'and the overhead project');

-- ---------------------------------------------------------------------------------------------
-- The editor and the viewer: the same rights as before.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.mcp(format('select public.mcp_set_category_cash(%L, %L::uuid, false)', 'bs-e-cash', pg_temp.id('repairs')),
  'editor')->'error', pg_temp.refused(), 'the editor is refused a closed category''s cash flag');
select is(pg_temp.mcp(format('select public.mcp_set_category_cash(%L, %L::uuid, true)', 'bs-e-cash-2', pg_temp.id('kept_open')),
  'editor')->>'ok', 'true', 'and changes an open one, as before');
select is(pg_temp.try($$select public.set_cash_basis('invoice')$$, 'editor'), 'forbidden',
  'the basis stays the owner''s: the editor is forbidden before the closed date is read');
select is(pg_temp.mcp(format('select public.mcp_set_category_pnl(%L, %L::uuid, true)', 'bs-v-pnl', pg_temp.id('kept_open')),
  'viewer')->'error'->>'code', 'forbidden', 'the viewer is forbidden, as before');
select is((pg_temp.cat('kept_open')).excluded_from_pnl, true, 'and nothing changed');

-- ---------------------------------------------------------------------------------------------
-- A's closed date never reaches B: B's lines dated in A's closed period are open for B.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.mcp(format('select public.mcp_set_cash_basis(%L, %L)', 'bs-b-basis', 'invoice'), 'other')->>'ok', 'true',
  'B switches its basis');
select is(pg_temp.mcp(format('select public.mcp_set_category_pnl(%L, %L::uuid, true)', 'bs-b-pnl', pg_temp.id('b_repairs')),
  'other')->>'ok', 'true', 'B takes a category out of the P&L');
select is(pg_temp.mcp(format('select public.mcp_set_category_cash(%L, %L::uuid, false)', 'bs-b-cash', pg_temp.id('b_repairs')),
  'other')->>'ok', 'true', 'and out of the cash view');
select is(pg_temp.mcp(format('select public.mcp_set_category_account(%L, %L::uuid, null)', 'bs-b-acct', pg_temp.id('b_repairs')),
  'other')->>'ok', 'true', 'and binds its account');
select is(pg_temp.mcp(format('select public.mcp_set_overhead_project(%L, %L::uuid)', 'bs-b-over', pg_temp.id('b_proj')),
  'other')->>'ok', 'true', 'and sets its overhead project');
-- Once B closes the same period, its own lines are closed.
update public.companies set books_closed_through = pg_temp.closed() where id = pg_temp.id('co_b');
select is(pg_temp.mcp(format('select public.mcp_set_overhead_project(%L, %L::uuid)', 'bs-b-over-2', pg_temp.id('b_proj2')),
  'other')->'error', pg_temp.refused(), 'B''s own closed date refuses B');

-- ---------------------------------------------------------------------------------------------
-- A rename keeps the flag, also in a closed period, and its undo too.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try(format($$select public.rename_category(%L, 'Owner distributions')$$, pg_temp.id('supplies'))), 'ok',
  'a category with closed lines is renamed to a name kept out by default');
select is((pg_temp.cat('supplies')).excluded_from_pnl, false, 'and keeps its P&L flag');
insert into res values ('rename', pg_temp.mcp(format('select public.mcp_rename_category(%L, %L::uuid, %L)', 'bs-rename',
  pg_temp.id('rent'), 'Owner contributions')));
select is((select r->>'ok' from res where label = 'rename'), 'true', 'the assistant renames an income category the same way');
select is(pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'bs-undo-rename', 'category_name', pg_temp.id('rent')))->>'ok',
  'true', 'and its undo renames it back');
select is((pg_temp.cat('rent')).excluded_from_pnl, false, 'with the flag kept throughout');

-- ---------------------------------------------------------------------------------------------
-- A bulk category action that reaches a closed line is refused whole by the line lock.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try(format('select public.merge_category(%L, %L)', pg_temp.id('override'), pg_temp.id('kept_open'))),
  pg_temp.line_msg(), 'merging a category with a closed line into one with other flags is refused by the line lock');
select is((pg_temp.cat('override')).hidden, false, 'and the category stays');

select * from finish();
rollback;
