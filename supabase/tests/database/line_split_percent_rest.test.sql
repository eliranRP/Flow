-- FLOW-325. Split a line by percent or amount, with a rest part on the line's own category
-- and project, and reversal parts (a refund filed under expense categories). Rounding, the
-- P&L effect, refusals, and the MCP reasons. Invented data only. Amounts are cents.

begin;

select plan(34);

do $users$
begin
  perform tests.create_supabase_user('lpr_owner', 'lpr-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('lpr_owner'), 'Example Percent LLC', false);

create temp table lpr (label text primary key, id uuid);
grant all on lpr to authenticated, service_role;
insert into lpr (label, id) select 'co', id from public.companies where name = 'Example Percent LLC';

insert into public.projects (company_id, name, status)
select (select id from lpr where label = 'co'), v.name, 'active'
from (values ('North'), ('South')) as v(name);
insert into lpr (label, id) select lower(name), id from public.projects
where name in ('North', 'South') and company_id = (select id from lpr where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default)
select (select id from lpr where label = 'co'), v.name, v.kind::public.category_kind, 90, false
from (values ('Repairs', 'expense'), ('Insurance', 'expense'), ('Rent', 'income')) as v(name, kind);
insert into lpr (label, id) select lower(name), id from public.categories
where name in ('Repairs', 'Insurance', 'Rent') and company_id = (select id from lpr where label = 'co');

-- A $100.01 bill on North, a $100 inflow filed as North rent (part of it is a refund), a
-- 1-cent and a 2-cent bill, and an uncategorised bill. All posted, no VAT.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select (select id from lpr where label = 'co'), v.direction::public.txn_direction, v.doc_kind::public.doc_kind,
  v.role::public.pnl_role, 'posted', 'USD',
  v.amount, v.amount, abs(v.amount), 0, 'source', '2026-06-10', '2026-06-10', 'manual', v.key,
  (select id from lpr where label = 'north'), (select id from lpr where label = v.category), v.key, true
from (values
  ('lpr:bill',   'expense', 'expense', 'project', -10001, 'repairs'),
  ('lpr:inflow', 'income',  'receipt', null,       10000, 'rent'),
  ('lpr:cent',   'expense', 'expense', 'project',     -1, 'repairs'),
  ('lpr:two',    'expense', 'expense', 'project',     -2, 'repairs'),
  ('lpr:nocat',  'expense', 'expense', 'project',  -1000, null),
  ('lpr:bounce', 'expense', 'expense', null,       -1000, 'rent')
) as v(key, direction, doc_kind, role, amount, category);
insert into lpr (label, id) select replace(idempotency_key, 'lpr:', 'txn_'), id
from public.transactions where idempotency_key like 'lpr:%';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('lpr_owner'), (select id from lpr where label = 'co'), 'hash-lpr-write', 'kid', array['write']::text[], '2099-01-01');
insert into lpr (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-lpr-write';

-- A part: p_how is 'amount', 'percent' or 'rest'.
create function pg_temp.part(p_category text, p_project text, p_how text, p_value numeric default null)
returns jsonb
language sql
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'category_id', (select id from lpr where label = p_category),
    'project_id', (select id from lpr where label = p_project),
    'amount_minor', case when p_how = 'amount' then p_value::bigint end,
    'percent', case when p_how = 'percent' then p_value end,
    'rest', case when p_how = 'rest' then true end
  ))
$$;
grant execute on function pg_temp.part(text, text, text, numeric) to authenticated, service_role;

create function pg_temp.amounts(p_txn text) returns bigint[]
language sql
as $$
  select array_agg(s.amount_minor order by s.ordinal)
  from public.line_splits s where s.transaction_id = (select id from lpr where label = p_txn)
$$;
grant execute on function pg_temp.amounts(text) to authenticated;

create function pg_temp.usd(p_field text) returns bigint
language sql
as $$
  select (x ->> p_field)::bigint
  from jsonb_array_elements(public.get_dashboard(null, null, 'cash') -> 'by_currency') x
  where x ->> 'currency' = 'USD'
$$;
grant execute on function pg_temp.usd(text) to authenticated;

create function pg_temp.proj_expense(p_project text) returns bigint
language sql
as $$
  select coalesce(sum((x ->> 'amount_minor')::bigint), 0) from jsonb_array_elements(
    public.get_project((select id from lpr where label = p_project), 'cash') -> 'categories_by_currency'
  ) x
  where x ->> 'currency' = 'USD'
    and x ->> 'id' in (select id::text from lpr where label in ('repairs', 'insurance'))
$$;
grant execute on function pg_temp.proj_expense(text) to authenticated;

create table pg_temp.base (field text primary key, amount bigint);
grant all on pg_temp.base to authenticated;

select tests.authenticate_as('lpr_owner');

-- Percents that sum to 100 hit the line to the cent; the largest remainder takes the cent.
select is(
  jsonb_array_length(public.save_line_split((select id from lpr where label = 'txn_bill'), jsonb_build_array(
    pg_temp.part('repairs', 'north', 'percent', 33.33),
    pg_temp.part('repairs', 'south', 'percent', 33.33),
    pg_temp.part('insurance', 'north', 'percent', 33.34)))),
  3, 'three percent parts are stored');
select is(pg_temp.amounts('txn_bill'), array[3333, 3333, 3335]::bigint[], '33.33/33.33/33.34 of $100.01 sum to the line');

select lives_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_bill'), jsonb_build_array(
    pg_temp.part('repairs', 'north', 'percent', 50), pg_temp.part('repairs', 'south', 'percent', 50)))$$,
  '50/50 of an odd line is accepted');
select is(pg_temp.amounts('txn_bill'), array[5001, 5000]::bigint[], 'on a tie the first part takes the cent');

-- An exact amount, a percent of the whole line, and the rest on the line's own category.
select lives_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_bill'), jsonb_build_array(
    pg_temp.part('insurance', 'south', 'amount', 1),
    pg_temp.part('repairs', 'south', 'percent', 50),
    pg_temp.part(null, null, 'rest')))$$,
  'amount, percent and rest together are accepted');
select is(pg_temp.amounts('txn_bill'), array[1, 5001, 4999]::bigint[], 'the rest takes what is left');
select ok(
  (select s.category_id = (select id from lpr where label = 'repairs') and s.project_id is null
   from public.line_splits s where s.transaction_id = (select id from lpr where label = 'txn_bill') and s.ordinal = 3),
  'the rest keeps the line''s category and project');
select is(pg_temp.proj_expense('south'), 5002::bigint, 'South counts its two parts');

-- A rest part with nothing left is dropped.
select lives_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_bill'), jsonb_build_array(
    pg_temp.part('repairs', 'south', 'percent', 60),
    pg_temp.part('insurance', 'north', 'percent', 40),
    pg_temp.part(null, null, 'rest')))$$,
  'a rest with nothing left is accepted');
select is(pg_temp.amounts('txn_bill'), array[6001, 4000]::bigint[], 'and is not stored');

-- A refund: part of an inflow goes back against expenses on two projects, the rest stays rent.
insert into pg_temp.base values
  ('expense', pg_temp.usd('expense_minor')), ('income', pg_temp.usd('income_minor')),
  ('south', pg_temp.proj_expense('south'));
select lives_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_inflow'), jsonb_build_array(
    pg_temp.part('repairs', 'south', 'percent', 30),
    pg_temp.part('insurance', 'north', 'amount', 2000),
    pg_temp.part(null, null, 'rest')))$$,
  'expense parts on an inflow are accepted as reversals');
select is(pg_temp.amounts('txn_inflow'), array[3000, 2000, 5000]::bigint[], 'the refund parts and the rest');
select is(pg_temp.usd('income_minor'), (select amount from pg_temp.base where field = 'income') - 5000,
  'company income keeps only the rest');
select is(pg_temp.usd('expense_minor'), (select amount from pg_temp.base where field = 'expense') - 5000,
  'company expense drops by the refund parts');
select is(pg_temp.proj_expense('south'), (select amount from pg_temp.base where field = 'south') - 3000,
  'South''s expense drops by its refund part');

-- Refusals.
select throws_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_inflow'), jsonb_build_array(
    pg_temp.part('repairs', null, 'amount', 3000), pg_temp.part(null, null, 'rest')))$$,
  'a reversal part needs a project', 'a reversal part with no project is refused');
select throws_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_bounce'), jsonb_build_array(
    pg_temp.part('repairs', null, 'percent', 40), pg_temp.part(null, null, 'rest')))$$,
  'a reversal part needs a project', 'on an outflow filed as income, an expense part with no project is refused');
select throws_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_bill'), jsonb_build_array(
    pg_temp.part('repairs', 'north', 'percent', 60), pg_temp.part('repairs', 'south', 'percent', 50)))$$,
  'parts exceed the line', 'percents above 100 are refused');
select throws_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_bill'), jsonb_build_array(
    pg_temp.part('repairs', 'south', 'amount', 20000), pg_temp.part(null, null, 'rest')))$$,
  'parts exceed the line', 'an amount above the line is refused even with a rest');
select throws_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_bill'), jsonb_build_array(
    pg_temp.part('repairs', 'north', 'percent', 40), pg_temp.part('repairs', 'south', 'percent', 50)))$$,
  'parts must sum to the line', 'percents under 100 with no rest are refused');
select throws_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_bill'), jsonb_build_array(
    pg_temp.part('repairs', 'north', 'percent', 101), pg_temp.part(null, null, 'rest')))$$,
  'validation', 'a percent above 100 is validation');
select throws_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_bill'), jsonb_build_array(
    pg_temp.part('repairs', 'north', 'percent', 0.00001), pg_temp.part(null, null, 'rest')))$$,
  'validation', 'more than 4 decimals is validation');
select throws_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_bill'), jsonb_build_array(
    pg_temp.part('repairs', 'north', 'amount', 100) || '{"percent": 5}'::jsonb, pg_temp.part(null, null, 'rest')))$$,
  'validation', 'an amount and a percent on one part is validation');
select throws_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_bill'), jsonb_build_array(
    pg_temp.part('repairs', 'north', 'rest'), pg_temp.part(null, null, 'rest')))$$,
  'validation', 'two rest parts are validation');
select throws_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_bill'), jsonb_build_array(
    pg_temp.part('repairs', 'north', 'amount', 100), '{"rest": false}'::jsonb))$$,
  'validation', 'rest false is validation');
select throws_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_bill'), jsonb_build_array(
    pg_temp.part('repairs', null, 'percent', 50), pg_temp.part(null, null, 'rest')))$$,
  'same category and project twice', 'a part that repeats the rest''s category and project is refused');
select throws_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_cent'), jsonb_build_array(
    pg_temp.part('repairs', 'south', 'percent', 50), pg_temp.part(null, null, 'rest')))$$,
  'nothing is left for the rest', 'one part plus an empty rest is not a split');
select throws_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_two'), jsonb_build_array(
    pg_temp.part('repairs', 'south', 'percent', 10), pg_temp.part(null, null, 'rest')))$$,
  'a part rounds to zero', 'a percent that rounds to no cents is refused');
select throws_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_nocat'), jsonb_build_array(
    pg_temp.part('repairs', 'south', 'percent', 10), pg_temp.part(null, null, 'rest')))$$,
  'line has no category for the rest', 'a rest needs a category on an uncategorised line');
select lives_ok(
  $$select public.save_line_split((select id from lpr where label = 'txn_nocat'), jsonb_build_array(
    pg_temp.part('repairs', 'south', 'percent', 10), pg_temp.part('insurance', 'north', 'rest')))$$,
  'a rest can name its own category and project');
select is(pg_temp.amounts('txn_nocat'), array[100, 900]::bigint[], 'the named rest takes what is left');

-- MCP split_line takes the same parts and reports the new reasons.
create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('lpr_owner');
  tid uuid;
begin
  select id into tid from pg_temp.lpr where label = 'write';
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
  public.mcp_split_line('k-pct', (select id from lpr where label = 'txn_bill'), jsonb_build_array(
    pg_temp.part('repairs', 'south', 'percent', 25), pg_temp.part(null, null, 'rest'))) -> 'data' -> 'parts',
  jsonb_build_array(
    jsonb_build_object('category_id', (select id from lpr where label = 'repairs'),
      'project_id', (select id from lpr where label = 'south'), 'amount_minor', 2500),
    jsonb_build_object('category_id', (select id from lpr where label = 'repairs'),
      'project_id', null, 'amount_minor', 7501)),
  'MCP returns the parts in cents');
select is(
  public.mcp_split_line('k-over', (select id from lpr where label = 'txn_bill'), jsonb_build_array(
    pg_temp.part('repairs', 'south', 'percent', 80), pg_temp.part('repairs', 'north', 'percent', 30))) -> 'error' ->> 'message',
  'parts exceed the line', 'MCP gives the reason for an over-split');
select is(
  public.mcp_split_line('k-rev', (select id from lpr where label = 'txn_inflow'), jsonb_build_array(
    pg_temp.part('insurance', null, 'percent', 30), pg_temp.part(null, null, 'rest'))) -> 'error' ->> 'message',
  'a reversal part needs a project', 'MCP gives the reason for a reversal part with no project');

select * from finish();
rollback;
