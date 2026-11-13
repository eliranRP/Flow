-- FLOW-1166 part 4 (20261113060409_review_row_undo_rules.sql; the owner's decisions of 2026-11-13).
-- A. One open review row per line: the unique index refuses a second open row; the guarded inserts
--    do nothing instead of raising; reopen_review (a skip, an approval) and undo_reassign keep the
--    newer open row as the card and leave the old one closed, and still reopen it when none is open;
--    an open split_mismatch row gives way as before.
-- B. skipped_by: resolve_review (person), transfer_mark_line (transfer), replace_sumit_connection
--    (sumit_switch); null otherwise; transfer_restore_line reopens only a transfer's skip (or an
--    unknown one), not a person's later skip.
-- C. reassign_undo.written_line: undo_reassign refuses ('line changed since') once the line changed,
--    and restores nothing; the immediate undo, a split line, a followed receipt and a sync's
--    unrelated update still undo; a sync's amount change and a person's edit do not; an undo row
--    from before keeps the old behaviour; flow-mcp gets the refusal word for word.
-- Invented names and figures, @example.com only. Dates follow current_date.

begin;

select plan(58);

do $users$
begin
  perform tests.create_supabase_user('ru_owner', 'ru-owner@example.com');
end
$users$;

create temp table ru (label text primary key, id uuid);
grant all on ru to authenticated, service_role;
create temp table res (label text primary key, r jsonb);
grant all on res to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid language sql set search_path = '' as $$ select id from pg_temp.ru where label = p_label; $$;
create or replace function pg_temp.day()
returns date language sql set search_path = '' as $$ select (date_trunc('month', current_date) - interval '2 months')::date + 9; $$;

-- A bank line and a SUMIT document as the engines send them.
create or replace function pg_temp.ml(p_ext text, p_amount bigint, p_note text default '')
returns jsonb language sql set search_path = '' as $$
  select jsonb_build_object(
    'source', 'mercury', 'external_id', p_ext, 'direction', 'expense', 'line_status', 'posted', 'doc_kind', 'expense',
    'pnl_role', 'overhead', 'currency', 'USD', 'amount_original', p_amount, 'amount_negated', true,
    'doc_date', pg_temp.day(), 'description', 'Example bank line ' || p_ext || p_note,
    'vat', jsonb_build_object('amount', 0, 'status', 'unknown'), 'provider_meta', '{}'::jsonb);
$$;
create or replace function pg_temp.sl(p_ext text, p_amount bigint)
returns jsonb language sql set search_path = '' as $$
  select jsonb_build_object(
    'source', 'sumit', 'external_id', p_ext, 'direction', 'expense', 'line_status', 'posted', 'doc_kind', 'expense',
    'pnl_role', 'overhead', 'currency', 'ILS', 'amount_original', p_amount, 'amount_negated', true,
    'doc_date', pg_temp.day(), 'description', 'Example document ' || p_ext,
    'vat', jsonb_build_object('amount', 0, 'status', 'unknown'), 'provider_meta', '{}'::jsonb);
$$;

create or replace function pg_temp.as_service()
returns void language plpgsql set search_path = '' as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
end; $$;
-- One sync run, and one queue run, as the service role.
create or replace function pg_temp.run(p_provider text, p_lines jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_service();
  r := to_jsonb(public.upsert_connector_lines(pg_temp.id('co'), p_provider::public.connector_provider,
    jsonb_build_object('lines', p_lines, 'removed_ids', '[]'::jsonb, 'complete', false), null, null));
  reset role;
  return r;
end; $$;
create or replace function pg_temp.queue()
returns integer language plpgsql set search_path = '' as $$
declare n integer;
begin
  perform pg_temp.as_service();
  n := public.sync_review_queue(pg_temp.id('co'));
  reset role;
  return n;
end; $$;

-- The owner, as the app or as flow-mcp; a raised error comes back as its message.
create or replace function pg_temp.as_owner()
returns void language plpgsql set search_path = '' as $$
declare
  uid uuid := tests.get_supabase_uid('ru_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1',
    'mcp_tid', pg_temp.id('tok'))::text, true);
end; $$;
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
create or replace function pg_temp.ask(p_sql text)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_owner();
  execute p_sql into r;
  reset role;
  return r;
end; $$;

create or replace function pg_temp.line(p_ext text)
returns public.transactions language sql set search_path = '' as $$
  select t.* from public.transactions t where t.company_id = pg_temp.id('co') and t.external_id = p_ext;
$$;
-- A review row as 'status:skipped_by'.
create or replace function pg_temp.row(p_id uuid)
returns text language sql set search_path = '' as $$
  select q.status::text || ':' || coalesce(q.skipped_by, '-')
  from public.review_queue q where q.id = p_id;
$$;
create or replace function pg_temp.open_row(p_ext text)
returns uuid language sql set search_path = '' as $$
  select q.id from public.review_queue q where q.transaction_id = (pg_temp.line(p_ext)).id and q.status = 'open';
$$;
create or replace function pg_temp.open_count(p_ext text)
returns integer language sql set search_path = '' as $$
  select count(*)::integer from public.review_queue q where q.transaction_id = (pg_temp.line(p_ext)).id and q.status = 'open';
$$;
-- A newer open row of a line, as a later write would queue it (the old one is closed).
create or replace function pg_temp.newer(p_ext text)
returns uuid language sql set search_path = '' as $$
  insert into public.review_queue (company_id, transaction_id, status, reason)
  values (pg_temp.id('co'), (pg_temp.line(p_ext)).id, 'open', 'suggested') returning id;
$$;
-- The line's filing as 'project:category:role'.
create or replace function pg_temp.filing(p_ext text)
returns text language sql set search_path = '' as $$
  select coalesce((select label from pg_temp.ru where id = t.project_id), '-') || ':'
    || coalesce((select label from pg_temp.ru where id = t.category_id), '-') || ':' || coalesce(t.pnl_role::text, '-')
  from public.transactions t where t.id = (pg_temp.line(p_ext)).id;
$$;
create or replace function pg_temp.file(p_ext text, p_project text, p_category text)
returns uuid language sql set search_path = '' as $$
  select (pg_temp.ask(format('select to_jsonb(public.reassign_transaction(%L, %L, %L))',
    (pg_temp.line(p_ext)).id, pg_temp.id(p_project), pg_temp.id(p_category))) #>> '{}')::uuid;
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

insert into ru (label, id) values ('co', tests.fixture_company('ru_owner', 'Example Review Rows Co'));
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('ru_owner'), pg_temp.id('co'), 'hash-ru-owner-0001', 'pepper-1',
  array['read', 'write'], now() + interval '90 days');
insert into ru (label, id) select 'tok', id from private.mcp_credentials where token_hash = 'hash-ru-owner-0001';
insert into ru (label, id) values
  ('repairs', tests.fixture_category(pg_temp.id('co'), 'Example repairs', 'expense')),
  ('supplies', tests.fixture_category(pg_temp.id('co'), 'Example supplies', 'expense')),
  ('works', tests.fixture_category(pg_temp.id('co'), 'Example works in', 'income')),
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example Oak house')),
  ('barn', tests.fixture_project(pg_temp.id('co'), 'Example Elm barn'));

insert into res values ('first', pg_temp.run('mercury', (select jsonb_agg(pg_temp.ml('m-' || n, 1000 + n)) from generate_series(1, 12) n)));

-- ---------------------------------------------------------------------------------------------
-- A. One open row per line
-- ---------------------------------------------------------------------------------------------
select is(
  (select i.indisunique::text || ':' || pg_get_indexdef(i.indexrelid) from pg_index i
   where i.indexrelid = 'public.review_queue_open_line_key'::regclass),
  'true:CREATE UNIQUE INDEX review_queue_open_line_key ON public.review_queue USING btree (transaction_id) WHERE (status = ''open''::review_status)',
  'the open rows are unique per line');
select is(to_regclass('public.review_queue_open_idx'), null, 'and the old open-row index is gone, not kept beside it');

select is((select count(*)::integer from public.review_queue q where q.company_id = pg_temp.id('co') and q.status = 'open'), 12,
  'the sync queues each new line with one open row');
select is(pg_temp.queue(), 0, 'another queue run opens none and does not fail');
select is((select count(*)::integer from public.review_queue q where q.company_id = pg_temp.id('co') and q.status = 'open'), 12,
  'each line still has one open row');

select throws_ok(
  format($$insert into public.review_queue (company_id, transaction_id, status, reason) values (%L, %L, 'open', 'suggested')$$,
    pg_temp.id('co'), (pg_temp.line('m-1')).id),
  '23505', 'duplicate key value violates unique constraint "review_queue_open_line_key"',
  'a second open row for a line is refused');
-- A guarded insert that lost a race (its "no open row" check passed before the other run wrote) does nothing.
select lives_ok(
  format($$insert into public.review_queue (company_id, transaction_id, status, reason) values (%L, %L, 'open', 'suggested')
    on conflict (transaction_id) where status = 'open' do nothing$$, pg_temp.id('co'), (pg_temp.line('m-1')).id),
  'the writers'' insert, with the open row already there, does nothing instead of raising');
select is(pg_temp.open_count('m-1'), 1, 'and the line keeps its one open row');
select is(
  (select array_agg(p.proname::text || ':' || ((length(pg_get_functiondef(p.oid))
     - length(replace(pg_get_functiondef(p.oid), 'on conflict (transaction_id) where status = ''open'' do nothing', '')))
     / length('on conflict (transaction_id) where status = ''open'' do nothing'))::text order by p.proname)
   from pg_proc p
   where p.proname in ('sync_review_queue', 'forecast_line_sync', 'line_split_review_sync', 'undo_held_change_left',
     'delete_category', 'set_transaction_category')),
  array['delete_category:1', 'forecast_line_sync:1', 'line_split_review_sync:1', 'set_transaction_category:2',
    'sync_review_queue:3', 'undo_held_change_left:1'],
  'every insert of an open row by a writer does nothing on a conflict');

-- reopen_review of a skip: a newer open row stays the card, the skip stays.
insert into ru (label, id) values ('r1', pg_temp.open_row('m-1')), ('r2', pg_temp.open_row('m-2'));
select is(pg_temp.try(format('select public.resolve_review(%L, %L)', pg_temp.id('r1'), 'skipped')), 'ok', 'the owner skips m-1');
select is(pg_temp.row(pg_temp.id('r1')), 'skipped:person', 'a person''s skip says so');
insert into res values ('m1_changed', pg_temp.run('mercury', jsonb_build_array(pg_temp.ml('m-1', 1001, ' (corrected)'))));
insert into ru (label, id) values ('r1b', pg_temp.open_row('m-1'));
select isnt(pg_temp.id('r1b'), pg_temp.id('r1'), 'the bank corrects m-1''s document, so the sync opens a newer row');
select is(pg_temp.try(format('select public.reopen_review(%L)', pg_temp.id('r1'))), 'ok',
  'reopening the old skip succeeds');
select is(pg_temp.row(pg_temp.id('r1')) || ',' || pg_temp.row(pg_temp.id('r1b')) || ',' || pg_temp.open_count('m-1'),
  'skipped:person,open:-,1', 'the old row stays skipped and the newer row is the card');
-- With no newer row it reopens, and the skip's kind goes.
select is(pg_temp.try(format('select public.resolve_review(%L, %L)', pg_temp.id('r2'), 'skipped')), 'ok', 'the owner skips m-2');
select is(pg_temp.try(format('select public.reopen_review(%L)', pg_temp.id('r2'))), 'ok', 'and reopens it');
select is(pg_temp.row(pg_temp.id('r2')), 'open:-', 'the skip reopens with no kind');

-- reopen_review of an approval: the filing comes back either way; the row reopens only with no newer one.
insert into ru (label, id) values ('r3', pg_temp.open_row('m-3')), ('r4', pg_temp.open_row('m-4'));
select is(pg_temp.try(format('select public.resolve_review(%L, %L, %L, %L)', pg_temp.id('r3'), 'approved',
  pg_temp.id('house'), pg_temp.id('repairs'))), 'ok', 'the owner approves m-3 onto the house');
select is(pg_temp.row(pg_temp.id('r3')), 'approved:-', 'an approval has no skip kind');
insert into ru (label, id) values ('r3b', pg_temp.newer('m-3'));
select is(pg_temp.try(format('select public.reopen_review(%L)', pg_temp.id('r3'))), 'ok', 'reopening the approval succeeds');
select is(pg_temp.filing('m-3') || ',' || pg_temp.row(pg_temp.id('r3')) || ',' || pg_temp.row(pg_temp.id('r3b')),
  '-:-:overhead,approved:-,open:-',
  'the line is as before the approval, the approval stays closed and the newer row is the card');
select is(pg_temp.try(format('select public.resolve_review(%L, %L, %L, %L)', pg_temp.id('r4'), 'approved',
  pg_temp.id('house'), pg_temp.id('repairs'))), 'ok', 'the owner approves m-4');
select is(pg_temp.try(format('select public.reopen_review(%L)', pg_temp.id('r4'))) || ':' || pg_temp.row(pg_temp.id('r4')),
  'ok:open:-', 'with no newer row the approval reopens');

-- undo_reassign: the same rule for the filing's 'changed' row.
insert into ru (label, id) values ('r5', pg_temp.open_row('m-5')), ('r6', pg_temp.open_row('m-6'));
insert into ru (label, id) values ('u5', pg_temp.file('m-5', 'house', 'repairs'));
insert into ru (label, id) values ('r5b', pg_temp.newer('m-5'));
select is(pg_temp.try(format('select public.undo_reassign(%L)', pg_temp.id('u5'))), 'ok', 'the undo of m-5''s filing succeeds');
select is(pg_temp.filing('m-5') || ',' || pg_temp.row(pg_temp.id('r5')) || ',' || pg_temp.row(pg_temp.id('r5b')),
  '-:-:overhead,changed:-,open:-',
  'the line is as before, the changed row stays closed and the newer row is the card');
insert into ru (label, id) values ('u6', pg_temp.file('m-6', 'house', 'repairs'));
select is(pg_temp.row(pg_temp.id('r6')), 'changed:-', 'a filing closes m-6''s row as changed');
select is(pg_temp.try(format('select public.undo_reassign(%L)', pg_temp.id('u6'))) || ':' || pg_temp.row(pg_temp.id('r6')),
  'ok:open:-', 'with no newer row the immediate undo reopens it, as before');

-- An open split_mismatch row gives way to a row that comes back, as before.
insert into ru (label, id) values ('r7', pg_temp.open_row('m-7'));
select is(pg_temp.try(format('select public.resolve_review(%L, %L)', pg_temp.id('r7'), 'skipped')), 'ok', 'the owner skips m-7');
select tests.line_split((pg_temp.line('m-7')).id, jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('repairs'), 'project_id', pg_temp.id('house'), 'amount_minor', 300, 'gross_up', false)));
select private.line_split_review_sync((pg_temp.line('m-7')).id);
select is((select q.reason from public.review_queue q where q.id = pg_temp.open_row('m-7')), 'split_mismatch',
  'a split that does not make the line opens split_mismatch');
select is(pg_temp.try(format('select public.reopen_review(%L)', pg_temp.id('r7'))) || ':' || pg_temp.row(pg_temp.id('r7'))
  || ':' || pg_temp.open_count('m-7'), 'ok:open:-:1', 'the reopened skip holds the line, and split_mismatch goes');

-- ---------------------------------------------------------------------------------------------
-- B. skipped_by
-- ---------------------------------------------------------------------------------------------
select throws_ok(
  format($$update public.review_queue set skipped_by = 'person' where id = %L$$, pg_temp.id('r7')),
  '23514', 'new row for relation "review_queue" violates check constraint "review_queue_skipped_by_chk"',
  'a row that is not skipped has no skip kind');
select throws_ok(
  format($$insert into public.review_queue (company_id, transaction_id, status, reason, resolved_at, skipped_by)
    values (%L, %L, 'skipped', null, now(), 'example')$$, pg_temp.id('co'), (pg_temp.line('m-7')).id),
  '23514', 'new row for relation "review_queue" violates check constraint "review_queue_skipped_by_chk"',
  'a skip kind the code does not write is refused');
select lives_ok(
  format($$insert into public.review_queue (company_id, transaction_id, status, reason, resolved_at)
    values (%L, %L, 'skipped', null, now())$$, pg_temp.id('co'), (pg_temp.line('m-7')).id),
  'a skip of unknown kind (as every skip before this change) goes in');

-- A transfer match skips with its kind; its undo reopens that row and clears it.
insert into ru (label, id) values ('r8', pg_temp.open_row('m-8'));
insert into res values ('mark8', private.transfer_mark_line(pg_temp.id('co'), (pg_temp.line('m-8')).id));
select is(pg_temp.row(pg_temp.id('r8')), 'skipped:transfer', 'a transfer match''s skip says so');
select private.transfer_restore_line(pg_temp.id('co'), (select r from res where label = 'mark8'));
select is(pg_temp.row(pg_temp.id('r8')), 'open:-', 'the match''s undo reopens it with no kind');
-- A person skipped it again after reopening it: the match's undo leaves that skip.
insert into res values ('mark8b', private.transfer_mark_line(pg_temp.id('co'), (pg_temp.line('m-8')).id));
select is(pg_temp.try(format('select public.reopen_review(%L)', pg_temp.id('r8'))), 'ok', 'the owner reopens the matched line''s card');
select is(pg_temp.try(format('select public.resolve_review(%L, %L)', pg_temp.id('r8'), 'skipped')), 'ok', 'and skips it');
select private.transfer_restore_line(pg_temp.id('co'), (select r from res where label = 'mark8b'));
select is(pg_temp.row(pg_temp.id('r8')), 'skipped:person', 'the match''s undo leaves a person''s later skip');
-- A skip from before skipped_by (null) is the match's, as before.
update public.review_queue set skipped_by = null where id = pg_temp.id('r8');
select private.transfer_restore_line(pg_temp.id('co'), (select r from res where label = 'mark8b'));
select is(pg_temp.row(pg_temp.id('r8')), 'open:-', 'a skip of unknown kind comes back, as before');

-- A SUMIT company switch skips the old company's open rows with its kind.
update public.companies set last_sumit_company_id = 111 where id = pg_temp.id('co');
insert into res values ('sumit', pg_temp.run('sumit', jsonb_build_array(pg_temp.sl('s-1', 7100))));
select is(pg_temp.open_count('s-1'), 1, 'the SUMIT document waits in the queue');
insert into ru (label, id) values ('rs', pg_temp.open_row('s-1'));
select pg_temp.as_service();
select public.replace_sumit_connection(pg_temp.id('co'), 222, 'aa', 'aa', 'aa', 'aa', '1', '2', true);
reset role;
select is(pg_temp.row(pg_temp.id('rs')), 'skipped:sumit_switch', 'the switch''s skip says so');

-- ---------------------------------------------------------------------------------------------
-- C. A late undo of a filing
-- ---------------------------------------------------------------------------------------------
insert into ru (label, id) values ('u9', pg_temp.file('m-9', 'house', 'repairs'));
select is((select u.written_line from public.reassign_undo u where u.id = pg_temp.id('u9')),
  private.reassign_line_state(pg_temp.id('co'), (pg_temp.line('m-9')).id), 'the undo row keeps the line as the filing left it');
select is(pg_temp.try(format('select public.set_transaction_category(%L, %L, false)', (pg_temp.line('m-9')).id, pg_temp.id('supplies'))),
  'ok', 'the owner then changes the category');
select is(pg_temp.try(format('select public.undo_reassign(%L)', pg_temp.id('u9'))), 'line changed since',
  'the older undo is refused');
select is(pg_temp.filing('m-9') || ':' || ((select u.undone_at from public.reassign_undo u where u.id = pg_temp.id('u9')) is null)::text,
  'house:supplies:project:true', 'the owner''s edit stays and the undo stays unused');

-- A sync's update of a column the undo does not restore does not block it.
insert into ru (label, id) values ('u10', pg_temp.file('m-10', 'house', 'repairs'));
insert into res values ('m10_note', pg_temp.run('mercury', jsonb_build_array(pg_temp.ml('m-10', 1010, ' (memo)'))));
select is((pg_temp.line('m-10')).description, 'Example bank line m-10 (memo)', 'the sync rewrote the line''s description');
select is(pg_temp.try(format('select public.undo_reassign(%L)', pg_temp.id('u10'))) || ':' || pg_temp.filing('m-10'),
  'ok:-:-:overhead', 'the undo still runs');
-- One that changes a restored column (the amount moves the allocation) does.
insert into ru (label, id) values ('u11', pg_temp.file('m-11', 'house', 'repairs'));
insert into res values ('m11_amount', pg_temp.run('mercury', jsonb_build_array(pg_temp.ml('m-11', 2011))));
select is(pg_temp.try(format('select public.undo_reassign(%L)', pg_temp.id('u11'))) || ':' || pg_temp.filing('m-11'),
  'line changed since:house:repairs:project', 'a sync''s new amount on the filed line blocks the undo');

-- An undo row from before this change has no written_line: it undoes as before.
insert into ru (label, id) values ('u12', pg_temp.file('m-12', 'house', 'repairs'));
update public.reassign_undo set written_line = null where id = pg_temp.id('u12');
select is(pg_temp.try(format('select public.set_transaction_category(%L, %L, false)', (pg_temp.line('m-12')).id, pg_temp.id('supplies'))),
  'ok', 'the owner changes m-12''s category');
select is(pg_temp.try(format('select public.undo_reassign(%L)', pg_temp.id('u12'))) || ':' || pg_temp.filing('m-12'),
  'ok:-:-:overhead', 'an undo row from before puts the old filing back, as it did');

-- A split line: collapsing it to one project, then the immediate undo.
insert into ru (label, id) values ('split', tests.fixture_line(pg_temp.id('co'), 'ru:split', 1000, p_category => pg_temp.id('repairs')));
-- Split over two projects as the split sheet stores it.
update public.transactions set pnl_role = 'shared', project_id = null where id = pg_temp.id('split');
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net) values
  (pg_temp.id('co'), pg_temp.id('split'), pg_temp.id('house'), 6000, -600),
  (pg_temp.id('co'), pg_temp.id('split'), pg_temp.id('barn'), 4000, -400);
select is((select count(*)::integer from public.allocations a where a.transaction_id = pg_temp.id('split')), 2,
  'the line is split over two projects');
insert into ru (label, id) select 'u13', (pg_temp.ask(format('select to_jsonb(public.collapse_split(%L, %L))',
  pg_temp.id('split'), pg_temp.id('house'))) #>> '{}')::uuid;
select is(pg_temp.try(format('select public.undo_reassign(%L)', pg_temp.id('u13'))), 'ok', 'the collapse is undone at once');
select is((select string_agg(a.share_bp::text, ',' order by a.share_bp) from public.allocations a where a.transaction_id = pg_temp.id('split'))
  || ':' || (select t.pnl_role::text from public.transactions t where t.id = pg_temp.id('split')),
  '4000,6000:shared', 'and the split is back');

-- A filing whose invoice moved its paired receipt: the pair's writes are the filing's, not a later edit.
insert into ru (label, id)
select 'inv', id from (select tests.fixture_line(pg_temp.id('co'), 'ru:inv', 5000, 'income', p_category => pg_temp.id('works'),
  p_doc_kind => 'invoice', p_source => 'sumit', p_pnl_role => null) id) x;
update public.transactions set external_id = 'ru-ext-inv', project_id = null, user_assigned = false, category_assigned = false
where id = pg_temp.id('inv');
insert into ru (label, id)
select 'rec', id from (select tests.fixture_line(pg_temp.id('co'), 'ru:rec', 5000, 'income',
  p_doc_kind => 'receipt', p_source => 'sumit', p_pnl_role => null) id) x;
update public.transactions set external_id = 'ru-ext-rec', linked_external_id = 'ru-ext-inv', user_assigned = false,
  category_assigned = false
where id = pg_temp.id('rec');
insert into ru (label, id) select 'u14', (pg_temp.ask(format('select to_jsonb(public.reassign_transaction(%L, %L, %L))',
  pg_temp.id('inv'), pg_temp.id('barn'), pg_temp.id('works'))) #>> '{}')::uuid;
select is((select t.project_id from public.transactions t where t.id = pg_temp.id('rec')), pg_temp.id('barn'),
  'filing the invoice moves its receipt with it');
select is(pg_temp.try(format('select public.undo_reassign(%L)', pg_temp.id('u14'))) || ':'
  || pg_temp.filing('ru-ext-inv'), 'ok:-:works:-', 'the immediate undo of the invoice''s filing runs');

-- flow-mcp: undo of a reassign gets the refusal word for word.
insert into ru (label, id) values ('mcp', tests.fixture_line(pg_temp.id('co'), 'ru:mcp', 2000, p_category => pg_temp.id('repairs')));
insert into res values ('mcp_assign', pg_temp.ask(format('select public.mcp_assign_expense(%L, %L, %L, %L)',
  'ru-assign-1', pg_temp.id('mcp'), pg_temp.id('barn'), pg_temp.id('repairs'))));
select is((select r #>> '{data,undo_kind}' from res where label = 'mcp_assign'), 'reassign', 'the assistant files a line');
-- Another writer changes only the owner's flag, which flow-mcp's own check does not read.
update public.transactions set category_assigned = not category_assigned where id = pg_temp.id('mcp');
insert into res values ('mcp_undo', pg_temp.ask(format('select public.mcp_undo(%L, %L, %L::uuid)',
  'ru-undo-1', 'reassign', (select r #>> '{data,id}' from res where label = 'mcp_assign'))));
select is((select r from res where label = 'mcp_undo'),
  '{"ok": false, "error": {"code": "conflict", "message": "line changed since"}}'::jsonb,
  'the assistant''s undo is a conflict that says the line changed since');
select is((select t.project_id from public.transactions t where t.id = pg_temp.id('mcp')), pg_temp.id('barn'),
  'and the line keeps its filing');

select * from finish();
rollback;
