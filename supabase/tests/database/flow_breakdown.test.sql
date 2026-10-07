-- FLOW-301: Home's income and expenses broken down by category, project, and supplier.
-- The groups add up to the same totals Home shows, on both bases, ILS and USD.
-- Invented data only.

begin;

select plan(56);

do $users$
begin
  perform tests.create_supabase_user('fb_owner', 'fb-owner@example.com');
  perform tests.create_supabase_user('fb_other', 'fb-other@example.com');
end
$users$;

create temp table fb_ref (label text primary key, id uuid);
create temp table fb_out (label text primary key, body jsonb);
grant all on fb_ref, fb_out to authenticated;

create function pg_temp.total(p jsonb, c text) returns bigint
language sql immutable
as $$ select coalesce((select (x ->> 'amount_minor')::bigint from jsonb_array_elements(p -> 'totals') x where x ->> 'currency' = c), 0) $$;

create function pg_temp.group_sum(p jsonb, c text) returns bigint
language sql immutable
as $$ select coalesce(sum((x ->> 'amount_minor')::bigint), 0)::bigint from jsonb_array_elements(p -> 'groups') x where x ->> 'currency' = c $$;

create function pg_temp.grp(p jsonb, c text, k text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p -> 'groups') x where x ->> 'currency' = c and x ->> 'key' = k $$;

create function pg_temp.excl(p jsonb, c text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p -> 'excluded') x where x ->> 'currency' = c $$;

create function pg_temp.cur(p jsonb, c text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p -> 'by_currency') x where x ->> 'currency' = c $$;

create function pg_temp.out_of(l text) returns jsonb
language sql stable
as $$ select body from fb_out where label = l $$;

grant execute on function pg_temp.total(jsonb, text), pg_temp.group_sum(jsonb, text), pg_temp.grp(jsonb, text, text),
  pg_temp.excl(jsonb, text), pg_temp.cur(jsonb, text), pg_temp.out_of(text) to authenticated;

select tests.authenticate_as('fb_owner');
select public.create_company('Example Breakdown LLC', true);
select public.upsert_project(null, 'Site Alpha', null, 'active');
select public.upsert_project(null, 'Site Beta', null, 'active');
select public.upsert_project(null, 'Office', null, 'active');
insert into fb_ref (label, id) select 'co', id from public.companies where name = 'Example Breakdown LLC';
insert into fb_ref (label, id) select 'alpha', id from public.projects where name = 'Site Alpha';
insert into fb_ref (label, id) select 'beta', id from public.projects where name = 'Site Beta';
insert into fb_ref (label, id) select 'office', id from public.projects where name = 'Office';
select public.set_overhead_project((select id from fb_ref where label = 'office'));

select tests.authenticate_as('fb_other');
select public.create_company('Other Example Co', true);

reset role;

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values
  ((select id from fb_ref where label = 'co'), 'Example materials', 'expense', 60, false, false),
  ((select id from fb_ref where label = 'co'), 'Example kept out', 'expense', 61, false, true);
insert into fb_ref (label, id) select 'materials', id from public.categories where name = 'Example materials';
insert into fb_ref (label, id) select 'kept', id from public.categories where name = 'Example kept out';

insert into public.suppliers (company_id, name)
values ((select id from fb_ref where label = 'co'), 'Example Supplier');
insert into fb_ref (label, id) select 'supplier', id from public.suppliers where name = 'Example Supplier';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, supplier_id, description, user_assigned
)
select
  (select id from fb_ref where label = 'co'),
  v.direction::public.txn_direction,
  v.doc_kind::public.doc_kind,
  v.pnl_role::public.pnl_role,
  v.status::public.line_status,
  cur.c,
  v.amount, v.amount, abs(v.amount), 0, 'source',
  '2026-06-10', case when v.direction = 'income' then '2026-06-10'::date end,
  'manual', 'fb:' || cur.c || ':' || v.ikey,
  (select id from fb_ref where label = v.proj),
  (select id from fb_ref where label = v.cat),
  (select id from fb_ref where label = v.sup),
  v.ikey,
  true
from (values ('ILS'), ('USD')) as cur(c),
(values
  ('income',  'invoice_receipt', null,       100000, 'alpha',  null,        'supplier', 'posted',  'in-alpha'),
  ('income',  'invoice',         null,        40000, 'alpha',  null,        null,       'posted',  'in-alpha-open'),
  ('income',  'receipt',         null,        20000, null,     null,        null,       'posted',  'in-none'),
  ('expense', 'expense',         'project',  -30000, 'alpha',  'materials', 'supplier', 'posted',  'ex-alpha'),
  ('expense', 'expense',         'project',  -15000, 'office', 'materials', null,       'posted',  'ex-office'),
  ('expense', 'expense',         'overhead',  -5000, null,     null,        null,       'posted',  'ex-overhead'),
  ('expense', 'expense',         null,        -7000, null,     null,        null,       'posted',  'ex-norole'),
  ('expense', 'expense',         'shared',   -10000, null,     'materials', null,       'posted',  'ex-shared'),
  ('expense', 'expense',         'project',   -2500, 'alpha',  'kept',      null,       'posted',  'ex-kept'),
  ('expense', 'expense',         'project',   -9000, 'alpha',  'materials', null,       'pending', 'ex-pending')
) as v(direction, doc_kind, pnl_role, amount, proj, cat, sup, status, ikey);

-- The shared line splits 60/40 between Alpha and Beta.
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, (select id from fb_ref where label = s.proj), s.bp, t.amount_net * s.bp / 10000
from public.transactions t
join (values ('alpha', 6000), ('beta', 4000)) as s(proj, bp) on true
where t.idempotency_key in ('fb:ILS:ex-shared', 'fb:USD:ex-shared');

-- An ILS loan payment of 1000.00 split 700/200/100 with no project: interest and escrow
-- count by part, the principal is kept out.
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values ((select id from fb_ref where label = 'co'), 'Example mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'ILS');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, category_id, description, user_assigned
)
values (
  (select id from fb_ref where label = 'co'), 'expense', 'expense', null, 'posted', 'ILS',
  -100000, -100000, 100000, 0, 'source', '2026-06-12', '2026-06-12', 'manual', 'fb:loan',
  (select id from fb_ref where label = 'materials'), 'fb:loan', true
);

insert into public.loan_splits (
  company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review
)
select
  t.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount,
  (select k.id from public.categories k where k.company_id = t.company_id and k.name = v.cat and k.kind = 'expense'),
  false
from public.transactions t
join public.loans l on l.company_id = t.company_id
join (values
  ('interest',  70000, 'ריבית משכנתא'),
  ('escrow',    20000, 'מסים וביטוח'),
  ('principal', 10000, 'תשלומי הלוואה')
) as v(part, amount, cat) on true
where t.idempotency_key = 'fb:loan';

-- A EUR shared loan payment of 1000.00 split 700.03 / 199.97 / 100.00, half to Alpha and
-- half to Beta. Each part's share rounds half to even: 350.015 to 350.02, 99.985 to 99.98.
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values ((select id from fb_ref where label = 'co'), 'Example EUR loan', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'EUR');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, category_id, description, user_assigned
)
values (
  (select id from fb_ref where label = 'co'), 'expense', 'expense', 'shared', 'posted', 'EUR',
  -100000, -100000, 100000, 0, 'source', '2026-06-14', '2026-06-14', 'manual', 'fb:eur-loan',
  (select id from fb_ref where label = 'materials'), 'fb:eur-loan', true
);

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, (select id from fb_ref where label = s.proj), 5000, -50000
from public.transactions t
join (values ('alpha'), ('beta')) as s(proj) on true
where t.idempotency_key = 'fb:eur-loan';

insert into public.loan_splits (
  company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review
)
select
  t.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount,
  (select k.id from public.categories k where k.company_id = t.company_id and k.name = v.cat and k.kind = 'expense'),
  false
from public.transactions t
join public.loans l on l.company_id = t.company_id and l.name = 'Example EUR loan'
join (values
  ('interest',  70003, 'ריבית משכנתא'),
  ('escrow',    19997, 'מסים וביטוח'),
  ('principal', 10000, 'תשלומי הלוואה')
) as v(part, amount, cat) on true
where t.idempotency_key = 'fb:eur-loan';

-- A EUR receipt dated 28 May and paid on 2 June counts in June on the cash basis.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description, user_assigned
)
values (
  (select id from fb_ref where label = 'co'), 'income', 'receipt', null, 'posted', 'EUR',
  5000, 5000, 5000, 0, 'source', '2026-05-28', '2026-06-02', 'manual', 'fb:eur-in',
  (select id from fb_ref where label = 'alpha'), 'fb:eur-in', true
);

-- Reversals in GBP (decision 0103): the category kind decides the side. An outflow under an
-- income category is negative income; an inflow under an expense category is negative expense.
insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values ((select id from fb_ref where label = 'co'), 'Example sales', 'income', 62, false, false);
insert into fb_ref (label, id) select 'sales', id from public.categories where name = 'Example sales';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select
  (select id from fb_ref where label = 'co'),
  v.direction::public.txn_direction,
  v.doc_kind::public.doc_kind,
  v.pnl_role::public.pnl_role,
  'posted', 'GBP',
  v.amount, v.amount, abs(v.amount), 0, 'source',
  '2026-06-12',
  -- The rent taken back clears in July: cash income counts it by that date, not the June document.
  case when v.ikey = 'gbp-sale-refund' then '2026-07-02'::date when v.direction = 'income' then '2026-06-12'::date end,
  'manual', 'fb:GBP:' || v.ikey,
  (select id from fb_ref where label = 'alpha'),
  (select id from fb_ref where label = v.cat),
  v.ikey,
  true
from (values
  ('income',  'invoice', null,       20000, 'sales',     'gbp-sale'),
  ('expense', 'expense', 'project',  -5000, 'sales',     'gbp-sale-refund'),
  ('expense', 'expense', 'project',  -8000, 'materials', 'gbp-cost'),
  ('income',  'receipt', 'project',   3000, 'materials', 'gbp-cost-refund')
) as v(direction, doc_kind, pnl_role, amount, cat, ikey);

-- One open expense review, one open income review, one closed expense review, an open
-- review on the GBP outflow under an income category (it counts as income), and an open
-- review on a pending line, which is not in the totals and so not in the count.
insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, v.status::public.review_status, 'example'
from public.transactions t
join (values
  ('fb:ILS:ex-alpha', 'open'),
  ('fb:ILS:in-alpha', 'open'),
  ('fb:ILS:ex-office', 'approved'),
  ('fb:GBP:gbp-sale-refund', 'open'),
  ('fb:ILS:ex-pending', 'open')
) as v(ikey, status) on v.ikey = t.idempotency_key;

select tests.authenticate_as('fb_owner');

insert into fb_out (label, body) values
  ('dash:cash', public.get_dashboard(null, null, 'cash')),
  ('dash:invoiced', public.get_dashboard(null, null, 'invoiced')),
  ('dash:june', public.get_dashboard('2026-06-01', '2026-06-30', 'cash')),
  ('dash:july', public.get_dashboard('2026-07-01', '2026-07-31', 'cash')),
  ('in:july', public.get_breakdown('income', '2026-07-01', '2026-07-31', 'category', 'cash')),
  ('in:june', public.get_breakdown('income', '2026-06-01', '2026-06-30', 'project', 'cash')),
  ('in:all', public.get_breakdown('income', null, null, 'category', 'cash')),
  ('ex:category', public.get_breakdown('expense', null, null, 'category', 'cash')),
  ('ex:project', public.get_breakdown('expense', null, null, 'project', 'cash')),
  ('ex:payer', public.get_breakdown('expense', null, null, 'payer', 'cash')),
  ('in:project:cash', public.get_breakdown('income', null, null, 'project', 'cash')),
  ('in:category:invoiced', public.get_breakdown('income', null, null, 'category', 'invoiced')),
  ('ex:june', public.get_breakdown('expense', '2026-06-01', '2026-06-30', 'category', 'cash')),
  ('ex:july', public.get_breakdown('expense', '2026-07-01', '2026-07-31', 'category', 'cash')),
  ('lines:alpha', public.get_breakdown_lines('expense', 'project', (select id::text from fb_ref where label = 'alpha'), 'ILS')),
  ('lines:excluded', public.get_breakdown_lines('expense', 'category', null, 'ILS', null, null, 'cash', true)),
  ('lines:page', public.get_breakdown_lines('expense', 'category', (select id::text from fb_ref where label = 'materials'), 'ILS', null, null, 'cash', false, 1, 0)),
  ('lines:page2', public.get_breakdown_lines('expense', 'category', (select id::text from fb_ref where label = 'materials'), 'ILS', null, null, 'cash', false, 1, 1)),
  ('lines:last', public.get_breakdown_lines('expense', 'category', (select id::text from fb_ref where label = 'materials'), 'ILS', null, null, 'cash', false, 1, 2)),
  ('lines:unassigned', public.get_breakdown_lines('expense', 'project', 'unassigned', 'ILS'));

-- Reversals follow the category kind, like Home (decision 0103).
select is(pg_temp.total(pg_temp.out_of('in:category:invoiced'), 'GBP'), (pg_temp.cur(pg_temp.out_of('dash:invoiced'), 'GBP') ->> 'income_minor')::bigint,
  'invoiced income with a reversal matches Home (GBP)');
select is(pg_temp.total(pg_temp.out_of('in:category:invoiced'), 'GBP'), 15000::bigint,
  'an outflow under an income category is negative income: 20000 - 5000');
select is(pg_temp.total(pg_temp.out_of('in:project:cash'), 'GBP'), (pg_temp.cur(pg_temp.out_of('dash:cash'), 'GBP') ->> 'income_minor')::bigint,
  'cash income counts the reversal whatever its document kind (GBP)');
select is(pg_temp.total(pg_temp.out_of('ex:category'), 'GBP'), 5000::bigint,
  'an inflow under an expense category is negative expense: 8000 - 3000');
select is(pg_temp.total(pg_temp.out_of('in:july'), 'GBP'), -5000::bigint,
  'cash income counts the reversal by its cash date (July), not its June document');
select is(pg_temp.total(pg_temp.out_of('in:july'), 'GBP'), (pg_temp.cur(pg_temp.out_of('dash:july'), 'GBP') ->> 'income_minor')::bigint,
  'July cash income with a reversal matches Home (GBP)');

-- Totals match Home.
select is(pg_temp.total(pg_temp.out_of('ex:category'), 'ILS'), (pg_temp.out_of('dash:cash') ->> 'expense_agorot')::bigint,
  'expense total matches Home (ILS)');
select is(pg_temp.total(pg_temp.out_of('ex:category'), 'USD'), (pg_temp.cur(pg_temp.out_of('dash:cash'), 'USD') ->> 'expense_minor')::bigint,
  'expense total matches Home (USD)');
select is(pg_temp.total(pg_temp.out_of('in:project:cash'), 'ILS'), (pg_temp.out_of('dash:cash') ->> 'income_agorot')::bigint,
  'cash income total matches Home');
select is(pg_temp.total(pg_temp.out_of('in:category:invoiced'), 'ILS'), (pg_temp.out_of('dash:invoiced') ->> 'income_agorot')::bigint,
  'invoiced income total matches Home');
select is(pg_temp.total(pg_temp.out_of('ex:project'), 'ILS'), pg_temp.total(pg_temp.out_of('ex:category'), 'ILS'),
  'the total does not depend on the grouping');
select is(pg_temp.total(pg_temp.out_of('ex:category'), 'ILS'), 157000::bigint,
  '30000 + 15000 + 5000 + 7000 + 10000 + interest 70000 + escrow 20000; kept-out and pending lines are out');

-- Groups add up to the total.
select is(pg_temp.group_sum(pg_temp.out_of('ex:category'), 'ILS'), pg_temp.total(pg_temp.out_of('ex:category'), 'ILS'),
  'category groups add up (ILS)');
select is(pg_temp.group_sum(pg_temp.out_of('ex:project'), 'ILS'), pg_temp.total(pg_temp.out_of('ex:project'), 'ILS'),
  'project groups add up (ILS)');
select is(pg_temp.group_sum(pg_temp.out_of('ex:payer'), 'ILS'), pg_temp.total(pg_temp.out_of('ex:payer'), 'ILS'),
  'supplier groups add up (ILS)');
select is(pg_temp.group_sum(pg_temp.out_of('ex:project'), 'USD'), pg_temp.total(pg_temp.out_of('ex:project'), 'USD'),
  'project groups add up (USD)');
select is(pg_temp.group_sum(pg_temp.out_of('in:project:cash'), 'ILS'), pg_temp.total(pg_temp.out_of('in:project:cash'), 'ILS'),
  'income project groups add up');

-- By project.
select is((pg_temp.grp(pg_temp.out_of('ex:project'), 'ILS', (select id::text from fb_ref where label = 'alpha')) ->> 'amount_minor')::bigint,
  36000::bigint, 'Alpha has its line and 60% of the shared line');
select is((pg_temp.grp(pg_temp.out_of('ex:project'), 'ILS', (select id::text from fb_ref where label = 'beta')) ->> 'shared')::boolean,
  true, 'Beta is marked as holding a shared share');
select is((pg_temp.grp(pg_temp.out_of('ex:project'), 'ILS', 'overhead') ->> 'amount_minor')::bigint,
  20000::bigint, 'overhead holds the overhead line and the overhead project''s cost');
select is(pg_temp.grp(pg_temp.out_of('ex:project'), 'ILS', (select id::text from fb_ref where label = 'office')),
  null::jsonb, 'the overhead project is not a group of its own');
select is((pg_temp.grp(pg_temp.out_of('ex:project'), 'ILS', 'unassigned') ->> 'amount_minor')::bigint,
  97000::bigint, 'unassigned holds the no-role line and the loan interest and escrow');
select is((pg_temp.grp(pg_temp.out_of('in:project:cash'), 'ILS', 'unassigned') ->> 'amount_minor')::bigint,
  20000::bigint, 'income with no project is unassigned');

-- By category and supplier.
select is((pg_temp.grp(pg_temp.out_of('ex:category'), 'ILS', (select k.id::text from public.categories k
    where k.company_id = (select id from fb_ref where label = 'co') and k.name = 'ריבית משכנתא')) ->> 'amount_minor')::bigint,
  70000::bigint, 'a loan payment counts its interest under the interest category');
select is(pg_temp.grp(pg_temp.out_of('ex:category'), 'ILS', (select id::text from fb_ref where label = 'kept')),
  null::jsonb, 'a kept-out category is not a group');
select is((pg_temp.excl(pg_temp.out_of('ex:category'), 'ILS') ->> 'amount_minor')::bigint,
  12500::bigint, 'kept-out line 2500 and the loan principal 10000 are excluded');
select is((pg_temp.grp(pg_temp.out_of('ex:payer'), 'ILS', (select id::text from fb_ref where label = 'supplier')) ->> 'amount_minor')::bigint,
  30000::bigint, 'the supplier group holds its line');

-- Period.
select is(pg_temp.total(pg_temp.out_of('ex:june'), 'ILS'), 157000::bigint, 'June holds every line');
select is(jsonb_array_length(pg_temp.out_of('ex:july') -> 'groups'), 0, 'July is empty');

-- Lines.
select is(jsonb_array_length(pg_temp.out_of('lines:alpha') -> 'rows'), 2, 'Alpha lists its line and the shared share');
select is((select sum((x ->> 'amount_minor')::bigint)::bigint from jsonb_array_elements(pg_temp.out_of('lines:alpha') -> 'rows') x),
  36000::bigint, 'Alpha''s lines add up to its group');
select is(jsonb_array_length(pg_temp.out_of('lines:excluded') -> 'rows'), 2, 'the excluded list holds the kept-out line and the principal');
select is((pg_temp.out_of('lines:page') ->> 'has_more')::boolean, true, 'a page of one says there is more');

select throws_ok(
  $$ select public.get_breakdown('expense', null, null, 'week', 'cash') $$,
  'validation', 'an unknown grouping is refused'
);

-- Shared loan-split parts round half to even, like company_pnl.
select is((pg_temp.grp(pg_temp.out_of('ex:project'), 'EUR', (select id::text from fb_ref where label = 'alpha')) ->> 'amount_minor')::bigint,
  45000::bigint, 'Alpha''s EUR share is 35002 + 9998, each part rounded half to even');
select is(pg_temp.total(pg_temp.out_of('ex:category'), 'EUR'), (pg_temp.cur(pg_temp.out_of('dash:cash'), 'EUR') ->> 'expense_minor')::bigint,
  'expense total matches Home (EUR)');

-- Cash income counts by the cash date.
select is(pg_temp.total(pg_temp.out_of('in:june'), 'EUR'), 5000::bigint, 'a receipt paid in June counts in June');
select is(pg_temp.total(pg_temp.out_of('in:june'), 'EUR'), (pg_temp.cur(pg_temp.out_of('dash:june'), 'EUR') ->> 'income_minor')::bigint,
  'June cash income matches Home (EUR)');

-- Open reviews of the side (the category kind) and period.
select is((pg_temp.out_of('ex:category') ->> 'review_count')::integer, 1, 'one open expense review; the pending line''s review is not in the sum');
select is((pg_temp.out_of('in:all') ->> 'review_count')::integer, 2,
  'one open income review, plus the open outflow under an income category');
select is((pg_temp.out_of('in:june') ->> 'review_count')::integer, 2, 'both income reviews are dated June');
select is((pg_temp.out_of('ex:july') ->> 'review_count')::integer, 0, 'no open review in July');

-- Paging.
select isnt(pg_temp.out_of('lines:page2') -> 'rows' -> 0 ->> 'transaction_id', pg_temp.out_of('lines:page') -> 'rows' -> 0 ->> 'transaction_id',
  'the second page starts after the first');
select is((pg_temp.out_of('lines:last') ->> 'has_more')::boolean, false, 'the last page says there is no more');
select is(jsonb_array_length(pg_temp.out_of('lines:last') -> 'rows'), 1, 'the last page holds the last line');

-- A split part names its own category, newest first.
select is((select x ->> 'category_name' from jsonb_array_elements(pg_temp.out_of('lines:unassigned') -> 'rows') x where x ->> 'part' = 'interest'),
  'ריבית משכנתא', 'the interest part names the interest category, not the bank line''s');
select is(pg_temp.out_of('lines:unassigned') -> 'rows' -> 0 ->> 'doc_date', '2026-06-12', 'the newest line comes first');

-- Group order, counts, and names.
select is(pg_temp.out_of('ex:project') -> 'groups' -> 0 ->> 'key', 'unassigned', 'the largest group comes first');
select is((pg_temp.grp(pg_temp.out_of('ex:project'), 'ILS', 'unassigned') ->> 'count')::integer, 2,
  'a split loan payment counts once in its group');
select ok(pg_temp.grp(pg_temp.out_of('ex:project'), 'ILS', 'overhead') ->> 'name' is null, 'overhead has no name');
select is((pg_temp.grp(pg_temp.out_of('ex:payer'), 'ILS', 'none') ->> 'amount_minor')::bigint, 127000::bigint,
  'lines with no supplier are under none');

select throws_ok(
  $$ select public.get_breakdown('both', null, null, 'category', 'cash') $$,
  'validation', 'an unknown direction is refused'
);
select throws_ok(
  $$ select public.get_breakdown('expense', '2026-06-01', null, 'category', 'cash') $$,
  'validation', 'a period with one date is refused'
);
select throws_ok(
  $$ select public.get_breakdown_lines('expense', 'category', 'none', 'ILS', null, '2026-06-30') $$,
  'validation', 'a lines period with one date is refused'
);

-- Another company sees none of these lines.
select tests.authenticate_as('fb_other');
select is(jsonb_array_length(public.get_breakdown('expense', null, null, 'category', 'cash') -> 'totals'), 0,
  'another company''s breakdown is empty');
select is(jsonb_array_length(public.get_breakdown_lines('expense', 'project',
    (select id::text from fb_ref where label = 'alpha'), 'ILS') -> 'rows'), 0,
  'another company cannot list Alpha''s lines');

select * from finish();
rollback;
