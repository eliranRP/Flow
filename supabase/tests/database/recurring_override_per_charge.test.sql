-- Decision 0188 (amends 0185). The owner's "recurring" switch and its pace apply to the line's own charge:
-- the party's lines for that line's project. A row with no project is the party-wide word, as before.
-- Invented data only. Amounts are agorot. Dates are relative to today (the setters read private.flow_today).

begin;

select plan(31);

do $users$
begin
  perform tests.create_supabase_user('ro_owner', 'ro-owner@example.com');
  perform tests.create_supabase_user('ro_other', 'ro-other@example.com');
end
$users$;

create temp table ro (label text primary key, id uuid);
grant all on ro to authenticated, service_role;

insert into ro (label, id) values
  ('co', tests.fixture_company('ro_owner', 'Example Rentals LLC')),
  ('co_b', tests.fixture_company('ro_other', 'Example Elsewhere LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.ro where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- The first of this month, and today.
create or replace function pg_temp.m(p_back integer)
returns date
language sql
as $$ select (date_trunc('month', private.flow_today()) - make_interval(months => p_back))::date; $$;
grant execute on function pg_temp.m(integer) to authenticated, service_role;
create temp table ro_day as select private.flow_today() as today;
grant all on ro_day to authenticated, service_role;
create or replace function pg_temp.today()
returns date
language sql
as $$ select today from pg_temp.ro_day; $$;
grant execute on function pg_temp.today() to authenticated, service_role;

insert into ro (label, id) values
  ('alder', tests.fixture_project(pg_temp.id('co'), 'Alder Ct')),
  ('birch', tests.fixture_project(pg_temp.id('co'), 'Birch Way')),
  ('cedar', tests.fixture_project(pg_temp.id('co'), 'Cedar Ln')),
  ('empty', tests.fixture_project(pg_temp.id('co'), 'Empty Lot'));

insert into public.customers (company_id, name) values (pg_temp.id('co'), 'Example Rent Platform');
insert into ro (label, id)
select 'rent', c.id from public.customers c where c.company_id = pg_temp.id('co');
insert into public.suppliers (company_id, name) values
  (pg_temp.id('co'), 'Example Grid'),
  (pg_temp.id('co'), 'Example Servicing');
insert into ro (label, id)
select lower(replace(s.name, 'Example ', '')), s.id from public.suppliers s where s.company_id = pg_temp.id('co');

-- Rent (one customer, three properties): Alder 5,000.00 on the 1st of each of the last six complete months
-- (recurring by the rule); Birch 4,000.00 in the last two complete months only; Cedar 3,000.00 this month
-- only. Grid: Alder in the last two complete months and one stray Birch bill three months back. Servicing:
-- Alder and Birch every one of the last six complete months.
create temp table ro_lines (key text, party text, direction text, project text, doc_date date, amount bigint);
insert into ro_lines select 'rent-a:' || b, 'rent', 'income', 'alder', pg_temp.m(b), 500000 from generate_series(1, 6) b;
insert into ro_lines select 'rent-b:' || b, 'rent', 'income', 'birch', pg_temp.m(b), 400000 from generate_series(1, 2) b;
insert into ro_lines values ('rent-c:0', 'rent', 'income', 'cedar', pg_temp.m(0), 300000);
insert into ro_lines select 'grid-a:' || b, 'grid', 'expense', 'alder', pg_temp.m(b) + 4, 20000 from generate_series(1, 2) b;
insert into ro_lines values ('grid-stray', 'grid', 'expense', 'birch', pg_temp.m(3) + 4, 90000);
insert into ro_lines select 'serv-a:' || b, 'servicing', 'expense', 'alder', pg_temp.m(b) + 2, 400000 from generate_series(1, 6) b;
insert into ro_lines select 'serv-b:' || b, 'servicing', 'expense', 'birch', pg_temp.m(b) + 2, 250000 from generate_series(1, 6) b;

insert into ro (label, id)
select l.key, tests.fixture_line(
  pg_temp.id('co'), 'ro:' || l.key, l.amount, l.direction, pg_temp.id(l.project), null, l.doc_date,
  p_pnl_role => null, p_doc_kind => case when l.direction = 'income' then 'invoice_receipt' else 'receipt' end
)
from ro_lines l;
update public.transactions t
set customer_id = case when l.direction = 'income' then pg_temp.id(l.party) end,
  supplier_id = case when l.direction = 'expense' then pg_temp.id(l.party) end
from ro_lines l
where t.id = pg_temp.id(l.key);

-- The party-wide words, as rows written before decision 0188: Grid recurring, Servicing not recurring.
insert into public.recurring_overrides (company_id, direction, party_id, currency, recurring) values
  (pg_temp.id('co'), 'expense', pg_temp.id('grid'), 'ILS', true),
  (pg_temp.id('co'), 'expense', pg_temp.id('servicing'), 'ILS', false);

-- The projects of a party's charges in today's schedule.
create or replace function pg_temp.charges(p_party text)
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(p.name order by p.name), '[]'::jsonb)
  from jsonb_array_elements(public.recurring_schedule(pg_temp.today())) e
  left join public.projects p on p.id = (e ->> 'project_id')::uuid
  where (e ->> 'party_id')::uuid = pg_temp.id(p_party);
$$;
grant execute on function pg_temp.charges(text) to authenticated, service_role;

select tests.authenticate_as('ro_owner');

-- 1. Before: only the main property's rent recurs.
select is(pg_temp.charges('rent'), '["Alder Ct"]'::jsonb, 'by the rule, only Alder''s rent recurs');

-- 2-5. "Recurring" on a Birch line makes Birch recurring and leaves Cedar alone.
select is(
  (select jsonb_build_object('override', w -> 'override', 'prior', w -> 'prior_override', 'project', w -> 'override_project_id')
   from public.set_payment_recurring(pg_temp.id('rent-b:1'), true) w),
  jsonb_build_object('override', true, 'prior', null, 'project', pg_temp.id('birch')),
  'the switch on a Birch line is Birch''s, with no word before'
);
select is(pg_temp.charges('rent'), '["Alder Ct", "Birch Way"]'::jsonb, 'Birch recurs with two complete months; Cedar does not');
select is(
  (public.payment_recurring(pg_temp.id('rent-a:1')) -> 'override'),
  'null'::jsonb,
  'Alder''s line reports no word of its own'
);
select is(
  (public.payment_recurring(pg_temp.id('rent-c:0')) -> 'recurring'),
  'false'::jsonb,
  'Cedar''s line is still not recurring'
);

-- 6-8. "Recurring" on Cedar, which has only this month: recurring from this month's amount and day.
select is(
  public.set_payment_recurring(pg_temp.id('rent-c:0'), true) -> 'override_project_id',
  to_jsonb(pg_temp.id('cedar')),
  'the switch on the Cedar line is Cedar''s'
);
select is(pg_temp.charges('rent'), '["Alder Ct", "Birch Way", "Cedar Ln"]'::jsonb, 'Cedar recurs with no complete month yet');
select is(
  (select jsonb_build_object('amount', s -> 'typical_amount_minor', 'day', s -> 'typical_day')
   from public.payment_recurring(pg_temp.id('rent-c:0')) s),
  jsonb_build_object('amount', 300000, 'day', 1),
  'Cedar''s usual amount and day are this month''s'
);

-- 9-10. "Not recurring" on Birch ends Birch only.
select is(
  public.set_payment_recurring(pg_temp.id('rent-b:2'), false) -> 'prior_override',
  'true'::jsonb,
  'the prior word is Birch''s own'
);
select is(pg_temp.charges('rent'), '["Alder Ct", "Cedar Ln"]'::jsonb, 'not recurring on Birch ends Birch and leaves Alder and Cedar');

-- 11-12. The words are rows per charge; the party-wide row is unchanged.
reset role;
select is(
  (select jsonb_object_agg(p.name, o.recurring) from public.recurring_overrides o
   join public.projects p on p.id = o.project_id
   where o.party_id = pg_temp.id('rent')),
  '{"Birch Way": false, "Cedar Ln": true}'::jsonb,
  'one row per charge'
);
select throws_ok(
  format($q$insert into public.recurring_overrides (company_id, direction, party_id, currency, recurring)
    values (%L, 'expense', %L, 'ILS', false)$q$, pg_temp.id('co'), pg_temp.id('grid')),
  '23505', null,
  'a party has one party-wide row (null project is not distinct)'
);

-- 13-14. A party-wide "recurring" (no project) still means the main charge only (#712's stray bill).
select tests.authenticate_as('ro_owner');
select is(pg_temp.charges('grid'), '["Alder Ct"]'::jsonb, 'the party-wide word makes only the main charge recurring');
select is(
  public.payment_recurring(pg_temp.id('grid-stray')) -> 'override',
  'null'::jsonb,
  'the stray Birch bill reports no word that applies to it'
);

-- 15-17. A party-wide "not recurring" ends every charge; a charge's own word wins over it.
select is(pg_temp.charges('servicing'), '[]'::jsonb, 'the party-wide not recurring ends both charges');
select is(
  public.payment_recurring(pg_temp.id('serv-b:1')) -> 'override',
  'false'::jsonb,
  'Birch''s line reports the party-wide not recurring'
);
select public.set_payment_recurring(pg_temp.id('serv-b:1'), true);
select is(pg_temp.charges('servicing'), '["Birch Way"]'::jsonb, 'recurring on Birch''s line brings back Birch only');

-- 18-20. The pace is per charge.
select is(
  public.set_payment_pace(pg_temp.id('rent-c:0'), 'quarter') -> 'pace_override',
  '"quarter"'::jsonb,
  'Cedar''s pace is set'
);
select is(
  public.payment_recurring(pg_temp.id('rent-a:1')) -> 'pace_override',
  'null'::jsonb,
  'Alder keeps the detected pace'
);
select is(
  (select e ->> 'pace' from jsonb_array_elements(public.recurring_schedule(pg_temp.today())) e
   where (e ->> 'party_id')::uuid = pg_temp.id('rent') and (e ->> 'project_id')::uuid = pg_temp.id('cedar')),
  'quarter',
  'Cedar''s charge reads its own pace'
);

-- 21-22. The app's undo: writing the prior word back restores the row, pace kept.
select is(
  public.set_payment_recurring(pg_temp.id('rent-c:0'), false) -> 'prior_override',
  'true'::jsonb,
  'Cedar off returns its prior word'
);
select public.set_payment_recurring(pg_temp.id('rent-c:0'), true);
reset role;
select is(
  (select jsonb_build_object('recurring', o.recurring, 'pace', o.pace) from public.recurring_overrides o
   where o.party_id = pg_temp.id('rent') and o.project_id = pg_temp.id('cedar')),
  jsonb_build_object('recurring', true, 'pace', 'quarter'),
  'Cedar''s row is back as it was'
);

-- 23-27. The MCP's undo puts back the row of the charge it wrote, including no row.
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('ro_owner'), pg_temp.id('co'), 'hash-ro-write', 'kid', array['write']::text[], '2099-01-01');
insert into ro (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-ro-write';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('ro_owner');
  tid uuid;
begin
  select id into tid from pg_temp.ro where label = 'write';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

select pg_temp.as_mcp();
select is(
  public.mcp_set_line_recurring('ro-1', pg_temp.id('rent-b:1'), true) -> 'data' -> 'override_project_id',
  null,
  'the MCP answer leaves out the written project'
);
select is(
  public.mcp_undo('ro-undo-1', 'line_recurring', pg_temp.id('rent-b:1')) ->> 'ok',
  'true',
  'undo line_recurring on Birch'
);
reset role;
select is(
  (select o.recurring from public.recurring_overrides o
   where o.party_id = pg_temp.id('rent') and o.project_id = pg_temp.id('birch')),
  false,
  'Birch''s word is back to not recurring'
);
-- Alder had no row. The line then moves to Birch; the undo still removes Alder's row.
select pg_temp.as_mcp();
select public.mcp_set_line_recurring('ro-2', pg_temp.id('rent-a:1'), false);
reset role;
update public.transactions set project_id = pg_temp.id('birch') where id = pg_temp.id('rent-a:1');
select pg_temp.as_mcp();
select is(
  public.mcp_undo('ro-undo-2', 'line_recurring', pg_temp.id('rent-a:1')) ->> 'ok',
  'true',
  'undo line_recurring after the line moved'
);
reset role;
select is(
  (select jsonb_agg(p.name order by p.name) from public.recurring_overrides o
   join public.projects p on p.id = o.project_id
   where o.party_id = pg_temp.id('rent')),
  '["Birch Way", "Cedar Ln"]'::jsonb,
  'Alder has no row again, and Birch''s is untouched'
);

-- 28. The pace undo too.
select pg_temp.as_mcp();
select public.mcp_set_line_pace('ro-3', pg_temp.id('rent-c:0'), 'year');
select public.mcp_undo('ro-undo-3', 'line_pace', pg_temp.id('rent-c:0'));
reset role;
select is(
  (select o.pace from public.recurring_overrides o
   where o.party_id = pg_temp.id('rent') and o.project_id = pg_temp.id('cedar')),
  'quarter',
  'undo line_pace puts Cedar''s pace back'
);

-- 29. A project's delete takes the words on its charge with it.
insert into public.recurring_overrides (company_id, direction, party_id, currency, project_id, recurring)
values (pg_temp.id('co'), 'income', pg_temp.id('rent'), 'ILS', pg_temp.id('empty'), true);
delete from public.projects where id = pg_temp.id('empty');
select is(
  (select count(*)::integer from public.recurring_overrides where project_id = pg_temp.id('empty')),
  0,
  'a deleted project''s words go with it'
);

-- 30-31. Another company is refused, and writes nothing.
select tests.authenticate_as('ro_other');
select throws_ok(
  format('select public.set_payment_recurring(%L, true)', pg_temp.id('rent-c:0')),
  'P0001', 'transaction not found',
  'another company''s line is refused'
);
select throws_ok(
  format('select public.set_payment_pace(%L, %L)', pg_temp.id('rent-c:0'), 'month'),
  'P0001', 'transaction not found',
  'another company''s pace is refused'
);

select * from finish();

rollback;
