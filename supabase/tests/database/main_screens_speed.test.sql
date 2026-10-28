-- FLOW-943 pins the reads its migration made faster to the answers they gave before it, on invented
-- books with the cases each rewrite branches on: private.pnl_lines (loan splits counted, flagged and
-- with VAT; a counted line split; a shared line; a kept-out category; an override; an unpaid invoice),
-- get_breakdown by category and by project, get_dashboard, and the recurring reads (recurring_parties'
-- last bill and this month, recurring_changes, recurring_this_month, expected_months' pays_loan,
-- missing_bills). Every expected value below was read from the functions as they were before the
-- migration. Invented data only; amounts are agorot; every recurring read is given its own today.
-- A second company pins a charge with several lines this month, five of them on one date and entry time:
-- Home and the project page add them up the same and name the same latest line, the higher id. Last, the
-- guard that makes the helpers' empty configuration safe: every caller sets an empty search_path, and no
-- client role can create objects in a schema.

begin;

select plan(18);

do $users$
begin
  perform tests.create_supabase_user('mss_owner', 'mss-owner@example.com');
  perform tests.create_supabase_user('mss_gas', 'mss-gas@example.com');
end
$users$;

create temp table mss (label text primary key, id uuid);
grant all on mss to authenticated, service_role;

insert into mss (label, id) values ('co', tests.fixture_company('mss_owner', 'Example Pin LLC'));
insert into mss (label, id) values ('gas_co', tests.fixture_company('mss_gas', 'Example Gas LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.mss where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

do $fixture$
declare
  co uuid := pg_temp.id('co');
  pa uuid; pb uuid; ov uuid;
  c1 uuid; c2 uuid; cx uuid; ci uuid; cint uuid; cesc uuid; cpri uuid;
  s_power uuid; s_water uuid; s_bank uuid; cu uuid;
  loan uuid; ln uuid; m int; d date;
begin
  update public.companies set base_currency = 'ILS', cash_basis = 'paid' where id = co;
  pa := tests.fixture_project(co, 'Pin A');
  pb := tests.fixture_project(co, 'Pin B');
  ov := tests.fixture_project(co, 'Pin office');
  update public.companies set overhead_project_id = ov where id = co;
  c1 := tests.fixture_category(co, 'Pin cost');
  c2 := tests.fixture_category(co, 'Pin cost sub');
  cx := tests.fixture_category(co, 'Pin kept out', 'expense', true);
  ci := tests.fixture_category(co, 'Pin sales', 'income');
  update public.categories set parent_id = c1 where id = c2;
  select id into cint from public.categories where company_id = co and loan_part = 'interest' limit 1;
  select id into cesc from public.categories where company_id = co and loan_part = 'escrow' limit 1;
  select id into cpri from public.categories where company_id = co and loan_part = 'principal' limit 1;
  insert into public.suppliers (company_id, name) values (co, 'Pin power') returning id into s_power;
  insert into public.suppliers (company_id, name) values (co, 'Pin water') returning id into s_water;
  insert into public.suppliers (company_id, name) values (co, 'Pin bank') returning id into s_bank;
  insert into public.customers (company_id, name) values (co, 'Pin tenant') returning id into cu;

  -- Monthly power on A (up 50% in July), water on A in ILS and on B in USD, rent on A.
  for m in 0..6 loop
    d := (date '2026-01-04' + make_interval(months => m))::date;
    insert into public.transactions (company_id, direction, doc_kind, pnl_role, line_status, currency,
      amount_gross, amount_net, amount_original, vat_amount, vat_status, doc_date, cash_date, source,
      idempotency_key, project_id, supplier_id, category_id, description, user_assigned, category_assigned)
    values
      (co, 'expense', 'receipt', 'project', 'posted', 'ILS', -(10000 + case when m = 6 then 5000 else 0 end),
        -(10000 + case when m = 6 then 5000 else 0 end), 10000, 0, 'source', d, d, 'manual',
        'mss:power:' || m, pa, s_power, c1, 'mss power', true, true),
      (co, 'expense', 'expense', 'project', 'posted', 'ILS', -3000, -3000, 3000, 0, 'source', d + 5, d + 5, 'manual',
        'mss:water-a:' || m, pa, s_water, c2, 'mss water a', true, true),
      (co, 'expense', 'expense', 'project', 'posted', 'USD', -2000, -2000, 2000, 0, 'source', d + 6, d + 6, 'manual',
        'mss:water-b:' || m, pb, s_water, c2, 'mss water b', true, true);
    insert into public.transactions (company_id, direction, doc_kind, pnl_role, line_status, currency,
      amount_gross, amount_net, amount_original, vat_amount, vat_status, doc_date, cash_date, source,
      idempotency_key, project_id, customer_id, category_id, description, user_assigned, category_assigned)
    values (co, 'income', 'invoice_receipt', 'project', 'posted', 'ILS', 117000, 100000, 117000, 17000, 'source', d + 1, d + 1, 'manual',
      'mss:rent:' || m, pa, cu, ci, 'mss rent', true, true);
  end loop;

  -- Loan payments on B, split interest / principal / escrow: counted, one flagged, one with VAT.
  insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor,
    escrow_minor, currency, project_id, interest_category_id, escrow_category_id, principal_category_id)
  values (co, 'Pin loan', 30000000, 60000, 360, date '2025-06-01', 200000, 30000, 'ILS', pb, cint, cesc, cpri)
  returning id into loan;
  for m in 0..6 loop
    d := (date '2026-01-15' + make_interval(months => m))::date;
    insert into public.transactions (company_id, direction, doc_kind, pnl_role, line_status, currency,
      amount_gross, amount_net, amount_original, vat_amount, vat_status, doc_date, cash_date, source,
      idempotency_key, project_id, supplier_id, category_id, description, user_assigned, category_assigned)
    values (co, 'expense', 'expense', 'project', 'posted', 'ILS', -200000 - case when m = 4 then 1000 else 0 end, -200000, 200000,
      case when m = 4 then -1000 else 0 end, 'source', d, d, 'manual', 'mss:loan:' || m, pb, s_bank, cint, 'mss loan', true, true)
    returning id into ln;
    perform tests.loan_split(ln, loan, jsonb_build_array(
      jsonb_build_object('part', 'interest', 'amount_minor', 120000, 'scheduled_minor', 120000, 'category_id', cint, 'needs_review', m = 2),
      jsonb_build_object('part', 'principal', 'amount_minor', 50000, 'scheduled_minor', 50000, 'category_id', cpri, 'needs_review', false),
      jsonb_build_object('part', 'escrow', 'amount_minor', 30000, 'scheduled_minor', 30000, 'category_id', cesc, 'needs_review', false)));
  end loop;

  -- A counted line split (A and B), a shared line over A and B, an unpaid invoice, a kept-out line,
  -- a kept-out line the owner counts, and a line with no project.
  insert into public.transactions (company_id, direction, doc_kind, pnl_role, line_status, currency,
    amount_gross, amount_net, amount_original, vat_amount, vat_status, doc_date, cash_date, source,
    idempotency_key, project_id, supplier_id, category_id, description, user_assigned, category_assigned, in_pnl_override)
  values
    (co, 'expense', 'expense', 'project', 'posted', 'ILS', -9000, -9000, 9000, 0, 'source', date '2026-05-20', date '2026-05-20', 'manual', 'mss:split', pa, s_power, c1, 'mss split', true, true, null),
    (co, 'expense', 'expense', 'shared', 'posted', 'ILS', -10001, -10001, 10001, 0, 'source', date '2026-06-06', date '2026-06-06', 'manual', 'mss:shared', null, s_water, c1, 'mss shared', true, true, null),
    (co, 'expense', 'invoice', 'project', 'posted', 'ILS', -23400, -20000, 23400, -3400, 'source', date '2026-06-10', null, 'manual', 'mss:unpaid', pa, s_power, c1, 'mss unpaid', true, true, null),
    (co, 'expense', 'expense', 'project', 'posted', 'ILS', -50000, -50000, 50000, 0, 'source', date '2026-04-02', date '2026-04-02', 'manual', 'mss:out', pa, s_water, cx, 'mss out', true, true, null),
    (co, 'expense', 'expense', 'project', 'posted', 'ILS', -7000, -7000, 7000, 0, 'source', date '2026-04-05', date '2026-04-05', 'manual', 'mss:out-in', pb, s_water, cx, 'mss out in', true, true, true),
    (co, 'expense', 'expense', null, 'posted', 'ILS', -6000, -6000, 6000, 0, 'source', date '2026-06-08', date '2026-06-08', 'manual', 'mss:none', null, s_water, c1, 'mss none', true, true, null);
  select id into ln from public.transactions where company_id = co and idempotency_key = 'mss:split';
  perform tests.line_split(ln, jsonb_build_array(
    jsonb_build_object('category_id', c1, 'project_id', pa, 'amount_minor', 6000),
    jsonb_build_object('category_id', c2, 'project_id', pb, 'amount_minor', 3000)));
  select id into ln from public.transactions where company_id = co and idempotency_key = 'mss:shared';
  insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
  values (co, ln, pa, 5000, -5000), (co, ln, pb, 5000, -5001);
end
$fixture$;

-- The second company: gas on one project, 10,000 a month from January to June on the 2nd. In July one
-- line on the 2nd and five on the 8th, all entered in this one transaction, so the five share a date and
-- an entry time. Their ids rise in the order they are entered: the last one entered is the latest.
do $gas$
declare
  co uuid := pg_temp.id('gas_co');
  pg uuid; cg uuid; s_gas uuid; m int; d date;
begin
  pg := tests.fixture_project(co, 'Gas house');
  cg := tests.fixture_category(co, 'Gas cost');
  insert into public.suppliers (company_id, name) values (co, 'Gas supplier') returning id into s_gas;
  insert into pg_temp.mss (label, id) values ('gas_project', pg);
  for m in 0..6 loop
    d := (date '2026-01-02' + make_interval(months => m))::date;
    insert into public.transactions (company_id, direction, doc_kind, pnl_role, line_status, currency,
      amount_gross, amount_net, amount_original, vat_amount, vat_status, doc_date, cash_date, source,
      idempotency_key, project_id, supplier_id, category_id, description, user_assigned, category_assigned)
    values (co, 'expense', 'receipt', 'project', 'posted', 'ILS', case when m = 6 then -2000 else -10000 end,
      case when m = 6 then -2000 else -10000 end, case when m = 6 then 2000 else 10000 end, 0, 'source', d, d,
      'manual', 'mss:gas:' || m, pg, s_gas, cg, 'mss gas', true, true);
  end loop;
  for m in 1..5 loop
    insert into public.transactions (id, company_id, direction, doc_kind, pnl_role, line_status, currency,
      amount_gross, amount_net, amount_original, vat_amount, vat_status, doc_date, cash_date, source,
      idempotency_key, project_id, supplier_id, category_id, description, user_assigned, category_assigned)
    values (('00000000-0000-4000-8000-00000000094' || m)::uuid, co, 'expense', 'receipt', 'project', 'posted', 'ILS',
      -1000, -1000, 1000, 0, 'source', date '2026-07-08', date '2026-07-08', 'manual', 'mss:gas-tie:' || m,
      pg, s_gas, cg, 'mss gas tie', true, true);
  end loop;
end
$gas$;

select tests.authenticate_as('mss_owner');

-- private.pnl_lines: the company's parts in one line each, with every flag the readers branch on.
select is(
  (select string_agg(format('%s/%s/%s/%s/%s/%s/%s/%s', t.idempotency_key, coalesce(l.part::text, '-'), l.amount_net,
      l.in_pnl, l.loan_split_fallback, l.unassigned, l.unpaid, coalesce(l.pnl_role::text, '-')),
      ' ' order by t.idempotency_key, l.part, l.amount_net)
   from private.pnl_lines l
   join public.transactions t on t.id = l.transaction_id
   where l.company_id = pg_temp.id('co') and t.idempotency_key not like 'mss:rent:%'
     and t.idempotency_key not like 'mss:power:%' and t.idempotency_key not like 'mss:water-%'),
  'mss:loan:0/interest/-120000/t/f/f/f/project mss:loan:0/escrow/-30000/t/f/f/f/project mss:loan:0/principal/-50000/f/f/f/f/project mss:loan:1/interest/-120000/t/f/f/f/project mss:loan:1/escrow/-30000/t/f/f/f/project mss:loan:1/principal/-50000/f/f/f/f/project mss:loan:2/-/-200000/t/t/f/f/project mss:loan:3/interest/-120000/t/f/f/f/project mss:loan:3/escrow/-30000/t/f/f/f/project mss:loan:3/principal/-50000/f/f/f/f/project mss:loan:4/-/-200000/t/t/f/f/project mss:loan:5/interest/-120000/t/f/f/f/project mss:loan:5/escrow/-30000/t/f/f/f/project mss:loan:5/principal/-50000/f/f/f/f/project mss:loan:6/interest/-120000/t/f/f/f/project mss:loan:6/escrow/-30000/t/f/f/f/project mss:loan:6/principal/-50000/f/f/f/f/project mss:none/-/-6000/t/f/t/f/- mss:out/-/-50000/f/f/f/f/project mss:out-in/-/-7000/t/f/f/f/project mss:shared/-/-10001/t/f/f/f/shared mss:split/-/-6000/t/f/f/f/project mss:split/-/-3000/t/f/f/f/project mss:unpaid/-/-20000/t/f/f/t/project',
  'pnl_lines: loan parts, the flagged and VAT payments as whole lines, the split, shared and kept-out lines'
);

select is(
  (select format('%s/%s/%s/%s', count(*), sum(l.amount_net), sum(l.amount_net) filter (where l.in_pnl), count(*) filter (where l.unassigned))
   from private.pnl_lines l where l.company_id = pg_temp.id('co')),
  '52/-912001/-612001/1',
  'pnl_lines: the company''s count and totals'
);

-- get_breakdown by category reads its rows once and answers as before; by project too.
select is(
  (select jsonb_build_object('totals', b->'totals', 'excluded', b->'excluded',
     'groups', (select jsonb_agg(jsonb_build_object('name', g->>'name', 'amount', g->'amount_minor', 'count', g->'count', 'currency', g->>'currency') order by g->>'currency', g->>'name') from jsonb_array_elements(b->'groups') g))::text
   from (select public.get_breakdown('expense', null, null, 'category') as b) x),
  '{"groups": [{"name": "Pin cost", "count": 10, "amount": 97001, "currency": "ILS"}, {"name": "Pin cost sub", "count": 8, "amount": 24000, "currency": "ILS"}, {"name": "Pin kept out", "count": 1, "amount": 7000, "currency": "ILS"}, {"name": "מסים וביטוח", "count": 5, "amount": 150000, "currency": "ILS"}, {"name": "ריבית משכנתא", "count": 7, "amount": 1000000, "currency": "ILS"}, {"name": "Pin cost sub", "count": 7, "amount": 14000, "currency": "USD"}], "totals": [{"count": 25, "currency": "ILS", "amount_minor": 1278001}, {"count": 7, "currency": "USD", "amount_minor": 14000}], "excluded": [{"count": 6, "currency": "ILS", "amount_minor": 300000}]}',
  'get_breakdown by category'
);

select is(
  (select jsonb_build_object('totals', b->'totals',
     'groups', (select jsonb_agg(jsonb_build_object('amount', g->'amount_minor', 'count', g->'count', 'shared', g->'shared', 'currency', g->>'currency') order by g->>'currency', g->'amount_minor') from jsonb_array_elements(b->'groups') g))::text
   from (select public.get_breakdown('expense', '2026-01-01', '2026-06-30', 'project') as b) x),
  '{"groups": [{"count": 1, "amount": 6000, "shared": false, "currency": "ILS"}, {"count": 14, "amount": 89000, "shared": true, "currency": "ILS"}, {"count": 9, "amount": 1015001, "shared": true, "currency": "ILS"}, {"count": 6, "amount": 12000, "shared": false, "currency": "USD"}], "totals": [{"count": 22, "currency": "ILS", "amount_minor": 1110001}, {"count": 6, "currency": "USD", "amount_minor": 12000}]}',
  'get_breakdown by project'
);

select is(
  (select format('%s/%s/%s/%s', d->>'income_agorot', d->>'expense_agorot', d->>'net_profit_agorot', d->>'excluded_expense_agorot')
   from (select public.get_dashboard('2026-01-01', '2026-07-31') as d) x),
  '700000/1278001/-578001/300000',
  'get_dashboard'
);

reset role;

-- recurring_parties: each charge's last bill and the month it is next due.
select is(
  (select string_agg(format('%s/%s/%s/%s/%s/%s/%s/%s/%s/%s', coalesce(s.name, cu.name), r.currency, coalesce(p.name, '-'),
      r.months_seen, r.typical_amount_minor, r.last_doc_date, r.last_amount_minor, r.pace, r.next_due_month,
      r.seen_this_month), ' ' order by coalesce(s.name, cu.name), r.currency)
   from private.recurring_parties(pg_temp.id('co'), date '2026-07-20') r
   left join public.suppliers s on s.id = r.party_id
   left join public.customers cu on cu.id = r.party_id
   left join public.projects p on p.id = r.project_id),
  'Pin bank/ILS/Pin B/6/-200000/2026-07-15/-200000/month/2026-08-01/t Pin power/ILS/Pin A/6/-10000/2026-07-04/-15000/month/2026-08-01/t Pin tenant/ILS/Pin A/6/100000/2026-07-05/100000/month/2026-08-01/t Pin water/ILS/Pin A/6/-3000/2026-07-09/-3000/month/2026-08-01/t Pin water/USD/Pin B/6/-2000/2026-07-10/-2000/month/2026-08-01/t',
  'recurring_parties: each charge''s last bill'
);

select tests.authenticate_as('mss_owner');

select is(
  (select string_agg(format('%s/%s/%s/%s/%s/%s', x->>'party_name', x->>'currency', x->>'amount_minor', x->>'change_percent',
      x->>'line_count', t.idempotency_key), ' ' order by ord)
   from jsonb_array_elements(public.recurring_changes(date '2026-07-20')) with ordinality e(x, ord)
   join public.transactions t on t.id = (x->>'transaction_id')::uuid),
  'Pin power/ILS/-15000/50/1/mss:power:6',
  'recurring_changes: the power charge up 50%, its one line this month'
);

select is(
  (select string_agg(format('%s/%s/%s/%s/%s', x->>'party_name', x->>'currency', x->>'amount_minor', x->>'line_count', x->>'changed'),
      ' ' order by ord)
   from jsonb_array_elements(public.recurring_this_month(date '2026-07-20')) with ordinality e(x, ord)),
  'Pin bank/ILS/-200000/1/false Pin power/ILS/-15000/1/true Pin water/ILS/-3000/1/false Pin water/USD/-2000/1/false Pin tenant/ILS/100000/1/false',
  'recurring_this_month'
);

select is(
  (select string_agg(format('%s/%s/%s/%s', x->>'name', x->>'currency', x->>'typical_amount_minor', x->>'pays_loan'), ' '
      order by x->>'name', x->>'currency')
   from jsonb_array_elements(public.expected_months(3, null, date '2026-07-20')->'recurring') with ordinality e(x, ord)),
  'Pin bank/ILS/-200000/true Pin power/ILS/-10000/false Pin tenant/ILS/100000/false Pin water/ILS/-3000/false Pin water/USD/-2000/false',
  'expected_months: the bank charge pays the loan'
);

select is(
  (select (public.expected_months(3, null, date '2026-07-20')->'months')::text),
  '[{"open": true, "month": "2026-07", "by_currency": []}, {"open": false, "month": "2026-08", "by_currency": [{"currency": "ILS", "income_minor": 100000, "expense_minor": -213000}, {"currency": "USD", "income_minor": 0, "expense_minor": -2000}]}, {"open": false, "month": "2026-09", "by_currency": [{"currency": "ILS", "income_minor": 100000, "expense_minor": -213000}, {"currency": "USD", "income_minor": 0, "expense_minor": -2000}]}]',
  'expected_months: the months'
);

select is(
  (select string_agg(format('%s/%s/%s/%s', x->>'party_name', x->>'currency', x->>'due_month', x->>'last_amount_minor'), ' ' order by ord)
   from jsonb_array_elements(public.missing_bills(date '2026-08-25')) with ordinality e(x, ord)),
  'Pin power/ILS/2026-08/-15000 Pin water/ILS/2026-08/-3000 Pin water/USD/2026-08/-2000 Pin bank/ILS/2026-08/-200000 Pin tenant/ILS/2026-08/100000',
  'missing_bills: every monthly charge is late on the 25th of the next month'
);


-- The second company's gas charge: six lines this month (2,000 + 5 x 1,000), 30% under its usual 10,000.
-- Home and the project page agree on the sum, the count and the latest line: of the five on the 8th, entered
-- together, the one with the higher id.
select tests.authenticate_as('mss_gas');

select is(
  (select string_agg(format('%s/%s/%s/%s', x->>'party_name', x->>'amount_minor', x->>'line_count', x->>'changed'), ' ' order by ord)
   from jsonb_array_elements(public.recurring_this_month(date '2026-07-20')) with ordinality e(x, ord)),
  'Gas supplier/-7000/6/true',
  'recurring_this_month: a charge with several lines this month, their sum and count'
);

select is(
  (select string_agg(format('%s/%s/%s/%s', x->>'party_name', x->>'amount_minor', x->>'line_count', t.idempotency_key), ' ' order by ord)
   from jsonb_array_elements(public.recurring_changes(date '2026-07-20')) with ordinality e(x, ord)
   join public.transactions t on t.id = (x->>'transaction_id')::uuid),
  'Gas supplier/-7000/6/mss:gas-tie:5',
  'recurring_changes: the latest of five lines with one date and entry time is the higher id'
);

select is(
  (select string_agg(format('%s/%s/%s', x->>'amount_minor', x->>'line_count', t.idempotency_key), ' ' order by ord)
   from jsonb_array_elements(public.project_recurring_changes(pg_temp.id('gas_project'), date '2026-07-20')) with ordinality e(x, ord)
   join public.transactions t on t.id = (x->>'transaction_id')::uuid),
  '-7000/6/mss:gas-tie:5',
  'project_recurring_changes: the same sum, count and latest line as Home'
);

select is(
  (select (h->>'alert_key') = (p->>'alert_key')
   from jsonb_array_elements(public.recurring_changes(date '2026-07-20')) h,
     jsonb_array_elements(public.project_recurring_changes(pg_temp.id('gas_project'), date '2026-07-20')) p),
  true,
  'Home and the project page key the change alert, and its dismissal, on the same line'
);

reset role;

-- The per-line helpers stay inlinable: no configuration, so the planner can fold them into the query.
select is(
  (select count(*)::integer from pg_proc p
   where p.oid in (
     'private.line_in_pnl(boolean, boolean, public.loan_split_part)'::regprocedure,
     'private.line_category_out(boolean, boolean, public.loan_split_part)'::regprocedure,
     'private.line_unpaid(public.txn_direction, public.doc_kind, date)'::regprocedure,
     'private.pnl_in_range(text, text, date, date, date, date)'::regprocedure,
     'private.category_in_rehab(boolean, boolean, public.loan_split_part)'::regprocedure,
     'private.div_half_even(numeric, numeric)'::regprocedure,
     'private.month_diff(date, date)'::regprocedure,
     'private.month_end(date)'::regprocedure,
     'private.pace_months(text)'::regprocedure,
     'private.round_agorot_shekel_hundreds(numeric)'::regprocedure,
     'private.category_flag(text, bigint, bigint, integer, integer, date)'::regprocedure)
     and p.proconfig is null and not p.prosecdef and p.provolatile = 'i'),
  11,
  'the per-line helpers set no configuration, so they inline'
);

-- Why no configuration is safe: every function that calls a helper sets an empty search_path (so a body
-- inlined into it is read with pg_catalog alone), and no client role can create an operator or function in
-- a schema a caller might search.
select is(
  (select case when count(*) = 0 then 'no callers found'
     else coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
       filter (where not coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']), 'every caller') end
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.prosrc ~ 'private\.(line_in_pnl|line_category_out|line_unpaid|pnl_in_range|category_in_rehab|div_half_even|month_diff|month_end|pace_months|round_agorot_shekel_hundreds|category_flag)\('),
  'every caller',
  'every function calling the inlined helpers sets an empty search_path'
);

select is(
  (select string_agg(r || ' on ' || s, ', ' order by r, s)
   from unnest(array['authenticated', 'anon', 'service_role']) r,
     unnest(array['public', 'private', 'extensions', 'graphql_public']) s
   where has_schema_privilege(r, s, 'CREATE')),
  null,
  'no client role can create objects in public, private, extensions or graphql_public'
);

select * from finish();
rollback;
