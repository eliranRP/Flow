-- FLOW-101 review. by_currency.count and other_currencies.count stay a count of
-- lines: a split line counts once, not once per part. Invented data only.

begin;

select plan(5);

select tests.create_supabase_user('lc_owner', 'lc-owner@example.com');
select tests.create_supabase_user('lc_other', 'lc-other@example.com');

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('lc_owner'), 'Example Count LLC', false),
  (tests.get_supabase_uid('lc_other'), 'Example Count Neighbour LLC', false);

create temp table lc_ref (label text primary key, id uuid);
grant all on lc_ref to authenticated, service_role;
insert into lc_ref (label, id) select 'co', id from public.companies where name = 'Example Count LLC';

insert into public.categories (company_id, name, kind, sort_order, is_default)
values ((select id from lc_ref where label = 'co'), 'Mortgage servicer', 'expense', 50, false);

insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values ((select id from lc_ref where label = 'co'), 'Example mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'USD');

-- One split payment and one ordinary USD expense: two lines.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, category_id, description, user_assigned
)
select (select id from lc_ref where label = 'co'), 'expense', 'expense', 'overhead', 'posted', 'USD',
  v.net, v.net, -v.net, 0, 'source', '2026-06-10', '2026-06-10', 'manual', v.ikey,
  (select id from public.categories where company_id = (select id from lc_ref where label = 'co') and name = 'Mortgage servicer'),
  v.ikey, true
from (values ('pay', -100000), ('plain', -5000)) as v(ikey, net);

select tests.loan_split(t.id, l.id, (
  select jsonb_agg(jsonb_build_object('part', v.part, 'amount_minor', v.amount, 'scheduled_minor', v.amount,
    'category_id', (select k.id from public.categories k where k.company_id = t.company_id and k.name = v.cat and k.kind = 'expense')))
  from (values
    ('interest', 70000, 'ריבית משכנתא'),
    ('escrow', 20000, 'מסים וביטוח'),
    ('principal', 10000, 'תשלומי הלוואה')
  ) as v(part, amount, cat)
))
from public.transactions t
join public.loans l on l.company_id = t.company_id
where t.idempotency_key = 'pay';

select tests.authenticate_as('lc_owner');

-- These RPCs are not granted to authenticated (decision 0193): the test calls them as service_role
-- with the user's claims, and each still checks the caller's company.
set local role service_role;
select is(
  (select (x->>'count')::int
   from jsonb_array_elements(
     public.company_pnl((select id from lc_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->'by_currency') x
   where x->>'currency' = 'USD'),
  2,
  'by_currency.count: the split payment counts as one line, not one per in-P&L part'
);
set local role authenticated;

set local role service_role;
select is(
  (select (x->>'count')::int
   from jsonb_array_elements(
     public.company_pnl((select id from lc_ref where label = 'co'), null, null, 'cash')->'by_currency') x
   where x->>'currency' = 'USD'),
  2,
  'by_currency.count: same without a period'
);
set local role authenticated;

set local role service_role;
select is(
  (select (x->>'count')::int
   from jsonb_array_elements(
     public.company_pnl((select id from lc_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->'other_currencies') x
   where x->>'currency' = 'USD'),
  2,
  'other_currencies.count: the split payment counts once'
);
set local role authenticated;

set local role service_role;
select is(
  (select (x->>'expense_minor')::bigint
   from jsonb_array_elements(
     public.company_pnl((select id from lc_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->'by_currency') x
   where x->>'currency' = 'USD'),
  95000::bigint,
  'the amounts still count by part (owner positive control)'
);
set local role authenticated;

select tests.authenticate_as('lc_other');

set local role service_role;
select throws_ok(
  $$select public.company_pnl((select id from lc_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')$$,
  'P0001',
  'forbidden',
  'another company''s caller is refused'
);
set local role authenticated;

select * from finish();

rollback;
