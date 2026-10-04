-- Loans. The owner writes. A demo viewer reads. A split is three parts of one line.

begin;

select plan(22);

do $users$
begin
  perform tests.create_supabase_user('loan_owner');
  perform tests.create_supabase_user('loan_other');
  perform tests.create_supabase_user('loan_reader');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('loan_owner'), 'הלוואות בדיקה', true);

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('loan_other'), 'הלוואות אחר', false);

insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('loan_reader'), c.id
from public.companies c
where c.name = 'הלוואות בדיקה';

select is(
  (
    select sort_order
    from public.categories
    where company_id = (select id from public.companies where name = 'הלוואות בדיקה')
      and name = 'ריבית משכנתא'
      and kind = 'expense'
      and not excluded_from_pnl
  ),
  10,
  'mortgage interest is an expense in the P&L'
);

select is(
  (
    select sort_order
    from public.categories
    where company_id = (select id from public.companies where name = 'הלוואות בדיקה')
      and name = 'מסים וביטוח'
      and kind = 'expense'
      and not excluded_from_pnl
  ),
  11,
  'taxes and insurance are an expense in the P&L'
);

select is(
  (
    select excluded_from_pnl
    from public.categories
    where company_id = (select id from public.companies where name = 'הלוואות בדיקה')
      and name = 'תשלומי הלוואה'
      and kind = 'expense'
  ),
  true,
  'principal stays off the P&L'
);

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select c.id, 'ריבית משכנתא', 'expense'::public.category_kind, 10, true, false
from public.companies c
where c.name = 'הלוואות בדיקה'
on conflict on constraint categories_company_id_kind_name_key do nothing;

select is(
  (
    select count(*)::int
    from public.categories
    where company_id = (select id from public.companies where name = 'הלוואות בדיקה')
      and name = 'ריבית משכנתא'
  ),
  1,
  'seeding interest again does not add a second row'
);

select throws_ok(
  $$insert into public.loans (
      company_id, name, principal_minor, annual_rate_ppm, term_months,
      start_date, payment_minor, escrow_minor, currency
    )
    select id, 'משכנתא לדוגמה', 120000, 60000, 360, '2026-01-01', 1000, 1000, 'USD'
    from public.companies where name = 'הלוואות בדיקה'$$,
  '23514',
  null,
  'escrow has to stay below the payment'
);

select throws_ok(
  $$insert into public.loans (
      company_id, name, principal_minor, annual_rate_ppm, term_months,
      start_date, payment_minor, escrow_minor, currency
    )
    select id, 'משכנתא לדוגמה', 120000, 1000001, 360, '2026-01-01', 1000, 100, 'USD'
    from public.companies where name = 'הלוואות בדיקה'$$,
  '23514',
  null,
  'a rate above 100 percent is refused'
);

insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
select id, 'משכנתא לדוגמה', 120000, 60000, 360, '2026-01-01', 1000, 100, 'USD'
from public.companies
where name = 'הלוואות בדיקה';

insert into public.transactions (
  company_id, direction, doc_kind, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
select c.id, 'expense', 'expense', -10000, -10000, 10000, 0, 'unknown',
  '2026-02-01', v.currency, 'manual', v.key, 'תשלום'
from public.companies c
cross join (
  values
    ('loan:paid', 'USD'),
    ('loan:partial', 'USD'),
    ('loan:sum', 'USD'),
    ('loan:category', 'USD'),
    ('loan:currency', 'ILS')
) as v(key, currency)
where c.name = 'הלוואות בדיקה';

insert into public.transactions (
  company_id, direction, doc_kind, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
select id, 'expense', 'expense', -10000, -10000, 10000, 0, 'unknown',
  '2026-02-01', 'USD', 'manual', 'loan:foreign', 'תשלום זר'
from public.companies
where name = 'הלוואות אחר';

select throws_ok(
  $$
    insert into public.loan_splits (
      company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
    )
    select l.company_id, l.id, t.id, 'interest', 10000, 10000, c.id
    from public.loans l
    join public.transactions t
      on t.company_id = l.company_id and t.idempotency_key = 'loan:partial'
    join public.categories c
      on c.company_id = l.company_id and c.name = 'ריבית משכנתא' and c.kind = 'expense';
    set constraints all immediate;
  $$,
  '23514',
  'loan_split_incomplete',
  'one part is not a split'
);

select throws_ok(
  $$
    insert into public.loan_splits (
      company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
    )
    select l.company_id, l.id, t.id, v.part::public.loan_split_part, 1, 1, c.id
    from public.loans l
    join public.transactions t
      on t.company_id = l.company_id and t.idempotency_key = 'loan:sum'
    cross join (
      values
        ('interest', 'ריבית משכנתא'),
        ('escrow', 'מסים וביטוח'),
        ('principal', 'תשלומי הלוואה')
    ) as v(part, category)
    join public.categories c
      on c.company_id = l.company_id and c.name = v.category and c.kind = 'expense';
    set constraints all immediate;
  $$,
  '23514',
  'loan_split_sum',
  'the three parts have to sum to the bank line'
);

select throws_ok(
  $$
    insert into public.loan_splits (
      company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
    )
    select l.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount, c.id
    from public.loans l
    join public.transactions t
      on t.company_id = l.company_id and t.idempotency_key = 'loan:currency'
    cross join (
      values
        ('interest', 'ריבית משכנתא', 5000),
        ('escrow', 'מסים וביטוח', 2000),
        ('principal', 'תשלומי הלוואה', 3000)
    ) as v(part, category, amount)
    join public.categories c
      on c.company_id = l.company_id and c.name = v.category and c.kind = 'expense';
    set constraints all immediate;
  $$,
  '23514',
  'loan_split_currency',
  'a split stays in the loan currency'
);

select throws_ok(
  $$
    insert into public.loan_splits (
      company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
    )
    select l.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount, c.id
    from public.loans l
    join public.transactions t
      on t.company_id = l.company_id and t.idempotency_key = 'loan:category'
    cross join (
      values
        ('interest', 'ביטוח', 5000),
        ('escrow', 'מסים וביטוח', 2000),
        ('principal', 'תשלומי הלוואה', 3000)
    ) as v(part, category, amount)
    join public.categories c
      on c.company_id = l.company_id and c.name = v.category and c.kind = 'expense';
    set constraints all immediate;
  $$,
  '23514',
  'loan_split_category',
  'interest uses ריבית משכנתא'
);

select throws_ok(
  $$insert into public.loan_splits (
      company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
    )
    select o.id, l.id, t.id, 'principal', 10000, 10000, c.id
    from public.companies o
    join public.loans l on l.name = 'משכנתא לדוגמה'
    join public.transactions t on t.idempotency_key = 'loan:foreign'
    join public.categories c
      on c.company_id = o.id and c.name = 'תשלומי הלוואה' and c.kind = 'expense'
    where o.name = 'הלוואות אחר'$$,
  '23503',
  null,
  'a split cannot point at another company''s loan'
);

insert into public.loan_splits (
  company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
)
select l.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount, c.id
from public.loans l
join public.transactions t
  on t.company_id = l.company_id and t.idempotency_key = 'loan:paid'
cross join (
  values
    ('interest', 'ריבית משכנתא', 5000),
    ('escrow', 'מסים וביטוח', 2000),
    ('principal', 'תשלומי הלוואה', 3000)
) as v(part, category, amount)
join public.categories c
  on c.company_id = l.company_id and c.name = v.category and c.kind = 'expense';

select lives_ok($$set constraints all immediate$$, 'three parts that match the line are kept');
set constraints all deferred;

select is(
  (
    select balance_minor
    from public.loan_balances
    where loan_id = (select id from public.loans where name = 'משכנתא לדוגמה')
  ),
  117000::bigint,
  'posted principal reduces the balance'
);

select ok(
  (
    select c.reloptions && array['security_invoker=true']
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'loan_balances'
  ),
  'loan balances run as the caller'
);

select tests.authenticate_as('loan_reader');

select is(
  (select count(*)::int from public.loans),
  1,
  'a demo viewer can read the loan'
);

select is(
  (select balance_minor from public.loan_balances),
  117000::bigint,
  'a demo viewer can read the balance'
);

select throws_ok(
  $$insert into public.loans (
      company_id, name, principal_minor, annual_rate_ppm, term_months,
      start_date, payment_minor, escrow_minor, currency
    )
    select id, 'אסור', 1000, 0, 12, '2026-01-01', 100, 0, 'USD'
    from public.companies where name = 'הלוואות בדיקה'$$,
  '42501',
  null,
  'a viewer cannot insert a loan'
);

select tests.authenticate_as('loan_other');

select is((select count(*)::int from public.loans), 0, 'another owner cannot read the loan');
select is((select count(*)::int from public.loan_splits), 0, 'another owner cannot read the split');

select tests.authenticate_as('loan_owner');

select lives_ok(
  $$insert into public.loans (
      company_id, name, principal_minor, annual_rate_ppm, term_months,
      start_date, payment_minor, escrow_minor, currency
    )
    select private.current_company_id(), 'משכנתא שנייה', 50000, 0, 12, '2026-04-01', 4000, 0, 'ILS'$$,
  'the owner can add a loan'
);

select is((select count(*)::int from public.loans), 2, 'the owner reads both loans');

select tests.clear_authentication();

select throws_ok(
  $$select * from public.loans$$,
  '42501',
  null,
  'anon cannot read loans'
);

reset role;

select * from finish();
rollback;
