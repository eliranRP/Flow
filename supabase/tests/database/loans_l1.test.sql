-- Loans. The owner writes. A demo viewer reads. A split is three parts of one line.
-- This file: categories, loan and split rules, the balance, and re-sync review flags.
-- Who can read and write, and clearing review, are in loans_l1_access.

begin;

select plan(47);

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
        ('interest', 'מסים וביטוח', 5000),
        ('escrow', 'מסים וביטוח', 2000),
        ('principal', 'תשלומי הלוואה', 3000)
    ) as v(part, category, amount)
    join public.categories c
      on c.company_id = l.company_id and c.name = v.category and c.kind = 'expense';
    set constraints all immediate;
  $$,
  '23514',
  'loan_split_category',
  'interest cannot use another part''s loan category (0128)'
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

select throws_ok(
  $$
    update public.categories
    set excluded_from_pnl = true
    where company_id = (select id from public.companies where name = 'הלוואות בדיקה')
      and name = 'ריבית משכנתא'
      and kind = 'expense';
    insert into public.loan_splits (
      company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
    )
    select l.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount, c.id
    from public.loans l
    join public.transactions t
      on t.company_id = l.company_id and t.idempotency_key = 'loan:category'
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
  'loan category is fixed',
  'a category holding interest cannot be kept out (0128)'
);

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select id, 'ריבית משכנתא', 'income', 4, false, false
from public.companies
where name = 'הלוואות בדיקה';

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
        ('interest', 'ריבית משכנתא', 'income', 5000),
        ('escrow', 'מסים וביטוח', 'expense', 2000),
        ('principal', 'תשלומי הלוואה', 'expense', 3000)
    ) as v(part, category, kind, amount)
    join public.categories c
      on c.company_id = l.company_id
     and c.name = v.category
     and c.kind = v.kind::public.category_kind;
    set constraints all immediate;
  $$,
  '23514',
  'loan_split_category',
  'interest cannot use an income category'
);

select throws_ok(
  $$
    update public.categories
    set excluded_from_pnl = false
    where company_id = (select id from public.companies where name = 'הלוואות בדיקה')
      and name = 'תשלומי הלוואה'
      and kind = 'expense';
    insert into public.loan_splits (
      company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
    )
    select l.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount, c.id
    from public.loans l
    join public.transactions t
      on t.company_id = l.company_id and t.idempotency_key = 'loan:category'
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
  'loan category is fixed',
  'a category holding principal stays kept out (0128)'
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
        ('interest', 'ריבית משכנתא', 'expense', 5000),
        ('escrow', 'מסים וביטוח', 'expense', 2000),
        ('principal', 'ריבית משכנתא', 'income', 3000)
    ) as v(part, category, kind, amount)
    join public.categories c
      on c.company_id = l.company_id
     and c.name = v.category
     and c.kind = v.kind::public.category_kind;
    set constraints all immediate;
  $$,
  '23514',
  'loan_split_category',
  'principal cannot use an income category'
);

select throws_ok(
  $$
    insert into public.loans (
      company_id, name, principal_minor, annual_rate_ppm, term_months,
      start_date, payment_minor, escrow_minor, currency
    )
    select id, 'משכנתא אחרת', 50000, 0, 12, '2026-04-01', 4000, 0, 'USD'
    from public.companies where name = 'הלוואות בדיקה';
    insert into public.loan_splits (
      company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
    )
    select l.company_id,
           case when v.part = 'principal' then other.id else l.id end,
           t.id, v.part::public.loan_split_part, v.amount, v.amount, c.id
    from public.loans l
    join public.loans other
      on other.company_id = l.company_id and other.name = 'משכנתא אחרת'
    join public.transactions t
      on t.company_id = l.company_id and t.idempotency_key = 'loan:sum'
    cross join (
      values
        ('interest', 'ריבית משכנתא', 5000),
        ('escrow', 'מסים וביטוח', 2000),
        ('principal', 'תשלומי הלוואה', 3000)
    ) as v(part, category, amount)
    join public.categories c
      on c.company_id = l.company_id and c.name = v.category and c.kind = 'expense'
    where l.name = 'משכנתא לדוגמה';
    set constraints all immediate;
  $$,
  '23514',
  'loan_split_incomplete',
  'a line belongs to one loan'
);

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
    insert into public.loan_splits (
      company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
    )
    select l.company_id, l.id, t.id, 'interest', 10000, 10000, c.id
    from public.loans l
    join public.transactions t
      on t.company_id = l.company_id and t.idempotency_key = 'loan:partial'
    join public.categories c
      on c.company_id = l.company_id and c.name = 'ריבית משכנתא' and c.kind = 'expense';
  $$,
  '23505',
  null,
  'a line has one row per part'
);

select throws_ok(
  $$
    update public.loan_splits s
    set amount_minor = 5001
    from public.transactions t
    where s.transaction_id = t.id
      and t.idempotency_key = 'loan:paid'
      and s.part = 'interest';
    set constraints all immediate;
  $$,
  '23514',
  'loan_split_sum',
  'changing a part rechecks the sum'
);

select lives_ok(
  $$
    update public.loan_splits s
    set amount_minor = case s.part
      when 'interest' then 5001
      when 'principal' then 2999
      else s.amount_minor
    end
    from public.transactions t
    where s.transaction_id = t.id
      and t.idempotency_key = 'loan:paid';
    set constraints all immediate;
    update public.loan_splits s
    set amount_minor = case s.part
      when 'interest' then 5000
      when 'principal' then 3000
      else s.amount_minor
    end
    from public.transactions t
    where s.transaction_id = t.id
      and t.idempotency_key = 'loan:paid';
    set constraints all immediate;
  $$,
  'an amount change that still sums is kept'
);
set constraints all deferred;

select throws_ok(
  $$
    insert into public.transactions (
      company_id, direction, doc_kind, amount_gross, amount_net, amount_original,
      vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
    )
    select id, 'income', 'other', 10000, 10000, 10000, 0, 'unknown',
      '2026-02-01', 'USD', 'manual', 'loan:income', 'תקבול'
    from public.companies where name = 'הלוואות בדיקה';
    insert into public.loan_splits (
      company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
    )
    select l.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount, c.id
    from public.loans l
    join public.transactions t
      on t.company_id = l.company_id and t.idempotency_key = 'loan:income'
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
  'loan_split_income',
  'an income line cannot be split'
);

select lives_ok(
  $$
    insert into public.loans (
      company_id, name, principal_minor, annual_rate_ppm, term_months,
      start_date, payment_minor, escrow_minor, currency
    )
    select id, 'משכנתא בלי חלקים', 50000, 0, 12, '2026-04-01', 4000, 0, 'USD'
    from public.companies where name = 'הלוואות בדיקה';
    update public.loans set currency = 'EUR' where name = 'משכנתא בלי חלקים';
    delete from public.loans where name = 'משכנתא בלי חלקים';
  $$,
  'currency can change before any split exists'
);

select throws_ok(
  $$update public.loans set currency = 'EUR' where name = 'משכנתא לדוגמה'$$,
  '23514',
  'loan_currency_locked',
  'currency stays once a split exists'
);

update public.transactions
set line_status = 'void'
where idempotency_key = 'loan:paid';

select is(
  (
    select balance_minor
    from public.loan_balances
    where loan_id = (select id from public.loans where name = 'משכנתא לדוגמה')
  ),
  120000::bigint,
  'a voided line does not reduce the balance'
);

update public.transactions
set line_status = 'posted'
where idempotency_key = 'loan:paid';

select is(
  (
    select balance_minor
    from public.loan_balances
    where loan_id = (select id from public.loans where name = 'משכנתא לדוגמה')
  ),
  117000::bigint,
  'a posted line reduces the balance again'
);

update public.transactions
set removed_at = now()
where idempotency_key = 'loan:paid';

select is(
  (
    select balance_minor
    from public.loan_balances
    where loan_id = (select id from public.loans where name = 'משכנתא לדוגמה')
  ),
  120000::bigint,
  'a removed line does not reduce the balance'
);

update public.transactions
set removed_at = null
where idempotency_key = 'loan:paid';

select is(
  (
    select balance_minor
    from public.loan_balances
    where loan_id = (select id from public.loans where name = 'משכנתא לדוגמה')
  ),
  117000::bigint,
  'putting the line back reduces the balance'
);

select is(
  (
    select bool_or(s.needs_review)
    from public.loan_splits s
    join public.transactions t on t.id = s.transaction_id
    where t.idempotency_key = 'loan:paid'
  ),
  false,
  'a split starts clear of review'
);

select lives_ok(
  $$update public.transactions set description = 'עודכן' where idempotency_key = 'loan:paid'$$,
  'a description change does not mark the split'
);

select is(
  (
    select bool_or(s.needs_review)
    from public.loan_splits s
    join public.transactions t on t.id = s.transaction_id
    where t.idempotency_key = 'loan:paid'
  ),
  false,
  'the split stays clear'
);

select lives_ok(
  $$
    update public.transactions
    set amount_original = 9000
    where idempotency_key = 'loan:paid';
    set constraints all immediate;
  $$,
  'a re-sync that changes the amount does not fail'
);
set constraints all deferred;

select is(
  (
    select bool_and(s.needs_review)
    from public.loan_splits s
    join public.transactions t on t.id = s.transaction_id
    where t.idempotency_key = 'loan:paid'
  ),
  true,
  'a re-sync that changes the amount marks every part'
);

select is(
  (
    select s.amount_minor
    from public.loan_splits s
    join public.transactions t on t.id = s.transaction_id
    where t.idempotency_key = 'loan:paid' and s.part = 'interest'
  ),
  5000::bigint,
  'a re-sync leaves the split amounts for review'
);

select is(
  (select amount_original from public.transactions where idempotency_key = 'loan:paid'),
  9000::bigint,
  'the re-sync keeps the new line amount'
);

update public.transactions
set amount_original = 10000
where idempotency_key = 'loan:paid';

select is(
  (
    select bool_and(s.needs_review)
    from public.loan_splits s
    join public.transactions t on t.id = s.transaction_id
    where t.idempotency_key = 'loan:paid'
  ),
  true,
  'reverting the line amount leaves the review flag set'
);

update public.transactions
set amount_original = 9000
where idempotency_key = 'loan:paid';

select throws_ok(
  $$
    update public.loan_splits s
    set needs_review = false
    from public.transactions t
    where s.transaction_id = t.id
      and t.idempotency_key = 'loan:paid';
    set constraints all immediate;
  $$,
  '23514',
  'loan_split_sum',
  'clearing review while the sum is off is refused'
);

select lives_ok(
  $$
    update public.transactions
    set amount_original = 10000
    where idempotency_key = 'loan:paid';
    update public.loan_splits s
    set needs_review = false
    from public.transactions t
    where s.transaction_id = t.id
      and t.idempotency_key = 'loan:paid';
    set constraints all immediate;
  $$,
  'restoring the line amount lets the flag clear'
);
set constraints all deferred;

select is(
  (
    select bool_or(s.needs_review)
    from public.loan_splits s
    join public.transactions t on t.id = s.transaction_id
    where t.idempotency_key = 'loan:paid'
  ),
  false,
  'the flag is clear once the line amount matches'
);

select lives_ok(
  $$
    update public.transactions
    set currency = 'EUR'
    where idempotency_key = 'loan:paid';
    set constraints all immediate;
  $$,
  'a re-sync that changes the currency does not fail'
);
set constraints all deferred;

select is(
  (
    select bool_and(s.needs_review)
    from public.loan_splits s
    join public.transactions t on t.id = s.transaction_id
    where t.idempotency_key = 'loan:paid'
  ),
  true,
  'a re-sync that changes the currency marks every part'
);

update public.transactions
set currency = 'USD'
where idempotency_key = 'loan:paid';

select is(
  (
    select bool_and(s.needs_review)
    from public.loan_splits s
    join public.transactions t on t.id = s.transaction_id
    where t.idempotency_key = 'loan:paid'
  ),
  true,
  'reverting the line currency leaves the review flag set'
);

select lives_ok(
  $$
    update public.transactions
    set currency = 'USD'
    where idempotency_key = 'loan:paid';
    update public.loan_splits s
    set needs_review = false
    from public.transactions t
    where s.transaction_id = t.id
      and t.idempotency_key = 'loan:paid';
    set constraints all immediate;
  $$,
  'restoring the currency lets the flag clear'
);
set constraints all deferred;

insert into public.transactions (
  company_id, direction, doc_kind, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
select id, 'expense', 'expense', -10000, -10000, 10000, 0, 'unknown',
  '2026-03-01', 'USD', 'manual', 'loan:move', 'תשלום להעברה'
from public.companies
where name = 'הלוואות בדיקה';

insert into public.loan_splits (
  company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
)
select l.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount, c.id
from public.loans l
join public.transactions t
  on t.company_id = l.company_id and t.idempotency_key = 'loan:move'
cross join (
  values
    ('interest', 'ריבית משכנתא', 5000),
    ('escrow', 'מסים וביטוח', 2000),
    ('principal', 'תשלומי הלוואה', 3000)
) as v(part, category, amount)
join public.categories c
  on c.company_id = l.company_id and c.name = v.category and c.kind = 'expense';

select lives_ok($$set constraints all immediate$$, 'a second line can carry its own split');
set constraints all deferred;

select throws_ok(
  $$
    delete from public.loan_splits s
    using public.transactions t
    where s.transaction_id = t.id
      and t.idempotency_key = 'loan:move'
      and s.part = 'interest';
    update public.loan_splits s
    set transaction_id = dest.id
    from public.transactions src, public.transactions dest
    where s.transaction_id = src.id
      and src.idempotency_key = 'loan:paid'
      and s.part = 'interest'
      and dest.idempotency_key = 'loan:move'
      and dest.company_id = src.company_id;
    set constraints all immediate;
  $$,
  '23514',
  'loan_split_incomplete',
  'moving a part rechecks the line it left'
);

delete from public.loan_splits s
using public.transactions t
where s.transaction_id = t.id
  and t.idempotency_key = 'loan:move';

select lives_ok($$set constraints all immediate$$, 'clearing every part of a line is allowed');
set constraints all deferred;

select * from finish();
rollback;
