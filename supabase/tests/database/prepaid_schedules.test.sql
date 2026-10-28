-- FLOW-155 + FLOW-156. Prepaid amortization schedules and the books-closed date, through the MCP:
-- a payment filed to Prepaid expenses posts one journal entry a month (Prepaid -> the expense
-- category, on the project) with no cash moved; refunds, changes and an early end spread what
-- remains; each write has an undo; the books-closed date guards the posted months.
-- Dates follow current_date (months are counted from this month, M0). Invented data only.

begin;

select plan(122);

do $users$
begin
  perform tests.create_supabase_user('pp_owner', 'owner155@example.com');
  perform tests.create_supabase_user('pp_editor', 'editor155@example.com');
  perform tests.create_supabase_user('pp_viewer', 'viewer155@example.com');
  perform tests.create_supabase_user('pp_other', 'other155@example.com');
end
$users$;

create temp table pp (label text primary key, id uuid);
grant all on pp to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid language sql set search_path = '' as $$ select id from pg_temp.pp where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- The month k months from this one, as 'YYYY-MM' and as its first day.
create or replace function pg_temp.ym(k integer)
returns text language sql set search_path = '' as $$
  select to_char(date_trunc('month', current_date) + make_interval(months => k), 'YYYY-MM');
$$;
create or replace function pg_temp.m1(k integer)
returns date language sql set search_path = '' as $$
  select (date_trunc('month', current_date) + make_interval(months => k))::date;
$$;
grant execute on function pg_temp.ym(integer), pg_temp.m1(integer) to authenticated, service_role;

-- Act as a holder of a flow-mcp credential: a = A's owner, e = A's editor, v = A's viewer, b = B's owner.
create or replace function pg_temp.as_mcp(p_who text)
returns void language plpgsql set search_path = '' as $$
declare
  uid uuid := tests.get_supabase_uid(case p_who when 'b' then 'pp_other' when 'e' then 'pp_editor'
    when 'v' then 'pp_viewer' else 'pp_owner' end);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1',
    'mcp_tid', pg_temp.id('tok_' || p_who))::text, true);
end; $$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

-- One call as p_who.
create or replace function pg_temp.mcp(p_who text, p_sql text)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_mcp(p_who);
  execute p_sql into r;
  reset role;
  return r;
end; $$;
grant execute on function pg_temp.mcp(text, text) to authenticated, service_role;

create or replace function pg_temp.create_pp(p_key text, p_txn uuid, p_cat uuid, p_start text, p_months integer,
  p_amount bigint default null, p_who text default 'a')
returns jsonb language sql set search_path = '' as $$
  select pg_temp.mcp(p_who, format(
    'select public.mcp_create_prepaid_schedule(%L, %L::uuid, %L::uuid, %L, %s, %L::uuid, %L::bigint, 1, null, %L)',
    p_key, p_txn, p_cat, p_start, p_months, pg_temp.id('maple'), p_amount, 'Example Insurance Co policy'));
$$;
create or replace function pg_temp.refund_pp(p_key text, p_sid uuid, p_txn uuid, p_amount bigint default null)
returns jsonb language sql set search_path = '' as $$
  select pg_temp.mcp('a', format('select public.mcp_attach_prepaid_refund(%L, %L::uuid, %L::uuid, %L::bigint)',
    p_key, p_sid, p_txn, p_amount));
$$;
create or replace function pg_temp.update_pp(p_key text, p_sid uuid, p_months integer, p_cat uuid default null)
returns jsonb language sql set search_path = '' as $$
  select pg_temp.mcp('a', format('select public.mcp_update_prepaid_schedule(%L, %L::uuid, %L::integer, %L::uuid, null)',
    p_key, p_sid, p_months, p_cat));
$$;
create or replace function pg_temp.end_pp(p_key text, p_sid uuid, p_from text, p_remaining text)
returns jsonb language sql set search_path = '' as $$
  select pg_temp.mcp('a', format('select public.mcp_end_prepaid_schedule(%L, %L::uuid, %L, %L)',
    p_key, p_sid, p_from, p_remaining));
$$;
create or replace function pg_temp.delete_pp(p_key text, p_sid uuid, p_who text default 'a')
returns jsonb language sql set search_path = '' as $$
  select pg_temp.mcp(p_who, format('select public.mcp_delete_prepaid_schedule(%L, %L::uuid)', p_key, p_sid));
$$;
create or replace function pg_temp.close_books(p_key text, p_date date, p_who text default 'a')
returns jsonb language sql set search_path = '' as $$
  select pg_temp.mcp(p_who, format('select public.mcp_set_books_closed_through(%L, %L::date)', p_key, p_date));
$$;
create or replace function pg_temp.undo(p_key text, p_kind text, p_id uuid)
returns jsonb language sql set search_path = '' as $$
  select pg_temp.mcp('a', format('select public.mcp_undo(%L, %L, %L::uuid)', p_key, p_kind, p_id));
$$;
create or replace function pg_temp.get_pp(p_sid uuid, p_who text default 'a')
returns jsonb language sql set search_path = '' as $$
  select pg_temp.mcp(p_who, format('select public.mcp_get_prepaid_schedule(%L::uuid)', p_sid));
$$;
-- A call that may raise, as p_who: 'ok' or the error's message.
create or replace function pg_temp.try(p_who text, p_sql text)
returns text language plpgsql set search_path = '' as $$
begin
  perform pg_temp.as_mcp(p_who);
  execute p_sql;
  reset role;
  return 'ok';
exception when others then
  return sqlerrm;
end; $$;
-- As postgres with no user, as a bank sync or a job writes.
create or replace function pg_temp.no_user()
returns void language sql set search_path = '' as $$
  select set_config('request.jwt.claims', '', true), set_config('request.jwt.claim.sub', '', true);
$$;
create or replace function pg_temp.pnl_all()
returns bigint language sql set search_path = '' as $$
  select coalesce(sum(p.amount_net), 0)::bigint from private.pnl_lines p where p.company_id = pg_temp.id('co') and p.in_pnl;
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- A schedule's rows as postgres sees them, and the books.
create or replace function pg_temp.amounts(p_sid uuid, p_posted boolean default null)
returns bigint[] language sql set search_path = '' as $$
  select coalesce(array_agg(r.amount_minor order by r.seq), '{}') from public.prepaid_rows r
  where r.schedule_id = p_sid and (p_posted is null or (r.entry_id is not null) = p_posted);
$$;
create or replace function pg_temp.entries(p_sid uuid)
returns integer language sql set search_path = '' as $$
  select count(*)::integer from public.journal_entries j where j.reference like 'prepaid:' || p_sid || ':%';
$$;
create or replace function pg_temp.bal(p_account uuid)
returns bigint language sql set search_path = '' as $$
  select coalesce(sum(l.amount_minor), 0)::bigint from public.legs l where l.account_id = p_account and not l.draft;
$$;
create or replace function pg_temp.expense(p_category uuid)
returns bigint language sql set search_path = '' as $$
  select -coalesce(sum(p.amount_net), 0)::bigint from private.pnl_lines p
  where p.company_id = pg_temp.id('co') and p.in_pnl and p.category_id = p_category
    and p.transaction_id in (select j.transaction_id from public.journal_entries j);
$$;
create or replace function pg_temp.prepaid_acct()
returns uuid language sql set search_path = '' as $$
  select a.id from public.accounts a where a.company_id = pg_temp.id('co') and a.name = 'Prepaid expenses';
$$;
-- What the cash views and the bank say: cash_months' money in and out (its profit and excluded
-- figures read the P&L, which an entry moves), the months' cash lines, and the bank legs.
create or replace function pg_temp.cash_print()
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform pg_temp.as_mcp('a');
  r := jsonb_build_object(
    'months', (select jsonb_agg(jsonb_build_object('month', m->'month', 'cash', (select jsonb_agg(jsonb_build_object('currency',
        c->'currency', 'in', c->'in_minor', 'out', c->'out_minor', 'net', c->'net_minor')) from jsonb_array_elements(m->'by_currency') c)))
      from jsonb_array_elements(public.cash_months(24, current_date + 400)->'months') m),
    'lines', (select jsonb_agg(public.cash_month_lines(pg_temp.m1(k), 'out', 'ILS', 200, 0)) from generate_series(-12, 12) k));
  reset role;
  return r || jsonb_build_object('bank', (
    select coalesce(sum(l.amount_minor), 0) from public.legs l
    join public.accounts a on a.id = l.account_id and a.is_bank
    where l.company_id = pg_temp.id('co') and not l.draft));
end; $$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- Company A (owner, an editor, a viewer) and B; a project; categories; the payment lines.
insert into pp (label, id) values
  ('co', tests.fixture_company('pp_owner', 'Example Holdings 155')),
  ('co_b', tests.fixture_company('pp_other', 'Example Other 155'));
insert into public.company_members (company_id, user_id, role) values
  (pg_temp.id('co'), tests.get_supabase_uid('pp_editor'), 'editor'),
  (pg_temp.id('co'), tests.get_supabase_uid('pp_viewer'), 'viewer');
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values
  (tests.get_supabase_uid('pp_owner'), pg_temp.id('co'), 'hash-pp-owner-0001', 'pepper-1', array['read', 'write'], now() + interval '90 days'),
  (tests.get_supabase_uid('pp_editor'), pg_temp.id('co'), 'hash-pp-editor-001', 'pepper-1', array['read', 'write'], now() + interval '90 days'),
  (tests.get_supabase_uid('pp_viewer'), pg_temp.id('co'), 'hash-pp-viewer-001', 'pepper-1', array['read', 'write'], now() + interval '90 days'),
  (tests.get_supabase_uid('pp_other'), pg_temp.id('co_b'), 'hash-pp-other-0001', 'pepper-1', array['read', 'write'], now() + interval '90 days');
insert into pp (label, id)
select 'tok_' || v.who, c.id from private.mcp_credentials c
join (values ('a', 'hash-pp-owner-0001'), ('e', 'hash-pp-editor-001'), ('v', 'hash-pp-viewer-001'), ('b', 'hash-pp-other-0001')) v(who, h)
  on c.token_hash = v.h;

insert into pp (label, id) values ('maple', tests.fixture_project(pg_temp.id('co'), 'Example Maple house'));
insert into pp (label, id) values
  ('insurance', tests.fixture_category(pg_temp.id('co'), 'Example insurance', 'expense')),
  ('repairs', tests.fixture_category(pg_temp.id('co'), 'Example repairs', 'expense')),
  ('rent', tests.fixture_category(pg_temp.id('co'), 'Example rent', 'income')),
  ('b_cat', tests.fixture_category(pg_temp.id('co_b'), 'Example other insurance', 'expense'));
insert into pp (label, id) values
  ('l_year', tests.fixture_line(pg_temp.id('co'), 'pp:year', 262100, 'expense', pg_temp.id('maple'), pg_temp.id('repairs'), pg_temp.m1(-11))),
  ('l_past', tests.fixture_line(pg_temp.id('co'), 'pp:past', 120000, 'expense', pg_temp.id('maple'), pg_temp.id('repairs'), pg_temp.m1(-3))),
  ('l_refund', tests.fixture_line(pg_temp.id('co'), 'pp:refund', 237890, 'expense', pg_temp.id('maple'), pg_temp.id('repairs'), pg_temp.m1(-3))),
  ('r_refund', tests.fixture_line(pg_temp.id('co'), 'pp:refund-in', 139703, 'income', pg_temp.id('maple'), pg_temp.id('rent'), current_date)),
  ('l_keep', tests.fixture_line(pg_temp.id('co'), 'pp:keep', 60000, 'expense', pg_temp.id('maple'), pg_temp.id('repairs'), pg_temp.m1(-1))),
  ('l_undo', tests.fixture_line(pg_temp.id('co'), 'pp:undo', 30000, 'expense', pg_temp.id('maple'), pg_temp.id('repairs'), pg_temp.m1(-2))),
  ('l_part', tests.fixture_line(pg_temp.id('co'), 'pp:part', 50000, 'expense', pg_temp.id('maple'), pg_temp.id('repairs'), pg_temp.m1(-1))),
  ('l_split', tests.fixture_line(pg_temp.id('co'), 'pp:split', 40000, 'expense', pg_temp.id('maple'), pg_temp.id('repairs'), pg_temp.m1(-1))),
  ('l_future', tests.fixture_line(pg_temp.id('co'), 'pp:future', 90000, 'expense', pg_temp.id('maple'), pg_temp.id('repairs'), current_date)),
  ('l_closed', tests.fixture_line(pg_temp.id('co'), 'pp:closed', 20000, 'expense', pg_temp.id('maple'), pg_temp.id('repairs'), pg_temp.m1(-2))),
  ('r_guard', tests.fixture_line(pg_temp.id('co'), 'pp:guard-in', 1000, 'income', pg_temp.id('maple'), pg_temp.id('rent'), current_date)),
  ('l_b', tests.fixture_line(pg_temp.id('co_b'), 'pp:b', 10000, 'expense', null, pg_temp.id('b_cat'), current_date));
select tests.line_split(pg_temp.id('l_split'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('repairs'), 'project_id', pg_temp.id('maple'), 'amount_minor', 30000),
  jsonb_build_object('category_id', pg_temp.id('insurance'), 'project_id', pg_temp.id('maple'), 'amount_minor', 10000)));

-- 1. 262,100 over 12 months from 11 months ago: every month is due, so all twelve post at once.
create temp table res (label text primary key, r jsonb);
grant all on res to authenticated, service_role;
insert into res values ('year', pg_temp.create_pp('pp-year', pg_temp.id('l_year'), pg_temp.id('insurance'), pg_temp.ym(-11), 12));
insert into pp values ('s_year', ((select r from res where label = 'year')->'data'->>'schedule_id')::uuid);

select is((select r->>'ok' from res where label = 'year'), 'true', 'create_prepaid_schedule answers ok');
select ok((select r->'data' from res where label = 'year') ?& array['schedule_id', 'prepaid_account_id', 'prepaid_category_id',
  'total_minor', 'rows', 'posted_count', 'remaining_minor', 'undo_kind'], 'and gives the contract''s keys');
select is((select r->'data'->>'undo_kind' from res where label = 'year'), 'prepaid_create', 'with undo kind prepaid_create');
select is(pg_temp.amounts(pg_temp.id('s_year')),
  array[21842, 21842, 21842, 21842, 21842, 21842, 21842, 21842, 21842, 21842, 21842, 21838]::bigint[],
  '262,100 over 12 is eleven months of 21,842 and a last of 21,838');
select is((select (r->'data'->>'posted_count')::integer from res where label = 'year'), 12, 'a past start posts every month due');
select is((select (r->'data'->>'remaining_minor')::bigint from res where label = 'year'), 0::bigint, 'and nothing remains');
select is((select status from public.prepaid_schedules where id = pg_temp.id('s_year')), 'completed', 'so the schedule is completed');
select is(pg_temp.bal(pg_temp.prepaid_acct()), 0::bigint, 'the Prepaid account is at 0 after the last month');
select is(pg_temp.expense(pg_temp.id('insurance')), 262100::bigint, 'and the expense category''s entries carry the whole 262,100');
select is((select count(*)::integer from public.accounts where company_id = pg_temp.id('co') and name = 'Prepaid expenses'
  and type = 'asset' and not is_system), 1, 'Prepaid expenses is made as the company''s asset account');
select is((select category_id from public.transactions where id = pg_temp.id('l_year')),
  (select prepaid_category_id from public.prepaid_schedules where id = pg_temp.id('s_year')),
  'the payment line is filed to the kept-out category bound to it');
select is((select ledger_account_id from public.categories c join public.prepaid_schedules s on s.prepaid_category_id = c.id
  where s.id = pg_temp.id('s_year')), pg_temp.prepaid_acct(), 'which posts to Prepaid expenses');
select is(pg_temp.entries(pg_temp.id('s_year')), 12, 'each month is a journal entry');
select is((select count(*)::integer from public.transactions t join public.prepaid_rows r on r.entry_id = t.id
  where r.schedule_id = pg_temp.id('s_year') and t.in_cash_override = false and t.project_id = pg_temp.id('maple')),
  12, 'out of the cash view, on the schedule''s project');

-- 2. A start three months ago backfills the four months due, each on its own date.
insert into res values ('past', pg_temp.create_pp('pp-past', pg_temp.id('l_past'), pg_temp.id('insurance'), pg_temp.ym(-3), 12));
insert into pp values ('s_past', ((select r from res where label = 'past')->'data'->>'schedule_id')::uuid);
select is(pg_temp.amounts(pg_temp.id('s_past'), true), array[10000, 10000, 10000, 10000]::bigint[], 'a past start posts the four months due');
select is((select array_agg(t.doc_date order by r.seq) from public.prepaid_rows r join public.transactions t on t.id = r.entry_id
  where r.schedule_id = pg_temp.id('s_past')), array[pg_temp.m1(-3), pg_temp.m1(-2), pg_temp.m1(-1), pg_temp.m1(0)],
  'each on its original date');
select is((select count(*)::integer from public.prepaid_rows where schedule_id = pg_temp.id('s_past') and entry_id is null),
  8, 'the eight months to come are planned');
select is((select r->'data'->>'next_date' from res where label = 'past'), pg_temp.m1(1)::text, 'and the next date is next month');
select is((select count(*)::integer from public.legs l join public.prepaid_rows r on r.entry_id = l.transaction_id
  where r.schedule_id = pg_temp.id('s_past') and r.entry_id is null), 0, 'a planned month has no legs');

-- 3. A re-run posts nothing.
select is(private.prepaid_post_due(), 0, 'the daily run posts nothing when every due month is posted');
select is(private.prepaid_post_due(current_date, pg_temp.id('s_past')), 0, 'nor for one schedule');

-- Idempotency: the same key and call replays; the same key with another call is a conflict.
select is(pg_temp.create_pp('pp-past', pg_temp.id('l_past'), pg_temp.id('insurance'), pg_temp.ym(-3), 12),
  (select r from res where label = 'past'), 'a replay gives the first answer');
select is((select count(*)::integer from public.prepaid_schedules where transaction_id = pg_temp.id('l_past')), 1, 'and writes nothing');
select is(pg_temp.create_pp('pp-past', pg_temp.id('l_past'), pg_temp.id('insurance'), pg_temp.ym(-3), 6)->'error'->>'code',
  'conflict', 'the same key with other arguments is a conflict');

-- Refusals.
select is(pg_temp.create_pp('pp-r1', pg_temp.id('l_past'), pg_temp.id('insurance'), pg_temp.ym(0), 12)->'error'->>'message',
  'the line is already in a prepaid schedule', 'a line already in a schedule is refused');
select is(pg_temp.create_pp('pp-r2', pg_temp.id('l_future'), pg_temp.id('insurance'), pg_temp.ym(0), 12, 90001)->'error'->>'message',
  'amount is above the line', 'an amount above the line is refused');
select is(pg_temp.create_pp('pp-r3', pg_temp.id('r_refund'), pg_temp.id('insurance'), pg_temp.ym(0), 12)->'error'->>'message',
  'the line is not an expense', 'an income line is refused');
select is(pg_temp.create_pp('pp-r4', pg_temp.id('l_future'), pg_temp.id('rent'), pg_temp.ym(0), 12)->'error'->>'message',
  'the category must be an expense category counted in the P&L', 'an income category is refused');
select is(pg_temp.create_pp('pp-r5', pg_temp.id('l_split'), pg_temp.id('insurance'), pg_temp.ym(0), 12)->'error'->>'message',
  'line is already split', 'a line already split is refused');
select is(pg_temp.create_pp('pp-r6', pg_temp.id('l_future'), pg_temp.id('insurance'), '2026-13', 12)->'error'->>'code',
  'validation', 'a month that is not a month is a validation error');
select is(pg_temp.create_pp('pp-r7', pg_temp.id('l_future'), pg_temp.id('insurance'), pg_temp.ym(0), 121)->'error'->>'code',
  'validation', 'and so is a 121st month');
select is(pg_temp.create_pp('pp-r8', (select entry_id from public.prepaid_rows where schedule_id = pg_temp.id('s_past') and seq = 1),
  pg_temp.id('insurance'), pg_temp.ym(0), 12)->'error'->>'message', 'the line is a journal entry', 'a journal entry is refused');
select is(pg_temp.update_pp('pp-r9', pg_temp.id('s_year'), 14)->'error'->>'message', 'the schedule is not active',
  'a completed schedule can''t change');
select is(pg_temp.update_pp('pp-r10', pg_temp.id('s_past'), 4)->'error'->>'message', 'months must be above the months posted',
  'months must stay above the months posted');
select is(pg_temp.end_pp('pp-r11', pg_temp.id('s_past'), pg_temp.ym(-1), 'keep')->'error'->>'message',
  'from_month is before the last posted month', 'an end before the last posted month is refused');

-- Another company: B can't read, change or remove A's schedule; A's owner can read it (positive control).
select is(pg_temp.get_pp(pg_temp.id('s_past'), 'b')->'error'->>'code', 'not_found', 'B does not find A''s schedule');
select is(pg_temp.delete_pp('pp-b1', pg_temp.id('s_past'), 'b')->'error'->>'message', 'The write was refused.',
  'B''s delete of it is refused unworded');
select is(pg_temp.mcp('b', format('select public.mcp_create_prepaid_schedule(%L, %L::uuid, %L::uuid, %L, 12)', 'pp-b2',
  pg_temp.id('l_future'), pg_temp.id('b_cat'), pg_temp.ym(0)))->'error'->>'message',
  'transaction not found', 'B can''t file A''s line');
select is(pg_temp.get_pp(pg_temp.id('s_past'))->'data'->>'schedule_id', pg_temp.id('s_past')::text, 'A''s owner reads it');
select is((select count(*)::integer from public.prepaid_rows where schedule_id = pg_temp.id('s_past') and entry_id is not null), 4,
  'and B''s calls changed nothing');

-- A viewer reads, and can't write; the get shows every row.
select is(jsonb_array_length(pg_temp.mcp('v', 'select public.mcp_list_prepaid_schedules(null)')->'data'->'schedules'), 2,
  'a viewer lists the schedules');
select is(jsonb_array_length(pg_temp.get_pp(pg_temp.id('s_past'), 'v')->'data'->'rows'), 12, 'and reads one with all its rows');
select is(pg_temp.mcp('v', format('select count(*)::text::jsonb from public.prepaid_rows where schedule_id = %L', pg_temp.id('s_past'))),
  '12'::jsonb, 'the tables are readable to members');
select is(pg_temp.delete_pp('pp-v1', pg_temp.id('s_past'), 'v')->'error'->>'code', 'forbidden', 'a viewer''s write is refused');
select is(pg_temp.mcp('a', 'select public.mcp_list_prepaid_schedules(''completed'')')->'data'->'schedules'->0->>'schedule_id',
  pg_temp.id('s_year')::text, 'list keeps one status');
select is(pg_temp.mcp('a', 'select public.mcp_list_prepaid_schedules(''nope'')')->'error'->>'code', 'validation',
  'an unknown status is a validation error');

-- 4. A refund of 139,703 with 158,594 remaining leaves 18,891 over the eight months left.
insert into res values ('refund_s', pg_temp.create_pp('pp-refund', pg_temp.id('l_refund'), pg_temp.id('insurance'), pg_temp.ym(-3), 12));
insert into pp values ('s_refund', ((select r from res where label = 'refund_s')->'data'->>'schedule_id')::uuid);
select is((select (r->'data'->>'remaining_minor')::bigint from res where label = 'refund_s'), 158594::bigint,
  '237,890 over 12 with four months posted leaves 158,594');
select is(pg_temp.refund_pp('pp-refund-1', pg_temp.id('s_refund'), pg_temp.id('r_refund'), 158595)->'error'->>'message',
  'amount is above the line', 'a refund above its line is refused');
insert into res values ('refund', pg_temp.refund_pp('pp-refund-2', pg_temp.id('s_refund'), pg_temp.id('r_refund')));
select is((select r->'data'->>'undo_kind' from res where label = 'refund'), 'prepaid_refund', 'attach_prepaid_refund answers ok');
select is((select (r->'data'->>'remaining_minor')::bigint from res where label = 'refund'), 18891::bigint, '18,891 remains');
select is(pg_temp.amounts(pg_temp.id('s_refund'), false), array[2361, 2361, 2361, 2361, 2361, 2361, 2361, 2364]::bigint[],
  'spread over the eight months left, the last taking the rest');
select is(pg_temp.amounts(pg_temp.id('s_refund'), true), array[19824, 19824, 19824, 19824]::bigint[], 'the posted months stay');
select is((select category_id from public.transactions where id = pg_temp.id('r_refund')),
  (select c.id from public.categories c where c.company_id = pg_temp.id('co') and c.kind = 'income' and c.ledger_account_id = pg_temp.prepaid_acct()),
  'the refund line is filed to the prepaid account''s income category');

-- Books closed (FLOW-156): owner only, never after today, and never past a due month not posted.
select is(pg_temp.close_books('pp-c1', current_date, 'e')->'error'->>'message', 'only the owner can close the books',
  'an editor can''t close the books');
select is(pg_temp.close_books('pp-c2', current_date + 1)->'error'->>'message', 'the date is after today', 'nor can a future date');
-- A month whose entry went (any path) is planned again, and due.
-- (Only the prepaid writers may remove it: the test takes their flag to make one month planned again.)
select set_config('flow.prepaid_apply', 'on', true);
delete from public.transactions where id = (select entry_id from public.prepaid_rows where schedule_id = pg_temp.id('s_year') and seq = 12);
select set_config('flow.prepaid_apply', '', true);
select is(pg_temp.close_books('pp-c3', current_date)->'error'->>'message', 'post the due prepaid rows first',
  'closing past a due month not posted is refused');
select is(private.prepaid_post_due(), 1, 'the daily run posts it again');
insert into res values ('closed', pg_temp.close_books('pp-c4', current_date));
select is((select r->'data' from res where label = 'closed'),
  jsonb_build_object('books_closed_through', current_date, 'previous', null, 'undo_kind', 'books_closed'), 'then the books close');
select is(pg_temp.mcp('a', 'select public.mcp_list_prepaid_schedules(null)')->'data'->>'books_closed_through', current_date::text,
  'list shows the date');
select is(pg_temp.create_pp('pp-c5', pg_temp.id('l_closed'), pg_temp.id('insurance'), pg_temp.ym(-2), 12)->'error'->>'message',
  'the books are closed through ' || to_char(current_date, 'YYYY-MM-DD'), 'a backfill into a closed month is refused');
select is((select category_id from public.transactions where id = pg_temp.id('l_closed')), pg_temp.id('repairs'),
  'and the line keeps its category');
select is(pg_temp.delete_pp('pp-c6', pg_temp.id('s_refund'))->'error'->>'message',
  'the books are closed through ' || to_char(current_date, 'YYYY-MM-DD'), 'deleting posted months in a closed period is refused');
select is(pg_temp.end_pp('pp-c7', pg_temp.id('s_refund'), pg_temp.ym(0), 'expense')->'error'->>'message',
  'the books are closed through ' || to_char(current_date, 'YYYY-MM-DD'), 'an end posting into a closed period is refused');
select is(pg_temp.update_pp('pp-c8', pg_temp.id('s_refund'), 14)->>'ok', 'true', 'a change to the months to come is allowed');
select is(pg_temp.amounts(pg_temp.id('s_refund'), false), array[1889, 1889, 1889, 1889, 1889, 1889, 1889, 1889, 1889, 1890]::bigint[],
  'it spreads 18,891 over ten months');
select is(pg_temp.undo('pp-c9', 'prepaid_update', pg_temp.id('s_refund'))->>'ok', 'true', 'undo prepaid_update');
select is(pg_temp.amounts(pg_temp.id('s_refund'), false), array[2361, 2361, 2361, 2361, 2361, 2361, 2361, 2364]::bigint[],
  'puts the eight months back');
select is(pg_temp.close_books('pp-c10', current_date)->'error'->>'message', 'nothing to change', 'closing to the same date changes nothing');
select is(pg_temp.undo('pp-c11', 'books_closed', pg_temp.id('co'))->'data'->>'kind', 'books_closed', 'undo books_closed');
select is((select books_closed_through from public.companies where id = pg_temp.id('co')), null::date, 'opens the books again');

-- Undo of a refund: the line and the planned months come back.
select is(pg_temp.undo('pp-u1', 'prepaid_refund', pg_temp.id('s_refund'))->>'ok', 'true', 'undo prepaid_refund');
select is(pg_temp.amounts(pg_temp.id('s_refund'), false), array[19824, 19824, 19824, 19824, 19824, 19824, 19824, 19826]::bigint[],
  'the eight months are spread from 158,594 again');
select is((select category_id from public.transactions where id = pg_temp.id('r_refund')), pg_temp.id('rent'),
  'the refund line has its category back');
select is((select count(*)::integer from public.prepaid_refunds where schedule_id = pg_temp.id('s_refund')), 0, 'and the refund is gone');

-- 5. End with expense: from this month, one last row takes what remains and posts at once.
insert into res values ('end', pg_temp.end_pp('pp-end', pg_temp.id('s_past'), pg_temp.ym(0), 'expense'));
select is((select r->'data'->>'status' from res where label = 'end'), 'ended', 'end_prepaid_schedule ends it');
select is((select amount_minor from public.prepaid_rows where schedule_id = pg_temp.id('s_past') and kind = 'end_expense'),
  80000::bigint, 'the end row takes the 80,000 that remained');
select is((select t.doc_date from public.prepaid_rows r join public.transactions t on t.id = r.entry_id
  where r.schedule_id = pg_temp.id('s_past') and r.kind = 'end_expense'), pg_temp.m1(0), 'posted at once, in from_month');
select is((select (r->'data'->>'remaining_minor')::bigint from res where label = 'end'), 0::bigint, 'nothing remains');
select is(pg_temp.update_pp('pp-end-2', pg_temp.id('s_past'), 14)->'error'->>'message', 'the schedule is not active',
  'an ended schedule can''t change');
select is(pg_temp.undo('pp-end-3', 'prepaid_end', pg_temp.id('s_past'))->>'ok', 'true', 'undo prepaid_end');
select is(pg_temp.amounts(pg_temp.id('s_past')), array[10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000]::bigint[],
  'puts the months back');
select is((select status from public.prepaid_schedules where id = pg_temp.id('s_past')), 'active', 'and the schedule is active');
select is(pg_temp.entries(pg_temp.id('s_past')), 4, 'and the end entry is removed');

-- End with keep: what remains stays on Prepaid.
insert into res values ('keep_s', pg_temp.create_pp('pp-keep', pg_temp.id('l_keep'), pg_temp.id('insurance'), pg_temp.ym(-1), 6));
insert into pp values ('s_keep', ((select r from res where label = 'keep_s')->'data'->>'schedule_id')::uuid);
insert into res values ('keep', pg_temp.end_pp('pp-keep-1', pg_temp.id('s_keep'), pg_temp.ym(1), 'keep'));
select is((select r->'data'->>'end_mode' from res where label = 'keep'), 'keep', 'an end can keep what remains');
select is(pg_temp.amounts(pg_temp.id('s_keep')), array[10000, 10000]::bigint[], 'the planned months go, the posted stay');
select is((select (r->'data'->>'remaining_minor')::bigint from res where label = 'keep'), 40000::bigint, '40,000 stays on Prepaid');

-- 6. Undo of create: the line's category comes back and the entries go.
insert into res values ('undo_s', pg_temp.create_pp('pp-undo', pg_temp.id('l_undo'), pg_temp.id('insurance'), pg_temp.ym(-2), 3));
insert into pp values ('s_undo', ((select r from res where label = 'undo_s')->'data'->>'schedule_id')::uuid);
select is(pg_temp.entries(pg_temp.id('s_undo')), 3, 'three months posted');
select is(pg_temp.undo('pp-undo-1', 'prepaid_create', pg_temp.id('s_undo'))->>'ok', 'true', 'undo prepaid_create');
select is((select category_id from public.transactions where id = pg_temp.id('l_undo')), pg_temp.id('repairs'),
  'the payment line has its category back');
select is(pg_temp.entries(pg_temp.id('s_undo')), 0, 'the entries are gone');
select is((select count(*)::integer from public.prepaid_schedules where id = pg_temp.id('s_undo')), 0, 'and so is the schedule');

-- A part of a line: the line is split, and undo puts it back whole.
insert into res values ('part_s', pg_temp.create_pp('pp-part', pg_temp.id('l_part'), pg_temp.id('insurance'), pg_temp.ym(-1), 2, 30000));
insert into pp values ('s_part', ((select r from res where label = 'part_s')->'data'->>'schedule_id')::uuid);
select is((select array_agg(s.amount_minor order by s.ordinal) from private.split_parts s where s.transaction_id = pg_temp.id('l_part')),
  array[30000, 20000]::bigint[], 'a part of the line splits it: the prepaid part and the rest');
select is(pg_temp.undo('pp-part-1', 'prepaid_create', pg_temp.id('s_part'))->>'ok', 'true', 'undo it');
select is((select count(*)::integer from private.split_parts s where s.transaction_id = pg_temp.id('l_part')), 0, 'the line is whole again');

-- Delete and its undo.
insert into res values ('del', pg_temp.delete_pp('pp-del', pg_temp.id('s_keep')));
select is((select r->'data' from res where label = 'del'),
  jsonb_build_object('schedule_id', pg_temp.id('s_keep'), 'entries_removed', 2, 'undo_kind', 'prepaid_delete'), 'delete_prepaid_schedule removes its entries');
select is((select category_id from public.transactions where id = pg_temp.id('l_keep')), pg_temp.id('repairs'),
  'and gives the payment line its category back');
select is(pg_temp.undo('pp-del-1', 'prepaid_delete', pg_temp.id('s_keep'))->>'ok', 'true', 'undo prepaid_delete');
select is(pg_temp.amounts(pg_temp.id('s_keep'), true), array[10000, 10000]::bigint[], 'brings the schedule back with its posted months');
select is((select status || ' ' || end_mode from public.prepaid_schedules where id = pg_temp.id('s_keep')), 'ended keep', 'as it was');
select is(pg_temp.undo('pp-del-2', 'prepaid_delete', pg_temp.id('s_keep'))->'error'->>'code', 'not_found', 'an undo is done once');

-- A schedule's lines and entries change only through the prepaid tools.
select is(pg_temp.refund_pp('pp-g0', pg_temp.id('s_past'), pg_temp.id('r_guard'))->>'ok', 'true', 'a refund line is attached');
insert into res values ('pnl_guard', to_jsonb(pg_temp.pnl_all()));
select is(pg_temp.try('a', format('select public.delete_transaction(%L::uuid)',
  (select entry_id from public.prepaid_rows where schedule_id = pg_temp.id('s_past') and seq = 1))),
  'the entry belongs to a prepaid schedule', 'delete_transaction refuses a posted month''s entry');
select is(pg_temp.try('a', format('select public.delete_transaction(%L::uuid)', pg_temp.id('l_past'))),
  'the line is in a prepaid schedule', 'and the payment line');
select is(pg_temp.try('a', format('select public.delete_transaction(%L::uuid)', pg_temp.id('r_guard'))),
  'the line is in a prepaid schedule', 'and a refund line');
select is(pg_temp.mcp('a', format('select public.mcp_set_expense_category(%L, %L::uuid, %L::uuid)', 'pp-g1',
  pg_temp.id('l_past'), pg_temp.id('repairs')))->'error'->>'message', 'the line is in a prepaid schedule',
  'set_expense_category refuses the payment line');
select is(pg_temp.mcp('a', format('select public.mcp_assign_expense(%L, %L::uuid, %L::uuid, %L::uuid)', 'pp-g2',
  pg_temp.id('l_past'), pg_temp.id('maple'), pg_temp.id('repairs')))->'error'->>'message', 'the line is in a prepaid schedule',
  'assign_expense refuses it');
select is(pg_temp.mcp('a', format('select public.mcp_split_line(%L, %L::uuid, %L::jsonb)', 'pp-g3', pg_temp.id('l_past'),
  jsonb_build_array(jsonb_build_object('category_id', pg_temp.id('repairs'), 'amount_minor', 20000),
    jsonb_build_object('category_id', pg_temp.id('insurance'), 'rest', true))))->'error'->>'message',
  'the line is in a prepaid schedule', 'split_line refuses it');
select is(pg_temp.mcp('a', format('select public.mcp_set_line_pnl(%L, %L::uuid, true)', 'pp-g4', pg_temp.id('l_past')))->'error'->>'message',
  'the line is in a prepaid schedule', 'set_line_pnl refuses it');
select is(pg_temp.mcp('a', format('select public.mcp_set_expense_category(%L, %L::uuid, %L::uuid)', 'pp-g5',
  pg_temp.id('r_guard'), pg_temp.id('rent')))->'error'->>'message', 'the line is in a prepaid schedule',
  'and a refund line can''t be recategorised');
select is(pg_temp.mcp('b', format('select public.mcp_set_expense_category(%L, %L::uuid, %L::uuid)', 'pp-g6',
  pg_temp.id('l_past'), pg_temp.id('b_cat')))->>'ok', 'false', 'nor can another company touch it');
select is(pg_temp.pnl_all(), (select r::bigint from res where label = 'pnl_guard'), 'the P&L did not move');
select is((select category_id from public.transactions where id = pg_temp.id('l_past')),
  (select prepaid_category_id from public.prepaid_schedules where id = pg_temp.id('s_past')), 'and the payment line kept its filing');
-- A bank sync (no user) may void the payment line; the schedule then posts nothing.
select pg_temp.no_user();
update public.transactions set line_status = 'void', removed_at = now() where id = pg_temp.id('l_past');
select is(private.prepaid_post_due(pg_temp.m1(3), pg_temp.id('s_past')), 0, 'a schedule whose payment line a sync voided posts nothing');
update public.transactions set line_status = 'posted', removed_at = null where id = pg_temp.id('l_past');
select is(private.prepaid_post_due(pg_temp.m1(1), pg_temp.id('s_past')), 1, 'and posts again once the line is back');

-- 7. Posting never moves cash: the cash views and the bank are the same before and after.
insert into res values ('future', pg_temp.create_pp('pp-future', pg_temp.id('l_future'), pg_temp.id('insurance'), pg_temp.ym(1), 3));
insert into pp values ('s_future', ((select r from res where label = 'future')->'data'->>'schedule_id')::uuid);
select is(pg_temp.update_pp('pp-future-1', pg_temp.id('s_future'), 6)->>'ok', 'true', 'a planned schedule is spread over six months');
insert into res values ('cash_before', pg_temp.cash_print());
select cmp_ok(private.prepaid_post_due(pg_temp.m1(4)), '>=', 3, 'posting the months to come');
select is(pg_temp.cash_print(), (select r from res where label = 'cash_before'), 'leaves cash_months, cash_month_lines and the bank legs as they were');

-- Undo after the job posted: the schedule no longer reads as the write left it, so undo is a conflict
-- and keeps the job's posts; delete_prepaid_schedule is the way back.
select is(pg_temp.undo('pp-future-2', 'prepaid_update', pg_temp.id('s_future'))->'error'->>'code', 'conflict',
  'undo after the job posted a month is a conflict');
select is(pg_temp.entries(pg_temp.id('s_future')), 4, 'and the job''s four posts stay');
select is(pg_temp.delete_pp('pp-future-3', pg_temp.id('s_future'))->'data'->>'entries_removed', '4', 'delete takes them back');

-- The daily job, where pg_cron is installed (the local test databases may lack it).
create or replace function pg_temp.cron_job()
returns text language plpgsql set search_path = '' as $$
declare r text;
begin
  execute 'select schedule || '' '' || btrim(command) from cron.job where jobname = ''flow-prepaid-post''' into r;
  return r;
end; $$;
select ok(not exists (select 1 from pg_extension where extname = 'pg_cron')
  or pg_temp.cron_job() = '41 0 * * * select private.prepaid_post_due();', 'flow-prepaid-post runs daily where pg_cron is installed');

-- A company with schedules, posted months and refunds can still be deleted.
delete from public.companies where id = pg_temp.id('co');
select is((select count(*)::integer from public.prepaid_schedules where company_id = pg_temp.id('co')), 0,
  'deleting the company removes its schedules with its lines');

select * from finish();

rollback;
