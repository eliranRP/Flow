-- FLOW-212, the Flow MCP agent's request of 2026-10-09: a refund filed under an expense category
-- lowers that category's cost in get_breakdown, get_project and get_profit_months, on both bases,
-- and never shows as income (decision 0103).

begin;

select plan(7);

do $users$
begin
  perform tests.create_supabase_user('rf_owner', 'rf-owner@example.com');
end
$users$;

create temp table rf_ref (label text primary key, id uuid);
grant all on rf_ref to authenticated;

select tests.authenticate_as('rf_owner');
select public.create_company('Example Refunds LLC', true);
select public.upsert_project(null, 'Site Gamma', null, 'active');
insert into rf_ref (label, id) select 'co', id from public.companies where name = 'Example Refunds LLC';
insert into rf_ref (label, id) select 'gamma', id from public.projects where name = 'Site Gamma';
insert into rf_ref (label, id)
select 'cat', c.id from public.categories c
where c.company_id = (select id from rf_ref where label = 'co')
  and c.kind = 'expense' and not c.excluded_from_pnl and c.loan_part is null
order by c.name
limit 1;

reset role;

-- Invented amounts: a 100.00 cost and a 30.00 refund of it, both on Site Gamma, both under the
-- same expense category. The refund is money in (an income line).
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select
  (select id from rf_ref where label = 'co'),
  v.dir::public.txn_direction, v.doc_kind::public.doc_kind, 'project', 'posted', 'USD',
  v.amount, v.amount, abs(v.amount), 0, 'source',
  v.doc_date::date, v.doc_date::date,
  'manual', 'rf:' || v.ikey,
  (select id from rf_ref where label = 'gamma'),
  (select id from rf_ref where label = 'cat'),
  v.ikey,
  true
from (values
  ('expense', 'expense', -10000, '2026-08-05', 'cost'),
  ('income', 'receipt', 3000, '2026-08-20', 'refund')
) as v(dir, doc_kind, amount, doc_date, ikey);

select tests.authenticate_as('rf_owner');

create temp table rf_out (label text primary key, j jsonb);
insert into rf_out (label, j) values
  ('ex:cash', public.get_breakdown('expense', null, null, 'category', 'cash')),
  ('ex:invoiced', public.get_breakdown('expense', null, null, 'category', 'invoiced')),
  ('in:cash', public.get_breakdown('income', null, null, 'category', 'cash')),
  ('project:cash', public.get_project((select id from rf_ref where label = 'gamma'), 'cash')),
  ('project:invoiced', public.get_project((select id from rf_ref where label = 'gamma'), 'invoiced')),
  ('months:cash', public.get_profit_months('2026-08-01', '2026-08-31', 'cash')),
  ('months:invoiced', public.get_profit_months('2026-08-01', '2026-08-31', 'invoiced'));

select is(
  (select (x ->> 'amount_minor')::bigint from jsonb_array_elements((select j from rf_out where label = 'ex:cash') -> 'totals') x where x ->> 'currency' = 'USD'),
  7000::bigint,
  'get_breakdown, cash: the refund comes off the category''s cost'
);
select is(
  (select (x ->> 'amount_minor')::bigint from jsonb_array_elements((select j from rf_out where label = 'ex:invoiced') -> 'totals') x where x ->> 'currency' = 'USD'),
  7000::bigint,
  'get_breakdown, invoiced: the refund comes off the category''s cost'
);
select is(
  coalesce((select (x ->> 'amount_minor')::bigint from jsonb_array_elements((select j from rf_out where label = 'in:cash') -> 'totals') x where x ->> 'currency' = 'USD'), 0),
  0::bigint,
  'get_breakdown: the refund is not income'
);
select is(
  (select j #> '{by_currency}' from rf_out where label = 'project:cash') @> '[{"currency": "USD", "income_minor": 0, "direct_minor": 7000}]'::jsonb
    and (select j #> '{categories_by_currency}' from rf_out where label = 'project:cash') @> '[{"currency": "USD", "amount_minor": 7000}]'::jsonb,
  true,
  'get_project, cash: income 0, the category''s cost net of the refund'
);
select is(
  (select j #> '{by_currency}' from rf_out where label = 'project:invoiced') @> '[{"currency": "USD", "income_minor": 0, "direct_minor": 7000}]'::jsonb
    and (select j #> '{categories_by_currency}' from rf_out where label = 'project:invoiced') @> '[{"currency": "USD", "amount_minor": 7000}]'::jsonb,
  true,
  'get_project, invoiced: income 0, the category''s cost net of the refund'
);
select is(
  (select j #> '{months,0,by_currency}' from rf_out where label = 'months:cash') @> '[{"currency": "USD", "income_minor": 0, "expense_minor": 7000}]'::jsonb,
  true,
  'get_profit_months, cash: August income 0, cost net of the refund'
);
select is(
  (select j #> '{months,0,by_currency}' from rf_out where label = 'months:invoiced') @> '[{"currency": "USD", "income_minor": 0, "expense_minor": 7000}]'::jsonb,
  true,
  'get_profit_months, invoiced: August income 0, cost net of the refund'
);

select * from finish();
rollback;
