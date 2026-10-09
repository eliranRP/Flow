-- Loans, access: a demo viewer reads, another owner sees nothing, the owner
-- cannot retarget a split, a flagged line clears review, and anon is refused.
-- The fixtures are the loan, its lines, and one three-part split from loans_l1.

begin;

select plan(31);

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

update public.loans set name = 'נגנב' where name = 'משכנתא לדוגמה';

select is(
  (select name from public.loans),
  'משכנתא לדוגמה',
  'a viewer cannot update a loan'
);

delete from public.loans;

select is(
  (select count(*)::int from public.loans),
  1,
  'a viewer cannot delete a loan'
);

select throws_ok(
  $$insert into public.loan_splits (
      company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
    )
    select l.company_id, l.id, t.id, 'interest', 1, 1, c.id
    from public.loans l
    join public.transactions t
      on t.company_id = l.company_id and t.idempotency_key = 'loan:partial'
    join public.categories c
      on c.company_id = l.company_id and c.name = 'ריבית משכנתא' and c.kind = 'expense'$$,
  '42501',
  null,
  'a viewer cannot insert a split'
);

update public.loan_splits set amount_minor = 1;

select is(
  (
    select s.amount_minor
    from public.loan_splits s
    join public.transactions t on t.id = s.transaction_id
    where t.idempotency_key = 'loan:paid' and s.part = 'interest'
  ),
  5000::bigint,
  'a viewer cannot update a split'
);

delete from public.loan_splits;

select is(
  (select count(*)::int from public.loan_splits),
  3,
  'a viewer cannot delete a split'
);

select throws_ok(
  $$
    select public.clear_loan_split_review(id)
    from public.transactions
    where idempotency_key = 'loan:paid'
  $$,
  '42501',
  'loan_split_review_denied',
  'a viewer cannot clear review'
);

select tests.authenticate_as('loan_other');

select is((select count(*)::int from public.loans), 0, 'another owner cannot read the loan');
select is((select count(*)::int from public.loan_splits), 0, 'another owner cannot read the split');

select tests.authenticate_as('loan_owner');

select throws_ok(
  $$update public.loan_splits set transaction_id = gen_random_uuid()$$,
  '42501',
  null,
  'the owner cannot move a split onto another line'
);

select throws_ok(
  $$update public.loan_splits set loan_id = gen_random_uuid()$$,
  '42501',
  null,
  'the owner cannot retarget a split to another loan'
);

select throws_ok(
  $$update public.loan_splits set company_id = gen_random_uuid()$$,
  '42501',
  null,
  'the owner cannot move a split to another company'
);

select throws_ok(
  $$update public.loan_splits set part = 'escrow'$$,
  '42501',
  null,
  'the owner cannot change which part a row is'
);

select throws_ok(
  $$update public.loan_splits set needs_review = true$$,
  '42501',
  null,
  'the owner cannot mark a split for review'
);

select throws_ok(
  $$
    insert into public.loan_splits (
      company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review
    )
    select l.company_id, l.id, t.id, 'interest', 1, 1, c.id, true
    from public.loans l
    join public.transactions t
      on t.company_id = l.company_id and t.idempotency_key = 'loan:partial'
    join public.categories c
      on c.company_id = l.company_id and c.name = 'ריבית משכנתא' and c.kind = 'expense'
    where l.name = 'משכנתא לדוגמה'
  $$,
  '42501',
  null,
  'the owner cannot insert a split already flagged'
);

select lives_ok(
  $$
    update public.loan_splits
    set amount_minor = case part
      when 'interest' then 5001
      when 'principal' then 2999
      else amount_minor
    end
    where company_id = (select private.current_company_id());
    set constraints all immediate;
    update public.loan_splits
    set amount_minor = case part
      when 'interest' then 5000
      when 'principal' then 3000
      else amount_minor
    end
    where company_id = (select private.current_company_id());
    set constraints all immediate;
  $$,
  'the owner can correct an amount'
);
set constraints all deferred;

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
reset role;

update public.loan_splits s
set needs_review = true
from public.transactions t
where s.transaction_id = t.id
  and t.idempotency_key = 'loan:paid';

update public.loan_splits s
set amount_minor = 100000
from public.transactions t
where s.transaction_id = t.id
  and t.idempotency_key = 'loan:paid'
  and s.part = 'principal';

select lives_ok(
  $$set constraints all immediate$$,
  'a flagged line can hold an amount that does not sum'
);
set constraints all deferred;

select tests.authenticate_as('loan_owner');

select is(
  (
    select balance_minor
    from public.loan_balances
    where loan_id = (select id from public.loans where name = 'משכנתא לדוגמה')
  ),
  120000::bigint,
  'a flagged principal part stays out of the balance'
);

select is(
  (
    select flagged_parts
    from public.loan_balances
    where loan_id = (select id from public.loans where name = 'משכנתא לדוגמה')
  ),
  3,
  'flagged parts are counted for review'
);

select throws_ok(
  $$
    select public.clear_loan_split_review(id)
    from public.transactions
    where idempotency_key = 'loan:paid'
  $$,
  '23514',
  'loan_split_sum',
  'clearing review while the parts do not sum is refused'
);

select lives_ok(
  $$
    update public.loan_splits
    set amount_minor = 3000
    where part = 'principal'
      and transaction_id = (
        select id from public.transactions where idempotency_key = 'loan:paid'
      );
    select public.clear_loan_split_review(id)
    from public.transactions
    where idempotency_key = 'loan:paid';
  $$,
  'a matching line can clear review'
);

select is(
  (
    select bool_or(s.needs_review)
    from public.loan_splits s
    join public.transactions t on t.id = s.transaction_id
    where t.idempotency_key = 'loan:paid'
  ),
  false,
  'review is clear once the parts match'
);

select is(
  (
    select balance_minor
    from public.loan_balances
    where loan_id = (select id from public.loans where name = 'משכנתא לדוגמה')
  ),
  117000::bigint,
  'cleared principal reduces the balance again'
);

select is(
  (
    select flagged_parts
    from public.loan_balances
    where loan_id = (select id from public.loans where name = 'משכנתא לדוגמה')
  ),
  0,
  'a clear line has no flagged parts'
);

select tests.clear_authentication();

select throws_ok(
  $$select * from public.loans$$,
  '42501',
  null,
  'anon cannot read loans'
);

select throws_ok(
  $$select public.clear_loan_split_review('00000000-0000-0000-0000-000000000000')$$,
  '42501',
  null,
  'anon cannot clear review'
);

reset role;

select * from finish();
rollback;
