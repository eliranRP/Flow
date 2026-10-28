-- Loans, access: a demo viewer reads, another owner sees nothing, the owner
-- cannot write the loan part legs, a flagged line clears review, and anon is refused.
-- The fixtures are the loan, its lines, and one three-part split from loans_l1.

begin;

select plan(32);

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

select tests.loan_split(t.id, l.id, jsonb_agg(jsonb_build_object('part', v.part, 'amount_minor', v.amount, 'scheduled_minor', v.amount,
  'category_id', c.id)))
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
  on c.company_id = l.company_id and c.name = v.category and c.kind = 'expense'
group by t.id, l.id;

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
  $$insert into public.legs (
      company_id, transaction_id, account_id, amount_minor, ordinal, leg_kind, category_id, part,
      loan_id, scheduled_minor, needs_review, draft
    )
    select l.company_id, t.id, a.id, 1, 1, 'item', c.id, 'interest', l.id, 1, false, true
    from public.loans l
    join public.transactions t
      on t.company_id = l.company_id and t.idempotency_key = 'loan:partial'
    join public.categories c
      on c.company_id = l.company_id and c.name = 'ריבית משכנתא' and c.kind = 'expense'
    join public.accounts a on a.company_id = l.company_id and a.category_id = c.id$$,
  '42501',
  null,
  'a viewer cannot insert a split'
);

select throws_ok(
  $$update public.legs set amount_minor = 1 where loan_id is not null$$,
  '42501',
  null,
  'a viewer cannot update a split'
);

select throws_ok(
  $$delete from public.legs where loan_id is not null$$,
  '42501',
  null,
  'a viewer cannot delete a split'
);

-- This RPC is not granted to authenticated (decision 0193): the test calls it as postgres with the
-- user's claims, and it still checks the caller's company.
set local role postgres;
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
set local role authenticated;

select tests.authenticate_as('loan_other');

select is((select count(*)::int from public.loans), 0, 'another owner cannot read the loan');
select is((select count(*)::int from private.loan_parts), 0, 'another owner cannot read the split');

select tests.authenticate_as('loan_owner');

select throws_ok(
  $$update public.legs set transaction_id = gen_random_uuid() where loan_id is not null$$,
  '42501',
  null,
  'the owner cannot move a split onto another line'
);

select throws_ok(
  $$update public.legs set loan_id = gen_random_uuid() where loan_id is not null$$,
  '42501',
  null,
  'the owner cannot retarget a split to another loan'
);

select throws_ok(
  $$update public.legs set company_id = gen_random_uuid() where loan_id is not null$$,
  '42501',
  null,
  'the owner cannot move a split to another company'
);

select throws_ok(
  $$update public.legs set part = 'escrow' where loan_id is not null$$,
  '42501',
  null,
  'the owner cannot change which part a row is'
);

select throws_ok(
  $$update public.legs set needs_review = true where loan_id is not null$$,
  '42501',
  null,
  'the owner cannot mark a split for review'
);

select throws_ok(
  $$
    insert into public.legs (
      company_id, transaction_id, account_id, amount_minor, ordinal, leg_kind, category_id, part,
      loan_id, scheduled_minor, needs_review, draft
    )
    select l.company_id, t.id, a.id, 1, 1, 'item', c.id, 'interest', l.id, 1, true, true
    from public.loans l
    join public.transactions t
      on t.company_id = l.company_id and t.idempotency_key = 'loan:partial'
    join public.categories c
      on c.company_id = l.company_id and c.name = 'ריבית משכנתא' and c.kind = 'expense'
    join public.accounts a on a.company_id = l.company_id and a.category_id = c.id
    where l.name = 'משכנתא לדוגמה'
  $$,
  '42501',
  null,
  'the owner cannot insert a split already flagged'
);

select lives_ok(
  $$
    select public.save_loan_split(s.transaction_id, s.loan_id, jsonb_agg(jsonb_build_object(
      'part', s.part,
      'amount_minor', case s.part when 'interest' then 5001 when 'principal' then 2999 else s.amount_minor end,
      'scheduled_minor', s.scheduled_minor, 'category_id', s.category_id)))
    from private.loan_parts s
    where s.company_id = (select private.current_company_id())
    group by s.transaction_id, s.loan_id;
    select public.save_loan_split(s.transaction_id, s.loan_id, jsonb_agg(jsonb_build_object(
      'part', s.part,
      'amount_minor', case s.part when 'interest' then 5000 when 'principal' then 3000 else s.amount_minor end,
      'scheduled_minor', s.scheduled_minor, 'category_id', s.category_id)))
    from private.loan_parts s
    where s.company_id = (select private.current_company_id())
    group by s.transaction_id, s.loan_id;
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

-- A line's parts with a new principal, written back through the writer (flags kept).
create function pg_temp.set_principal(p_key text, p_principal bigint)
returns void
language sql
as $$
  select tests.loan_split(s.transaction_id, s.loan_id, jsonb_agg(jsonb_build_object(
    'part', s.part,
    'amount_minor', case s.part when 'principal' then p_principal else s.amount_minor end,
    'scheduled_minor', s.scheduled_minor, 'category_id', s.category_id, 'needs_review', s.needs_review)))
  from private.loan_parts s
  join public.transactions t on t.id = s.transaction_id
  where t.idempotency_key = p_key
  group by s.transaction_id, s.loan_id;
$$;

select tests.loan_split_review(t.id, true) from public.transactions t where t.idempotency_key = 'loan:paid';
select pg_temp.set_principal('loan:paid', 100000);

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

set local role postgres;
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
set local role authenticated;

set local role postgres;
select lives_ok(
  $$ select pg_temp.set_principal('loan:paid', 3000) $$,
  'the owner can fix a split part'
);

select lives_ok(
  $$
    select public.clear_loan_split_review(id)
    from public.transactions
    where idempotency_key = 'loan:paid';
  $$,
  'a matching line can clear review'
);
set local role authenticated;

select is(
  (
    select bool_or(s.needs_review)
    from private.loan_parts s
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
