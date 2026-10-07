-- FLOW-121. A guessed kept-out category counts until confirmed (company_pnl, get_project,
-- get_transaction, set_transaction_pnl), a guessed loan category stays fixed, and get_project
-- lists kept-out project income on both bases. Invented data only. Amounts are agorot.

begin;

select plan(24);

do $users$
begin
  perform tests.create_supabase_user('kog_owner', 'kog-owner@example.com');
  perform tests.create_supabase_user('kog_other', 'kog-other@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('kog_owner'), 'Example Guess LLC', false),
  (tests.get_supabase_uid('kog_other'), 'Example Across LLC', false);

create temp table kog (label text primary key, id uuid);
grant all on kog to authenticated, service_role;
insert into kog (label, id) select 'co', id from public.companies where name = 'Example Guess LLC';
insert into kog (label, id) select 'other_co', id from public.companies where name = 'Example Across LLC';

insert into public.projects (company_id, name, status)
values
  ((select id from kog where label = 'co'), 'North', 'active'),
  ((select id from kog where label = 'other_co'), 'Far', 'active');
insert into kog (label, id) select 'north', id from public.projects where name = 'North';
insert into kog (label, id) select 'far', id from public.projects where name = 'Far';

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values
  ((select id from kog where label = 'co'), 'Rent in', 'income', 90, false, false),
  ((select id from kog where label = 'co'), 'Owner money in', 'income', 91, false, true),
  ((select id from kog where label = 'co'), 'Held deposits', 'expense', 92, false, true),
  ((select id from kog where label = 'other_co'), 'Owner money in', 'income', 91, false, true);
insert into kog (label, id) select 'cat_rent_in', id from public.categories
where name = 'Rent in' and company_id = (select id from kog where label = 'co');
insert into kog (label, id) select 'cat_owner_in', id from public.categories
where name = 'Owner money in' and company_id = (select id from kog where label = 'co');
insert into kog (label, id) select 'cat_owner_in_far', id from public.categories
where name = 'Owner money in' and company_id = (select id from kog where label = 'other_co');
insert into kog (label, id) select 'cat_held', id from public.categories
where name = 'Held deposits' and company_id = (select id from kog where label = 'co');
insert into kog (label, id)
select 'cat_principal', id from public.categories
where company_id = (select id from kog where label = 'co') and loan_part = 'principal';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description
)
select
  (select id from kog where label = v.co),
  v.direction::public.txn_direction, v.doc_kind::public.doc_kind, v.pnl_role::public.pnl_role,
  'posted', v.currency, v.amount, v.amount, abs(v.amount), 0, 'source',
  '2026-06-10', '2026-06-10', 'manual', v.ikey,
  (select id from kog where label = v.project),
  (select id from kog where label = v.cat),
  v.ikey
from (values
  ('co',       'income',  'receipt', null,      'ILS', 100000, 'kog:rent',      'cat_rent_in',      'north'),
  ('co',       'income',  'receipt', null,      'ILS',  50000, 'kog:owner',     'cat_owner_in',     'north'),
  ('co',       'income',  'invoice', null,      'ILS',   7000, 'kog:owner_inv', 'cat_owner_in',     'north'),
  ('co',       'income',  'receipt', null,      'USD',   3000, 'kog:owner_usd', 'cat_owner_in',     'north'),
  ('co',       'expense', 'expense', 'project', 'ILS', -10000, 'kog:guess',     'cat_held',         'north'),
  ('co',       'expense', 'expense', 'project', 'ILS', -20000, 'kog:held',      'cat_held',         'north'),
  ('co',       'expense', 'expense', 'project', 'ILS', -30000, 'kog:loan',      'cat_principal',    'north'),
  ('other_co', 'income',  'receipt', null,      'ILS',  90000, 'kog:far',       'cat_owner_in_far', 'far')
) as v(co, direction, doc_kind, pnl_role, currency, amount, ikey, cat, project);
insert into kog (label, id) select replace(idempotency_key, 'kog:', 'txn_'), id
from public.transactions where idempotency_key like 'kog:%';

-- Two lines carry a guessed category: a kept-out one and the loan principal.
update public.transactions
set category_suggested = true
where id in (select id from kog where label in ('txn_guess', 'txn_loan'));

create or replace function pg_temp.pnl(p_basis text, p_key text)
returns bigint
language sql
as $$
  select (public.company_pnl(
    (select id from pg_temp.kog where label = 'co'), '2026-06-01', '2026-06-30', p_basis
  )->>p_key)::bigint;
$$;
grant execute on function pg_temp.pnl(text, text) to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.kog where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

select is(
  (select count(*)::integer from public.transactions
   where id in (pg_temp.id('txn_guess'), pg_temp.id('txn_loan')) and category_suggested),
  2,
  'setup: the guess and the loan line are suggestions'
);

select tests.authenticate_as('kog_owner');

-- (a) The guessed kept-out line counts; the confirmed one and the loan principal stay out.
select is(pg_temp.pnl('cash', 'direct_agorot'), 10000::bigint, 'cash: a guessed kept-out cost counts as direct cost');
select is(pg_temp.pnl('cash', 'excluded_expense_agorot'), 50000::bigint, 'cash: kept out are the confirmed line and the guessed principal');
select is(pg_temp.pnl('invoiced', 'direct_agorot'), 10000::bigint, 'invoiced: a guessed kept-out cost counts as direct cost');
select is(pg_temp.pnl('invoiced', 'excluded_expense_agorot'), 50000::bigint, 'invoiced: same kept-out cost');
select is(
  (public.get_project(pg_temp.id('north'), 'cash')->>'direct_agorot')::bigint, 10000::bigint,
  'get_project: the guessed line is in the project''s direct cost'
);

select is(
  (public.get_transaction(pg_temp.id('txn_guess'))->>'in_pnl')::boolean, true,
  'get_transaction: a guessed kept-out category is in the P&L'
);
select is(
  (public.get_transaction(pg_temp.id('txn_guess'))->>'category_suggested')::boolean, true,
  'get_transaction: returns the guess flag'
);
select is(
  (public.get_transaction(pg_temp.id('txn_guess'))->>'category_excluded_from_pnl')::boolean, true,
  'get_transaction: the category flag itself is unchanged'
);
select is(
  (public.get_transaction(pg_temp.id('txn_loan'))->>'in_pnl')::boolean, false,
  'get_transaction: a guessed loan principal stays out'
);

-- The line's own override still wins over the guess, and null follows the guess again.
select is(
  (public.set_transaction_pnl(pg_temp.id('txn_guess'), false)->>'in_pnl')::boolean, false,
  'set_transaction_pnl false takes the guessed line out'
);
select is(pg_temp.pnl('cash', 'excluded_expense_agorot'), 60000::bigint, 'the override moves it to the kept-out total');
select is(
  (public.set_transaction_pnl(pg_temp.id('txn_guess'), null)->>'in_pnl')::boolean, true,
  'set_transaction_pnl null: the guessed line counts again'
);

-- Confirming the guess takes the line out.
reset role;
update public.transactions set category_suggested = false where id = pg_temp.id('txn_guess');
select tests.authenticate_as('kog_owner');
select is(pg_temp.pnl('cash', 'direct_agorot'), 0::bigint, 'confirmed: the line leaves direct cost');
select is(pg_temp.pnl('cash', 'excluded_expense_agorot'), 60000::bigint, 'confirmed: the line is kept out');
select is(
  (public.get_transaction(pg_temp.id('txn_guess'))->>'in_pnl')::boolean, false,
  'confirmed: get_transaction says out'
);

-- (b) Kept-out project income, by basis.
select is(
  (public.get_project(pg_temp.id('north'), 'cash')->>'income_agorot')::bigint, 100000::bigint,
  'get_project cash income leaves the kept-out income out'
);
select is(
  public.get_project(pg_temp.id('north'), 'cash')->'excluded_income_by_currency',
  jsonb_build_array(
    jsonb_build_object('currency', 'ILS', 'id', pg_temp.id('cat_owner_in'), 'name', 'Owner money in', 'amount_minor', 50000, 'count', 1),
    jsonb_build_object('currency', 'USD', 'id', pg_temp.id('cat_owner_in'), 'name', 'Owner money in', 'amount_minor', 3000, 'count', 1)
  ),
  'cash: kept-out income is listed per currency (receipts only)'
);
select is(
  public.get_project(pg_temp.id('north'), 'invoiced')->'excluded_income_by_currency',
  jsonb_build_array(
    jsonb_build_object('currency', 'ILS', 'id', pg_temp.id('cat_owner_in'), 'name', 'Owner money in', 'amount_minor', 7000, 'count', 1)
  ),
  'invoiced: kept-out income is the invoice only'
);

-- A line taken out by its own override is listed too; brought back, it leaves the list.
select lives_ok(
  format('select public.set_transaction_pnl(%L, false)', pg_temp.id('txn_rent')),
  'take the rent line out'
);
select is(
  (select sum((e->>'amount_minor')::bigint) from jsonb_array_elements(
    public.get_project(pg_temp.id('north'), 'cash')->'excluded_income_by_currency') e
   where e->>'currency' = 'ILS')::bigint,
  150000::bigint,
  'an income line taken out by its override is listed'
);
select lives_ok(
  format('select public.set_transaction_pnl(%L, null)', pg_temp.id('txn_rent')),
  'bring the rent line back'
);

-- Another company's project is not readable; that company still sees its own.
select is(
  public.get_project(pg_temp.id('far'), 'cash'), null,
  'cross-tenant: another company''s project reads as null'
);
select tests.authenticate_as('kog_other');
select is(
  public.get_project(pg_temp.id('far'), 'cash')->'excluded_income_by_currency'->0->>'amount_minor',
  '90000',
  'positive control: the other owner sees their own kept-out income'
);

select * from finish();
rollback;
