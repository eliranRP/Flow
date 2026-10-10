-- FLOW-413 follow-up (decision 0168): one loan money category per company. A company with an
-- income category of its own for loan money, kept out of the P&L, loses the seeded duplicate
-- while nothing uses it. Its own category keeps whether it counts in cash (FLOW-436: loan money
-- counts in cash, and the owner switches it off).
-- Invented data only.

begin;

select plan(15);

do $users$
begin
  perform tests.create_supabase_user('lmd_own', 'lmd-own@example.com');
  perform tests.create_supabase_user('lmd_used', 'lmd-used@example.com');
  perform tests.create_supabase_user('lmd_none', 'lmd-none@example.com');
  perform tests.create_supabase_user('lmd_kept_in', 'lmd-kept-in@example.com');
  perform tests.create_supabase_user('lmd_off', 'lmd-off@example.com');
end
$users$;

create temp table lmd (label text primary key, id uuid);

-- Each company gets the seeded loan money category at creation, like every company did in #370.
insert into lmd (label, id) values
  ('own', tests.fixture_company('lmd_own', 'Example Own Loans LLC')),
  ('used', tests.fixture_company('lmd_used', 'Example Used Loans LLC')),
  ('none', tests.fixture_company('lmd_none', 'Example No Loans LLC')),
  ('kept_in', tests.fixture_company('lmd_kept_in', 'Example Kept In LLC')),
  ('off', tests.fixture_company('lmd_off', 'Example Off LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.lmd where label = p_label; $$;

create or replace function pg_temp.seeded(p_company text)
returns uuid
language sql
as $$
  select c.id from public.categories c
  where c.company_id = pg_temp.id(p_company) and c.name = 'כסף שהתקבל מהלוואות' and c.kind = 'income';
$$;

select isnt(pg_temp.seeded('own'), null, 'every company starts with the seeded loan money category');

-- 'own' and 'used' keep loan money in a category of their own, out of the P&L. 'used' also has a
-- line in the seeded one. 'kept_in' has a loan category that counts in the P&L, so it is not
-- loan money for this rule.
insert into lmd (label, id) values
  ('own_loans', tests.fixture_category(pg_temp.id('own'), 'Loans received', 'income', true)),
  ('used_loans', tests.fixture_category(pg_temp.id('used'), 'הלוואות שהתקבלו', 'income', true)),
  ('kept_in_loans', tests.fixture_category(pg_temp.id('kept_in'), 'Loan interest income', 'income', false)),
  ('off_loans', tests.fixture_category(pg_temp.id('off'), 'Loan proceeds', 'income', true));
-- The owner of 'off' switched its loan money out of cash.
update public.categories set in_cash = false where id = pg_temp.id('off_loans');
insert into lmd (label, id) values
  ('used_line', tests.fixture_line(pg_temp.id('used'), 'lmd:used', 500000, 'income', null,
    pg_temp.seeded('used'), '2026-06-03', p_pnl_role => null, p_doc_kind => 'invoice_receipt'));

select is(
  (select in_cash from public.categories where id = pg_temp.id('own_loans')),
  true,
  'a new income category with a loan name counts in cash until the cleanup'
);

-- The rule.
select ok(private.loan_money_category('income', true, 'Loan proceeds'), 'loan proceeds is loan money');
select ok(private.loan_money_category('income', true, 'HML loans'), 'a plural loan name is loan money');
select ok(private.loan_money_category('income', true, 'כסף מהלוואה'), 'a Hebrew loan name is loan money');
select ok(not private.loan_money_category('income', false, 'Loans received'), 'a loan category in the P&L is not');
select ok(not private.loan_money_category('expense', true, 'Loan principal'), 'an expense category is not');
select ok(not private.loan_money_category('income', true, 'Sloane rent'), 'a word that only contains loan is not');

select is(private.dedupe_loan_money_categories(), 2, 'the cleanup removes the two unused duplicates');

select is(pg_temp.seeded('own'), null, 'the unused duplicate is gone');
select is(
  (select in_cash from public.categories where id = pg_temp.id('own_loans')),
  true,
  'the company''s own loan money category stays in cash'
);
select is(
  (select in_cash from public.categories where id = pg_temp.id('off_loans')),
  false,
  'and one the owner switched out of cash stays out'
);
select isnt(pg_temp.seeded('used'), null, 'a duplicate with a line stays for the owner to merge');
select ok(
  pg_temp.seeded('none') is not null and pg_temp.seeded('kept_in') is not null,
  'a company with no loan money category of its own keeps the seeded one'
);
select is(private.dedupe_loan_money_categories(), 0, 'a second run changes nothing');

select * from finish();
rollback;
