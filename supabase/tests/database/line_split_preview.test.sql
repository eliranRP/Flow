-- FLOW-325 follow-ups. save_line_split preview writes nothing and returns the parts a save
-- would store; get_line_split marks each part's percent and the rest; named refusals for a
-- repeated pair and a line of zero. Invented data only. Amounts are cents.

begin;

select plan(14);

do $users$
begin
  perform tests.create_supabase_user('lpv_owner', 'lpv-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('lpv_owner'), 'Example Preview LLC', false);

create temp table lpv (label text primary key, id uuid);
grant all on lpv to authenticated, service_role;
insert into lpv (label, id) select 'co', id from public.companies where name = 'Example Preview LLC';

insert into public.projects (company_id, name, status)
select (select id from lpv where label = 'co'), v.name, 'active'
from (values ('North'), ('South')) as v(name);
insert into lpv (label, id) select lower(name), id from public.projects
where name in ('North', 'South') and company_id = (select id from lpv where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default)
select (select id from lpv where label = 'co'), v.name, 'expense', 90, false
from (values ('Repairs'), ('Insurance')) as v(name);
insert into lpv (label, id) select lower(name), id from public.categories
where name in ('Repairs', 'Insurance') and company_id = (select id from lpv where label = 'co');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned,
  category_suggested
)
select (select id from lpv where label = 'co'), 'expense', 'expense', 'project', 'posted', 'USD',
  v.amount, v.amount, abs(v.amount), 0, 'source', '2026-06-10', '2026-06-10', 'manual', v.key,
  (select id from lpv where label = 'north'), (select id from lpv where label = 'repairs'), v.key, false, true
from (values ('lpv:bill', -10001), ('lpv:zero', 0)) as v(key, amount);
insert into lpv (label, id) select replace(idempotency_key, 'lpv:', 'txn_'), id
from public.transactions where idempotency_key like 'lpv:%';

create function pg_temp.parts() returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object('category_id', (select id from lpv where label = 'repairs'),
      'project_id', (select id from lpv where label = 'south'), 'percent', 33.33),
    jsonb_build_object('category_id', (select id from lpv where label = 'insurance'),
      'project_id', (select id from lpv where label = 'north'), 'amount_minor', 1000),
    jsonb_build_object('rest', true)
  )
$$;
grant execute on function pg_temp.parts() to authenticated;

-- MCP passes the new reasons through.
select is(private_mcp_reason.r, 'line amount is zero', 'MCP passes the zero reason through')
from (select private.mcp_refused('line amount is zero') -> 'error' ->> 'message' as r) as private_mcp_reason;
select is(private_mcp_reason.r, 'same category and project twice', 'MCP passes the repeated pair reason through')
from (select private.mcp_refused('same category and project twice') -> 'error' ->> 'message' as r) as private_mcp_reason;


select tests.authenticate_as('lpv_owner');

-- Preview.
select is(
  public.save_line_split((select id from lpv where label = 'txn_bill'), pg_temp.parts(), true),
  jsonb_build_array(
    jsonb_build_object('category_id', (select id from lpv where label = 'repairs'),
      'project_id', (select id from lpv where label = 'south'), 'amount_minor', 3333, 'percent', 33.33, 'rest', false),
    jsonb_build_object('category_id', (select id from lpv where label = 'insurance'),
      'project_id', (select id from lpv where label = 'north'), 'amount_minor', 1000, 'percent', null, 'rest', false),
    jsonb_build_object('category_id', (select id from lpv where label = 'repairs'),
      'project_id', null, 'amount_minor', 5668, 'percent', null, 'rest', true)),
  'a preview returns the parts in cents with percent and rest');
select is((select count(*)::integer from public.line_splits), 0, 'a preview stores no parts');
select ok(
  (select not t.user_assigned from public.transactions t
   where t.id = (select id from lpv where label = 'txn_bill')),
  'a preview leaves the line''s flags alone');
select throws_ok(
  $$select public.save_line_split((select id from lpv where label = 'txn_bill'), jsonb_build_array(
    jsonb_build_object('category_id', (select id from lpv where label = 'repairs'), 'percent', 80),
    jsonb_build_object('category_id', (select id from lpv where label = 'insurance'), 'percent', 30)), true)$$,
  'parts exceed the line', 'a preview refuses what a save would refuse');
select is(
  public.save_line_split((select id from lpv where label = 'txn_bill'), '[]'::jsonb, true),
  '[]'::jsonb, 'a preview of no parts is empty');

-- Save, then read the markers back.
select lives_ok(
  $$select public.save_line_split((select id from lpv where label = 'txn_bill'), pg_temp.parts())$$,
  'the same parts save');
select is(
  (select jsonb_agg(jsonb_build_object('amount_minor', x -> 'amount_minor', 'percent', x -> 'percent', 'rest', x -> 'rest'))
   from jsonb_array_elements(public.get_line_split((select id from lpv where label = 'txn_bill')) -> 'parts') x),
  '[{"amount_minor": 3333, "percent": 33.33, "rest": false},
    {"amount_minor": 1000, "percent": null, "rest": false},
    {"amount_minor": 5668, "percent": null, "rest": true}]'::jsonb,
  'get_line_split marks the percent part and the rest');
select ok(
  (select t.user_assigned and not t.category_suggested from public.transactions t
   where t.id = (select id from lpv where label = 'txn_bill')),
  'a save marks the line as the owner''s choice');
select is(
  public.save_line_split((select id from lpv where label = 'txn_bill'), '[]'::jsonb, true),
  '[]'::jsonb, 'a preview of a clear returns nothing');
select is((select count(*)::integer from public.line_splits), 3, 'and keeps the saved parts');

-- Named refusals.
select throws_ok(
  $$select public.save_line_split((select id from lpv where label = 'txn_bill'), jsonb_build_array(
    jsonb_build_object('category_id', (select id from lpv where label = 'repairs'), 'amount_minor', 1),
    jsonb_build_object('category_id', (select id from lpv where label = 'repairs'), 'amount_minor', 10000)))$$,
  'same category and project twice', 'a repeated pair is named');
select throws_ok(
  $$select public.save_line_split((select id from lpv where label = 'txn_zero'), pg_temp.parts())$$,
  'line amount is zero', 'a line of zero is named');
select * from finish();
rollback;
