-- FLOW-517: weekly_summary, one company's week (Sunday to Saturday, Israel time) for the weekly
-- summary sheet. Invented data only. Amounts are agorot.
-- The week is Sunday 2026-06-07 to Saturday 2026-06-13; the week before, 2026-05-31 to 2026-06-06.

begin;

select plan(20);

select tests.create_supabase_user('wks_owner', 'wks-owner@example.com');
select tests.create_supabase_user('wks_other', 'wks-other@example.com');

create temp table wks (label text primary key, id uuid);
grant all on wks to authenticated, service_role;

insert into wks (label, id) values
  ('co', tests.fixture_company('wks_owner', 'Example Weekly LLC')),
  ('other', tests.fixture_company('wks_other', 'Example Weekly Other LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.wks where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into wks (label, id) values
  ('rent_cat', tests.fixture_category(pg_temp.id('co'), 'Rent', 'income')),
  ('repairs_cat', tests.fixture_category(pg_temp.id('co'), 'Repairs', 'expense')),
  ('rehab_cat', tests.fixture_category(pg_temp.id('co'), 'Rehab', 'expense', true)),
  ('over_a', tests.fixture_project(pg_temp.id('co'), 'Example Over A')),
  ('over_b', tests.fixture_project(pg_temp.id('co'), 'Example Over B')),
  ('under', tests.fixture_project(pg_temp.id('co'), 'Example Under')),
  ('done', tests.fixture_project(pg_temp.id('co'), 'Example Done', 'finished'));

-- The week's SUMIT lines: money in on the 8th, money out on the 10th, a rehab payment (in cash, kept
-- out of profit) on the 11th, and money in that came in late on Saturday night, Israel time.
insert into wks (label, id) values
  ('in_wk', tests.fixture_line(pg_temp.id('co'), 'wks:in', 100000, 'income', null,
    pg_temp.id('rent_cat'), '2026-06-08', p_source => 'sumit', p_pnl_role => null, p_doc_kind => 'invoice_receipt')),
  ('out_wk', tests.fixture_line(pg_temp.id('co'), 'wks:out', 40000, 'expense', null,
    pg_temp.id('repairs_cat'), '2026-06-10', p_source => 'sumit', p_pnl_role => 'overhead')),
  ('kept_wk', tests.fixture_line(pg_temp.id('co'), 'wks:kept', 25000, 'expense', null,
    pg_temp.id('rehab_cat'), '2026-06-11', p_source => 'sumit', p_pnl_role => 'overhead')),
  ('sat_late', tests.fixture_line(pg_temp.id('co'), 'wks:sat', 5000, 'income', null,
    pg_temp.id('rent_cat'), '2026-06-13', p_source => 'sumit', p_pnl_role => null, p_doc_kind => 'invoice_receipt')),
  -- Came in at 00:10 on Sunday the 14th, Israel time: the next week's.
  ('sun_next', tests.fixture_line(pg_temp.id('co'), 'wks:sun', 7000, 'income', null,
    pg_temp.id('rent_cat'), '2026-06-14', p_source => 'sumit', p_pnl_role => null, p_doc_kind => 'invoice_receipt')),
  -- Typed in by hand during the week: in the sums, not in the line counts.
  ('manual_wk', tests.fixture_line(pg_temp.id('co'), 'wks:manual', 3000, 'expense', null,
    pg_temp.id('repairs_cat'), '2026-06-09', p_pnl_role => 'overhead')),
  -- The week before: money out on the 2nd.
  ('out_prev', tests.fixture_line(pg_temp.id('co'), 'wks:prev', 30000, 'expense', null,
    pg_temp.id('repairs_cat'), '2026-06-02', p_source => 'sumit', p_pnl_role => 'overhead')),
  -- Project spending in May, outside both weeks.
  ('spend_a', tests.fixture_line(pg_temp.id('co'), 'wks:a', 80000, 'expense', pg_temp.id('over_a'),
    pg_temp.id('repairs_cat'), '2026-05-01')),
  ('spend_b', tests.fixture_line(pg_temp.id('co'), 'wks:b', 120000, 'expense', pg_temp.id('over_b'),
    pg_temp.id('repairs_cat'), '2026-05-01')),
  ('spend_under', tests.fixture_line(pg_temp.id('co'), 'wks:u', 10000, 'expense', pg_temp.id('under'),
    pg_temp.id('repairs_cat'), '2026-05-01')),
  ('spend_done', tests.fixture_line(pg_temp.id('co'), 'wks:d', 900000, 'expense', pg_temp.id('done'),
    pg_temp.id('repairs_cat'), '2026-05-01')),
  ('other_wk', tests.fixture_line(pg_temp.id('other'), 'wks:other', 999900, 'income', null, null, '2026-06-09',
    p_source => 'sumit', p_pnl_role => null, p_doc_kind => 'invoice_receipt'));

update public.transactions set created_at = '2026-06-09 10:00:00+03'
  where id in (pg_temp.id('in_wk'), pg_temp.id('out_wk'), pg_temp.id('kept_wk'), pg_temp.id('manual_wk'), pg_temp.id('other_wk'));
update public.transactions set created_at = '2026-06-13 23:30:00+03' where id = pg_temp.id('sat_late');
update public.transactions set created_at = '2026-06-14 00:10:00+03' where id = pg_temp.id('sun_next');
update public.transactions set created_at = '2026-06-03 10:00:00+03' where id = pg_temp.id('out_prev');

-- A: 80,000 of 50,000 (160%); B: 120,000 of 100,000 (120%); under budget; finished and over.
update public.projects set budget_agorot = 50000 where id = pg_temp.id('over_a');
update public.projects set budget_agorot = 100000 where id = pg_temp.id('over_b');
update public.projects set budget_agorot = 100000 where id = pg_temp.id('under');
update public.projects set budget_agorot = 1000 where id = pg_temp.id('done');

-- Review: the money out waits; the rehab line was approved by hand; last week's line still waits.
delete from public.review_queue where company_id in (pg_temp.id('co'), pg_temp.id('other'));
insert into public.review_queue (company_id, transaction_id, status) values
  (pg_temp.id('co'), pg_temp.id('out_wk'), 'open'),
  (pg_temp.id('co'), pg_temp.id('kept_wk'), 'approved'),
  (pg_temp.id('co'), pg_temp.id('out_prev'), 'open');

create or replace function pg_temp.wk()
returns jsonb
language sql
stable
as $$ select public.weekly_summary('2026-06-07') $$;
grant execute on function pg_temp.wk() to authenticated, service_role;

select tests.authenticate_as('wks_owner');

-- 1-2. The week's frame.
select is(pg_temp.wk() ->> 'week_start', '2026-06-07', 'the week starts on its Sunday');
select is(pg_temp.wk() ->> 'currency', 'ILS', 'the sums are in the base currency');

-- 3-6. The sums, by the cash view's dates; the manual line counts in them.
select is((pg_temp.wk() ->> 'in_minor')::bigint, 105000::bigint, 'money in counts the 8th and Saturday the 13th, not Sunday the 14th');
select is((pg_temp.wk() ->> 'out_minor')::bigint, 68000::bigint, 'money out counts the week''s payments, the rehab and the manual one');
select is((pg_temp.wk() ->> 'profit_minor')::bigint, 62000::bigint, 'profit leaves the rehab out');
select is((pg_temp.wk() ->> 'kept_out_minor')::bigint, -25000::bigint, 'the rehab is not counted in profit');

-- 7. In − out = profit + kept out, always.
select is(
  (pg_temp.wk() ->> 'in_minor')::bigint - (pg_temp.wk() ->> 'out_minor')::bigint,
  (pg_temp.wk() ->> 'profit_minor')::bigint + (pg_temp.wk() ->> 'kept_out_minor')::bigint,
  'in − out = profit + kept out'
);

-- 8. The week before.
select is((pg_temp.wk() ->> 'prev_profit_minor')::bigint, -30000::bigint, 'the week before''s profit');

-- 9-12. The counts: connector lines that came in during the week, Israel time.
select is((pg_temp.wk() ->> 'lines')::integer, 4, 'four SUMIT lines came in, Saturday 23:30 included, Sunday 00:10 and the manual line not');
select is((pg_temp.wk() ->> 'auto_approved')::integer, 2, 'lines with no review row were approved without a tap');
select is((pg_temp.wk() ->> 'week_waiting')::integer, 1, 'one of the week''s lines waits');
select is((pg_temp.wk() ->> 'waiting')::integer, 2, 'the whole open queue, last week''s line included');

-- 13-14. The project most over budget, and how many more.
select is(pg_temp.wk() -> 'alert' ->> 'name', 'Example Over A', 'the largest overrun in percent wins');
select is((pg_temp.wk() ->> 'more_over_budget')::integer, 1, 'one more active project is over; a finished one is not counted');

-- 15. A week before the books started has no week before to compare with.
select ok(public.weekly_summary('2026-04-05') -> 'prev_profit_minor' = 'null'::jsonb, 'no week before the books start');

-- 16-18. The week must be a Sunday, not in the future, and not null.
select throws_ok($$ select public.weekly_summary('2026-06-08') $$, 'validation', 'a Monday is refused');
select throws_ok($$ select public.weekly_summary('2099-01-04') $$, 'validation', 'a future week is refused');
select throws_ok($$ select public.weekly_summary(null) $$, 'validation', 'a null week is refused');

-- 19. Another company's lines never show.
reset role;
select tests.authenticate_as('wks_other');
select is((pg_temp.wk() ->> 'lines')::integer, 1, 'the other company sees only its own line');

-- 20. App users can call it; anonymous ones cannot.
reset role;
select ok(
  has_function_privilege('authenticated', 'public.weekly_summary(date)', 'execute')
    and not has_function_privilege('anon', 'public.weekly_summary(date)', 'execute'),
  'the read is granted to app users, not to anon'
);

select * from finish();
rollback;
