-- FLOW-1171 (perf queue, small database fixes). Pins what 20261113083534_sql_small_speed.sql touched:
-- the P&L line states read only the caller's company's lines, the forecast helpers keep their answers
-- (the month, quarter, year and once paces, and start months), and projects_cash_month counts each
-- project's waiting lines as project_waiting does.
-- Invented data only. The month is September 2026, "today" is 2026-09-20.

begin;

select plan(29);

do $users$
begin
  perform tests.create_supabase_user('sle_owner', 'sle-owner@example.com');
  perform tests.create_supabase_user('sle_other', 'sle-other@example.com');
end
$users$;

create temp table sle (label text primary key, id uuid);
grant all on sle to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.sle where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into sle (label, id) values ('co', tests.fixture_company('sle_owner', 'Example Speed LLC'));
insert into sle (label, id) values ('other_co', tests.fixture_company('sle_other', 'Example Other Speed LLC'));
insert into sle (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('shop', tests.fixture_project(pg_temp.id('co'), 'Example Shop')),
  ('other_house', tests.fixture_project(pg_temp.id('other_co'), 'Example Other House')),
  ('elec', tests.fixture_category(pg_temp.id('co'), 'Electricity')),
  ('paint', tests.fixture_category(pg_temp.id('co'), 'Paint'));

-- Two filed expenses, one each in two projects.
insert into sle (label, id) values
  ('a', tests.fixture_line(pg_temp.id('co'), 'sle:a', 10000, p_project => pg_temp.id('house'),
    p_category => pg_temp.id('elec'), p_doc_date => '2026-09-05')),
  ('b', tests.fixture_line(pg_temp.id('co'), 'sle:b', 5000, p_project => pg_temp.id('shop'),
    p_category => pg_temp.id('paint'), p_doc_date => '2026-09-06'));
-- Two expenses of the house that wait for a review.
insert into sle (label, id) values
  ('w1', tests.fixture_line(pg_temp.id('co'), 'sle:w1', 7000, p_project => pg_temp.id('house'),
    p_category => pg_temp.id('elec'), p_doc_date => '2026-09-07')),
  ('w2', tests.fixture_line(pg_temp.id('co'), 'sle:w2', 3000, p_project => pg_temp.id('house'),
    p_category => pg_temp.id('paint'), p_doc_date => '2026-09-08'));
insert into public.review_queue (company_id, transaction_id, status, reason)
values (pg_temp.id('co'), pg_temp.id('w1'), 'open', 'suggested'),
  (pg_temp.id('co'), pg_temp.id('w2'), 'open', 'suggested');
-- The other company's expense, waiting for a review.
insert into sle (label, id) values
  ('ox', tests.fixture_line(pg_temp.id('other_co'), 'sle:ox', 4000, p_project => pg_temp.id('other_house'),
    p_category => null, p_doc_date => '2026-09-09'));
insert into public.review_queue (company_id, transaction_id, status, reason)
values (pg_temp.id('other_co'), pg_temp.id('ox'), 'open', 'suggested');

-- line_pnl_states reads the caller's company's lines only. Passing another company's line gives nothing for it.
select tests.authenticate_as('sle_owner');

select is(
  (select array_agg(x.transaction_id order by x.transaction_id) from private.line_pnl_states(
    array[pg_temp.id('a'), pg_temp.id('ox')]) x),
  array[pg_temp.id('a')],
  'line_pnl_states returns only the caller''s company''s lines'
);
select is(
  (select x.state from private.line_pnl_states(array[pg_temp.id('a')]) x where x.transaction_id = pg_temp.id('a')),
  'in',
  'a filed expense of a project is in the P&L'
);
select is(
  (select count(*)::int from private.line_pnl_states(array[pg_temp.id('a'), pg_temp.id('b'), pg_temp.id('ox')],
    pg_temp.id('house'), null)),
  2,
  'the project overload answers for the caller''s lines only (two of them)'
);
select is(
  (select count(*)::int from private.line_pnl_states(array[pg_temp.id('a'), pg_temp.id('b'), pg_temp.id('ox')],
    pg_temp.id('house'), null) x where x.transaction_id = pg_temp.id('ox')),
  0,
  'the project overload skips another company''s line'
);

-- Another company's owner reads its own line only.
select tests.authenticate_as('sle_other');
select is(
  (select array_agg(x.transaction_id) from private.line_pnl_states(array[pg_temp.id('a'), pg_temp.id('ox')]) x),
  array[pg_temp.id('ox')],
  'another company''s owner reads its own line, not the first company''s'
);

-- projects_cash_month for the first company: the waiting count of each project.
select tests.authenticate_as('sle_owner');

select is(
  (select (p ->> 'pending_count')::int
     from jsonb_array_elements(public.projects_cash_month('2026-09-01', '2026-09-20', null) -> 'projects') p
    where p ->> 'id' = pg_temp.id('house')::text),
  jsonb_array_length(public.project_waiting(pg_temp.id('house'))),
  'projects_cash_month counts the house''s waiting lines as project_waiting lists them'
);
select is(
  (select (p ->> 'pending_count')::int
     from jsonb_array_elements(public.projects_cash_month('2026-09-01', '2026-09-20', null) -> 'projects') p
    where p ->> 'id' = pg_temp.id('house')::text),
  2,
  'the two lines with an open review row wait on the house'
);
select is(
  (select (p ->> 'pending_count')::int
     from jsonb_array_elements(public.projects_cash_month('2026-09-01', '2026-09-20', null) -> 'projects') p
    where p ->> 'id' = pg_temp.id('shop')::text),
  0,
  'a project with no waiting line counts zero'
);
select is(
  (select sum((p ->> 'pending_count')::int)
     from jsonb_array_elements(public.projects_cash_month('2026-09-01', '2026-09-20', null) -> 'projects') p),
  (select sum(jsonb_array_length(public.project_waiting(s.id))) from public.projects s where s.company_id = pg_temp.id('co')),
  'the waiting counts of all the company''s projects add up to project_waiting''s'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.projects_cash_month('2026-09-01', '2026-09-20', null) -> 'projects') p
    where p ->> 'id' in (pg_temp.id('house')::text, pg_temp.id('shop')::text)),
  2,
  'the first company''s month lists its two projects'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.projects_cash_month('2026-09-01', '2026-09-20', null) -> 'projects') p
    where p ->> 'id' = pg_temp.id('other_house')::text),
  0,
  'the first company''s month does not list the other company''s project'
);

-- The other company's owner sees its own project only, and no project of the first company.
select tests.authenticate_as('sle_other');
select is(
  (select count(*)::int from jsonb_array_elements(public.projects_cash_month('2026-09-01', '2026-09-20', null) -> 'projects') p
    where p ->> 'id' = pg_temp.id('other_house')::text),
  1,
  'the other company''s month lists its own project'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.projects_cash_month('2026-09-01', '2026-09-20', null) -> 'projects') p
    where p ->> 'id' in (pg_temp.id('house')::text, pg_temp.id('shop')::text)),
  0,
  'the other company''s month does not list the first company''s projects'
);
select ok(
  public.projects_cash_month('2026-09-01', '2026-09-20', pg_temp.id('house')) is null,
  'a project of another company is refused'
);

-- The forecast helpers keep their answers. The month index counts months from year zero. They are private, so
-- as the table owner.
select tests.clear_authentication();
reset role;

select is(private.pfe_month_index('2026-03'), 2026 * 12 + 2, 'pfe_month_index counts the month');
select ok(private.pfe_hits('2026-01', 'month', '2026-05'), 'a monthly edit applies in every later month');
select ok(not private.pfe_hits('2026-05', 'month', '2026-01'), 'an edit does not apply before its start month');
select ok(private.pfe_hits('2026-03', 'once', '2026-03'), 'a one-time edit applies in its start month');
select ok(not private.pfe_hits('2026-03', 'once', '2026-04'), 'a one-time edit does not apply in the next month');
select ok(private.pfe_hits('2026-01', '2months', '2026-05'), 'a two-month edit applies at an even gap');
select ok(not private.pfe_hits('2026-01', '2months', '2026-04'), 'a two-month edit does not apply at an odd gap');
select ok(private.pfe_hits('2026-01', 'quarter', '2026-04'), 'a quarterly edit applies at a gap of three');
select ok(not private.pfe_hits('2026-01', 'quarter', '2026-05'), 'a quarterly edit does not apply at a gap of four');
select ok(private.pfe_hits('2026-01', 'year', '2027-01'), 'a yearly edit applies at a gap of twelve');
select ok(not private.pfe_hits('2026-01', 'year', '2026-12'), 'a yearly edit does not apply at a gap of eleven');
select ok(not private.pfe_hits('2026-01', 'weekly', '2026-05'), 'an unknown pace applies to no month');
select is(private.pfe_hits('2026-01', null, '2026-05'), false, 'a missing pace applies to no month');

-- The helpers keep their volatility and drop their search_path setting, so Postgres inlines them.
select is(
  (select provolatile::text from pg_proc where oid = 'private.pfe_hits(text,text,text)'::regprocedure), 'i',
  'pfe_hits stays immutable'
);
select is(
  (select array[(select proconfig is null from pg_proc where oid = 'private.pfe_hits(text,text,text)'::regprocedure),
    (select proconfig is null from pg_proc where oid = 'private.pfe_month_index(text)'::regprocedure),
    (select proconfig is null from pg_proc where oid = 'private.pfe_json(public.project_forecast_edits)'::regprocedure)]),
  array[true, true, true],
  'pfe_hits, pfe_month_index and pfe_json set no search_path'
);

select * from finish();
rollback;
