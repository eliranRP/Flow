-- FLOW-104. A reversal is an outflow under an income category (negative income)
-- or an inflow under an expense category (negative expense). Decision 0103.
-- Invented data only. Amounts are minor units (10000 is 100.00), ILS and USD.

begin;

select plan(62);

do $users$
begin
  perform tests.create_supabase_user('rv_owner', 'rv-owner@example.com');
  perform tests.create_supabase_user('rv_iso', 'rv-iso@example.com');
  perform tests.create_supabase_user('rv_assign', 'rv-assign@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('rv_owner'), 'Example Reversals LLC', false),
  (tests.get_supabase_uid('rv_iso'), 'Example Isolated LLC', false),
  (tests.get_supabase_uid('rv_assign'), 'Example Assign LLC', false);

create temp table rv_ref (label text primary key, id uuid);
grant all on rv_ref to authenticated, service_role;

insert into rv_ref (label, id)
select case name
  when 'Example Reversals LLC' then 'A'
  when 'Example Isolated LLC' then 'I'
  else 'C' end, id
from public.companies;

-- Per company: two projects and four categories.
insert into public.projects (company_id, name, status)
select r.id, v.name, 'active'
from rv_ref r cross join (values ('Site One'), ('Site Two')) v(name)
where r.label in ('A', 'I', 'C');

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select r.id, v.name, v.kind::public.category_kind, 60, false, v.kept_out
from rv_ref r
cross join (values
  ('Rent income',     'income',  false),
  ('Transfers',       'income',  true),
  ('Materials',       'expense', false),
  ('Deposit holding', 'expense', true)
) v(name, kind, kept_out)
where r.label in ('A', 'I', 'C');

insert into rv_ref (label, id)
select r.label || ':' || case p.name when 'Site One' then 'p1' else 'p2' end, p.id
from public.projects p join rv_ref r on r.id = p.company_id and length(r.label) = 1;

insert into rv_ref (label, id)
select r.label || ':' || case k.name
    when 'Rent income' then 'rent' when 'Transfers' then 'transfers'
    when 'Materials' then 'materials' else 'deposit' end, k.id
from public.categories k join rv_ref r on r.id = k.company_id and length(r.label) = 1
where k.name in ('Rent income', 'Transfers', 'Materials', 'Deposit holding');

-- One plain line, filed under the category of its own kind. Stores its id under p_key.
create function pg_temp.mk(
  p_co text, p_key text, p_direction text, p_doc_kind text, p_role text, p_currency text,
  p_net bigint, p_doc date, p_cash date, p_cat text, p_project text
) returns void
language plpgsql
as $$
begin
  insert into public.transactions (
    company_id, direction, doc_kind, pnl_role, line_status, currency,
    amount_gross, amount_net, vat_amount, vat_status,
    doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
    user_assigned
  ) values (
    (select id from rv_ref where label = p_co),
    p_direction::public.txn_direction, p_doc_kind::public.doc_kind,
    p_role::public.pnl_role, 'posted', p_currency,
    p_net, p_net, 0, 'source',
    p_doc, p_cash, 'manual', p_co || ':' || p_key,
    (select id from rv_ref where label = p_co || ':' || p_project),
    (select id from rv_ref where label = p_co || ':' || p_cat),
    'example ' || p_key, true
  );
  insert into rv_ref (label, id)
  select p_co || ':' || p_key, id from public.transactions
  where idempotency_key = p_co || ':' || p_key;
end
$$;

-- Company A. Normal lines, then lines that become reversals.
select pg_temp.mk('A', 'n1', 'income',  'invoice_receipt', null,      'ILS',  100000, '2026-06-05', '2026-06-05', 'rent',      'p1');
select pg_temp.mk('A', 'n3', 'income',  'invoice',         null,      'ILS',    7000, '2026-06-07', null,         'rent',      'p1');
select pg_temp.mk('A', 'n2', 'expense', 'expense',         'project', 'ILS',  -20000, '2026-06-08', '2026-06-08', 'materials', 'p1');
select pg_temp.mk('A', 'r1', 'expense', 'expense',         'project', 'ILS',  -10000, '2026-06-10', '2026-06-10', 'materials', 'p1');
select pg_temp.mk('A', 'r2', 'expense', 'expense',         'project', 'ILS',   -5000, '2026-06-20', '2026-07-02', 'materials', 'p1');
select pg_temp.mk('A', 'r3', 'income',  'receipt',         null,      'ILS',    5000, '2026-06-12', '2026-06-12', 'rent',      'p1');
select pg_temp.mk('A', 'k1', 'expense', 'expense',         'project', 'ILS',   -3000, '2026-06-11', '2026-06-11', 'materials', 'p1');
select pg_temp.mk('A', 'k2', 'income',  'receipt',         null,      'ILS',    2000, '2026-06-13', '2026-06-13', 'rent',      'p1');
select pg_temp.mk('A', 'u1', 'expense', 'expense',         'project', 'USD',  -20000, '2026-06-10', '2026-06-10', 'materials', 'p1');
select pg_temp.mk('A', 'u2', 'income',  'receipt',         null,      'USD',    4000, '2026-06-10', '2026-06-10', 'rent',      'p1');

-- Company I. One line per direction on its own project.
select pg_temp.mk('I', 'i1', 'expense', 'expense', 'project', 'ILS', -10000, '2026-06-10', '2026-06-10', 'materials', 'p1');
select pg_temp.mk('I', 'i2', 'income',  'receipt', null,      'ILS',   5000, '2026-06-12', '2026-06-12', 'rent',      'p2');

-- Company C. Lines for the assign RPCs.
select pg_temp.mk('C', 'c1', 'expense', 'expense', 'project', 'ILS', -10000, '2026-06-10', '2026-06-10', 'materials', 'p1');
select pg_temp.mk('C', 'c2', 'income',  'receipt', null,      'ILS',   5000, '2026-06-11', '2026-06-11', 'rent',      'p1');
select pg_temp.mk('C', 'c3', 'expense', 'expense', 'project', 'ILS', -10000, '2026-06-12', '2026-06-12', 'materials', 'p1');
select pg_temp.mk('C', 'c4', 'income',  'receipt', null,      'ILS',   5000, '2026-06-13', '2026-06-13', 'rent',      'p1');
select pg_temp.mk('C', 'c5', 'expense', 'expense', 'project', 'ILS', -10000, '2026-06-14', '2026-06-14', 'materials', 'p1');
select pg_temp.mk('C', 'c6', 'expense', 'expense', 'project', 'ILS', -10000, '2026-06-15', '2026-06-15', 'materials', 'p1');
select pg_temp.mk('C', 'c7', 'expense', 'expense', 'shared',  'ILS', -20000, '2026-06-16', '2026-06-16', 'materials', 'p1');
select pg_temp.mk('C', 'c8', 'expense', 'expense', 'shared',  'ILS', -20000, '2026-06-17', '2026-06-17', 'materials', 'p1');
select pg_temp.mk('C', 'c9', 'expense', 'expense', 'project', 'ILS', -10000, '2026-06-18', '2026-06-18', 'materials', 'p1');

update public.transactions set category_id = null where idempotency_key = 'C:c8';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from rv_ref where label = 'C'),
  (select id from rv_ref where label = 'C:' || v.t), (select id from rv_ref where label = 'C:' || v.p),
  5000, -10000
from (values ('c7', 'p1'), ('c7', 'p2'), ('c8', 'p1'), ('c8', 'p2')) v(t, p);

insert into public.review_queue (company_id, transaction_id, status, reason)
select (select id from rv_ref where label = 'C'),
  (select id from rv_ref where label = 'C:' || v.t), 'open', v.reason
from (values
  ('c3', 'suggested'), ('c4', 'suggested'), ('c6', 'suggested'),
  ('c7', 'missing_category'), ('c8', 'missing_category')
) v(t, reason);

insert into rv_ref (label, id)
select 'rev:' || replace(t.idempotency_key, 'C:', ''), q.id
from public.review_queue q join public.transactions t on t.id = q.transaction_id
where t.idempotency_key like 'C:%';

create function pg_temp.pnl(p_co text, p_from date, p_to date, p_basis text)
returns jsonb
language sql
as $$
  select public.company_pnl((select id from rv_ref where label = p_co), p_from, p_to, p_basis);
$$;
grant execute on function pg_temp.pnl(text, date, date, text) to authenticated;

create function pg_temp.cur(p_co text, p_from date, p_to date, p_basis text, p_cur text)
returns jsonb
language sql
as $$
  -- The prev_* fields are checked in company_base_currency.test.sql.
  select x - 'prev_income_minor' - 'prev_expense_minor' - 'prev_net_profit_minor'
  from jsonb_array_elements(pg_temp.pnl(p_co, p_from, p_to, p_basis) -> 'by_currency') x
  where x->>'currency' = p_cur;
$$;
grant execute on function pg_temp.cur(text, date, date, text, text) to authenticated;

create function pg_temp.top(p_co text, p_from date, p_to date, p_basis text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'income', j->'income_agorot', 'expense', j->'expense_agorot', 'net', j->'net_profit_agorot'
  )
  from (select pg_temp.pnl(p_co, p_from, p_to, p_basis) j) s;
$$;
grant execute on function pg_temp.top(text, date, date, text) to authenticated;

create function pg_temp.proj(p_label text, p_basis text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'income', j->'income_agorot', 'direct', j->'direct_agorot', 'profit', j->'profit_agorot')
  from (select public.get_project((select id from rv_ref where label = p_label), p_basis) j) s;
$$;
grant execute on function pg_temp.proj(text, text) to authenticated;

create function pg_temp.proj_cur(p_label text, p_basis text, p_cur text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'income', x->'income_minor', 'direct', x->'direct_minor', 'profit', x->'profit_minor')
  from jsonb_array_elements(
    public.get_project((select id from rv_ref where label = p_label), p_basis) -> 'by_currency'
  ) x
  where x->>'currency' = p_cur;
$$;
grant execute on function pg_temp.proj_cur(text, text, text) to authenticated;

create function pg_temp.proj_cats(p_label text, p_key text)
returns jsonb
language sql
as $$
  select coalesce(jsonb_object_agg(x->>'name', x->'amount_minor'), '{}'::jsonb)
  from jsonb_array_elements(
    public.get_project((select id from rv_ref where label = p_label), 'cash') -> p_key
  ) x
  where x->>'currency' = 'ILS';
$$;
grant execute on function pg_temp.proj_cats(text, text) to authenticated;

select tests.authenticate_as('rv_owner');

-- (8) Non-reversal lines keep today's numbers. Snapshot before any line is reversed.
select is(
  pg_temp.top('A', '2026-06-01', '2026-06-30', 'cash'),
  '{"income": 107000, "expense": 38000, "net": 69000}'::jsonb,
  'snapshot, cash: only receipts count as income, every expense counts by its document date'
);
select is(
  pg_temp.top('A', '2026-06-01', '2026-06-30', 'invoiced'),
  '{"income": 107000, "expense": 38000, "net": 69000}'::jsonb,
  'snapshot, invoiced: invoices count as income, receipts do not'
);
select is(
  pg_temp.cur('A', '2026-06-01', '2026-06-30', 'cash', 'USD') - 'count' - 'loan_split_fallback_count',
  '{"currency": "USD", "income_minor": 4000, "direct_minor": 20000, "shared_minor": 0, "overhead_minor": 0,
    "expense_minor": 20000, "net_profit_minor": -16000, "excluded_income_minor": 0,
    "excluded_expense_minor": 0, "excluded_count": 0,
    "unassigned_income_minor": 0, "unassigned_expense_minor": 0}'::jsonb,
  'snapshot, USD by_currency before any reversal'
);

-- Reverse the lines through the assign RPC, as the owner would.
select lives_ok(
  format('select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from rv_ref where label = 'A:r1'), (select id from rv_ref where label = 'A:p1'),
    (select id from rv_ref where label = 'A:rent')),
  'an outflow takes an income category'
);
select lives_ok(
  format('select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from rv_ref where label = 'A:r2'), (select id from rv_ref where label = 'A:p1'),
    (select id from rv_ref where label = 'A:rent')),
  'a second outflow takes an income category'
);
select lives_ok(
  format('select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from rv_ref where label = 'A:r3'), (select id from rv_ref where label = 'A:p1'),
    (select id from rv_ref where label = 'A:materials')),
  'an inflow takes an expense category'
);
select lives_ok(
  format('select public.reassign_transaction(%L::uuid, null, %L::uuid)',
    (select id from rv_ref where label = 'A:k1'), (select id from rv_ref where label = 'A:transfers')),
  'a kept-out income category on an outflow needs no project'
);
select lives_ok(
  format('select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from rv_ref where label = 'A:k2'), (select id from rv_ref where label = 'A:p1'),
    (select id from rv_ref where label = 'A:deposit')),
  'a kept-out expense category on an inflow'
);
select lives_ok(
  format('select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from rv_ref where label = 'A:u1'), (select id from rv_ref where label = 'A:p1'),
    (select id from rv_ref where label = 'A:rent')),
  'a USD outflow takes an income category'
);
select lives_ok(
  format('select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from rv_ref where label = 'A:u2'), (select id from rv_ref where label = 'A:p1'),
    (select id from rv_ref where label = 'A:materials')),
  'a USD inflow takes an expense category'
);

-- Role and project follow the category kind.
select is(
  (select jsonb_build_object('role', t.pnl_role, 'project', t.project_id = (select id from rv_ref where label = 'A:p1'))
   from public.transactions t where t.id = (select id from rv_ref where label = 'A:r1')),
  '{"role": null, "project": true}'::jsonb,
  'an income-kind outflow keeps its project and has no cost role, like income'
);
select is(
  (select jsonb_build_object('role', t.pnl_role,
      'shares', (select count(*) from public.allocations a where a.transaction_id = t.id))
   from public.transactions t where t.id = (select id from rv_ref where label = 'A:r3')),
  '{"role": "project", "shares": 1}'::jsonb,
  'an expense-kind inflow is a project cost with one share'
);
select is(
  (select jsonb_build_object('direction', t.direction, 'net', t.amount_net)
   from public.transactions t where t.id = (select id from rv_ref where label = 'A:r1')),
  '{"direction": "expense", "net": -10000}'::jsonb,
  'the direction and the signed amount stay as stored'
);

-- (1) and (2) Company I: one reversal each, nothing else.
select tests.authenticate_as('rv_iso');
select lives_ok(
  format('select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from rv_ref where label = 'I:i1'), (select id from rv_ref where label = 'I:p1'),
    (select id from rv_ref where label = 'I:rent')),
  'company I: an outflow 100.00 takes an income category on project one'
);
select lives_ok(
  format('select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from rv_ref where label = 'I:i2'), (select id from rv_ref where label = 'I:p2'),
    (select id from rv_ref where label = 'I:materials')),
  'company I: an inflow 50.00 takes an expense category on project two'
);

select is(
  pg_temp.top('I', '2026-06-01', '2026-06-30', 'cash'),
  '{"income": -10000, "expense": -5000, "net": -5000}'::jsonb,
  'company I, cash: income -100.00, expense -50.00, net -50.00'
);
select is(
  pg_temp.top('I', '2026-06-01', '2026-06-30', 'invoiced'),
  '{"income": -10000, "expense": -5000, "net": -5000}'::jsonb,
  'company I, invoiced: the same, the reversal counts on both bases'
);
select is(
  (select jsonb_build_object('income', pg_temp.cur('I', '2026-06-01', '2026-06-30', 'cash', 'ILS')->'income_minor',
      'net', pg_temp.cur('I', '2026-06-01', '2026-06-30', 'cash', 'ILS')->'net_profit_minor')),
  '{"income": -10000, "net": -5000}'::jsonb,
  'company I: by_currency agrees with the top-level fields'
);
select is(
  (select jsonb_object_agg(x->>'name', jsonb_build_object('income', x->'income_agorot', 'profit', x->'profit_agorot'))
   from jsonb_array_elements(pg_temp.pnl('I', '2026-06-01', '2026-06-30', 'cash')->'projects') x),
  '{"Site One": {"income": -10000, "profit": -10000}, "Site Two": {"income": 0, "profit": 5000}}'::jsonb,
  'company I: project one has income -100.00 and profit -100.00, project two profit +50.00'
);
select is(
  pg_temp.proj('I:p1', 'cash'),
  '{"income": -10000, "direct": 0, "profit": -10000}'::jsonb,
  'company I: get_project, project one, cash'
);
select is(
  pg_temp.proj('I:p1', 'invoiced'),
  '{"income": -10000, "direct": 0, "profit": -10000}'::jsonb,
  'company I: get_project, project one, invoiced'
);
select is(
  pg_temp.proj('I:p2', 'invoiced'),
  '{"income": 0, "direct": -5000, "profit": 5000}'::jsonb,
  'company I: get_project, project two has a negative direct cost'
);
select is(
  pg_temp.proj_cats('I:p2', 'categories_by_currency'),
  '{"Materials": -5000}'::jsonb,
  'company I: the category totals show the refund as a negative cost'
);

-- (1) to (3) Company A across periods, bases and the three reads.
select tests.authenticate_as('rv_owner');
select is(
  pg_temp.top('A', '2026-06-01', '2026-06-30', 'cash'),
  '{"income": 90000, "expense": 15000, "net": 75000}'::jsonb,
  'cash, June: the bounced rent comes off income by its cash date, the refund comes off expense'
);
select is(
  pg_temp.top('A', '2026-06-01', '2026-06-30', 'invoiced'),
  '{"income": 92000, "expense": 15000, "net": 77000}'::jsonb,
  'invoiced, June: the reversal counts by document date whatever its document kind'
);
select is(
  pg_temp.top('A', '2026-07-01', '2026-07-31', 'cash'),
  '{"income": -5000, "expense": 0, "net": -5000}'::jsonb,
  'cash, July: a reversal with a later cash date lands in that month'
);
select is(
  (pg_temp.top('A', '2026-07-01', '2026-07-31', 'invoiced')->'income'),
  '0'::jsonb,
  'invoiced, July: nothing, its document date is in June'
);
select is(
  (select jsonb_build_object('income', x->'income_agorot', 'direct', x->'direct_agorot', 'profit', x->'profit_agorot')
   from jsonb_array_elements(pg_temp.pnl('A', '2026-06-01', '2026-06-30', 'cash')->'projects') x
   where x->>'name' = 'Site One'),
  '{"income": 90000, "direct": 15000, "profit": 75000}'::jsonb,
  'company_pnl project row: income and cost follow the category kind'
);
select is(
  (select jsonb_build_object('income', x->'income_minor', 'expense', x->'expense_minor', 'net', x->'net_profit_minor')
   from jsonb_array_elements(pg_temp.pnl('A', null, null, 'cash')->'by_currency') x
   where x->>'currency' = 'ILS'),
  '{"income": 85000, "expense": 15000, "net": 70000}'::jsonb,
  'by_currency ILS without a period, cash'
);
select is(
  pg_temp.proj('A:p1', 'cash'),
  '{"income": 85000, "direct": 15000, "profit": 70000}'::jsonb,
  'get_project agrees with company_pnl, cash'
);
select is(
  pg_temp.proj('A:p1', 'invoiced'),
  '{"income": 92000, "direct": 15000, "profit": 77000}'::jsonb,
  'get_project agrees with company_pnl, invoiced'
);
select is(
  public.get_home()->'net_profit_agorot',
  '70000'::jsonb,
  'get_home agrees with company_pnl net on the cash basis'
);
select is(
  pg_temp.cur('A', null, null, 'cash', 'USD') - 'count' - 'loan_split_fallback_count',
  '{"currency": "USD", "income_minor": -20000, "direct_minor": -4000, "shared_minor": 0, "overhead_minor": 0,
    "expense_minor": -4000, "net_profit_minor": -16000, "excluded_income_minor": 0,
    "excluded_expense_minor": 0, "excluded_count": 0,
    "unassigned_income_minor": 0, "unassigned_expense_minor": 0}'::jsonb,
  'company_pnl by_currency, USD: negative income and negative expense'
);
select is(
  pg_temp.proj_cur('A:p1', 'cash', 'USD'),
  '{"income": -20000, "direct": -4000, "profit": -16000}'::jsonb,
  'get_project by_currency, USD, agrees'
);
select is(
  (select jsonb_build_object('income', x->'income_minor', 'expense', x->'expense_minor', 'count', x->'count')
   from jsonb_array_elements(public.get_home()->'other_currencies') x where x->>'currency' = 'USD'),
  '{"income": -20000, "expense": 4000, "count": 2}'::jsonb,
  'get_home other_currencies, USD, agrees'
);
select is(
  (select jsonb_build_object('income', x->'income_minor', 'expense', x->'expense_minor', 'count', x->'count')
   from jsonb_array_elements(pg_temp.pnl('A', '2026-06-01', '2026-06-30', 'invoiced')->'other_currencies') x
   where x->>'currency' = 'USD'),
  '{"income": -20000, "expense": 4000, "count": 2}'::jsonb,
  'company_pnl other_currencies, USD, invoiced basis, agrees'
);
select is(
  pg_temp.proj_cats('A:p1', 'categories_by_currency'),
  '{"Materials": 15000}'::jsonb,
  'the category totals net the refund against the cost'
);

-- (6) A kept-out reversal goes to the excluded totals, both directions.
select is(
  (select jsonb_build_object('income', x->'excluded_income_agorot', 'expense', x->'excluded_expense_agorot')
   from (select pg_temp.pnl('A', '2026-06-01', '2026-06-30', 'cash') x) s),
  '{"income": -3000, "expense": -2000}'::jsonb,
  'excluded totals: the kept-out outflow is negative income, the kept-out inflow negative expense'
);
select is(
  (pg_temp.cur('A', '2026-06-01', '2026-06-30', 'invoiced', 'ILS')->'excluded_count'),
  '2'::jsonb,
  'excluded count on the invoiced basis'
);
select is(
  pg_temp.proj_cats('A:p1', 'excluded_categories_by_currency'),
  '{"Deposit holding": -2000}'::jsonb,
  'get_project: the kept-out refund sits under excluded categories'
);

-- (4) The four RPCs accept the other kind.
select tests.authenticate_as('rv_assign');
select lives_ok(
  format('select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from rv_ref where label = 'C:c1'), (select id from rv_ref where label = 'C:p1'),
    (select id from rv_ref where label = 'C:rent')),
  'reassign_transaction: an outflow under an income category'
);
select lives_ok(
  format('select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from rv_ref where label = 'C:c2'), (select id from rv_ref where label = 'C:p1'),
    (select id from rv_ref where label = 'C:materials')),
  'reassign_transaction: an inflow under an expense category'
);
select lives_ok(
  format('select public.set_transaction_category(%L::uuid, %L::uuid, false)',
    (select id from rv_ref where label = 'C:c3'), (select id from rv_ref where label = 'C:rent')),
  'set_transaction_category: an outflow under an income category'
);
select is(
  (select t.category_id from public.transactions t where t.id = (select id from rv_ref where label = 'C:c3')),
  (select id from rv_ref where label = 'C:rent'),
  'set_transaction_category wrote the income category on the outflow'
);
select lives_ok(
  format('select public.set_transaction_category(%L::uuid, %L::uuid, false)',
    (select id from rv_ref where label = 'C:c4'), (select id from rv_ref where label = 'C:materials')),
  'set_transaction_category: an inflow under an expense category'
);
select lives_ok(
  format('select public.resolve_review(%L::uuid, ''approved'', %L::uuid, %L::uuid, false)',
    (select id from rv_ref where label = 'rev:c6'), (select id from rv_ref where label = 'C:p1'),
    (select id from rv_ref where label = 'C:rent')),
  'resolve_review: approving an outflow under an income category with a project'
);
select is(
  (select jsonb_build_object('role', t.pnl_role, 'status', (select q.status from public.review_queue q where q.id = (select id from rv_ref where label = 'rev:c6')))
   from public.transactions t where t.id = (select id from rv_ref where label = 'C:c6')),
  '{"role": null, "status": "approved"}'::jsonb,
  'resolve_review closed the item and treated the outflow like income'
);
select lives_ok(
  format('select public.resolve_review(%L::uuid, ''changed'', %L::uuid, %L::uuid, false, false)',
    (select id from rv_ref where label = 'rev:c4'), (select id from rv_ref where label = 'C:p1'),
    (select id from rv_ref where label = 'C:materials')),
  'resolve_review without resolving: an inflow under an expense category'
);
select lives_ok(
  format('select public.set_transaction_category(%L::uuid, %L::uuid, false)',
    (select id from rv_ref where label = 'C:c7'), (select id from rv_ref where label = 'C:rent')),
  'a shared outflow takes an income category'
);
select lives_ok(
  format('select public.approve_split_review(%L::uuid)', (select id from rv_ref where label = 'rev:c7')),
  'approve_split_review: a split outflow under an income category'
);
select is(
  (select q.status::text from public.review_queue q where q.id = (select id from rv_ref where label = 'rev:c7')),
  'approved',
  'approve_split_review closed the item'
);
select throws_ok(
  format('select public.approve_split_review(%L::uuid)', (select id from rv_ref where label = 'rev:c8')),
  'P0001',
  'category is required',
  'approve_split_review still refuses a line with no category'
);

-- (5) An income-kind category on an outflow needs a project, like income.
select throws_ok(
  format('select public.reassign_transaction(%L::uuid, null, %L::uuid)',
    (select id from rv_ref where label = 'C:c5'), (select id from rv_ref where label = 'C:rent')),
  'P0001',
  'project and category are required',
  'reassign_transaction: an income-kind outflow without a project is refused'
);
select lives_ok(
  format('select public.reassign_transaction(%L::uuid, null, %L::uuid)',
    (select id from rv_ref where label = 'C:c5'), (select id from rv_ref where label = 'C:transfers')),
  'reassign_transaction: a kept-out income category needs no project'
);
select throws_ok(
  format('select public.resolve_review(%L::uuid, ''approved'', null, %L::uuid, false)',
    (select id from rv_ref where label = 'rev:c3'), (select id from rv_ref where label = 'C:rent')),
  'P0001',
  'project and category are required',
  'resolve_review: an income-kind outflow without a project is refused'
);

-- (7) Cross-tenant refusal, with a positive control.
select throws_ok(
  format('select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from rv_ref where label = 'A:n2'), (select id from rv_ref where label = 'C:p1'),
    (select id from rv_ref where label = 'C:rent')),
  'P0001',
  'transaction not found',
  'another company''s line is refused'
);
select throws_ok(
  format('select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from rv_ref where label = 'C:c9'), (select id from rv_ref where label = 'C:p1'),
    (select id from rv_ref where label = 'A:rent')),
  'P0001',
  'category not found',
  'another company''s income category is refused on an outflow'
);
select throws_ok(
  format('select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from rv_ref where label = 'C:c9'), (select id from rv_ref where label = 'A:p1'),
    (select id from rv_ref where label = 'C:rent')),
  'P0001',
  'project not found',
  'another company''s project is refused on an income-kind outflow'
);
select lives_ok(
  format('select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from rv_ref where label = 'C:c9'), (select id from rv_ref where label = 'C:p1'),
    (select id from rv_ref where label = 'C:rent')),
  'positive control: the owner files the same line under their own income category and project'
);
select tests.authenticate_as('rv_owner');
select throws_ok(
  format('select public.set_transaction_category(%L::uuid, %L::uuid, false)',
    (select id from rv_ref where label = 'A:n2'), (select id from rv_ref where label = 'C:rent')),
  'P0001',
  'category not found',
  'set_transaction_category refuses another company''s income category'
);
select throws_ok(
  format('select public.company_pnl(%L::uuid, null, null, ''cash'')', (select id from rv_ref where label = 'C')),
  'P0001',
  'forbidden',
  'company_pnl refuses another company''s reversals'
);
select is(
  pg_temp.top('A', null, null, 'cash')->'income',
  '85000'::jsonb,
  'positive control: the owner reads their own company'
);

select * from finish();
rollback;
