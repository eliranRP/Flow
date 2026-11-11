-- FLOW-1166 part 2a: the books-closed date locks a closed month against a person's edits
-- (20261111080447_books_closed_lock.sql). With the date set, each group of writers is refused on a
-- line dated in the closed month and allowed on one in an open month: an owner RPC that files, a
-- split, a manual booking, a delete, a bulk category move (refused whole), an MCP tool (the `refused`
-- envelope), an undo, and a line's parts. A change of cash_date alone into an open month is allowed;
-- a pending line is free until it posts; a receipt in the closed month keeps its filing when its open
-- invoice is filed; the service-role sync still writes a closed line. The undo of the closed date
-- works, and with no date nothing is refused.
-- Invented names and figures, @example.com only. Dates follow current_date.

begin;

select plan(47);

do $users$
begin
  perform tests.create_supabase_user('bc_owner', 'bc-owner@example.com');
end
$users$;

create temp table bc (label text primary key, id uuid);
grant all on bc to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid language sql set search_path = '' as $$ select id from pg_temp.bc where label = p_label; $$;

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

-- The owner, as the app (role authenticated) or as flow-mcp (with its credential's id).
create or replace function pg_temp.as_owner()
returns void language plpgsql set search_path = '' as $$
declare
  uid uuid := tests.get_supabase_uid('bc_owner');
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
-- One call as the owner: 'ok', or the error's message.
create or replace function pg_temp.try(p_sql text)
returns text language plpgsql set search_path = '' as $$
begin
  perform pg_temp.as_owner();
  execute p_sql;
  reset role;
  return 'ok';
exception when others then
  reset role;
  return sqlerrm;
end; $$;
-- A statement as postgres with the owner's claims (a person's write the app makes in a definer).
create or replace function pg_temp.person_sql(p_sql text)
returns text language plpgsql set search_path = '' as $$
begin
  perform pg_temp.as_owner();
  reset role;
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end; $$;
-- One MCP call as the owner.
create or replace function pg_temp.mcp(p_sql text)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_owner();
  execute p_sql into r;
  reset role;
  return r;
end; $$;
create or replace function pg_temp.cat_of(p_label text)
returns uuid language sql set search_path = '' as $$
  select t.category_id from public.transactions t where t.id = pg_temp.id(p_label);
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- The company, a project, categories, a flow-mcp credential.
insert into bc (label, id) values ('co', tests.fixture_company('bc_owner', 'Example Closed Books Co'));
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('bc_owner'), pg_temp.id('co'), 'hash-bc-owner-0001', 'pepper-1',
  array['read', 'write'], now() + interval '90 days');
insert into bc (label, id) select 'tok', id from private.mcp_credentials where token_hash = 'hash-bc-owner-0001';
insert into bc (label, id) values ('maple', tests.fixture_project(pg_temp.id('co'), 'Example Maple house'));
insert into bc (label, id) values
  ('repairs', tests.fixture_category(pg_temp.id('co'), 'Example repairs', 'expense')),
  ('supplies', tests.fixture_category(pg_temp.id('co'), 'Example supplies', 'expense')),
  ('cleanup', tests.fixture_category(pg_temp.id('co'), 'Example cleanup', 'expense')),
  ('tidy', tests.fixture_category(pg_temp.id('co'), 'Example tidy-up', 'expense')),
  ('rent', tests.fixture_category(pg_temp.id('co'), 'Example rent', 'income'));

-- Lines, two of each: one in the closed month (s_), one in an open month (o_).
create or replace function pg_temp.line(p_key text, p_date date, p_category text, p_status text default 'posted')
returns uuid language sql set search_path = '' as $$
  select tests.fixture_line(pg_temp.id('co'), 'bc:' || p_key, 12345, 'expense', pg_temp.id('maple'), pg_temp.id(p_category),
    p_date, 'ILS', p_status);
$$;
insert into bc (label, id) values
  ('s_file', pg_temp.line('s-file', pg_temp.shut(), 'repairs')),
  ('o_file', pg_temp.line('o-file', pg_temp.open(), 'repairs')),
  ('s_split', pg_temp.line('s-split', pg_temp.shut(), 'repairs')),
  ('o_split', pg_temp.line('o-split', pg_temp.open(), 'repairs')),
  ('s_del', pg_temp.line('s-del', pg_temp.shut(), 'repairs')),
  ('o_del', pg_temp.line('o-del', pg_temp.open(), 'repairs')),
  ('s_mcp', pg_temp.line('s-mcp', pg_temp.shut(), 'repairs')),
  ('o_mcp', pg_temp.line('o-mcp', pg_temp.open(), 'repairs')),
  ('s_undo', pg_temp.line('s-undo', pg_temp.shut(), 'repairs')),
  ('o_undo', pg_temp.line('o-undo', pg_temp.open(), 'repairs')),
  ('s_parts', pg_temp.line('s-parts', pg_temp.shut(), 'repairs')),
  ('o_parts', pg_temp.line('o-parts', pg_temp.open(), 'repairs')),
  ('s_merge', pg_temp.line('s-merge', pg_temp.shut(), 'cleanup')),
  ('o_merge', pg_temp.line('o-merge', pg_temp.open(), 'cleanup')),
  ('o_tidy', pg_temp.line('o-tidy', pg_temp.open(), 'tidy')),
  ('s_pending', pg_temp.line('s-pending', pg_temp.shut(), 'repairs', 'pending')),
  ('s_cash', pg_temp.line('s-cash', pg_temp.shut(), 'repairs')),
  ('s_after', pg_temp.line('s-after', pg_temp.shut(), 'repairs'));
-- A closed month's invoice not yet paid.
update public.transactions set cash_date = null, doc_kind = 'invoice', direction = 'income', category_id = pg_temp.id('rent'),
  amount_gross = 12345, amount_net = 12345
where id = pg_temp.id('s_cash');

-- An invoice from SUMIT in an open month, paid by one receipt in the closed month and one in an open
-- month, neither filed yet.
insert into bc (label, id) values
  ('inv', tests.fixture_line(pg_temp.id('co'), 'bc:inv', 50000, 'income', null, null, pg_temp.open(), 'ILS', 'posted', 'sumit',
    'project', 'invoice')),
  ('rcpt_s', tests.fixture_line(pg_temp.id('co'), 'bc:rcpt-s', 20000, 'income', null, null, pg_temp.shut(), 'ILS', 'posted', 'sumit',
    'project', 'receipt')),
  ('rcpt_o', tests.fixture_line(pg_temp.id('co'), 'bc:rcpt-o', 30000, 'income', null, null, pg_temp.open(), 'ILS', 'posted', 'sumit',
    'project', 'receipt'));
update public.transactions set external_id = 'bc-inv-1', user_assigned = false, category_assigned = false
where id = pg_temp.id('inv');
update public.transactions set linked_external_id = 'bc-inv-1', user_assigned = false, category_assigned = false
where id in (pg_temp.id('rcpt_s'), pg_temp.id('rcpt_o'));

-- A filing made through flow-mcp before the close, to undo after it.
create temp table res (label text primary key, r jsonb);
grant all on res to authenticated, service_role;
insert into res values
  ('file_s', pg_temp.mcp(format('select public.mcp_assign_expense(%L, %L::uuid, %L::uuid, %L::uuid)',
    'bc-file-s', pg_temp.id('s_undo'), pg_temp.id('maple'), pg_temp.id('supplies')))),
  ('file_o', pg_temp.mcp(format('select public.mcp_assign_expense(%L, %L::uuid, %L::uuid, %L::uuid)',
    'bc-file-o', pg_temp.id('o_undo'), pg_temp.id('maple'), pg_temp.id('supplies'))));
select is((select r->'data'->>'undo_kind' from res where label = 'file_s'), 'reassign', 'a filing before the close has its undo');

-- ---------------------------------------------------------------------------------------------
-- With no closed date nothing is refused.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try(format('select public.reassign_transaction(%L, %L, %L)', pg_temp.id('s_after'), pg_temp.id('maple'),
  pg_temp.id('supplies'))), 'ok', 'with no closed date a line dated anywhere is filed');

-- The owner closes the books through the end of month -6.
insert into res values ('close', pg_temp.mcp(format('select public.mcp_set_books_closed_through(%L, %L::date)',
  'bc-close', pg_temp.closed())));
select is((select r->>'ok' from res where label = 'close'), 'true', 'the owner closes the books');

-- ---------------------------------------------------------------------------------------------
-- An owner RPC that files.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try(format('select public.reassign_transaction(%L, %L, %L)', pg_temp.id('s_file'), pg_temp.id('maple'),
  pg_temp.id('supplies'))), pg_temp.msg(), 'reassign_transaction is refused on a closed line, with the closed date');
select is(pg_temp.cat_of('s_file'), pg_temp.id('repairs'), 'and the line keeps its category');
select is(pg_temp.try(format('select public.reassign_transaction(%L, %L, %L)', pg_temp.id('o_file'), pg_temp.id('maple'),
  pg_temp.id('supplies'))), 'ok', 'reassign_transaction files an open line');
select is(pg_temp.cat_of('o_file'), pg_temp.id('supplies'), 'which takes the new category');
select is(pg_temp.person_sql(format('update public.transactions set doc_date = %L where id = %L', pg_temp.shut(), pg_temp.id('o_file'))),
  pg_temp.msg(), 'moving an open line into the closed month is refused');

-- ---------------------------------------------------------------------------------------------
-- A split.
-- ---------------------------------------------------------------------------------------------
create or replace function pg_temp.parts()
returns jsonb language sql set search_path = '' as $$
  select jsonb_build_array(
    jsonb_build_object('category_id', pg_temp.id('repairs'), 'amount_minor', 10000),
    jsonb_build_object('category_id', pg_temp.id('supplies'), 'amount_minor', 2345));
$$;
grant execute on function pg_temp.parts() to authenticated;
select is(pg_temp.try(format('select public.save_line_split(%L, %L::jsonb)', pg_temp.id('s_split'), pg_temp.parts())),
  pg_temp.msg(), 'save_line_split is refused on a closed line');
select is((select count(*)::integer from public.legs where transaction_id = pg_temp.id('s_split') and split_part), 0,
  'and the line has no parts');
select is(pg_temp.try(format('select public.save_line_split(%L, %L::jsonb)', pg_temp.id('o_split'), pg_temp.parts())),
  'ok', 'save_line_split splits an open line');
select is((select count(*)::integer from public.legs where transaction_id = pg_temp.id('o_split') and split_part), 2,
  'into two parts');

-- ---------------------------------------------------------------------------------------------
-- A manual booking.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try(format($$select public.create_manual_line('expense', 4200, %L, 'Example Hardware', %L, %L, 'cash', null)$$,
  pg_temp.shut(), pg_temp.id('maple'), pg_temp.id('repairs'))), pg_temp.msg(), 'create_manual_line is refused in the closed month');
select is(pg_temp.try(format($$select public.create_manual_line('expense', 4200, %L, 'Example Hardware', %L, %L, 'cash', null)$$,
  pg_temp.open(), pg_temp.id('maple'), pg_temp.id('repairs'))), 'ok', 'create_manual_line books in an open month');
select is((select count(*)::integer from public.transactions where company_id = pg_temp.id('co') and amount_original = 4200), 1,
  'one manual line was booked');

-- ---------------------------------------------------------------------------------------------
-- A delete.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try(format('select public.delete_transaction(%L)', pg_temp.id('s_del'))), pg_temp.msg(),
  'delete_transaction is refused on a closed line');
select ok(exists (select 1 from public.transactions where id = pg_temp.id('s_del')), 'and the line stays');
select is(pg_temp.try(format('select public.delete_transaction(%L)', pg_temp.id('o_del'))), 'ok',
  'delete_transaction deletes an open line');

-- ---------------------------------------------------------------------------------------------
-- A bulk move: refused whole.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try(format('select public.merge_category(%L, %L)', pg_temp.id('cleanup'), pg_temp.id('supplies'))),
  pg_temp.msg(), 'merge_category is refused when a line of the category is closed');
select is(array[pg_temp.cat_of('s_merge'), pg_temp.cat_of('o_merge')], array[pg_temp.id('cleanup'), pg_temp.id('cleanup')],
  'and nothing moved, the open line included');
select is((select hidden from public.categories where id = pg_temp.id('cleanup')), false, 'and the category is not hidden');
select is(pg_temp.try(format('select public.delete_category(%L)', pg_temp.id('cleanup'))), pg_temp.msg(),
  'delete_category is refused too');
select ok(exists (select 1 from public.categories where id = pg_temp.id('cleanup')), 'and the category stays');
select is(pg_temp.try(format('select public.merge_category(%L, %L)', pg_temp.id('tidy'), pg_temp.id('supplies'))), 'ok',
  'merge_category moves a category whose lines are all open');
select is(pg_temp.cat_of('o_tidy'), pg_temp.id('supplies'), 'and its line moved');

-- ---------------------------------------------------------------------------------------------
-- An MCP tool: the refused envelope.
-- ---------------------------------------------------------------------------------------------
insert into res values
  ('mcp_s', pg_temp.mcp(format('select public.mcp_assign_expense(%L, %L::uuid, %L::uuid, %L::uuid)',
    'bc-mcp-s', pg_temp.id('s_mcp'), pg_temp.id('maple'), pg_temp.id('supplies')))),
  ('mcp_o', pg_temp.mcp(format('select public.mcp_assign_expense(%L, %L::uuid, %L::uuid, %L::uuid)',
    'bc-mcp-o', pg_temp.id('o_mcp'), pg_temp.id('maple'), pg_temp.id('supplies'))));
select is((select r->'error' from res where label = 'mcp_s'),
  jsonb_build_object('code', 'refused', 'message', pg_temp.msg()), 'assign_expense on a closed line answers refused, with the date');
select is(pg_temp.cat_of('s_mcp'), pg_temp.id('repairs'), 'and the line keeps its category');
select is((select r->>'ok' from res where label = 'mcp_o'), 'true', 'assign_expense files an open line');

-- ---------------------------------------------------------------------------------------------
-- An undo of a filing made before the close.
-- ---------------------------------------------------------------------------------------------
insert into res values
  ('undo_s', pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'bc-undo-s', 'reassign',
    (select (r->'data'->>'id')::uuid from res where label = 'file_s')))),
  ('undo_o', pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'bc-undo-o', 'reassign',
    (select (r->'data'->>'id')::uuid from res where label = 'file_o'))));
select is((select r->'error' from res where label = 'undo_s'),
  jsonb_build_object('code', 'refused', 'message', pg_temp.msg()), 'undo of a filing in the closed month answers refused');
select is(pg_temp.cat_of('s_undo'), pg_temp.id('supplies'), 'and the line keeps the filing');
select is((select r->>'ok' from res where label = 'undo_o'), 'true', 'undo of a filing in an open month goes back');
select is(pg_temp.cat_of('o_undo'), pg_temp.id('repairs'), 'to the category before');

-- ---------------------------------------------------------------------------------------------
-- A line's parts (set_line_parts), written by a person.
-- ---------------------------------------------------------------------------------------------
create or replace function pg_temp.set_parts(p_label text)
returns text language plpgsql set search_path = '' as $$
begin
  perform pg_temp.as_owner();
  reset role;
  perform private.set_line_parts(pg_temp.id('co'), pg_temp.id(p_label), pg_temp.parts());
  return 'ok';
exception when others then
  return sqlerrm;
end; $$;
select is(pg_temp.set_parts('s_parts'), pg_temp.msg(), 'set_line_parts is refused on a closed line');
select is(pg_temp.set_parts('o_parts'), 'ok', 'and writes the parts of an open line');

-- ---------------------------------------------------------------------------------------------
-- cash_date alone; a pending line; a receipt that follows its invoice.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.person_sql(format('update public.transactions set cash_date = %L where id = %L', pg_temp.open(),
  pg_temp.id('s_cash'))), 'ok', 'a closed month''s invoice is marked paid in an open month');
select is(pg_temp.person_sql(format('update public.transactions set cash_date = %L where id = %L', pg_temp.shut(),
  pg_temp.id('s_cash'))), pg_temp.msg(), 'but not paid in the closed month');
select is(pg_temp.person_sql(format('update public.transactions set category_id = %L where id = %L', pg_temp.id('supplies'),
  pg_temp.id('s_pending'))), 'ok', 'a pending line dated in the closed month is filed freely');
select is(pg_temp.person_sql(format($$update public.transactions set line_status = 'posted' where id = %L$$,
  pg_temp.id('s_pending'))), pg_temp.msg(), 'and is refused when a person posts it');

insert into bc (label, id) values ('rcpt_s_cat', pg_temp.cat_of('rcpt_s'));
select is(pg_temp.try(format('select public.reassign_transaction(%L, %L, %L)', pg_temp.id('inv'), pg_temp.id('maple'),
  pg_temp.id('rent'))), 'ok', 'filing the open invoice is not refused for its closed receipt');
select is(
  (select array_agg(coalesce(t.project_id::text, '-') || ':' || coalesce(t.category_id::text, '-') order by t.doc_date)
   from public.transactions t where t.id in (pg_temp.id('rcpt_s'), pg_temp.id('rcpt_o'))),
  array['-:' || coalesce(pg_temp.id('rcpt_s_cat')::text, '-'), pg_temp.id('maple') || ':' || pg_temp.id('rent')],
  'the closed receipt keeps its filing and the open one follows the invoice');

-- ---------------------------------------------------------------------------------------------
-- The service-role sync still writes a closed line (holding it is part 2b).
-- ---------------------------------------------------------------------------------------------
create or replace function pg_temp.sync(p_amount bigint)
returns integer language plpgsql set search_path = '' as $$
declare n integer;
begin
  perform pg_temp.nobody();
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  select (u).inserted + (u).updated into n from (select public.upsert_connector_lines(pg_temp.id('co'), 'sumit',
    jsonb_build_object('lines', jsonb_build_array(jsonb_build_object(
      'source', 'sumit', 'external_id', 'bc-sync-1', 'direction', 'expense', 'line_status', 'posted', 'doc_kind', 'expense',
      'pnl_role', 'overhead', 'currency', 'ILS', 'amount_original', p_amount, 'amount_negated', true,
      'doc_date', pg_temp.shut(), 'description', 'Example sync line',
      'vat', jsonb_build_object('amount', 0, 'status', 'unknown'), 'provider_meta', '{}'::jsonb)),
      'removed_ids', '[]'::jsonb, 'complete', false), null, null) as u) x;
  reset role;
  return n;
end; $$;
grant execute on function pg_temp.sync(bigint) to service_role;
select is(pg_temp.sync(7000), 1, 'the sync brings a new line dated in the closed month');
select is(pg_temp.sync(7100), 1, 'and changes it later');
select is((select amount_original from public.transactions where company_id = pg_temp.id('co') and external_id = 'bc-sync-1'),
  7100::bigint, 'so the closed line carries the new amount');

-- ---------------------------------------------------------------------------------------------
-- The undo of the closed date writes only the company; then nothing is refused.
-- ---------------------------------------------------------------------------------------------
insert into res values ('undo_close', pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'bc-undo-close',
  'books_closed', pg_temp.id('co'))));
select is((select r->>'ok' from res where label = 'undo_close'), 'true', 'the close is undone');
select is((select books_closed_through from public.companies where id = pg_temp.id('co')), null::date, 'so no date is set');
select is(pg_temp.try(format('select public.reassign_transaction(%L, %L, %L)', pg_temp.id('s_file'), pg_temp.id('maple'),
  pg_temp.id('supplies'))), 'ok', 'and the line refused before is filed');
select is(pg_temp.try(format('select public.merge_category(%L, %L)', pg_temp.id('cleanup'), pg_temp.id('supplies'))), 'ok',
  'and the merge refused before goes through');

select * from finish();
rollback;
