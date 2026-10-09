-- FLOW-413 + FLOW-103, server PR 1 (decision 0168). The monthly cash view: every line's money
-- in and out by its parts, gross, with the full loan payment out, transfers and loan money out
-- of the view by default, a category and a line switch, and the paid or invoice basis.
-- Invented data only. Amounts are agorot (cents for USD). Today is 2026-06-15.

begin;

select plan(51);

do $users$
begin
  perform tests.create_supabase_user('cfm_owner', 'cfm-owner@example.com');
  perform tests.create_supabase_user('cfm_other', 'cfm-other@example.com');
  perform tests.create_supabase_user('cfm_demo', 'cfm-demo@example.com');
  perform tests.create_supabase_user('cfm_viewer', 'cfm-viewer@example.com');
end
$users$;

create temp table cfm (label text primary key, id uuid);
create temp table cfm_val (label text primary key, v jsonb);
grant all on cfm, cfm_val to authenticated, service_role;

insert into cfm (label, id) values ('co', tests.fixture_company('cfm_owner', 'Example Cash LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.cfm where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create or replace function pg_temp.cat(p_name text, p_kind text)
returns uuid
language sql
as $$
  select c.id from public.categories c
  where c.company_id = pg_temp.id('co') and c.name = p_name and c.kind = p_kind::public.category_kind;
$$;
grant execute on function pg_temp.cat(text, text) to authenticated, service_role;

-- One month's row for one currency, from cash_months(2, 2026-06-15).
create or replace function pg_temp.month_row(p_month text, p_currency text)
returns jsonb
language sql
as $$
  select r
  from jsonb_array_elements(public.cash_months(2, '2026-06-15') -> 'months') m
  cross join lateral jsonb_array_elements(m -> 'by_currency') r
  where m ->> 'month' = p_month and r ->> 'currency' = p_currency;
$$;
grant execute on function pg_temp.month_row(text, text) to authenticated, service_role;

create or replace function pg_temp.june(p_field text)
returns bigint
language sql
as $$ select (pg_temp.month_row('2026-06-01', 'ILS') ->> p_field)::bigint; $$;
grant execute on function pg_temp.june(text) to authenticated, service_role;

insert into cfm (label, id) values
  ('harbor', tests.fixture_project(pg_temp.id('co'), 'Harbor')),
  ('xfer_out', tests.fixture_category(pg_temp.id('co'), 'Internal transfers out'));

insert into cfm (label, id) values
  ('rent', tests.fixture_line(pg_temp.id('co'), 'cfm:rent', 1200000, 'income', pg_temp.id('harbor'),
    pg_temp.cat('תקבול מלקוח', 'income'), '2026-06-05', p_pnl_role => null, p_doc_kind => 'invoice_receipt')),
  ('loan', tests.fixture_line(pg_temp.id('co'), 'cfm:loan', 1000000, 'expense', null,
    pg_temp.cat('אחר', 'expense'), '2026-06-12', p_pnl_role => null, p_doc_kind => 'expense')),
  ('transfer', tests.fixture_line(pg_temp.id('co'), 'cfm:transfer', 50000, 'expense', null,
    pg_temp.cat('העברות', 'expense'), '2026-06-08', p_pnl_role => null)),
  ('loan_money', tests.fixture_line(pg_temp.id('co'), 'cfm:loan-money', 5000000, 'income', null,
    pg_temp.cat('כסף שהתקבל מהלוואות', 'income'), '2026-06-03', p_pnl_role => null, p_doc_kind => 'invoice_receipt')),
  ('open_invoice', tests.fixture_line(pg_temp.id('co'), 'cfm:open-invoice', 30000, 'expense', pg_temp.id('harbor'),
    pg_temp.cat('אחר', 'expense'), '2026-06-20', p_doc_kind => 'invoice')),
  ('vat', tests.fixture_line(pg_temp.id('co'), 'cfm:vat', 10000, 'expense', pg_temp.id('harbor'),
    pg_temp.cat('אחר', 'expense'), '2026-06-10')),
  ('split', tests.fixture_line(pg_temp.id('co'), 'cfm:split', 10000, 'expense', pg_temp.id('harbor'),
    pg_temp.cat('אחר', 'expense'), '2026-06-11')),
  ('usd', tests.fixture_line(pg_temp.id('co'), 'cfm:usd', 10000, 'expense', pg_temp.id('harbor'),
    pg_temp.cat('אחר', 'expense'), '2026-05-30', p_currency => 'USD', p_source => 'mercury'));

-- The open invoice is unpaid; the Mercury card line posted in June; two lines carry 18% VAT.
update public.transactions set cash_date = null where id = pg_temp.id('open_invoice');
update public.transactions set cash_date = '2026-06-02' where id = pg_temp.id('usd');
update public.transactions
set amount_net = -10000, vat_amount = -1800, amount_gross = -11800
where id in (pg_temp.id('vat'), pg_temp.id('split'));

-- The split line: three categories, 33.33 / 33.33 / 33.34 net.
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
values
  (pg_temp.id('co'), pg_temp.id('split'), 1, pg_temp.cat('אחר', 'expense'), pg_temp.id('harbor'), 3333),
  (pg_temp.id('co'), pg_temp.id('split'), 2, pg_temp.cat('חומרים', 'expense'), pg_temp.id('harbor'), 3333),
  (pg_temp.id('co'), pg_temp.id('split'), 3, pg_temp.cat('עבודה', 'expense'), pg_temp.id('harbor'), 3334);

-- The loan payment: 7,000 principal, 2,000 interest, 1,000 escrow.
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values (pg_temp.id('co'), 'Example mortgage', 120000000, 60000, 360, '2026-01-01', 1000000, 100000, 'ILS');

insert into public.loan_splits (
  company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review
)
select pg_temp.id('co'), l.id, pg_temp.id('loan'), v.part::public.loan_split_part, v.amount, v.amount,
  pg_temp.cat(v.cat, 'expense'), false
from public.loans l
join (values
  ('principal', 700000, 'תשלומי הלוואה'),
  ('interest', 200000, 'ריבית משכנתא'),
  ('escrow', 100000, 'מסים וביטוח')
) as v(part, amount, cat) on true
where l.company_id = pg_temp.id('co');

-- 1-6. Defaults.
select ok(
  (select excluded_from_pnl and not in_cash and is_default
   from public.categories where id = pg_temp.cat('כסף שהתקבל מהלוואות', 'income')),
  'a new company has a loan money category, out of the P&L and out of cash'
);
select is(
  (select count(*)::integer from public.categories
   where company_id = pg_temp.id('co') and name = 'העברות' and not in_cash),
  2,
  'both transfer categories start out of cash'
);
select ok(
  (select in_cash from public.categories where id = pg_temp.cat('תשלומי הלוואה', 'expense')),
  'loan principal is out of the P&L but in cash'
);
select ok(
  (select not in_cash from public.categories where id = pg_temp.id('xfer_out')),
  'a category named like an internal transfer starts out of cash'
);
select is(
  (select cash_basis from public.companies where id = pg_temp.id('co')),
  'paid',
  'the cash basis defaults to the payment date'
);

select tests.authenticate_as('cfm_owner');

insert into cfm_val (label, v)
select 'pnl_before', public.company_pnl(pg_temp.id('co'), '2026-06-01', '2026-06-30', 'invoiced') -> 'by_currency' -> 0;

select is(
  (select (c ->> 'in_cash')::boolean from jsonb_array_elements(public.list_categories()) c
   where c ->> 'id' = pg_temp.cat('העברות', 'expense')::text),
  false,
  'list_categories returns in_cash'
);

-- 7-17. June and May on the paid basis.
select is(public.cash_months(2, '2026-06-15') ->> 'basis', 'paid', 'cash_months echoes the basis');
select is(
  (select jsonb_agg(m ->> 'month') from jsonb_array_elements(public.cash_months(2, '2026-06-15') -> 'months') m),
  '["2026-06-01", "2026-05-01"]'::jsonb,
  'the months come newest first, the current month included'
);
select is(pg_temp.june('in_minor'), 1200000::bigint, 'נכנס is the rent; loan money is left out');
select is(
  pg_temp.june('out_minor'), 1023600::bigint,
  'יצא is the full loan payment plus two lines gross of VAT; transfers and the open invoice are left out'
);
select is(pg_temp.june('net_minor'), 176400::bigint, 'net is in minus out');
select is(
  (select jsonb_build_object('n', r -> 'excluded_count', 'in', r -> 'excluded_in_minor', 'out', r -> 'excluded_out_minor')
   from pg_temp.month_row('2026-06-01', 'ILS') r),
  '{"n": 2, "in": 5000000, "out": 50000}'::jsonb,
  'what the view leaves out: the loan money and the transfer'
);
select is(pg_temp.june('profit_minor'), 850000::bigint, 'the month''s profit leaves loan principal out');
select is(
  pg_temp.june('profit_minor'),
  ((select v ->> 'net_profit_minor' from cfm_val where label = 'pnl_before'))::bigint,
  'profit_minor is company_pnl''s invoiced net profit for the month'
);
select is(
  (select jsonb_agg(r ->> 'currency')
   from jsonb_array_elements(public.cash_months(2, '2026-06-15') -> 'months' -> 0 -> 'by_currency') r),
  '["ILS", "USD"]'::jsonb,
  'each currency on its own, the base currency first'
);
select is(
  (pg_temp.month_row('2026-06-01', 'USD') ->> 'out_minor')::bigint, 10000::bigint,
  'a Mercury line counts in the month it posted'
);
select is(
  pg_temp.month_row('2026-05-01', 'ILS'),
  '{"currency": "ILS", "in_minor": 0, "out_minor": 0, "net_minor": 0, "profit_minor": 0, "excluded_count": 0, "excluded_in_minor": 0, "excluded_out_minor": 0}'::jsonb,
  'a quiet month still has its base currency row'
);

-- 18-22. The drill-in lists.
select is(
  (select jsonb_agg(jsonb_build_object('id', r ->> 'transaction_id', 'amount', r -> 'amount_minor', 'side', r -> 'side'))
   from jsonb_array_elements(public.cash_month_lines('2026-06-01', 'in') -> 'rows') r),
  jsonb_build_array(jsonb_build_object('id', pg_temp.id('rent'), 'amount', 1200000, 'side', 'in')),
  'the נכנס list is the rent'
);
select is(
  (select jsonb_agg(r ->> 'part' order by r ->> 'part') || jsonb_build_array(sum((r ->> 'amount_minor')::bigint))
   from jsonb_array_elements(public.cash_month_lines('2026-06-15', 'out') -> 'rows') r
   where r ->> 'transaction_id' = pg_temp.id('loan')::text),
  '["escrow", "interest", "principal", 1000000]'::jsonb,
  'the יצא list shows each part of the loan payment'
);
select is(
  (select jsonb_build_object('amount', r -> 'amount_minor', 'category', r -> 'category_name')
   from jsonb_array_elements(public.cash_month_lines('2026-06-01', 'out') -> 'rows') r
   where r ->> 'transaction_id' = pg_temp.id('split')::text),
  '{"amount": 11800, "category": null}'::jsonb,
  'a line split by category is one row, its parts adding up to the gross'
);
select is(
  (select jsonb_agg(jsonb_build_object('side', r -> 'side', 'amount', r -> 'amount_minor', 'kept_out', r -> 'kept_out')
     order by r ->> 'side')
   from jsonb_array_elements(public.cash_month_lines('2026-06-01', 'excluded') -> 'rows') r),
  '[{"side": "in", "amount": 5000000, "kept_out": true}, {"side": "out", "amount": 50000, "kept_out": true}]'::jsonb,
  'the left-out list names each row''s side'
);
select is(
  (select jsonb_agg(r ->> 'transaction_id')
   from jsonb_array_elements(public.cash_month_lines('2026-06-01', 'out', 'USD') -> 'rows') r),
  jsonb_build_array(pg_temp.id('usd')::text),
  'the lists take a currency'
);

-- 23-36. The switches.
select is(
  public.set_category_cash(pg_temp.cat('העברות', 'expense'), true),
  jsonb_build_object('id', pg_temp.cat('העברות', 'expense'), 'in_cash', true, 'prior_in_cash', false),
  'set_category_cash returns the prior value'
);
select is(pg_temp.june('out_minor'), 1073600::bigint, 'a category put back in cash counts its lines');
select lives_ok(
  $$select public.set_category_cash(pg_temp.cat('העברות', 'expense'), false)$$,
  'and goes out again'
);
select is(
  public.set_transaction_cash(pg_temp.id('rent'), false) - 'id',
  '{"in_cash_override": false, "prior_in_cash_override": null, "cash_state": "out"}'::jsonb,
  'set_transaction_cash takes one line out and returns the prior value'
);
select is(
  (select jsonb_build_array(r -> 'in_minor', r -> 'excluded_in_minor') from pg_temp.month_row('2026-06-01', 'ILS') r),
  '[0, 6200000]'::jsonb,
  'the line leaves נכנס for the left-out total'
);
select lives_ok($$select public.set_transaction_cash(pg_temp.id('rent'), null)$$, 'null follows the category again');
select is(pg_temp.june('in_minor'), 1200000::bigint, 'the rent is back');
select is(
  public.set_transaction_cash(pg_temp.id('loan'), false) ->> 'cash_state',
  'out',
  'a loan payment can leave the view (the P&L lock is not the cash flag''s)'
);
select is(pg_temp.june('out_minor'), 23600::bigint, 'all three parts leave יצא');
select lives_ok($$select public.set_transaction_cash(pg_temp.id('loan'), null)$$, 'the loan payment is back');
select lives_ok(
  $$select public.set_category_cash(pg_temp.cat('חומרים', 'expense'), false)$$,
  'one of the split''s categories goes out of cash'
);
select is(
  public.get_transaction(pg_temp.id('split')) ->> 'cash_state',
  'mixed',
  'get_transaction says a line with parts in and out is mixed'
);
select lives_ok($$select public.set_category_cash(pg_temp.cat('חומרים', 'expense'), true)$$, 'and back');
select is(
  public.company_pnl(pg_temp.id('co'), '2026-06-01', '2026-06-30', 'invoiced') -> 'by_currency' -> 0,
  (select v from cfm_val where label = 'pnl_before'),
  'the cash switches leave the P&L as it was'
);

-- 37-41. The basis.
select is(
  public.set_cash_basis('invoice'),
  '{"basis": "invoice", "prior_basis": "paid"}'::jsonb,
  'set_cash_basis returns the prior basis'
);
select is(pg_temp.june('out_minor'), 1053600::bigint, 'on the invoice basis the open invoice counts');
select is(
  (pg_temp.month_row('2026-05-01', 'USD') ->> 'out_minor')::bigint, 10000::bigint,
  'and the Mercury line counts on its document date'
);
select throws_ok($$select public.set_cash_basis('weekly')$$, 'validation', 'an unknown basis is refused');
select lives_ok($$select public.set_cash_basis('paid')$$, 'back to the payment date');

-- 42-43. Validation.
select throws_ok($$select public.cash_months(0)$$, 'validation', 'months must be 1 to 24');
select throws_ok($$select public.cash_month_lines('2026-06-01', 'up')$$, 'validation', 'the side must be in, out or excluded');

-- 44-46. A viewer of a demo company reads it and cannot switch anything.
select tests.authenticate_as('cfm_demo');
select public.create_company('Example Demo LLC', true);
reset role;
update public.companies set is_demo = true where name = 'Example Demo LLC';
insert into cfm (label, id) select 'demo', id from public.companies where name = 'Example Demo LLC';
insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('cfm_viewer'), pg_temp.id('demo'));

select tests.authenticate_as('cfm_viewer');
select is(public.cash_months(1, '2026-06-15') ->> 'basis', 'paid', 'a viewer reads the cash view');
select throws_ok($$select public.set_cash_basis('invoice')$$, '42501', 'forbidden', 'a viewer cannot change the basis');
select throws_ok(
  $$select public.set_category_cash(
    (select id from public.categories where company_id = pg_temp.id('demo') and name = 'העברות' and kind = 'expense'),
    true
  )$$,
  '42501', 'forbidden', 'a viewer cannot switch a category'
);

-- 47-50. Another company sees and changes nothing of this one.
select tests.authenticate_as('cfm_other');
select lives_ok($$select public.create_company('Other Example LLC', false)$$, 'another company');
select is(
  (select r -> 'in_minor' from jsonb_array_elements(public.cash_months(1, '2026-06-15') -> 'months' -> 0 -> 'by_currency') r),
  '0'::jsonb,
  'another company''s cash view holds none of these lines'
);
select is(
  public.cash_month_lines('2026-06-01', 'in') -> 'rows',
  '[]'::jsonb,
  'nor its lists'
);
select throws_ok(
  $$select public.set_transaction_cash(pg_temp.id('rent'), false)$$,
  'transaction not found',
  'nor can it switch this company''s line'
);

-- 51. Signed out, nothing.
select tests.clear_authentication();
select throws_ok($$select public.cash_months()$$, '42501', null, 'anon cannot read the cash view');

select * from finish();
rollback;
