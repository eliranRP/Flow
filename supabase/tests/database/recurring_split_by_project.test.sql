-- Decision 0185. A recurring charge is a party's charges for one project: a servicer paying three
-- loans (three properties) is three charges, each with its own usual amount, arrival and alert.
-- Invented data only. Amounts are cents. "Today" is 2026-10-20.

begin;

select plan(13);

do $users$
begin
  perform tests.create_supabase_user('sp_owner', 'sp-owner@example.com');
end
$users$;

create temp table sp (label text primary key, id uuid);
grant all on sp to authenticated, service_role;

insert into sp (label, id) values ('co', tests.fixture_company('sp_owner', 'Example Split LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.sp where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into sp (label, id) values
  ('alder', tests.fixture_project(pg_temp.id('co'), 'Alder Ct')),
  ('birch', tests.fixture_project(pg_temp.id('co'), 'Birch Way')),
  ('cedar', tests.fixture_project(pg_temp.id('co'), 'Cedar Run'));

insert into public.suppliers (company_id, name) values (pg_temp.id('co'), 'Example Servicing');
insert into sp (label, id)
select 'servicer', s.id from public.suppliers s where s.company_id = pg_temp.id('co') and s.name = 'Example Servicing';

-- Alder: $4,000 on the 1st, April to October. Birch: $2,500 on the 2nd, April to September, and an
-- October payment of $2,490 not filed yet. Cedar: $2,000 on the 3rd, April to September, none in October.
create temp table sp_lines (key text, project text, doc_date date, amount bigint);
insert into sp_lines
select 'alder:' || d::date, 'alder', d::date, 400000 from generate_series('2026-04-01'::date, '2026-10-01', interval '1 month') d;
insert into sp_lines
select 'birch:' || d::date, 'birch', d::date + 1, 250000 from generate_series('2026-04-01'::date, '2026-09-01', interval '1 month') d;
insert into sp_lines values ('birch-new', null, '2026-10-02', 249000);
insert into sp_lines
select 'cedar:' || d::date, 'cedar', d::date + 2, 200000 from generate_series('2026-04-01'::date, '2026-09-01', interval '1 month') d;

insert into sp (label, id)
select l.key, tests.fixture_line(
  pg_temp.id('co'), 'sp:' || l.key, l.amount, 'expense', pg_temp.id(l.project), null, l.doc_date,
  p_currency => 'USD', p_pnl_role => null
)
from sp_lines l;
update public.transactions t set supplier_id = pg_temp.id('servicer')
where t.company_id = pg_temp.id('co');

create or replace function pg_temp.charge(p_project text)
returns jsonb
language sql
as $$
  select e from jsonb_array_elements(public.recurring_schedule('2026-10-20')) e
  where (e ->> 'party_id')::uuid = pg_temp.id('servicer') and (e ->> 'project_id')::uuid = pg_temp.id(p_project);
$$;
grant execute on function pg_temp.charge(text) to authenticated, service_role;

select tests.authenticate_as('sp_owner');

-- 1-4. One charge per project, each with its own usual amount.
select is(
  (select count(*)::integer from jsonb_array_elements(public.recurring_schedule('2026-10-20')) e
   where (e ->> 'party_id')::uuid = pg_temp.id('servicer')),
  3,
  'a servicer paying three properties is three charges'
);
select is((pg_temp.charge('alder') ->> 'typical_amount_minor')::bigint, -400000::bigint, 'the first property keeps its own usual amount');
select is((pg_temp.charge('birch') ->> 'typical_amount_minor')::bigint, -250000::bigint, 'the second property keeps its own usual amount');
select is((pg_temp.charge('cedar') ->> 'typical_amount_minor')::bigint, -200000::bigint, 'the third property keeps its own usual amount');

-- 5-6. October's payments arrive on their own charge; the unfiled one joins the closest amount.
select is(abs((pg_temp.charge('alder') ->> 'amount_minor')::bigint), 400000::bigint, 'an arrival counts its own property''s payment only');
select is(abs((pg_temp.charge('birch') ->> 'amount_minor')::bigint), 249000::bigint, 'a payment not filed yet joins the charge whose amount is closest');

-- 7. Cedar has not come in October: it is late on its own.
select is(pg_temp.charge('cedar') ->> 'state', 'late', 'a property whose payment has not come is late, the others are not');

-- 8. No mixed month makes a change.
select is(
  (select count(*)::integer from jsonb_array_elements(public.recurring_changes('2026-10-20')) e
   where (e ->> 'party_id')::uuid = pg_temp.id('servicer')),
  0,
  'payments at their usual amounts make no change alert'
);

-- 9. A late property's alert key names its project, so dismissing one leaves the others.
select is(
  (select e ->> 'alert_key' from jsonb_array_elements(public.missing_bills('2026-10-20')) e
   where (e ->> 'party_id')::uuid = pg_temp.id('servicer')),
  'expense:' || pg_temp.id('servicer') || ':USD:2026-10:' || pg_temp.id('cedar'),
  'a split party''s late bill key carries its project'
);

-- 10-11. The newest line of one charge.
select is(
  public.recurring_party_line('expense', pg_temp.id('servicer'), 'USD', '2026-10-20', pg_temp.id('birch')),
  pg_temp.id('birch-new'),
  'the newest line of a charge is its own project''s'
);
select is(
  public.recurring_party_line('expense', pg_temp.id('servicer'), 'USD', '2026-10-20'),
  pg_temp.id('birch-new'),
  'without a project, the newest line of the party'
);

-- 12. A line's recurring state reads its own charge.
select is(
  (public.payment_recurring(pg_temp.id('alder:2026-10-01'), '2026-10-20') ->> 'typical_amount_minor')::bigint,
  -400000::bigint,
  'a line reads the usual amount of its own property''s charge'
);

-- 13. The helper stays private.
select ok(
  not has_function_privilege('authenticated', 'private.recurring_stream_lines(uuid, date)', 'execute'),
  'a signed-in user cannot call the stream helper'
);

select * from finish();
rollback;
