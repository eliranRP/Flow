-- FLOW-701 part 4 (decision 0131). Anomaly candidates, recurring suppliers and customers,
-- missing bills and expected months, all computed in SQL for the caller's company.
-- Helpers come from supabase/tests/helpers.sql.

begin;

select plan(26);

do $users$
begin
  perform tests.create_supabase_user('jp_owner');
  perform tests.create_supabase_user('jp_other');
end
$users$;

select tests.authenticate_as('jp_owner');
select lives_ok($$select public.create_company('עסק א', true)$$, 'owner creates a company');
select tests.authenticate_as('jp_other');
select lives_ok($$select public.create_company('עסק ב', true)$$, 'other owner creates a company');
reset role;

create temp table jp_ref (label text primary key, id uuid);
grant all on jp_ref to anon, authenticated, service_role;

insert into jp_ref (label, id)
select 'co', c.id from public.companies c
join auth.users u on u.id = c.owner_id
where u.raw_user_meta_data ->> 'test_identifier' = 'jp_owner';
insert into jp_ref (label, id)
select 'co_b', c.id from public.companies c
join auth.users u on u.id = c.owner_id
where u.raw_user_meta_data ->> 'test_identifier' = 'jp_other';

insert into public.suppliers (company_id, name)
select (select id from jp_ref where label = 'co'), n
from unnest(array['שכירות', 'חשמל', 'ספק משולם', 'ספק ישן', 'ספק קפיצה', 'ספק כפול', 'ספק חדש', 'ספק מילוי', 'ספק סוף חודש']) n;
insert into jp_ref (label, id)
select case s.name
    when 'שכירות' then 's_rent' when 'חשמל' then 's_power' when 'ספק משולם' then 's_paid'
    when 'ספק ישן' then 's_old' when 'ספק קפיצה' then 's_spike' when 'ספק כפול' then 's_dup'
    when 'ספק חדש' then 's_new' when 'ספק סוף חודש' then 's_late' else 's_fill' end, s.id
from public.suppliers s where s.company_id = (select id from jp_ref where label = 'co');
insert into public.customers (company_id, name) select id, 'שוכר' from jp_ref where label = 'co';
insert into jp_ref (label, id) select 'c_rent', id from public.customers where name = 'שוכר';
insert into public.projects (company_id, name) select id, 'בניין צפון' from jp_ref where label = 'co';
insert into jp_ref (label, id) select 'p1', id from public.projects where name = 'בניין צפון';

-- One helper insert per line: label, supplier or customer label, date, net amount.
create temp table jp_lines (label text, party text, doc_date date, net bigint);
insert into jp_lines values
  ('rent_10', 's_rent', '2025-10-03', -500000), ('rent_11', 's_rent', '2025-11-03', -500000),
  ('rent_12', 's_rent', '2025-12-03', -500000), ('rent_01', 's_rent', '2026-01-03', -500000),
  ('rent_02', 's_rent', '2026-02-03', -500000), ('rent_03', 's_rent', '2026-03-03', -500000),
  ('power_11', 's_power', '2025-11-18', -20000), ('power_12', 's_power', '2025-12-18', -20000),
  ('power_01', 's_power', '2026-01-18', -20000), ('power_02', 's_power', '2026-02-18', -20000),
  ('power_03', 's_power', '2026-03-18', -20000),
  ('paid_10', 's_paid', '2025-10-01', -30000), ('paid_11', 's_paid', '2025-11-01', -30000),
  ('paid_12', 's_paid', '2025-12-01', -30000), ('paid_01', 's_paid', '2026-01-01', -30000),
  ('paid_02', 's_paid', '2026-02-01', -30000), ('paid_03', 's_paid', '2026-03-01', -30000),
  ('paid_04', 's_paid', '2026-04-01', -30000),
  ('old_10', 's_old', '2025-10-05', -40000), ('old_11', 's_old', '2025-11-05', -40000),
  ('old_12', 's_old', '2025-12-05', -40000),
  ('spike_01', 's_spike', '2026-01-10', -10000), ('spike_02', 's_spike', '2026-02-10', -10000),
  ('spike_03', 's_spike', '2026-03-10', -10000), ('spike_03b', 's_spike', '2026-03-20', -10000),
  ('spike_04', 's_spike', '2026-04-15', -100000),
  ('dup_a', 's_dup', '2026-04-10', -5000), ('dup_b', 's_dup', '2026-04-12', -5000),
  ('new_04', 's_new', '2026-04-16', -600000),
  ('inc_01', 'c_rent', '2026-01-05', 800000), ('inc_02', 'c_rent', '2026-02-05', 800000),
  ('inc_03', 'c_rent', '2026-03-05', 800000),
  ('late_10', 's_late', '2025-10-28', -7000), ('late_11', 's_late', '2025-11-28', -7000),
  ('late_12', 's_late', '2025-12-28', -7000), ('late_01', 's_late', '2026-01-28', -7000),
  ('late_02', 's_late', '2026-02-28', -7000), ('late_03', 's_late', '2026-03-28', -7000);
insert into jp_lines
select 'fill_' || n, 's_fill', ('2025-06-' || lpad(n::text, 2, '0'))::date, -1000 from generate_series(1, 20) n;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, supplier_id, customer_id, project_id,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description
)
select (select id from jp_ref where label = 'co'),
  case when l.party = 'c_rent' then 'income' else 'expense' end::public.txn_direction,
  case when l.party = 'c_rent' then 'invoice' else 'expense' end::public.doc_kind,
  'project',
  case when l.party <> 'c_rent' then (select id from jp_ref where label = l.party) end,
  case when l.party = 'c_rent' then (select id from jp_ref where label = l.party) end,
  case when l.party = 's_rent' then (select id from jp_ref where label = 'p1') end,
  (l.net * 118) / 100, l.net, (l.net * 18) / 100, 'assumed',
  l.doc_date, l.doc_date, 'sumit', 'sumit:jp-' || l.label, l.label
from jp_lines l;
insert into jp_ref (label, id)
select substr(idempotency_key, 10), id from public.transactions where idempotency_key like 'sumit:jp-%';
-- A customer billed by invoice on the 1st and paid by a linked receipt on the 3rd: the pair
-- counts once (invoiced basis) and is not a duplicate.
insert into public.customers (company_id, name) select id, 'לקוח חשבונית' from jp_ref where label = 'co';
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, customer_id,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description, external_id, linked_external_id
)
select (select id from jp_ref where label = 'co'), 'income', k.kind, 'project',
  (select id from public.customers where name = 'לקוח חשבונית'),
  354000, 300000, 54000, 'assumed',
  (m + case k.kind when 'invoice' then 0 else 2 end)::date, (m + 2)::date, 'sumit',
  'sumit:jp-' || k.kind || '_' || to_char(m, 'MM'), k.kind,
  k.kind || '-' || to_char(m, 'MM'),
  case k.kind when 'receipt' then 'invoice-' || to_char(m, 'MM') end
from (select d::date as m from generate_series('2026-01-01'::date, '2026-03-01'::date, interval '1 month') d) g,
  (values ('invoice'::public.doc_kind), ('receipt'::public.doc_kind)) k(kind);

-- Company B has the same supplier names and nothing else.
insert into public.suppliers (company_id, name) select id, 'שכירות' from jp_ref where label = 'co_b';

-- A removed copy of the rent line would otherwise read as a duplicate.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, supplier_id,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description, removed_at
)
select company_id, direction, doc_kind, pnl_role, supplier_id, amount_gross, amount_net, vat_amount,
  vat_status, doc_date + 1, cash_date, source, 'sumit:jp-removed', 'removed', now()
from public.transactions where id = (select id from jp_ref where label = 'rent_03');

-- Open review rows for two lines; every other line is filed.
insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'approved', 'test'
from public.transactions t
where t.idempotency_key like 'sumit:jp-%'
  and not exists (select 1 from public.review_queue q where q.transaction_id = t.id);
update public.review_queue q set status = case
    when q.transaction_id in (select id from jp_ref where label in ('dup_a', 'spike_04')) then 'open'::public.review_status
    else 'approved'::public.review_status end
where q.transaction_id in (select id from jp_ref);
set constraints all immediate;

create temp table jp_out (label text primary key, result jsonb);
grant all on jp_out to anon, authenticated, service_role;

select tests.authenticate_as('jp_owner');
insert into jp_out (label, result)
select 'anomalies', public.review_anomalies(array(
  select id from jp_ref where label in ('rent_03', 'spike_04', 'dup_a', 'dup_b', 'new_04', 'inc_03')
));
insert into jp_out (label, result) select 'mcp', public.mcp_review_anomalies();
insert into jp_out (label, result) select 'missing_20', public.missing_bills('2026-04-20');
insert into jp_out (label, result) select 'missing_25', public.missing_bills('2026-04-25');
insert into jp_out (label, result) select 'missing_29', public.missing_bills('2026-04-29');
insert into jp_out (label, result) select 'missing_30', public.missing_bills('2026-04-30');
insert into jp_out (label, result) select 'inv_anomalies', public.review_anomalies(array(
  select id from public.transactions where idempotency_key in ('sumit:jp-invoice_02', 'sumit:jp-receipt_02')
));
insert into jp_out (label, result) select 'expected', public.expected_months(3, null, '2026-04-20');
insert into jp_out (label, result) select 'expected_p1',
  public.expected_months(2, (select id from jp_ref where label = 'p1'), '2026-04-20');

-- Anomalies.
select is(
  (select jsonb_agg(e ->> 'kind' order by e ->> 'kind')
   from jp_out, jsonb_array_elements(result) e
   where label = 'anomalies' and (e ->> 'transaction_id')::uuid in (select id from jp_ref where label in ('dup_a', 'dup_b'))),
  '["duplicate", "duplicate"]'::jsonb, 'two lines of the same supplier and amount 2 days apart are both duplicates'
);
select is(
  (select e ->> 'other_transaction_id' from jp_out, jsonb_array_elements(result) e
   where label = 'anomalies' and (e ->> 'transaction_id')::uuid = (select id from jp_ref where label = 'dup_a')),
  (select id::text from jp_ref where label = 'dup_b'), 'a duplicate names the other line'
);
select is(
  (select e - 'transaction_id' from jp_out, jsonb_array_elements(result) e
   where label = 'anomalies' and (e ->> 'transaction_id')::uuid = (select id from jp_ref where label = 'spike_04')),
  '{"kind": "amount_spike", "ratio": 10.0, "typical_amount_minor": 10000, "jev_score": null}'::jsonb,
  'ten times the supplier''s usual amount is a spike'
);
select is(
  (select e - 'transaction_id' from jp_out, jsonb_array_elements(result) e
   where label = 'anomalies' and (e ->> 'transaction_id')::uuid = (select id from jp_ref where label = 'new_04')),
  '{"kind": "new_party_large", "company_p90_minor": 500000, "jev_score": null}'::jsonb,
  'a first line above the company''s 90th percentile is flagged'
);
select is(
  (select count(*)::integer from jp_out, jsonb_array_elements(result) e
   where label = 'anomalies' and (e ->> 'transaction_id')::uuid in (select id from jp_ref where label in ('rent_03', 'inc_03'))),
  0, 'usual lines, and a removed copy, raise nothing'
);
select throws_ok(
  $$select public.review_anomalies(array(select gen_random_uuid() from generate_series(1, 501)))$$,
  'P0001', 'validation', 'more than 500 ids is refused'
);

select is(
  (select jsonb_agg(e ->> 'kind' order by e ->> 'kind') from jp_out, jsonb_array_elements(result -> 'anomalies') e where label = 'mcp'),
  '["amount_spike", "duplicate"]'::jsonb, 'MCP reads the flags of the open review lines only'
);

-- Missing bills.
select is(
  (select jsonb_agg(e ->> 'supplier_name') from jp_out, jsonb_array_elements(result) e where e ->> 'direction' = 'expense' and label = 'missing_20'),
  '["שכירות"]'::jsonb, 'on the 20th, rent (usually the 3rd) is missing; power (the 18th) is not yet'
);
select is(
  (select e - 'supplier_id' - 'project_id' - 'category_id'
     -- FLOW-415 PR 2 (decision 0175): the party, its pace, the due month and the alert's key.
     - 'direction' - 'party_id' - 'party_name' - 'due_month' - 'pace' - 'pace_source' - 'alert_key'
   from jp_out, jsonb_array_elements(result) e
   where e ->> 'direction' = 'expense' and label = 'missing_20'),
  jsonb_build_object('supplier_name', 'שכירות', 'currency', 'ILS', 'typical_amount_minor', -500000,
    'typical_day', 3, 'expected_by', '2026-04-08', 'months_seen', 6, 'last_doc_date', '2026-03-03',
    -- FLOW-415: the last bill's amount, the usual project's and category's names, and the rule.
    'last_amount_minor', -500000, 'project_name', 'בניין צפון', 'category_name', 'חומרים', 'source', 'auto'),
  'a missing bill has the usual amount, day and the date it was due'
);
select is(
  (select e ->> 'project_id' from jp_out, jsonb_array_elements(result) e where e ->> 'direction' = 'expense' and label = 'missing_20'),
  (select id::text from jp_ref where label = 'p1'), 'it carries the supplier''s usual project'
);
select is(
  (select jsonb_agg(e ->> 'supplier_name' order by (e ->> 'typical_day')::integer) from jp_out, jsonb_array_elements(result) e where e ->> 'direction' = 'expense' and label = 'missing_25'),
  '["שכירות", "חשמל"]'::jsonb, 'on the 25th power is missing too; a supplier already billed this month and one gone quiet are not'
);

select is(
  (select jsonb_agg(e ->> 'supplier_name' order by (e ->> 'typical_day')::integer)
   from jp_out, jsonb_array_elements(result) e where e ->> 'direction' = 'expense' and label = 'missing_29'),
  '["שכירות", "חשמל"]'::jsonb, 'a supplier due on the 28th is not missing before the month''s last day'
);
select is(
  (select jsonb_agg(e ->> 'expected_by' order by (e ->> 'typical_day')::integer)
   from jp_out, jsonb_array_elements(result) e where e ->> 'direction' = 'expense' and label = 'missing_30'),
  '["2026-04-08", "2026-04-23", "2026-04-30"]'::jsonb, 'on the last day it is, due that day'
);
select is(
  (select result from jp_out where label = 'inv_anomalies'), '[]'::jsonb,
  'an invoice and its receipt are not duplicates'
);

-- Expected months.
select is(
  (select jsonb_agg(m ->> 'month') from jp_out, jsonb_array_elements(result -> 'months') m where label = 'expected'),
  '["2026-04", "2026-05", "2026-06"]'::jsonb, 'three months from this one'
);
select is(
  (select m -> 'by_currency' from jp_out, jsonb_array_elements(result -> 'months') m
   where label = 'expected' and m ->> 'month' = '2026-04'),
  '[{"currency": "ILS", "income_minor": 1100000, "expense_minor": -527000}]'::jsonb,
  'this month counts only what has not come in yet; an invoice and its receipt count once'
);
select is(
  (select m -> 'by_currency' from jp_out, jsonb_array_elements(result -> 'months') m
   where label = 'expected' and m ->> 'month' = '2026-05'),
  '[{"currency": "ILS", "income_minor": 1100000, "expense_minor": -567000}]'::jsonb,
  'next month counts every recurring supplier and customer'
);
select is(
  (select (m ->> 'open')::boolean from jp_out, jsonb_array_elements(result -> 'months') m
   where label = 'expected' and m ->> 'month' = '2026-04'),
  true, 'this month is open'
);
select is(
  (select jsonb_agg(e ->> 'name' order by e ->> 'name') from jp_out, jsonb_array_elements(result -> 'recurring') e where label = 'expected'),
  '["חשמל", "לקוח חשבונית", "ספק משולם", "ספק סוף חודש", "ספק קפיצה", "שוכר", "שכירות"]'::jsonb,
  'recurring: 3 of the last 6 months and active in the last 2; a supplier gone quiet and one-off lines are not'
);
select is(
  (select m -> 'by_currency' from jp_out, jsonb_array_elements(result -> 'months') m
   where label = 'expected_p1' and m ->> 'month' = '2026-05'),
  '[{"currency": "ILS", "income_minor": 0, "expense_minor": -500000}]'::jsonb,
  'one project counts the parties whose usual project it is'
);
select throws_ok(
  $$select public.expected_months(13)$$, 'P0001', 'validation', 'more than 12 months is refused'
);

-- Tenant isolation and grants.
select tests.authenticate_as('jp_other');
select is(public.missing_bills('2026-04-25'), '[]'::jsonb, 'company B sees no missing bills of A');
select is(
  public.review_anomalies(array(select id from jp_ref where label in ('dup_a', 'spike_04'))),
  '[]'::jsonb, 'company B gets nothing for A''s lines'
);
reset role;
select ok(
  not has_function_privilege('anon', 'public.missing_bills(date)', 'execute')
  and not has_function_privilege('anon', 'public.expected_months(integer, uuid, date)', 'execute')
  and not has_function_privilege('anon', 'public.review_anomalies(uuid[])', 'execute')
  and not has_function_privilege('authenticated', 'private.recurring_parties(uuid, date, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'private.line_anomalies(uuid, uuid[])', 'execute'),
  'anon calls none of them; the private parts are not callable'
);

select * from finish();
rollback;
