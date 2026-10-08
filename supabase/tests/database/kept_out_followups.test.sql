-- FLOW-112: kept-out default names (near variants, rename), owner who is also a viewer, loan_part key.

begin;

select plan(31);

do $users$
begin
  perform tests.create_supabase_user('ko_owner', 'ko-owner@example.com');
  perform tests.create_supabase_user('ko_demo', 'ko-demo@example.com');
end
$users$;

create temp table ko_ref (label text primary key, id uuid);
grant all on ko_ref to authenticated, service_role;

-- Near variants of the default names.
select is(private.non_pnl_category('expense', 'Owner distribution'), true, 'singular owner distribution is kept out');
select is(private.non_pnl_category('expense', 'Owner''s Distributions'), true, 'apostrophe variant is kept out');
select is(private.non_pnl_category('expense', 'CapEx/Rehab'), true, 'slash instead of & is kept out');
select is(private.non_pnl_category('expense', 'Closing and acquisition costs'), true, '"and" instead of & is kept out');
select is(private.non_pnl_category('expense', 'Utility deposit'), true, 'singular utility deposit is kept out');
select is(private.non_pnl_category('income', 'Owner contribution'), true, 'singular owner contribution income is kept out');
select is(private.non_pnl_category('expense', 'Tax & insurance escrow'), false, 'escrow stays in the P&L');
select is(private.non_pnl_category('income', 'Owner distribution'), false, 'an expense default name does not match income');
select is(private.non_pnl_category('expense', 'Materials'), false, 'an ordinary name stays in the P&L');
select is(private.non_pnl_category('expense', 'ריבית משכנתא'), false, 'a Hebrew name never matches the English list');
select is(private.non_pnl_category('expense', 'Owner distributions שותף'), false, 'a Hebrew qualifier is part of the name');
select is(private.non_pnl_category('expense', 'Closing and and acquisition costs'), true, 'repeated "and" words are dropped');

select tests.authenticate_as('ko_owner');
select lives_ok($$select public.create_company('Example Ventures LLC', true)$$, 'owner creates company');
insert into ko_ref (label, id) select 'co', id from public.companies where name = 'Example Ventures LLC';

select lives_ok($$select public.create_category('Owner draws and distribution', 'expense')$$, 'create a non-default name');
select lives_ok($$select public.create_category('Furniture/Fixture', 'expense')$$, 'create a near-variant default name');

select is(
  (select excluded_from_pnl from public.categories
   where company_id = (select id from ko_ref where label = 'co') and name = 'Furniture/Fixture'),
  true,
  'insert keeps a near-variant default name out'
);

-- Rename into a default name. The owner has no rename RPC yet, so renames run as the admin.
select lives_ok($$select public.create_category('Repairs', 'expense')$$, 'create repairs');
reset role;
update public.categories set name = 'Owner distribution'
where company_id = (select id from ko_ref where label = 'co') and name = 'Repairs';

select is(
  (select excluded_from_pnl from public.categories
   where company_id = (select id from ko_ref where label = 'co') and name = 'Owner distribution'),
  true,
  'a rename into a default name keeps the category out'
);
select tests.authenticate_as('ko_owner');

-- The owner's choice survives a rename between default names, and a rename away from one.
select lives_ok(
  $$select public.set_category_excluded_from_pnl(
    (select id from public.categories
     where company_id = (select id from ko_ref where label = 'co') and name = 'Owner distribution'),
    false
  )$$,
  'owner puts the category back in the P&L'
);
reset role;
update public.categories set name = 'Owner distributions'
where company_id = (select id from ko_ref where label = 'co') and name = 'Owner distribution';
update public.categories set name = 'Repairs and upkeep'
where company_id = (select id from ko_ref where label = 'co') and name = 'Owner distributions';

select is(
  (select excluded_from_pnl from public.categories
   where company_id = (select id from ko_ref where label = 'co') and name = 'Repairs and upkeep'),
  false,
  'renames that start from a default name keep the owner''s flag'
);
select tests.authenticate_as('ko_owner');

-- loan_part: seeded on the three loan categories, fixed for the owner.
select is(
  (select array_agg(loan_part::text order by loan_part) from public.categories
   where company_id = (select id from ko_ref where label = 'co') and loan_part is not null),
  array['interest', 'escrow', 'principal'],
  'a new company gets the three loan keys'
);

select throws_ok(
  $$update public.categories set loan_part = null
    where company_id = (select id from ko_ref where label = 'co') and loan_part = 'principal'$$,
  '42501',
  null,
  'the owner cannot change loan_part'
);

reset role;
update public.categories set name = 'Mortgage interest'
where company_id = (select id from ko_ref where label = 'co') and loan_part = 'interest';
select tests.authenticate_as('ko_owner');

select throws_ok(
  $$select public.set_category_excluded_from_pnl(
    (select id from public.categories
     where company_id = (select id from ko_ref where label = 'co') and name = 'Mortgage interest'),
    true
  )$$,
  'loan category is fixed',
  'a renamed loan category is still fixed'
);

select is(
  (select c->>'loan_part' from jsonb_array_elements(public.list_categories()) c
   where c->>'name' = 'Mortgage interest'),
  'interest',
  'list_categories returns loan_part'
);

-- A guessed default category never picks a loan category, even after a rename.
reset role;
update public.categories set hidden = true
where company_id = (select id from ko_ref where label = 'co')
  and kind = 'expense' and loan_part is null;
update public.categories set excluded_from_pnl = false, sort_order = 0
where company_id = (select id from ko_ref where label = 'co') and loan_part = 'principal';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description
)
values (
  (select id from ko_ref where label = 'co'),
  'expense', 'expense', 'project', 'posted', 'ILS',
  -10000, -10000, 10000, 0, 'source',
  '2026-06-03', null, 'manual', 'ko:guess', 'Uncategorised expense'
);

select is(
  (select category_id from public.transactions where idempotency_key = 'ko:guess'),
  null,
  'a renamed loan category is never the guessed default'
);

-- The loan split check matches the loan category by loan_part, not by name. Runs as the admin.
-- The interest category is now named 'Mortgage interest'; a new category takes its old Hebrew name.
insert into public.categories (company_id, name, kind, sort_order)
values ((select id from ko_ref where label = 'co'), 'ריבית משכנתא', 'expense', 50);
-- The guess test above put the principal category back in the P&L; the split needs it kept out.
update public.categories set excluded_from_pnl = true
where company_id = (select id from ko_ref where label = 'co') and loan_part = 'principal';

insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values ((select id from ko_ref where label = 'co'), 'Example mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'USD');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description, user_assigned
)
select (select id from ko_ref where label = 'co'), 'expense', 'expense', 'shared', 'posted', 'USD',
  -100000, -100000, 100000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', v.k, v.k, true
from (values ('ko:loan-key'), ('ko:loan-name')) v(k);


create function pg_temp.ko_split(p_ikey text, p_by text) returns void language sql as $f$
  insert into public.loan_splits (
    company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id
  )
  select t.company_id, l.id, t.id, v.part::public.loan_split_part, v.amount, v.amount,
    case
      when v.part = 'interest' and p_by = 'name' then
        (select k.id from public.categories k
         where k.company_id = t.company_id and k.name = 'ריבית משכנתא' and k.kind = 'expense')
      else
        (select k.id from public.categories k
         where k.company_id = t.company_id and k.loan_part = v.part::public.loan_split_part)
    end
  from public.transactions t
  join public.loans l on l.company_id = t.company_id
  cross join (values ('interest', 70000), ('escrow', 20000), ('principal', 10000)) v(part, amount)
  where t.idempotency_key = p_ikey;
  set constraints all immediate;
$f$;

select lives_ok(
  $$select pg_temp.ko_split('ko:loan-key', 'key')$$,
  'a split onto the renamed interest category passes the check'
);

-- Since 0128 any expense category in the P&L may hold interest, whatever its name.
select lives_ok(
  $$select pg_temp.ko_split('ko:loan-name', 'name')$$,
  'a category that only has the old Hebrew name may hold interest (0128)'
);
set constraints all deferred;

-- An owner who is also listed as a viewer of a demo company can set the flag on their own company.
select tests.authenticate_as('ko_demo');
select public.create_company('Example Demo Co', true);
reset role;
update public.companies set is_demo = true where name = 'Example Demo Co';
alter table public.company_viewers disable trigger company_viewers_guard;
insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('ko_owner'), (select id from public.companies where name = 'Example Demo Co');
alter table public.company_viewers enable trigger company_viewers_guard;

select tests.authenticate_as('ko_owner');
select lives_ok(
  $$select public.set_category_excluded_from_pnl(
    (select id from public.categories
     where company_id = (select id from ko_ref where label = 'co') and name = 'Repairs and upkeep'),
    true
  )$$,
  'an owner who is also a viewer is not refused'
);

select is(
  (select excluded_from_pnl from public.categories
   where company_id = (select id from ko_ref where label = 'co') and name = 'Repairs and upkeep'),
  true,
  'the flag changed on the owner''s company'
);

select throws_ok(
  $$select public.set_category_excluded_from_pnl(
    (select id from public.categories
     where company_id = (select id from public.companies where name = 'Example Demo Co') and name = 'חומרים'),
    true
  )$$,
  'category not found',
  'the demo company stays read-only for that user'
);

reset role;
select is(
  has_function_privilege('authenticated', 'private.pnl_name_key(text)', 'execute'),
  false,
  'pnl_name_key is not executable by authenticated'
);

select * from finish();
rollback;
