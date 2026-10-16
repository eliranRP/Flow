-- FLOW-447 (decision 0175). recurring_schedule() gives each recurring party its state this month:
-- arrived, late, soon or later. Invented data only. Amounts are cents. "Today" is 2026-10-20.

begin;

select plan(10);

do $users$
begin
  perform tests.create_supabase_user('rs_owner', 'rs-owner@example.com');
end
$users$;

create temp table rs (label text primary key, id uuid);
grant all on rs to authenticated, service_role;

insert into rs (label, id) values ('co', tests.fixture_company('rs_owner', 'Example Schedule LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.rs where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- arrived: monthly, a line in October. late: monthly, day 3, nothing in October (expected by the 8th).
-- soon: monthly, day 25, nothing in October yet. later: every two months, last line in September.
insert into public.suppliers (company_id, name)
select pg_temp.id('co'), n from unnest(array['Arrived Power', 'Late Water', 'Soon Pest', 'Later Lawn']) n;
insert into rs (label, id)
select case s.name when 'Arrived Power' then 'arrived' when 'Late Water' then 'late'
  when 'Soon Pest' then 'soon' else 'later' end, s.id
from public.suppliers s where s.company_id = pg_temp.id('co');

create temp table rs_lines (label text, doc_date date, amount bigint);
insert into rs_lines
select 'arrived', d::date + 1, 9000 from generate_series('2026-04-01'::date, '2026-10-01', interval '1 month') d;
insert into rs_lines
select 'late', d::date + 2, 4200 from generate_series('2026-04-01'::date, '2026-09-01', interval '1 month') d;
insert into rs_lines
select 'soon', d::date + 24, 6500 from generate_series('2026-04-01'::date, '2026-09-01', interval '1 month') d;
insert into rs_lines
select 'later', d::date + 4, 12000 from generate_series('2026-03-01'::date, '2026-09-01', interval '2 months') d;

insert into rs (label, id)
select l.label || '_' || row_number() over (partition by l.label order by l.doc_date), tests.fixture_line(
  pg_temp.id('co'), 'rs:' || l.label || ':' || l.doc_date::text, l.amount, 'expense', null, null, l.doc_date,
  p_currency => 'USD', p_pnl_role => null
)
from rs_lines l;
update public.transactions t
set supplier_id = pg_temp.id(l.label)
from rs_lines l
where t.id = (select id from pg_temp.rs x where x.label = l.label || '_' || (
  select count(*) from rs_lines z where z.label = l.label and z.doc_date <= l.doc_date)::text);

create or replace function pg_temp.row_for(p_label text)
returns jsonb
language sql
as $$
  select e from jsonb_array_elements(public.recurring_schedule('2026-10-20')) e
  where (e ->> 'party_id')::uuid = pg_temp.id(p_label);
$$;
grant execute on function pg_temp.row_for(text) to authenticated, service_role;

select tests.authenticate_as('rs_owner');

select is(pg_temp.row_for('arrived') ->> 'state', 'arrived', 'a party seen in October is arrived');
select is(pg_temp.row_for('late') ->> 'state', 'late', 'a party past its expected day with no line is late');
select is(pg_temp.row_for('soon') ->> 'state', 'soon', 'a party due later this month is soon');
select is(pg_temp.row_for('later') ->> 'state', 'later', 'a party whose next month is after this one is later');
select is(pg_temp.row_for('later') ->> 'pace', '2months', 'the pace comes from recurring_parties');
select is(pg_temp.row_for('late') ->> 'next_due_month', '2026-10', 'the next due month is this month for a late party');
select is(abs((pg_temp.row_for('arrived') ->> 'amount_minor')::bigint), 9000::bigint, 'an arrived party shows this month''s live amount');
select ok(not has_function_privilege('anon', 'public.recurring_schedule(date)', 'execute'), 'anon cannot run the schedule read');
select ok(has_function_privilege('authenticated', 'public.recurring_schedule(date)', 'execute'), 'a signed-in user can run the schedule read');
select is(
  (select count(distinct e ->> 'party_id')::integer from jsonb_array_elements(public.recurring_schedule('2026-10-20')) e),
  jsonb_array_length(public.recurring_schedule('2026-10-20')),
  'each party appears once'
);

select * from finish();
rollback;
