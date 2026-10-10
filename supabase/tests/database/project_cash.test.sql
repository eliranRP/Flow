-- FLOW-417 (decision 0173): one project's cash per month and its lines. A line filed to the
-- project counts whole, a shared line counts the project's allocation, and what the view leaves
-- out stays out. Invented data only. Amounts are agorot. Today is 2026-06-15.

begin;

select plan(16);

do $users$
begin
  perform tests.create_supabase_user('pc_owner', 'pc-owner@example.com');
  perform tests.create_supabase_user('pc_other', 'pc-other@example.com');
end
$users$;

create temp table pc (label text primary key, id uuid);
grant all on pc to authenticated, service_role;

insert into pc (label, id) values
  ('co', tests.fixture_company('pc_owner', 'Example Project Cash LLC')),
  ('other_co', tests.fixture_company('pc_other', 'Example Other LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.pc where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create or replace function pg_temp.cat(p_name text, p_kind text)
returns uuid
language sql
as $$
  select c.id from public.categories c
  where c.company_id = pg_temp.id('co') and c.name = p_name and c.kind = p_kind::public.category_kind;
$$;
grant execute on function pg_temp.cat(text, text) to authenticated, service_role;

insert into pc (label, id) values
  ('cedar', tests.fixture_project(pg_temp.id('co'), 'Cedar')),
  ('maple', tests.fixture_project(pg_temp.id('co'), 'Maple')),
  ('elsewhere', tests.fixture_project(pg_temp.id('other_co'), 'Elsewhere'));

insert into pc (label, id) values
  ('rent', tests.fixture_line(pg_temp.id('co'), 'pc:rent', 1000000, 'income', pg_temp.id('cedar'),
    pg_temp.cat('תקבול מלקוח', 'income'), '2026-06-05', p_pnl_role => null, p_doc_kind => 'invoice_receipt')),
  ('repair', tests.fixture_line(pg_temp.id('co'), 'pc:repair', 300000, 'expense', pg_temp.id('cedar'),
    pg_temp.cat('אחר', 'expense'), '2026-06-10')),
  ('shared', tests.fixture_line(pg_temp.id('co'), 'pc:shared', 100000, 'expense', null,
    pg_temp.cat('אחר', 'expense'), '2026-06-12', p_pnl_role => 'shared')),
  ('maple_cost', tests.fixture_line(pg_temp.id('co'), 'pc:maple', 50000, 'expense', pg_temp.id('maple'),
    pg_temp.cat('אחר', 'expense'), '2026-06-11')),
  ('may_cost', tests.fixture_line(pg_temp.id('co'), 'pc:may', 200000, 'expense', pg_temp.id('cedar'),
    pg_temp.cat('אחר', 'expense'), '2026-05-20')),
  ('transfer', tests.fixture_line(pg_temp.id('co'), 'pc:transfer', 25000, 'expense', pg_temp.id('cedar'),
    pg_temp.cat('העברות', 'expense'), '2026-05-21'));

-- The shared bill: 60% Cedar, 40% Maple.
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net) values
  (pg_temp.id('co'), pg_temp.id('shared'), pg_temp.id('cedar'), 6000, -60000),
  (pg_temp.id('co'), pg_temp.id('shared'), pg_temp.id('maple'), 4000, -40000);

-- One cell of a project's month, from project_cash_months(p, 2, 2026-06-15).
create or replace function pg_temp.cell(p_project text, p_month text, p_field text)
returns bigint
language sql
as $$
  select (r ->> p_field)::bigint
  from jsonb_array_elements(public.project_cash_months(pg_temp.id(p_project), 2, '2026-06-15') -> 'months') m
  cross join lateral jsonb_array_elements(m -> 'by_currency') r
  where m ->> 'month' = p_month and r ->> 'currency' = 'ILS';
$$;
grant execute on function pg_temp.cell(text, text, text) to authenticated, service_role;

select tests.authenticate_as('pc_owner');

select is(
  jsonb_array_length(public.project_cash_months(pg_temp.id('cedar'), 2, '2026-06-15') -> 'months'),
  2,
  'two months, the current one first'
);
select is(pg_temp.cell('cedar', '2026-06-01', 'in_minor'), 1000000::bigint, 'Cedar June: the rent is in');
select is(pg_temp.cell('cedar', '2026-06-01', 'out_minor'), 360000::bigint, 'Cedar June: its repair and 60% of the shared bill are out');
select is(pg_temp.cell('cedar', '2026-06-01', 'net_minor'), 640000::bigint, 'Cedar June: the net');
select is(pg_temp.cell('cedar', '2026-06-01', 'profit_minor'), 640000::bigint, 'Cedar June: the profit counts the same lines');
select is(pg_temp.cell('maple', '2026-06-01', 'out_minor'), 90000::bigint, 'Maple June: its cost and 40% of the shared bill');
select is(pg_temp.cell('cedar', '2026-05-01', 'out_minor'), 200000::bigint, 'Cedar May: the transfer stays out of cash');
select is(pg_temp.cell('cedar', '2026-05-01', 'excluded_out_minor'), 25000::bigint, 'Cedar May: the transfer is what the view leaves out');

select is(
  (select jsonb_agg((r ->> 'amount_minor')::bigint order by (r ->> 'amount_minor')::bigint)
   from jsonb_array_elements(public.project_cash_month_lines(pg_temp.id('cedar'), '2026-06-01', 'out') -> 'rows') r),
  '[60000, 300000]'::jsonb,
  'Cedar June out: the repair, and the shared bill at Cedar''s share'
);
select is(
  (select (r ->> 'shared')::boolean
   from jsonb_array_elements(public.project_cash_month_lines(pg_temp.id('cedar'), '2026-06-01', 'out') -> 'rows') r
   where (r ->> 'transaction_id')::uuid = pg_temp.id('shared')),
  true,
  'the shared bill''s row is marked shared'
);
select is(
  jsonb_array_length(public.project_cash_month_lines(pg_temp.id('cedar'), '2026-06-01', 'in') -> 'rows'),
  1,
  'Cedar June in: the rent'
);
select is(
  (public.project_cash_month_lines(pg_temp.id('cedar'), '2026-05-01', 'excluded') -> 'rows' -> 0 ->> 'transaction_id')::uuid,
  pg_temp.id('transfer'),
  'Cedar May left out: the transfer'
);
select is(public.project_cash_months(pg_temp.id('elsewhere'), 2, '2026-06-15'), null, 'another company''s project reads as nothing');
select is(public.project_cash_month_lines(pg_temp.id('elsewhere'), '2026-06-01', 'out'), null, 'nor do its lines');
select throws_ok(
  $$ select public.project_cash_month_lines(pg_temp.id('cedar'), '2026-06-01', 'sideways') $$,
  'validation',
  'an unknown side is refused'
);

select tests.clear_authentication();
select is(
  (select count(*)::integer from (values
    (has_function_privilege('anon', 'public.project_cash_months(uuid, integer, date)', 'execute')),
    (has_function_privilege('anon', 'public.project_cash_month_lines(uuid, date, text, text, integer, integer)', 'execute'))
  ) v(allowed) where allowed),
  0,
  'anon cannot call the project cash reads'
);

select * from finish();
rollback;
