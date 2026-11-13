-- FLOW-1166 part 5 (20261113080500_lifecycle_last_rules.sql, A): a prepaid schedule whose payment
-- line is removed is ended at that point, its posted months stay, and it is listed as ended because
-- its payment was removed (the owner's decision, 2026-11-13). Every way the sync removes a line: a
-- bank void, the SUMIT sweep, a SUMIT company switch (replace_sumit_connection), and a void held in a
-- closed month, which ends the schedule only once the replay writes it. A line that comes back leaves
-- the schedule ended. The owner's end says person. The daily job and the migration end the schedules
-- a removal left active. ended_by is tied to the status. What the books show after an automatic end
-- and after the delete. An ended schedule on a removed payment keeps no planned row (the undo of a
-- delete, an owner's end from a later month), so the books close. Invented names and figures; dates
-- follow current_date.

begin;

select plan(60);

do $users$
begin
  perform tests.create_supabase_user('pr_owner', 'pr-owner@example.com');
end
$users$;

create temp table pr (label text primary key, id uuid);
grant all on pr to authenticated, service_role;
create temp table res (label text primary key, r jsonb);
grant all on res to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid language sql set search_path = '' as $$ select id from pg_temp.pr where label = p_label; $$;
create or replace function pg_temp.m1(k integer)
returns date language sql set search_path = '' as $$
  select (date_trunc('month', current_date) + make_interval(months => k))::date;
$$;
create or replace function pg_temp.ym(k integer)
returns text language sql set search_path = '' as $$ select to_char(pg_temp.m1(k), 'YYYY-MM'); $$;

-- A bank line and a SUMIT document as the engines send them.
create or replace function pg_temp.ml(p_ext text, p_amount bigint, p_date date)
returns jsonb language sql set search_path = '' as $$
  select jsonb_build_object(
    'source', 'mercury', 'external_id', p_ext, 'direction', 'expense', 'line_status', 'posted', 'doc_kind', 'expense',
    'pnl_role', 'overhead', 'currency', 'USD', 'amount_original', p_amount, 'amount_negated', true,
    'doc_date', p_date, 'description', 'Example bank line ' || p_ext,
    'vat', jsonb_build_object('amount', 0, 'status', 'unknown'), 'provider_meta', '{}'::jsonb);
$$;
create or replace function pg_temp.sl(p_ext text, p_amount bigint, p_date date)
returns jsonb language sql set search_path = '' as $$
  select pg_temp.ml(p_ext, p_amount, p_date)
    || jsonb_build_object('source', 'sumit', 'currency', 'ILS', 'description', 'Example document ' || p_ext);
$$;
-- The SUMIT documents a complete run sends, without the ones named.
create or replace function pg_temp.sumit_all(p_without text[] default '{}')
returns jsonb language sql set search_path = '' as $$
  select jsonb_agg(pg_temp.sl(e, 30000, pg_temp.m1(-3)) order by e)
  from unnest(array['s-sweep', 's-switch', 's-keep-1', 's-keep-2', 's-keep-3']) e
  where not (e = any (p_without));
$$;

-- As the service role, as the sync and the connector setter run.
create or replace function pg_temp.svc()
returns void language sql set search_path = '' as $$
  select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', 'service_role', true),
    set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
create or replace function pg_temp.run(p_provider text, p_lines jsonb, p_removed jsonb default '[]'::jsonb,
  p_complete boolean default false)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.svc();
  set local role service_role;
  r := to_jsonb(public.upsert_connector_lines(pg_temp.id('co'), p_provider::public.connector_provider,
    jsonb_build_object('lines', p_lines, 'removed_ids', p_removed, 'complete', p_complete), null, null));
  reset role;
  return r;
end; $$;

-- The owner through flow-mcp.
create or replace function pg_temp.mcp(p_sql text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  uid uuid := tests.get_supabase_uid('pr_owner');
  r jsonb;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1',
    'mcp_tid', pg_temp.id('tok'))::text, true);
  execute p_sql into r;
  reset role;
  return r;
end; $$;

create or replace function pg_temp.line(p_ext text)
returns uuid language sql set search_path = '' as $$
  select t.id from public.transactions t where t.company_id = pg_temp.id('co') and t.external_id = p_ext;
$$;
-- A schedule over six months from two months ago, on the line: three months post at once.
create or replace function pg_temp.create_pp(p_key text, p_ext text)
returns uuid language sql set search_path = '' as $$
  select (pg_temp.mcp(format(
    'select public.mcp_create_prepaid_schedule(%L, %L::uuid, %L::uuid, %L, 6, null, null, 1, null, %L)',
    p_key, pg_temp.line(p_ext), pg_temp.id('insurance'), pg_temp.ym(-2), 'Example policy ' || p_ext))->'data'->>'schedule_id')::uuid;
$$;
-- status:ended_on:end_mode:ended_by, posted rows, planned rows.
create or replace function pg_temp.state(p_sid uuid)
returns text language sql set search_path = '' as $$
  select s.status || ':' || coalesce(to_char(s.ended_on, 'YYYY-MM'), '-') || ':' || coalesce(s.end_mode, '-') || ':'
    || coalesce(s.ended_by, '-') || ':'
    || (select count(*) from public.prepaid_rows r where r.schedule_id = s.id and r.entry_id is not null) || ':'
    || (select count(*) from public.prepaid_rows r where r.schedule_id = s.id and r.entry_id is null)
  from public.prepaid_schedules s where s.id = p_sid;
$$;
create or replace function pg_temp.entries(p_sid uuid)
returns integer language sql set search_path = '' as $$
  select count(*)::integer from public.journal_entries j where j.reference like 'prepaid:' || p_sid || ':%';
$$;
-- What the prepaid months booked on the Prepaid account (the payment lines' own legs left out).
create or replace function pg_temp.prepaid_balance()
returns bigint language sql set search_path = '' as $$
  select coalesce(sum(l.amount_minor), 0)::bigint from public.legs l
  join public.accounts a on a.id = l.account_id and a.name = 'Prepaid expenses'
  join public.journal_entries j on j.company_id = l.company_id and j.transaction_id = l.transaction_id
  where l.company_id = pg_temp.id('co') and not l.draft;
$$;
-- What the books show for a schedule, as the ledger reads them (posted lines that are not removed):
-- the Prepaid account and the expense category, over the payment line and the schedule's months.
create or replace function pg_temp.books(p_sid uuid, p_ext text)
returns text language sql set search_path = '' as $$
  select 'prepaid ' || coalesce(sum(l.amount_minor) filter (where a.name = 'Prepaid expenses'), 0)
    || ', expense ' || coalesce(sum(l.amount_minor) filter (where l.category_id = pg_temp.id('insurance')), 0)
  from public.legs l
  join public.accounts a on a.id = l.account_id
  join public.transactions t on t.company_id = l.company_id and t.id = l.transaction_id
    and t.removed_at is null and t.line_status = 'posted'
  where l.company_id = pg_temp.id('co') and not l.draft
    and (t.id = pg_temp.line(p_ext)
      or t.id in (select j.transaction_id from public.journal_entries j where j.reference like 'prepaid:' || p_sid || ':%'));
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- The company, a flow-mcp credential, an expense category, the lines.
insert into pr (label, id) values ('co', tests.fixture_company('pr_owner', 'Example Prepaid Removal Co'));
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('pr_owner'), pg_temp.id('co'), 'hash-pr-owner-0001', 'pepper-1',
  array['read', 'write'], now() + interval '90 days');
insert into pr (label, id) select 'tok', id from private.mcp_credentials where token_hash = 'hash-pr-owner-0001';
insert into pr (label, id) values ('insurance', tests.fixture_category(pg_temp.id('co'), 'Example insurance', 'expense'));
update public.companies set last_sumit_company_id = 111 where id = pg_temp.id('co');

insert into res values ('bank', pg_temp.run('mercury', jsonb_build_array(
  pg_temp.ml('b-void', 60000, pg_temp.m1(-3)), pg_temp.ml('b-held', 60000, pg_temp.m1(-8)),
  pg_temp.ml('b-person', 60000, pg_temp.m1(-3)), pg_temp.ml('b-old', 60000, pg_temp.m1(-3)),
  pg_temp.ml('b-job', 60000, pg_temp.m1(-3)), pg_temp.ml('b-undo', 60000, pg_temp.m1(-3)))));
insert into res values ('sumit', pg_temp.run('sumit', pg_temp.sumit_all(), '[]'::jsonb, true));
select is((select (r->>'inserted')::integer from res where label = 'bank') + (select (r->>'inserted')::integer from res where label = 'sumit'),
  11, 'the syncs bring the six bank lines and five SUMIT documents');

insert into pr (label, id) values
  ('s_void', pg_temp.create_pp('pr-1', 'b-void')), ('s_held', pg_temp.create_pp('pr-2', 'b-held')),
  ('s_person', pg_temp.create_pp('pr-3', 'b-person')), ('s_old', pg_temp.create_pp('pr-4', 'b-old')),
  ('s_job', pg_temp.create_pp('pr-5', 'b-job')), ('s_undo', pg_temp.create_pp('pr-6', 'b-undo')),
  ('s_sweep', pg_temp.create_pp('pr-7', 's-sweep')), ('s_switch', pg_temp.create_pp('pr-8', 's-switch'));
select is((select count(*)::integer from public.prepaid_schedules where company_id = pg_temp.id('co') and status = 'active'), 8,
  'eight schedules are made');
select is(pg_temp.state(pg_temp.id('s_void')), 'active:-:-:-:3:3', 'each posted its three months due and plans three');
insert into res values ('balance_before', to_jsonb(pg_temp.prepaid_balance()));

-- ---------------------------------------------------------------------------------------------
-- The bank voids a payment: the run completes, and the schedule ends there.
-- ---------------------------------------------------------------------------------------------
insert into res values ('void', pg_temp.run('mercury', '[]'::jsonb, '["b-void"]'::jsonb));
select is((select r->>'removed' from res where label = 'void'), '1', 'the sync run that voids the payment completes');
select is(pg_temp.state(pg_temp.id('s_void')), 'ended:' || pg_temp.ym(1) || ':keep:payment_removed:3:0',
  'its schedule is ended because the payment was removed: planned months dropped, ended from the first one');
select is(pg_temp.entries(pg_temp.id('s_void')), 3, 'the three posted months stay as journal entries');
select is(pg_temp.prepaid_balance(), (select r::bigint from res where label = 'balance_before'),
  'and the end writes nothing to the ledger');
select is(private.prepaid_post_due(pg_temp.m1(6), pg_temp.id('s_void')), 0, 'nothing posts any more');

-- ---------------------------------------------------------------------------------------------
-- The SUMIT sweep removes a document; sent again, it comes back and the schedule stays ended.
-- ---------------------------------------------------------------------------------------------
insert into res values ('sweep', pg_temp.run('sumit', pg_temp.sumit_all(array['s-sweep']), '[]'::jsonb, true));
select is((select r->>'removed' from res where label = 'sweep'), '1', 'the complete SUMIT run sweeps the missing document');
select is(pg_temp.state(pg_temp.id('s_sweep')), 'ended:' || pg_temp.ym(1) || ':keep:payment_removed:3:0',
  'the swept payment ends its schedule');
insert into res values ('back', pg_temp.run('sumit', pg_temp.sumit_all(), '[]'::jsonb, true));
select is((select removed_at from public.transactions where id = pg_temp.line('s-sweep')), null::timestamptz,
  'the document sent again comes back');
select is(pg_temp.state(pg_temp.id('s_sweep')), 'ended:' || pg_temp.ym(1) || ':keep:payment_removed:3:0',
  'and the schedule stays ended');
select is(private.prepaid_post_due(pg_temp.m1(6), pg_temp.id('s_sweep')), 0, 'its months do not post');
select is(pg_temp.state(pg_temp.id('s_sweep')), 'ended:' || pg_temp.ym(1) || ':keep:payment_removed:3:0',
  'and stays ended');
select is(pg_temp.mcp(format('select public.mcp_delete_prepaid_schedule(%L, %L::uuid)', 'pr-9', pg_temp.id('s_sweep')))->>'ok',
  'true', 'the owner can delete the ended schedule');
select ok(pg_temp.create_pp('pr-10', 's-sweep') is not null, 'and make a new one on the payment that came back');

-- ---------------------------------------------------------------------------------------------
-- A SUMIT company switch removes every document: the run completes, the schedule ends.
-- ---------------------------------------------------------------------------------------------
select pg_temp.svc();
select lives_ok(format('select public.replace_sumit_connection(%L, 222, %L, %L, %L, %L, %L, %L, true)',
  pg_temp.id('co'), 'aa', 'aa', 'aa', 'aa', '1', '2'), 'replace_sumit_connection removes the old company''s documents');
select is(pg_temp.state(pg_temp.id('s_switch')), 'ended:' || pg_temp.ym(1) || ':keep:payment_removed:3:0',
  'and ends the schedule of the payment it removed');

-- ---------------------------------------------------------------------------------------------
-- A void held in a closed month has not happened: the schedule stays active until the replay.
-- ---------------------------------------------------------------------------------------------
update public.companies set books_closed_through = pg_temp.m1(-6) where id = pg_temp.id('co');
insert into res values ('held', pg_temp.run('mercury', '[]'::jsonb, '["b-held"]'::jsonb));
select is((select r->>'held' from res where label = 'held'), '1', 'a void of a payment dated in a closed month is held');
select is(pg_temp.state(pg_temp.id('s_held')), 'active:-:-:-:3:3', 'and its schedule stays active with its planned months');
update public.companies set books_closed_through = null where id = pg_temp.id('co');
insert into res values ('replay', pg_temp.run('mercury', '[]'::jsonb));
select ok((select removed_at is not null from public.transactions where id = pg_temp.line('b-held')),
  'once the month is open again the next sync applies the void');
select is(pg_temp.state(pg_temp.id('s_held')), 'ended:' || pg_temp.ym(1) || ':keep:payment_removed:3:0',
  'and the schedule ends then');

-- ---------------------------------------------------------------------------------------------
-- The owner's end says person; list and get show why.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.mcp(format('select public.mcp_end_prepaid_schedule(%L, %L::uuid, %L, %L)', 'pr-11',
  pg_temp.id('s_person'), pg_temp.ym(1), 'keep'))->'data'->>'ended_by', 'person', 'end_prepaid_schedule answers ended_by person');
select is(pg_temp.state(pg_temp.id('s_person')), 'ended:' || pg_temp.ym(1) || ':keep:person:3:0', 'and stores it');
insert into res values ('list', pg_temp.mcp('select public.mcp_list_prepaid_schedules(null)'));
select is((select jsonb_object_agg(x->>'schedule_id', x->'ended_by') from res, jsonb_array_elements(r->'data'->'schedules') x
  where label = 'list' and (x->>'schedule_id')::uuid in (pg_temp.id('s_void'), pg_temp.id('s_person'), pg_temp.id('s_old'))),
  jsonb_build_object(pg_temp.id('s_void'), 'payment_removed', pg_temp.id('s_person'), 'person', pg_temp.id('s_old'), null),
  'list_prepaid_schedules gives ended_by: payment_removed, person, and null on an active schedule');
select is((select count(*)::integer from res, jsonb_array_elements(r->'data'->'schedules') x
  where label = 'list' and not (x ? 'ended_by')), 0, 'every listed schedule carries the key');
select is(jsonb_array_length(pg_temp.mcp('select public.mcp_list_prepaid_schedules(''ended'')')->'data'->'schedules'), 5,
  'the ended filter lists the five ended schedules');
select is(pg_temp.mcp(format('select public.mcp_get_prepaid_schedule(%L::uuid)', pg_temp.id('s_held')))->'data'->>'ended_by',
  'payment_removed', 'get_prepaid_schedule gives it too');

-- An undo puts the schedule back as it was, ended_by included.
select is(pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'pr-12', 'prepaid_end', pg_temp.id('s_person')))->>'ok',
  'true', 'the owner''s end is undone');
select is(pg_temp.state(pg_temp.id('s_person')), 'active:-:-:-:3:3', 'the schedule is active again, with no reason');

-- ---------------------------------------------------------------------------------------------
-- The rule: ended_by only on an ended schedule, one of the two reasons.
-- ---------------------------------------------------------------------------------------------
select throws_ok(format($$update public.prepaid_schedules set ended_by = 'person' where id = %L$$, pg_temp.id('s_old')),
  '23514', null, 'an active schedule cannot carry a reason');
select throws_ok(format($$update public.prepaid_schedules set ended_by = 'sync' where id = %L$$, pg_temp.id('s_void')),
  '23514', null, 'an ended schedule carries only person or payment_removed');
select lives_ok(format($$update public.prepaid_schedules set ended_by = null where id = %L$$, pg_temp.id('s_void')),
  'an ended schedule may carry none (those ended before 2026-11-13)');

-- ---------------------------------------------------------------------------------------------
-- Schedules a removal left active (written before this file, or a lock held elsewhere): the
-- migration's clean-up and the daily job end them by the same code path.
-- ---------------------------------------------------------------------------------------------
select is(private.prepaid_end_removed_all(), 0, 'with no such schedule the clean-up ends nothing');
set constraints all immediate;
alter table public.transactions disable trigger transactions_prepaid_removed;
select pg_temp.svc();
update public.transactions set removed_at = now() where id in (pg_temp.line('b-old'), pg_temp.line('b-job'), pg_temp.line('b-undo'));
set constraints all immediate;
alter table public.transactions enable trigger transactions_prepaid_removed;
select is(pg_temp.state(pg_temp.id('s_old')), 'active:-:-:-:3:3', 'a removal from before this file left the schedule active');
select is(private.prepaid_end_removed(pg_temp.id('co'), pg_temp.id('s_void')), false, 'the end does nothing to a schedule already ended');
select is(private.prepaid_end_removed(pg_temp.id('co'), pg_temp.id('s_person')), false, 'nor to one whose payment is still there');
select is(private.prepaid_end_removed_all(), 3, 'the migration''s clean-up ends the three left active');
select is(pg_temp.state(pg_temp.id('s_old')) || ' ' || pg_temp.state(pg_temp.id('s_job')),
  'ended:' || pg_temp.ym(1) || ':keep:payment_removed:3:0 ended:' || pg_temp.ym(1) || ':keep:payment_removed:3:0',
  'each as a removal ends it');

-- The daily job's run for all schedules does the same first.
update public.prepaid_schedules set status = 'active', ended_on = null, end_mode = null, ended_by = null
where id = pg_temp.id('s_job');
insert into public.prepaid_rows (company_id, schedule_id, seq, due_date, amount_minor)
values (pg_temp.id('co'), pg_temp.id('s_job'), 4, pg_temp.m1(1), 10000);
select is(private.prepaid_post_due(), 0, 'the daily job posts nothing for a removed payment');
select is(pg_temp.state(pg_temp.id('s_job')), 'ended:' || pg_temp.ym(1) || ':keep:payment_removed:3:0',
  'and ends its schedule before it posts');

-- An undo that would put a schedule back active on a removed payment ends it again.
select pg_temp.svc();
update public.transactions set removed_at = null where id = pg_temp.line('b-undo');
update public.prepaid_schedules set status = 'active', ended_on = null, end_mode = null, ended_by = null
where id = pg_temp.id('s_undo');
insert into public.prepaid_rows (company_id, schedule_id, seq, due_date, amount_minor)
select pg_temp.id('co'), pg_temp.id('s_undo'), g, pg_temp.m1(g - 3), 10000 from generate_series(4, 6) g;
select is(pg_temp.mcp(format('select public.mcp_end_prepaid_schedule(%L, %L::uuid, %L, %L)', 'pr-13',
  pg_temp.id('s_undo'), pg_temp.ym(1), 'keep'))->>'ok', 'true', 'the owner ends a schedule');
select pg_temp.svc();
update public.transactions set removed_at = now() where id = pg_temp.line('b-undo');
select is(pg_temp.state(pg_temp.id('s_undo')), 'ended:' || pg_temp.ym(1) || ':keep:person:3:0',
  'a later removal leaves the owner''s end as it is');
select is(pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'pr-14', 'prepaid_end', pg_temp.id('s_undo')))->>'ok',
  'true', 'the owner''s end is undone');
select is(pg_temp.state(pg_temp.id('s_undo')), 'ended:' || pg_temp.ym(1) || ':keep:payment_removed:3:0',
  'and the schedule it put back ends because the payment was removed');

-- ---------------------------------------------------------------------------------------------
-- What the books show. The automatic end writes nothing: the removed payment's own legs leave the
-- ledger with the line, the posted months stay (expense, and a credit on Prepaid) against a payment
-- that no longer exists, until the owner deletes the schedule.
-- ---------------------------------------------------------------------------------------------
insert into res values ('more', pg_temp.run('mercury', jsonb_build_array(
  pg_temp.ml('b-del', 60000, pg_temp.m1(-3)), pg_temp.ml('b-late', 60000, pg_temp.m1(-3)))));
insert into pr (label, id) values ('s_del', pg_temp.create_pp('pr-20', 'b-del')), ('s_late', pg_temp.create_pp('pr-21', 'b-late'));
select is(pg_temp.books(pg_temp.id('s_del'), 'b-del'), 'prepaid 30000, expense 30000',
  'three of six months posted: half the payment is still on Prepaid, half is expensed');
insert into res values ('del_void', pg_temp.run('mercury', '[]'::jsonb, '["b-del"]'::jsonb));
select is(pg_temp.state(pg_temp.id('s_del')), 'ended:' || pg_temp.ym(1) || ':keep:payment_removed:3:0',
  'the bank voids the payment and the schedule ends');
select is(pg_temp.books(pg_temp.id('s_del'), 'b-del'), 'prepaid -30000, expense 30000',
  'the payment''s own legs leave the books; the posted months stay expensed, credited to Prepaid');
select is(pg_temp.mcp(format('select public.mcp_get_prepaid_schedule(%L::uuid)', pg_temp.id('s_del')))->'data'->>'remaining_minor',
  '30000', 'remaining_minor still reads the unposted amount, though nothing is left on the account');
select is(pg_temp.mcp(format('select public.mcp_delete_prepaid_schedule(%L, %L::uuid)', 'pr-22', pg_temp.id('s_del')))->>'ok',
  'true', 'the owner deletes the schedule');
select is(pg_temp.books(pg_temp.id('s_del'), 'b-del'), 'prepaid 0, expense 0', 'which takes the posted months out of the books');

-- The delete undone: its months come back as planned rows, which can never post on a removed payment.
select is(pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'pr-23', 'prepaid_delete', pg_temp.id('s_del')))->>'ok',
  'true', 'the delete is undone');
select is(pg_temp.state(pg_temp.id('s_del')), 'ended:' || pg_temp.ym(-2) || ':keep:payment_removed:0:0',
  'the schedule is back, ended because its payment was removed, from its first month, with no month posted or planned');
select is(pg_temp.books(pg_temp.id('s_del'), 'b-del'), 'prepaid 0, expense 0', 'and the books are as the delete left them');

-- An owner's end from a later month leaves planned months before it; a removal then drops them.
select is(pg_temp.mcp(format('select public.mcp_end_prepaid_schedule(%L, %L::uuid, %L, %L)', 'pr-24',
  pg_temp.id('s_late'), pg_temp.ym(2), 'expense'))->>'ok', 'true', 'the owner ends a schedule from the month after next, expensing the rest');
select is(pg_temp.state(pg_temp.id('s_late')), 'ended:' || pg_temp.ym(2) || ':expense:person:3:2',
  'a planned month and the end row wait to post');
insert into res values ('late_void', pg_temp.run('mercury', '[]'::jsonb, '["b-late"]'::jsonb));
select is(pg_temp.state(pg_temp.id('s_late')), 'ended:' || pg_temp.ym(1) || ':keep:payment_removed:3:0',
  'when its payment is removed they are dropped, and the schedule ended there because the payment was removed');

-- The daily job drops planned rows an ended schedule on a removed payment still has.
insert into public.prepaid_rows (company_id, schedule_id, seq, due_date, amount_minor)
values (pg_temp.id('co'), pg_temp.id('s_late'), 9, pg_temp.m1(1), 10000);
select is(private.prepaid_post_due(), 0, 'the daily job posts nothing for it');
select is(pg_temp.state(pg_temp.id('s_late')), 'ended:' || pg_temp.ym(1) || ':keep:payment_removed:3:0', 'and drops the planned row');

-- The owner has dealt with the synced lines' review rows; the close checks those first.
update public.review_queue set status = 'skipped', skipped_by = 'person', resolved_at = now()
where company_id = pg_temp.id('co') and status = 'open';
select is(pg_temp.mcp(format('select public.mcp_set_books_closed_through(%L, %L::date)', 'pr-25', current_date))->>'ok',
  'true', 'nothing is left that counts as due: the books close through today');

select * from finish();
rollback;
