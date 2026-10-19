-- The recurring reads, set-based (20261019122231): private.recurring_stream_lines gives a line with no
-- project the same stream project as the per-line subquery it replaced, ties included, and
-- private.line_pnl_states(ids, project, category) gives what line_pnl_state(id, project, category) gives.
-- Invented data only. Amounts are cents. "Today" is 2026-10-20.

begin;

select plan(14);

do $users$
begin
  perform tests.create_supabase_user('rs_owner', 'rs-owner@example.com');
  perform tests.create_supabase_user('rs_outsider', 'rs-outsider@example.com');
end
$users$;

create temp table rs (label text primary key, id uuid);
grant all on rs to authenticated, service_role;

insert into rs (label, id) values
  ('co', tests.fixture_company('rs_owner', 'Example Streams LLC')),
  ('other_co', tests.fixture_company('rs_outsider', 'Example Elsewhere LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.rs where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into rs (label, id) values
  ('alder', tests.fixture_project(pg_temp.id('co'), 'Alder Ct')),
  ('birch', tests.fixture_project(pg_temp.id('co'), 'Birch Way')),
  ('cedar', tests.fixture_project(pg_temp.id('co'), 'Cedar Run')),
  ('dogwood', tests.fixture_project(pg_temp.id('co'), 'Dogwood Ln')),
  ('upkeep', tests.fixture_category(pg_temp.id('co'), 'Example Upkeep')),
  ('deposit', tests.fixture_category(pg_temp.id('co'), 'Example Deposit', 'expense', true));

insert into public.suppliers (company_id, name) values
  (pg_temp.id('co'), 'Example Utility'), (pg_temp.id('co'), 'Example Water'), (pg_temp.id('co'), 'Example Courier');
insert into rs (label, id)
select case s.name when 'Example Utility' then 'utility' when 'Example Water' then 'water' else 'courier' end, s.id
from public.suppliers s where s.company_id = pg_temp.id('co');

-- The utility bills two properties the same amount on the same day (a full tie: the lower project id wins)
-- and a third a little less, later. Its unfiled lines: one on the tie, one halfway between (a tie on the
-- distance: the later filed wins), one near the third, two alike, a USD one (no USD line is filed) and a
-- split one whose part with no project joins the charge closest to the part (its other part is a
-- fourth property's). The water company files one property in USD; the courier files none.
create temp table rs_lines (key text, supplier text, project text, doc_date date, amount bigint, currency text);
insert into rs_lines values
  ('u:alder:7', 'utility', 'alder', '2026-07-05', 100000, 'ILS'),
  ('u:alder:8', 'utility', 'alder', '2026-08-05', 100000, 'ILS'),
  ('u:birch:8', 'utility', 'birch', '2026-08-05', 100000, 'ILS'),
  ('u:cedar:8', 'utility', 'cedar', '2026-08-10', 90000, 'ILS'),
  ('u:tie', 'utility', null, '2026-09-05', 100000, 'ILS'),
  ('u:between', 'utility', null, '2026-09-06', 95000, 'ILS'),
  ('u:near-cedar', 'utility', null, '2026-09-07', 91000, 'ILS'),
  ('u:twin-a', 'utility', null, '2026-10-05', 100000, 'ILS'),
  ('u:twin-b', 'utility', null, '2026-10-05', 100000, 'ILS'),
  ('u:usd', 'utility', null, '2026-10-06', 100000, 'USD'),
  ('u:split', 'utility', null, '2026-10-07', 120000, 'ILS'),
  ('w:alder', 'water', 'alder', '2026-08-01', 5000, 'USD'),
  ('w:open', 'water', null, '2026-09-01', 4000, 'USD'),
  ('c:open', 'courier', null, '2026-09-01', 3000, 'ILS');
insert into rs (label, id)
select l.key, tests.fixture_line(
  pg_temp.id('co'), 'rs:' || l.key, l.amount, 'expense', pg_temp.id(l.project),
  case when l.project is not null then pg_temp.id('upkeep') end, l.doc_date, p_currency => l.currency
)
from rs_lines l;
update public.transactions t set supplier_id = pg_temp.id(l.supplier)
from rs_lines l where t.id = pg_temp.id(l.key);
update public.transactions t set category_id = pg_temp.id('upkeep') where t.id = pg_temp.id('u:split');
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor) values
  (pg_temp.id('co'), pg_temp.id('u:split'), 1, pg_temp.id('upkeep'), null, 80000),
  (pg_temp.id('co'), pg_temp.id('u:split'), 2, pg_temp.id('upkeep'), pg_temp.id('dogwood'), 40000);

-- The reference: the per-line subquery the set-based pick replaced (20261019063254).
create temp table rs_reference as
with lines as (
  select lp.id, lp.direction, lp.party_id, lp.currency, lp.doc_date, lp.created_at, lp.amount_net, lp.project_id
  from private.recurring_line_parts(pg_temp.id('co'), '2024-10-01', '2026-10-20') lp
),
filed as (
  select distinct on (l.direction, l.party_id, l.currency, l.project_id)
    l.direction, l.party_id, l.currency, l.project_id, abs(l.amount_net) as amount, l.doc_date
  from lines l
  where l.project_id is not null
  order by l.direction, l.party_id, l.currency, l.project_id, l.doc_date desc, l.created_at desc, abs(l.amount_net) desc
)
select l.id, l.amount_net, l.project_id,
  coalesce(l.project_id, (
    select f.project_id from filed f
    where f.direction = l.direction and f.party_id = l.party_id and f.currency = l.currency
    order by abs(f.amount - abs(l.amount_net)), f.doc_date desc, f.project_id
    limit 1
  )) as stream_project
from lines l;

create temp table rs_stream as
select sl.id, sl.amount_net, sl.project_id, sl.stream_project
from private.recurring_stream_lines(pg_temp.id('co'), '2026-10-20') sl;

create or replace function pg_temp.stream(p_key text, p_project_null boolean default true)
returns uuid
language sql
as $$
  select s.stream_project from pg_temp.rs_stream s
  where s.id = pg_temp.id(p_key) and (s.project_id is null) = p_project_null;
$$;

-- 1. Every line, the same stream project as the reference.
select results_eq(
  'select id, amount_net, project_id, stream_project from pg_temp.rs_stream order by id, amount_net',
  'select id, amount_net, project_id, stream_project from pg_temp.rs_reference order by id, amount_net',
  'every stream line has the stream project the per-line subquery gave'
);

-- 2-8. The cases the reference covers, named.
select is(
  pg_temp.stream('u:tie'),
  least(pg_temp.id('alder'), pg_temp.id('birch')),
  'a tie on amount and date goes to the lower project id'
);
select is(pg_temp.stream('u:between'), pg_temp.id('cedar'), 'a tie on distance goes to the later filed project');
select is(pg_temp.stream('u:near-cedar'), pg_temp.id('cedar'), 'an unfiled line joins the closest filed amount');
select is(
  array[pg_temp.stream('u:twin-a'), pg_temp.stream('u:twin-b')],
  array[least(pg_temp.id('alder'), pg_temp.id('birch')), least(pg_temp.id('alder'), pg_temp.id('birch'))],
  'two alike unfiled lines join the same charge'
);
select is(
  array[pg_temp.stream('u:split'), pg_temp.stream('u:split', false)],
  array[pg_temp.id('cedar'), pg_temp.id('dogwood')],
  'a split line''s part with no project joins the closest charge, its filed part stays on its project'
);
select is(
  array[pg_temp.stream('u:usd'), pg_temp.stream('w:open')],
  array[null::uuid, pg_temp.id('alder')],
  'only the same currency''s filed lines are matched'
);
select is(pg_temp.stream('c:open'), null::uuid, 'a party with no filed line has no stream project');

-- 9. The scoped batch of line states matches line_pnl_state for every line and scope: a line split
-- between two properties with one part kept out, a line kept out whole, a pending line.
select tests.fixture_line(pg_temp.id('co'), 'rs:out', 2000, 'expense', pg_temp.id('birch'), pg_temp.id('deposit'));
select tests.fixture_line(pg_temp.id('co'), 'rs:pending', 2500, 'expense', pg_temp.id('birch'), pg_temp.id('upkeep'),
  p_line_status => 'pending');
insert into rs (label, id) values
  ('mixed', tests.fixture_line(pg_temp.id('co'), 'rs:mixed', 10000, 'expense', pg_temp.id('alder'), pg_temp.id('upkeep')));
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor) values
  (pg_temp.id('co'), pg_temp.id('mixed'), 1, pg_temp.id('upkeep'), null, 6000),
  (pg_temp.id('co'), pg_temp.id('mixed'), 2, pg_temp.id('deposit'), pg_temp.id('birch'), 4000);

-- A line waiting on Alder (a suggested category), and every line id, for the company checks after test 10.
select tests.fixture_line(pg_temp.id('co'), 'rs:guess', 3000, 'expense', pg_temp.id('alder'), pg_temp.id('upkeep'),
  p_suggested => true);
create temp table rs_ids as select t.id from public.transactions t where t.company_id = pg_temp.id('co');
grant select on rs_ids to authenticated, service_role;

select tests.authenticate_as('rs_owner');

select is(
  (select jsonb_agg(jsonb_build_object('p', sc.p, 'c', sc.c, 'states',
      (select jsonb_object_agg(st.transaction_id, st.state)
       from private.line_pnl_states(array(select t.id from public.transactions t where t.company_id = pg_temp.id('co')), sc.p, sc.c) st))
    order by sc.p, sc.c)
   from (select p.id as p, c.id as c
         from (values (pg_temp.id('alder')), (pg_temp.id('birch')), (pg_temp.id('cedar')), (null::uuid)) p(id)
         cross join (values (pg_temp.id('upkeep')), (pg_temp.id('deposit')), (null::uuid)) c(id)) sc),
  (select jsonb_agg(jsonb_build_object('p', sc.p, 'c', sc.c, 'states',
      (select jsonb_object_agg(t.id, private.line_pnl_state(t.id, sc.p, sc.c))
       from public.transactions t where t.company_id = pg_temp.id('co')))
    order by sc.p, sc.c)
   from (select p.id as p, c.id as c
         from (values (pg_temp.id('alder')), (pg_temp.id('birch')), (pg_temp.id('cedar')), (null::uuid)) p(id)
         cross join (values (pg_temp.id('upkeep')), (pg_temp.id('deposit')), (null::uuid)) c(id)) sc),
  'line_pnl_states(ids, project, category) matches line_pnl_state for every line and scope'
);

-- 10. The scope matters here: the split line reads in on its own property, out on the other, mixed whole.
select is(
  array[private.line_pnl_state(pg_temp.id('mixed'), pg_temp.id('alder')),
    private.line_pnl_state(pg_temp.id('mixed'), pg_temp.id('birch')),
    private.line_pnl_state(pg_temp.id('mixed'))],
  array['in', 'out', 'mixed'],
  'the reference reads a split line by its scope'
);

-- 11. The owner sees Alder's waiting line and its upkeep lines.
select ok(
  jsonb_array_length(public.project_waiting(pg_temp.id('alder'))) > 0
    and jsonb_array_length(public.list_project_category(pg_temp.id('alder'), pg_temp.id('upkeep')) -> 'rows') > 0,
  'the owner sees the project''s waiting lines and category lines'
);

-- 12-14. Another company's user reads none of them.
select tests.authenticate_as('rs_outsider');

select is(
  (select count(*)::integer
   from private.line_pnl_states(array(select id from pg_temp.rs_ids), pg_temp.id('alder'), pg_temp.id('upkeep'))),
  0,
  'line_pnl_states(ids, project, category) returns no line of another company'
);
select is(
  public.project_waiting(pg_temp.id('alder')),
  '[]'::jsonb,
  'project_waiting shows no waiting line of another company'
);
select is(
  public.list_project_category(pg_temp.id('alder'), pg_temp.id('upkeep')),
  null::jsonb,
  'list_project_category reads nothing of another company''s project'
);

select * from finish();
rollback;
