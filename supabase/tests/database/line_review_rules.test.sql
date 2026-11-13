-- FLOW-1166 part 3 (decision 0266): the last column rules that every writer already keeps
-- (20261112213714_line_review_rules.sql). The four CHECKs part 1 added NOT VALID are validated. On
-- transactions, a void line is removed (transactions_void_removed_chk; a removed line need not be
-- void) and a suggested category is never the owner's (transactions_suggested_chk). On review_queue,
-- an open row has no resolution time and a closed one has it (review_queue_resolved_chk), and the
-- reason is one the code writes, or none (review_queue_reason_chk). Each rule refuses the meaningless
-- row written directly, and each writer's row still goes in: the sync's void (fetched, by removed id,
-- sent again), the SUMIT sweep and its revival, replace_sumit_connection, a held void and a held
-- removal replayed, the trigger's suggested category and the owner's pick, sync_review_queue,
-- resolve_review (approve, skip), reopen_review, reassign_transaction / undo_reassign,
-- leave_held_change and mcp_undo held_change_left.
-- Invented names and figures, @example.com only. Dates follow current_date.

begin;

select plan(50);

do $users$
begin
  perform tests.create_supabase_user('lr_owner', 'lr-owner@example.com');
end
$users$;

create temp table lr (label text primary key, id uuid);
grant all on lr to authenticated, service_role;
create temp table res (label text primary key, r jsonb);
grant all on res to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid language sql set search_path = '' as $$ select id from pg_temp.lr where label = p_label; $$;

-- The first day of the month k months from this one; the closed date is the last day of month -6.
create or replace function pg_temp.m1(k integer)
returns date language sql set search_path = '' as $$
  select (date_trunc('month', current_date) + make_interval(months => k))::date;
$$;
create or replace function pg_temp.shut()
returns date language sql set search_path = '' as $$ select pg_temp.m1(-6) + 9; $$;
create or replace function pg_temp.open()
returns date language sql set search_path = '' as $$ select pg_temp.m1(-3) + 9; $$;

-- A bank line and a SUMIT document as the engines send them.
create or replace function pg_temp.ml(p_ext text, p_amount bigint, p_date date, p_status text default 'posted')
returns jsonb language sql set search_path = '' as $$
  select jsonb_build_object(
    'source', 'mercury', 'external_id', p_ext, 'direction', 'expense', 'line_status', p_status, 'doc_kind', 'expense',
    'pnl_role', 'overhead', 'currency', 'USD', 'amount_original', p_amount, 'amount_negated', true,
    'doc_date', p_date, 'description', 'Example bank line ' || p_ext,
    'vat', jsonb_build_object('amount', 0, 'status', 'unknown'), 'provider_meta', '{}'::jsonb);
$$;
create or replace function pg_temp.sl(p_ext text, p_amount bigint, p_date date)
returns jsonb language sql set search_path = '' as $$
  select jsonb_build_object(
    'source', 'sumit', 'external_id', p_ext, 'direction', 'expense', 'line_status', 'posted', 'doc_kind', 'expense',
    'pnl_role', 'overhead', 'currency', 'ILS', 'amount_original', p_amount, 'amount_negated', true,
    'doc_date', p_date, 'description', 'Example document ' || p_ext,
    'vat', jsonb_build_object('amount', 0, 'status', 'unknown'), 'provider_meta', '{}'::jsonb);
$$;

-- One statement as the service role.
create or replace function pg_temp.svc(p_sql text)
returns void language plpgsql set search_path = '' as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  execute p_sql;
  reset role;
end; $$;

-- One sync run as the service role: its result as json.
create or replace function pg_temp.run(p_provider text, p_lines jsonb, p_removed jsonb default '[]'::jsonb,
  p_complete boolean default false)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  set local role service_role;
  r := to_jsonb(public.upsert_connector_lines(pg_temp.id('co'), p_provider::public.connector_provider,
    jsonb_build_object('lines', p_lines, 'removed_ids', p_removed, 'complete', p_complete), null, null));
  reset role;
  return r;
end; $$;

-- The owner, as the app or as flow-mcp; a raised error comes back as its message.
create or replace function pg_temp.as_owner()
returns void language plpgsql set search_path = '' as $$
declare
  uid uuid := tests.get_supabase_uid('lr_owner');
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
-- A line's status and whether it is removed, as 'posted:false'.
create or replace function pg_temp.state(p_ext text)
returns text language sql set search_path = '' as $$
  select (pg_temp.line(p_ext)).line_status::text || ':' || ((pg_temp.line(p_ext)).removed_at is not null)::text;
$$;
-- A review row's status, whether it has its resolution time and its reason, as 'open:false:suggested'.
create or replace function pg_temp.row(p_id uuid)
returns text language sql set search_path = '' as $$
  select q.status::text || ':' || (q.resolved_at is not null)::text || ':' || coalesce(q.reason, '-')
  from public.review_queue q where q.id = p_id;
$$;
-- The line's newest review row.
create or replace function pg_temp.review_of(p_ext text)
returns uuid language sql set search_path = '' as $$
  select q.id from public.review_queue q
  where q.transaction_id = (pg_temp.line(p_ext)).id
  order by q.created_at desc, (q.status = 'open') desc limit 1;
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- The company, a category, a project and a flow-mcp credential.
insert into lr (label, id) values ('co', tests.fixture_company('lr_owner', 'Example Line Rules Co'));
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('lr_owner'), pg_temp.id('co'), 'hash-lr-owner-0001', 'pepper-1',
  array['read', 'write'], now() + interval '90 days');
insert into lr (label, id) select 'tok', id from private.mcp_credentials where token_hash = 'hash-lr-owner-0001';
insert into lr (label, id) values
  ('repairs', tests.fixture_category(pg_temp.id('co'), 'Example repairs', 'expense')),
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example Oak house'));

-- ---------------------------------------------------------------------------------------------
-- transactions_suggested_chk: a suggested category is never the owner's. The insert and update
-- trigger fill_suggested_category already clears the flag on every write, so the CHECK is shown
-- with that trigger off, before anything else in this test queues a deferred trigger event (the
-- table cannot be altered while one waits).
-- ---------------------------------------------------------------------------------------------
insert into lr (label, id) values ('own', tests.fixture_line(pg_temp.id('co'), 'lr:own', 100, p_category => pg_temp.id('repairs')));
alter table public.transactions disable trigger transactions_fill_category;
select throws_ok(
  format($$insert into public.transactions (company_id, direction, doc_kind, amount_gross, amount_net,
    amount_original, vat_amount, vat_status, doc_date, source, idempotency_key, category_id,
    category_suggested, user_assigned)
    values (%L, 'expense', 'receipt', -100, -100, 100, 0, 'source', %L, 'manual', 'lr:suggested-own', %L, true, true)$$,
    pg_temp.id('co'), pg_temp.open(), pg_temp.id('repairs')),
  '23514', 'new row for relation "transactions" violates check constraint "transactions_suggested_chk"',
  'a line filed by the owner cannot also hold a suggested category');
select throws_ok(
  format($$update public.transactions set category_suggested = true, category_assigned = true
    where id = %L$$, pg_temp.id('own')),
  '23514', 'new row for relation "transactions" violates check constraint "transactions_suggested_chk"',
  'a category the owner picked cannot also be a suggestion');
alter table public.transactions enable trigger transactions_fill_category;

-- ---------------------------------------------------------------------------------------------
-- Part 1's four CHECKs are validated, and the new ones are added validated.
-- ---------------------------------------------------------------------------------------------
select is(
  (select array_agg(c.conname::text || ':' || c.convalidated::text order by c.conname) from pg_constraint c
   where c.conname in ('loans_refinance_chk', 'projects_finished_chk', 'prepaid_schedules_ended_chk',
     'company_invites_decided_chk', 'transactions_void_removed_chk', 'transactions_suggested_chk',
     'review_queue_resolved_chk', 'review_queue_reason_chk')),
  array['company_invites_decided_chk:true', 'loans_refinance_chk:true', 'prepaid_schedules_ended_chk:true',
    'projects_finished_chk:true', 'review_queue_reason_chk:true', 'review_queue_resolved_chk:true',
    'transactions_suggested_chk:true', 'transactions_void_removed_chk:true'],
  'every column rule of FLOW-1166 is a validated CHECK');

-- ---------------------------------------------------------------------------------------------
-- transactions_void_removed_chk: a void line is removed.
-- ---------------------------------------------------------------------------------------------
select throws_ok(
  format($$insert into public.transactions (company_id, direction, doc_kind, line_status, amount_gross, amount_net,
    amount_original, vat_amount, vat_status, doc_date, source, idempotency_key)
    values (%L, 'expense', 'receipt', 'void', -100, -100, 100, 0, 'source', %L, 'manual', 'lr:void-live')$$,
    pg_temp.id('co'), pg_temp.open()),
  '23514', 'new row for relation "transactions" violates check constraint "transactions_void_removed_chk"',
  'a void line with no removal time cannot be inserted');

insert into res values ('first', pg_temp.run('mercury', jsonb_build_array(
  pg_temp.ml('m-1', 1100, pg_temp.open()), pg_temp.ml('m-2', 1200, pg_temp.open()),
  pg_temp.ml('m-3', 1300, pg_temp.open()), pg_temp.ml('m-4', 1400, pg_temp.open()),
  pg_temp.ml('m-new-void', 1500, pg_temp.open(), 'void'),
  pg_temp.ml('m-held', 1600, pg_temp.shut()))));
select is((select (r->>'inserted')::integer from res where label = 'first'), 5,
  'the first sync stores six lines, five of them new');

select throws_ok(
  format($$update public.transactions set line_status = 'void' where id = %L$$, (pg_temp.line('m-1')).id),
  '23514', 'new row for relation "transactions" violates check constraint "transactions_void_removed_chk"',
  'a live line cannot be made void without its removal time');
select lives_ok(
  format($$update public.transactions set removed_at = now() where id = %L$$, (pg_temp.line('m-4')).id),
  'a posted line can be removed without being void (the SUMIT sweep''s row)');
select is(pg_temp.state('m-new-void'), 'void:true', 'the sync stores a line first seen as void removed');

insert into res values ('void', pg_temp.run('mercury', '[]'::jsonb, '["m-1"]'::jsonb));
select is(pg_temp.state('m-1'), 'void:true', 'the sync''s void by removed id removes the line');
select throws_ok(
  format($$update public.transactions set removed_at = null where id = %L$$, (pg_temp.line('m-1')).id),
  '23514', 'new row for relation "transactions" violates check constraint "transactions_void_removed_chk"',
  'a void line cannot be brought back without leaving void');
insert into res values ('again', pg_temp.run('mercury', jsonb_build_array(pg_temp.ml('m-1', 1150, pg_temp.open()))));
select is(pg_temp.state('m-1') || ':' || (pg_temp.line('m-1')).amount_original, 'void:true:1150',
  'a void line the bank sends again stays void and removed, with the new amount');
insert into res values ('again_void', pg_temp.run('mercury', jsonb_build_array(
  pg_temp.ml('m-2', 1200, pg_temp.open(), 'void'))));
select is(pg_temp.state('m-2'), 'void:true', 'a live line the bank sends as void is removed with it');

-- The SUMIT sweep removes without void, and a document sent again comes back.
insert into res values ('sumit_first', pg_temp.run('sumit', jsonb_build_array(
  pg_temp.sl('s-1', 7100, pg_temp.open()), pg_temp.sl('s-2', 7200, pg_temp.open()),
  pg_temp.sl('s-3', 7300, pg_temp.open()), pg_temp.sl('s-held', 7400, pg_temp.shut())), '[]'::jsonb, true));
insert into res values ('sweep', pg_temp.run('sumit', jsonb_build_array(
  pg_temp.sl('s-1', 7100, pg_temp.open()), pg_temp.sl('s-3', 7300, pg_temp.open()),
  pg_temp.sl('s-held', 7400, pg_temp.shut())), '[]'::jsonb, true));
select is(pg_temp.state('s-2'), 'posted:true', 'the SUMIT sweep removes a document without voiding it');
insert into res values ('back', pg_temp.run('sumit', jsonb_build_array(
  pg_temp.sl('s-1', 7100, pg_temp.open()), pg_temp.sl('s-2', 7200, pg_temp.open()),
  pg_temp.sl('s-3', 7300, pg_temp.open()), pg_temp.sl('s-held', 7400, pg_temp.shut())), '[]'::jsonb, true));
select is(pg_temp.state('s-2'), 'posted:false', 'a swept document sent again comes back');

-- A void and a removal held in a closed period, replayed once the date moves back.
update public.companies set books_closed_through = pg_temp.m1(-5) - 1 where id = pg_temp.id('co');
insert into res values ('held_void', pg_temp.run('mercury', '[]'::jsonb, '["m-held"]'::jsonb));
insert into res values ('held_remove', pg_temp.run('sumit', jsonb_build_array(
  pg_temp.sl('s-1', 7100, pg_temp.open()), pg_temp.sl('s-2', 7200, pg_temp.open()),
  pg_temp.sl('s-3', 7300, pg_temp.open())), '[]'::jsonb, true));
select is(pg_temp.state('m-held') || ',' || pg_temp.state('s-held')
  || ':' || (select count(*) from private.closed_line_holds h where h.company_id = pg_temp.id('co')),
  'posted:false,posted:false:2', 'a void and a removal in the closed period are held, the lines unchanged');
update public.companies set books_closed_through = pg_temp.m1(-9) where id = pg_temp.id('co');
insert into res values ('replay_void', pg_temp.run('mercury', '[]'::jsonb));
insert into res values ('replay_remove', pg_temp.run('sumit', jsonb_build_array(
  pg_temp.sl('s-1', 7100, pg_temp.open()), pg_temp.sl('s-2', 7200, pg_temp.open()),
  pg_temp.sl('s-3', 7300, pg_temp.open())), '[]'::jsonb, true));
select is(pg_temp.state('m-held') || ',' || pg_temp.state('s-held'), 'void:true,posted:true',
  'the replayed void removes its line, and the replayed removal removes its document without void');
update public.companies set books_closed_through = null where id = pg_temp.id('co');

select is((pg_temp.line('m-3')).category_suggested::text || ':' || (pg_temp.line('m-3')).user_assigned::text,
  'true:false', 'the sync''s guessed category is a suggestion');
select is(pg_temp.try(format('select public.set_transaction_category(%L, %L, false)',
  (pg_temp.line('m-3')).id, pg_temp.id('repairs'))), 'ok', 'the owner picks the category');
select is((pg_temp.line('m-3')).category_suggested::text || ':' || (pg_temp.line('m-3')).category_assigned::text,
  'false:true', 'the owner''s pick is assigned and no longer a suggestion');
select is((select count(*)::integer from public.transactions t
  where t.company_id = pg_temp.id('co') and t.category_suggested and (t.user_assigned or t.category_assigned)), 0,
  'no line of the company is both suggested and the owner''s');

-- ---------------------------------------------------------------------------------------------
-- review_queue_resolved_chk: open has no resolution time, closed has one.
-- ---------------------------------------------------------------------------------------------
select throws_ok(
  format($$insert into public.review_queue (company_id, transaction_id, status, reason, resolved_at)
    values (%L, %L, 'open', 'suggested', now())$$, pg_temp.id('co'), (pg_temp.line('s-1')).id),
  '23514', 'new row for relation "review_queue" violates check constraint "review_queue_resolved_chk"',
  'an open row with a resolution time cannot be inserted');
select throws_ok(
  format($$insert into public.review_queue (company_id, transaction_id, status, reason)
    values (%L, %L, 'approved', 'suggested')$$, pg_temp.id('co'), (pg_temp.line('s-1')).id),
  '23514', 'new row for relation "review_queue" violates check constraint "review_queue_resolved_chk"',
  'an approved row with no resolution time cannot be inserted');

-- The sync's queue: each line it waits on has one open row.
select pg_temp.svc(format('select public.sync_review_queue(%L)', pg_temp.id('co')));
insert into lr (label, id) values
  ('r-s1', pg_temp.review_of('s-1')), ('r-s3', pg_temp.review_of('s-3')), ('r-m4', pg_temp.review_of('m-4'));
select is((select count(*)::integer from public.review_queue q
  where q.id in (pg_temp.id('r-s1'), pg_temp.id('r-s3')) and q.status = 'open' and q.resolved_at is null), 2,
  'sync_review_queue opens rows with no resolution time');
select throws_ok(
  format($$update public.review_queue set status = 'skipped' where id = %L$$, pg_temp.id('r-s1')),
  '23514', 'new row for relation "review_queue" violates check constraint "review_queue_resolved_chk"',
  'a row cannot be closed without its resolution time');
select throws_ok(
  format($$update public.review_queue set resolved_at = now() where id = %L$$, pg_temp.id('r-s1')),
  '23514', 'new row for relation "review_queue" violates check constraint "review_queue_resolved_chk"',
  'an open row cannot take a resolution time');

-- resolve_review approves and skips; reopen_review puts a row back.
select is(pg_temp.try(format('select public.resolve_review(%L, %L, %L, %L)', pg_temp.id('r-s1'), 'approved',
  pg_temp.id('house'), pg_temp.id('repairs'))), 'ok', 'the owner approves a row');
select is(pg_temp.row(pg_temp.id('r-s1')), 'approved:true:' || split_part(pg_temp.row(pg_temp.id('r-s1')), ':', 3),
  'the approved row has its resolution time');
select is(pg_temp.try(format('select public.resolve_review(%L, %L)', pg_temp.id('r-s3'), 'skipped')), 'ok',
  'the owner skips a row');
select is(split_part(pg_temp.row(pg_temp.id('r-s3')), ':', 1) || ':' || split_part(pg_temp.row(pg_temp.id('r-s3')), ':', 2),
  'skipped:true', 'the skipped row has its resolution time');
select throws_ok(
  format($$update public.review_queue set status = 'open' where id = %L$$, pg_temp.id('r-s3')),
  '23514', 'new row for relation "review_queue" violates check constraint "review_queue_resolved_chk"',
  'a closed row cannot be reopened keeping its resolution time');
select is(pg_temp.try(format('select public.reopen_review(%L)', pg_temp.id('r-s3'))), 'ok', 'the owner reopens the skip');
select is(split_part(pg_temp.row(pg_temp.id('r-s3')), ':', 1) || ':' || split_part(pg_temp.row(pg_temp.id('r-s3')), ':', 2),
  'open:false', 'the reopened row has no resolution time');
select is(pg_temp.try(format('select public.reopen_review(%L)', pg_temp.id('r-s1'))), 'ok', 'the owner reopens the approval');
select is(split_part(pg_temp.row(pg_temp.id('r-s1')), ':', 1) || ':' || split_part(pg_temp.row(pg_temp.id('r-s1')), ':', 2),
  'open:false', 'the reopened approval has no resolution time');

-- reassign_transaction closes the row as changed; undo_reassign opens it again.
insert into lr (label, id) select 'ticket', (pg_temp.ask(format('select to_jsonb(public.reassign_transaction(%L, %L, %L))',
  (pg_temp.line('s-3')).id, pg_temp.id('house'), pg_temp.id('repairs'))) #>> '{}')::uuid;
select is(split_part(pg_temp.row(pg_temp.id('r-s3')), ':', 1) || ':' || split_part(pg_temp.row(pg_temp.id('r-s3')), ':', 2),
  'changed:true', 'a filing from the line closes its row as changed, with the time');
select is(pg_temp.try(format('select public.undo_reassign(%L)', pg_temp.id('ticket'))), 'ok', 'the owner undoes the filing');
select is(split_part(pg_temp.row(pg_temp.id('r-s3')), ':', 1) || ':' || split_part(pg_temp.row(pg_temp.id('r-s3')), ':', 2),
  'open:false', 'the undone filing reopens the row with no resolution time');

-- A held change: leave_held_change approves its row, mcp_undo held_change_left reopens it.
update public.companies set books_closed_through = pg_temp.m1(-5) - 1 where id = pg_temp.id('co');
insert into res values ('hold_new', pg_temp.run('mercury', jsonb_build_array(pg_temp.ml('m-closed', 2100, pg_temp.shut()))));
insert into res values ('hold_change', pg_temp.run('mercury', jsonb_build_array(pg_temp.ml('m-closed', 2200, pg_temp.shut()))));
insert into lr (label, id) values ('r-held', pg_temp.review_of('m-closed'));
select is(pg_temp.row(pg_temp.id('r-held')), 'open:false:closed_month_change', 'a held change opens its row');
select is(pg_temp.try(format('select public.leave_held_change(%L)', pg_temp.id('r-held'))), 'ok',
  'the owner leaves the held change');
select is(pg_temp.row(pg_temp.id('r-held')), 'approved:true:closed_month_change', 'the left change''s row is approved, with the time');
insert into res values ('leave_undo', pg_temp.ask(format('select public.mcp_undo(%L, %L, %L::uuid)',
  'lr-leave-undo-1', 'held_change_left', (pg_temp.line('m-closed')).id)));
select is((select r->>'ok' from res where label = 'leave_undo'), 'false',
  'the app''s leave has no flow-mcp write to undo');
insert into res values ('leave_mcp', pg_temp.ask(format('select public.mcp_leave_held_change(%L, %L::uuid)',
  'lr-leave-1', (pg_temp.line('m-closed')).id)));
select is((select r->>'ok' from res where label = 'leave_mcp'), 'false',
  'a held change already left is not open to leave');
-- A different change opens the row again; flow-mcp leaves it and undoes the leave.
insert into res values ('hold_third', pg_temp.run('mercury', jsonb_build_array(pg_temp.ml('m-closed', 2300, pg_temp.shut()))));
select is(pg_temp.row(pg_temp.review_of('m-closed')), 'open:false:closed_month_change',
  'a different held change reopens the row with no resolution time');
insert into res values ('leave_mcp_2', pg_temp.ask(format('select public.mcp_leave_held_change(%L, %L::uuid)',
  'lr-leave-2', (pg_temp.line('m-closed')).id)));
select is(pg_temp.row(pg_temp.review_of('m-closed')), 'approved:true:closed_month_change', 'flow-mcp leaves it');
insert into res values ('leave_undo_2', pg_temp.ask(format('select public.mcp_undo(%L, %L, %L::uuid)',
  'lr-leave-undo-2', 'held_change_left', (pg_temp.line('m-closed')).id)));
select is((select r->>'ok' from res where label = 'leave_undo_2') || ':' || pg_temp.row(pg_temp.review_of('m-closed')),
  'true:open:false:closed_month_change', 'the undo reopens the row with no resolution time');
update public.companies set books_closed_through = null where id = pg_temp.id('co');

-- ---------------------------------------------------------------------------------------------
-- review_queue_reason_chk: a reason the code writes, or none.
-- ---------------------------------------------------------------------------------------------
select throws_ok(
  format($$insert into public.review_queue (company_id, transaction_id, status, reason)
    values (%L, %L, 'open', 'example_reason')$$, pg_temp.id('co'), (pg_temp.line('s-2')).id),
  '23514', 'new row for relation "review_queue" violates check constraint "review_queue_reason_chk"',
  'a reason the code does not write cannot be inserted');
select throws_ok(
  format($$update public.review_queue set reason = 'pending_income' where id = %L$$, pg_temp.id('r-s3')),
  '23514', 'new row for relation "review_queue" violates check constraint "review_queue_reason_chk"',
  'the retired reason pending_income cannot be written back');
select lives_ok(
  format($$insert into public.review_queue (company_id, transaction_id, status, reason, resolved_at)
    values (%L, %L, 'approved', null, now())$$, pg_temp.id('co'), (pg_temp.line('s-2')).id),
  'a settled row with no reason goes in (follow_invoice writes one)');
select lives_ok(
  format($$insert into public.review_queue (company_id, transaction_id, status, reason, resolved_at)
    select %L, %L, 'approved', r, now() from unnest(array['missing_category', 'missing_project', 'suggested',
      'unallocated_shared', 'split_mismatch', 'closed_month_change']) r$$,
    pg_temp.id('co'), (pg_temp.line('s-2')).id),
  'each reason the code writes goes in (closed rows: a line has one open row since part 4)');
select is((select count(*)::integer from public.review_queue q where q.company_id = pg_temp.id('co')
  and q.reason is not null and q.reason not in ('missing_category', 'missing_project', 'suggested',
    'unallocated_shared', 'split_mismatch', 'closed_month_change')), 0,
  'every row the writers above made carries one of those reasons');

select * from finish();
rollback;
