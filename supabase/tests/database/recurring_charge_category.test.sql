-- FLOW-998. Each recurring charge's category (private.recurring_parties): the category of most of its
-- counted lines, then of its latest line, then the lowest id. A monthly charge counts its last 6 months
-- only. A charge with no categorised line has none. Each charge picks from its own lines only.
-- Invented data only. Amounts are agorot. "Today" is 2026-10-20, so the last 6 months are April to September.

begin;

select plan(6);

do $users$
begin
  perform tests.create_supabase_user('rcc_owner', 'rcc-owner@example.com');
end
$users$;

create temp table rcc (label text primary key, id uuid);

insert into rcc (label, id) values ('co', tests.fixture_company('rcc_owner', 'Example Charge Category LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.rcc where label = p_label; $$;

insert into rcc (label, id) values
  ('elec', tests.fixture_category(pg_temp.id('co'), 'Example Electricity')),
  ('paint', tests.fixture_category(pg_temp.id('co'), 'Example Paint'));

insert into public.suppliers (company_id, name)
select pg_temp.id('co'), n
from unnest(array['Example Most', 'Example Latest', 'Example Window', 'Example Tie', 'Example Bare']) n;
insert into rcc (label, id)
select lower(replace(s.name, 'Example ', '')), s.id from public.suppliers s where s.company_id = pg_temp.id('co');

-- party, date, category: one bill a month from April to September 2026 unless said otherwise.
create temp table rcc_lines (party text, doc_date date, category text);
-- Most: electricity in four months, paint in two.
insert into rcc_lines
select 'most', d::date + 4, case when d < '2026-08-01' then 'elec' else 'paint' end
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
-- Latest: electricity from April to June, paint from July to September, three each.
insert into rcc_lines
select 'latest', d::date + 6, case when d < '2026-07-01' then 'elec' else 'paint' end
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
-- Window: paint every month of the last six, and electricity in eight months of 2025 before them.
insert into rcc_lines
select 'window', d::date + 8, 'paint'
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
insert into rcc_lines
select 'window', d::date + 8, 'elec'
from generate_series('2025-03-01'::date, '2025-10-01'::date, interval '1 month') d;
-- Tie: each month one electricity bill and one paint bill on the same day.
insert into rcc_lines
select 'tie', d::date + 10, c
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d, unnest(array['elec', 'paint']) c;
-- Bare: no category on any bill.
insert into rcc_lines
select 'bare', d::date + 12, null
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;

create temp table rcc_ids as
select tests.fixture_line(
  pg_temp.id('co'), 'rcc:' || l.party || ':' || l.doc_date || ':' || coalesce(l.category, '-'), 5000, 'expense',
  null, pg_temp.id(l.category), l.doc_date, p_pnl_role => null
) as id
from rcc_lines l;
update public.transactions t
set supplier_id = pg_temp.id(split_part(t.idempotency_key, ':', 2))
where t.company_id = pg_temp.id('co') and t.idempotency_key like 'rcc:%';

create or replace function pg_temp.category(p_party text)
returns uuid
language sql
as $$
  select rp.category_id from private.recurring_parties(pg_temp.id('co'), '2026-10-20') rp
  where rp.party_id = pg_temp.id(p_party);
$$;

select is(
  (select count(*)::integer from private.recurring_parties(pg_temp.id('co'), '2026-10-20')),
  5,
  'each party is one monthly charge'
);
select is(pg_temp.category('most'), pg_temp.id('elec'), 'a charge takes the category of most of its lines');
select is(pg_temp.category('latest'), pg_temp.id('paint'),
  'on a tie in count, the category of its latest line');
select is(pg_temp.category('window'), pg_temp.id('paint'),
  'a monthly charge counts its last 6 months only, not more numerous older lines');
select is(pg_temp.category('tie'), least(pg_temp.id('elec'), pg_temp.id('paint')),
  'on a tie in count and latest date, the lowest id');
select is(pg_temp.category('bare'), null, 'a charge with no categorised line has no category');

select * from finish();
rollback;
