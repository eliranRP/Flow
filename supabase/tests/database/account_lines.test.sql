-- FLOW-165 and FLOW-171: get_account_lines, one balance-sheet account's movements for the reports screen and the MCP
-- (get_account_lines), and get_breakdown_lines' p_project_id (one project's lines in a category). The
-- balance, the year's opening balance and the movements follow get_balance_sheet's rule and sign; another
-- company's account or project reads as unknown. FLOW-171: the period starts on p_from, or at the very start
-- (p_from_start). Invented data only; amounts are agorot and cents.

begin;

select plan(75);

do $users$
begin
  perform tests.create_supabase_user('al_owner', 'al-owner@example.com');
  perform tests.create_supabase_user('al_other', 'al-other@example.com');
  perform tests.create_supabase_user('al_viewer', 'al-viewer@example.com');
end
$users$;

create temp table al_ref (label text primary key, id uuid);
create temp table al_out (label text primary key, body jsonb);
grant all on al_ref, al_out to authenticated;

create function pg_temp.ref(l text) returns uuid
language sql stable
as $$ select id from al_ref where label = l $$;

create function pg_temp.out_of(l text) returns jsonb
language sql stable
as $$ select body from al_out where label = l $$;

-- One currency's summary from a read's currencies[].
create function pg_temp.cur(p jsonb, c text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p -> 'currencies') x where x ->> 'currency' = c $$;

-- The rows' descriptions in order.
create function pg_temp.descs(p jsonb) returns text[]
language sql immutable
as $$ select coalesce(array_agg(x ->> 'description' order by n), '{}') from jsonb_array_elements(p -> 'rows') with ordinality r(x, n) $$;

grant execute on function pg_temp.ref(text), pg_temp.out_of(text), pg_temp.cur(jsonb, text), pg_temp.descs(jsonb) to authenticated;

select tests.authenticate_as('al_owner');
select public.create_company('Example Ledger LLC', true);
select public.upsert_project(null, 'Site Alpha', null, 'active');
select public.upsert_project(null, 'Site Beta', null, 'active');
insert into al_ref (label, id) select 'co', id from public.companies where name = 'Example Ledger LLC';
insert into al_ref (label, id) select 'alpha', id from public.projects where name = 'Site Alpha';
insert into al_ref (label, id) select 'beta', id from public.projects where name = 'Site Beta';

select tests.authenticate_as('al_other');
select public.create_company('Other Ledger Co', true);
select public.upsert_project(null, 'Other Site', null, 'active');
insert into al_ref (label, id) select 'other_co', id from public.companies where name = 'Other Ledger Co';
insert into al_ref (label, id) select 'other_site', id from public.projects where name = 'Other Site';

reset role;

insert into al_ref (label, id)
select 'principal_acct', id from public.accounts where company_id = pg_temp.ref('co') and category_id is null and name = 'Loan principal';
insert into al_ref (label, id)
select 'bank_acct', id from public.accounts where company_id = pg_temp.ref('co') and category_id is null and name = 'Bank/Clearing';
insert into al_ref (label, id)
select 'other_principal', id from public.accounts where company_id = pg_temp.ref('other_co') and category_id is null and name = 'Loan principal';
insert into al_ref (label, id)
select 'principal_cat', id from public.categories where company_id = pg_temp.ref('co') and loan_part = 'principal' order by name limit 1;
insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values (pg_temp.ref('co'), 'Example repairs', 'expense', 61, false, false);
insert into al_ref (label, id) select 'repairs', id from public.categories where company_id = pg_temp.ref('co') and name = 'Example repairs';
insert into al_ref (label, id)
select 'repairs_acct', id from public.accounts where company_id = pg_temp.ref('co') and category_id = pg_temp.ref('repairs');
insert into public.suppliers (company_id, name) values (pg_temp.ref('co'), 'Example Lender');
insert into al_ref (label, id) select 'lender', id from public.suppliers where company_id = pg_temp.ref('co') and name = 'Example Lender';
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, start_date, escrow_minor, currency, term_months, payment_minor)
values (pg_temp.ref('co'), 'Example loan', 15400000, 60000, '2025-03-01', 0, 'ILS', 360, 135000);
insert into al_ref (label, id) select 'loan', id from public.loans where company_id = pg_temp.ref('co') and name = 'Example loan';

-- The loan comes in (2025, Alpha) and is paid down in 2026: three principal payments on Alpha and one on
-- Beta, a removed one and a pending one (neither is on the books), one after the read's date, and a USD one.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, supplier_id, description, user_assigned, removed_at
)
select
  pg_temp.ref('co'), v.direction::public.txn_direction, v.doc_kind::public.doc_kind, 'project'::public.pnl_role,
  v.status::public.line_status, v.cur,
  v.amount, v.amount, abs(v.amount), 0, 'source',
  v.d::date, v.d::date, 'manual', 'al:' || v.ikey, pg_temp.ref(v.proj), pg_temp.ref(v.cat), pg_temp.ref('lender'), v.ikey, true,
  case when v.removed then now() end
from (values
  ('income',  'invoice_receipt', 'ILS', 15400000, '2025-03-01', 'alpha', 'principal_cat', 'posted',  false, 'loan-in'),
  ('expense', 'expense',         'ILS',   -40000, '2026-01-10', 'alpha', 'principal_cat', 'posted',  false, 'pay-jan'),
  ('expense', 'expense',         'ILS',   -40000, '2026-02-10', 'alpha', 'principal_cat', 'posted',  false, 'pay-feb'),
  ('expense', 'expense',         'ILS',   -40000, '2026-03-10', 'beta',  'principal_cat', 'posted',  false, 'pay-mar'),
  ('expense', 'expense',         'ILS',   -40000, '2026-04-10', 'alpha', 'principal_cat', 'posted',  true,  'pay-removed'),
  ('expense', 'expense',         'ILS',   -40000, '2026-04-12', 'alpha', 'principal_cat', 'pending', false, 'pay-pending'),
  ('expense', 'expense',         'ILS',   -40000, '2026-11-10', 'alpha', 'principal_cat', 'posted',  false, 'pay-nov'),
  ('expense', 'expense',         'USD',   -10000, '2026-05-10', 'alpha', 'principal_cat', 'posted',  false, 'pay-usd'),
  ('expense', 'expense',         'ILS',   -25000, '2026-06-01', 'alpha', 'repairs',       'posted',  false, 'repair')
) as v(direction, doc_kind, cur, amount, d, proj, cat, status, removed, ikey);
insert into al_ref (label, id) select 'pay_jan', id from public.transactions where idempotency_key = 'al:pay-jan';

-- The January payment's principal leg is the loan's part.
update public.legs set loan_id = pg_temp.ref('loan'), part = 'principal', scheduled_minor = 40000
where transaction_id = pg_temp.ref('pay_jan') and account_id = pg_temp.ref('principal_acct');

-- A shared repair, 60/40 between Alpha and Beta, for get_breakdown_lines by project.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, cash_date, source, idempotency_key, category_id, description, user_assigned
) values (pg_temp.ref('co'), 'expense', 'expense', 'shared', 'posted', 'ILS', -10000, -10000, 10000, 0, 'source',
  '2026-06-05', '2026-06-05', 'manual', 'al:shared', pg_temp.ref('repairs'), 'shared-repair', true);
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, pg_temp.ref(s.proj), s.bp, t.amount_net * s.bp / 10000
from public.transactions t
join (values ('alpha', 6000), ('beta', 4000)) as s(proj, bp) on true
where t.idempotency_key = 'al:shared';

-- The reads, as the owner.
select tests.authenticate_as('al_owner');
insert into al_out values
  ('loan',      public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15')),
  ('loan_ils',  public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', null, 'ILS')),
  ('page1',     public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', null, 'ILS', 2, 0)),
  ('page2',     public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', null, 'ILS', 2, 2)),
  ('feb',       public.get_account_lines(pg_temp.ref('principal_acct'), '2026-02-15', null, 'ILS')),
  ('y2025',     public.get_account_lines(pg_temp.ref('principal_acct'), '2025-12-31', null, 'ILS')),
  ('beta',      public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', pg_temp.ref('beta'), 'ILS')),
  ('alpha',     public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', pg_temp.ref('alpha'), 'ILS')),
  ('bank',      public.get_account_lines(pg_temp.ref('bank_acct'), '2026-10-15', null, 'ILS')),
  ('sheet',     public.mcp_balance_sheet('2026-10-15')),
  ('sheet_b',   public.mcp_balance_sheet('2026-10-15', pg_temp.ref('beta'))),
  ('bd_alpha',  public.get_breakdown_lines('expense', 'category', pg_temp.ref('repairs')::text, 'ILS', '2026-06-01', '2026-06-30', 'cash', false, 40, 0, pg_temp.ref('alpha'))),
  ('bd_beta',   public.get_breakdown_lines('expense', 'category', pg_temp.ref('repairs')::text, 'ILS', '2026-06-01', '2026-06-30', 'cash', false, 40, 0, pg_temp.ref('beta'))),
  ('bd_all',    public.get_breakdown_lines('expense', 'category', pg_temp.ref('repairs')::text, 'ILS', '2026-06-01', '2026-06-30', 'cash')),
  ('bd_parent', public.get_breakdown_lines('expense', 'parent', pg_temp.ref('repairs')::text, 'ILS', '2026-06-01', '2026-06-30', 'cash', false, 40, 0, pg_temp.ref('alpha'))),
  ('bd_page',   public.get_breakdown_lines('expense', 'category', pg_temp.ref('repairs')::text, 'ILS', '2026-06-01', '2026-06-30', 'cash', false, 1, 0, pg_temp.ref('alpha'))),
  ('bd_kept',   public.get_breakdown_lines('expense', 'category', null, 'ILS', '2026-01-01', '2026-06-30', 'cash', true, 40, 0, pg_temp.ref('beta'))),
  ('pnl_alpha', public.get_pnl_statement('2026-06-01', '2026-06-30', pg_temp.ref('alpha'), false, 'cash'));

-- FLOW-171: from the very start, and from a custom date.
insert into al_out values
  ('start',      public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', null, 'ILS', 50, 0, null, true)),
  ('start_page', public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', null, 'ILS', 2, 2, null, true)),
  ('from_feb',   public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', null, 'ILS', 50, 0, '2026-02-01')),
  ('from_day',   public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', null, 'ILS', 50, 0, '2026-10-15')),
  ('start_beta', public.get_account_lines(p_account_id => pg_temp.ref('principal_acct'), p_as_of => '2026-10-15',
                   p_project_id => pg_temp.ref('beta'), p_currency => 'ILS', p_from_start => true));

-- 1. The loan's principal: a liability shown positive, its year's opening, its movements, by currency.
select is(pg_temp.out_of('loan') ->> 'type', 'liability', 'the account is a liability');
select is(pg_temp.out_of('loan') ->> 'name', 'Loan principal', 'the account names itself');
select is(pg_temp.out_of('loan') ->> 'from', '2026-01-01', 'with no start the period starts on 1 January of as_of''s year');
select is(pg_temp.out_of('loan') ->> 'from_start', 'false', 'and it is not from the start');
select is((pg_temp.cur(pg_temp.out_of('loan'), 'ILS') ->> 'opening_minor')::bigint, 15400000::bigint, 'the opening balance is what was owed on 1 January, positive');
select is((pg_temp.cur(pg_temp.out_of('loan'), 'ILS') ->> 'balance_minor')::bigint, 15280000::bigint, 'the balance is after the year''s three payments, not the removed, pending or later one');
select is((pg_temp.cur(pg_temp.out_of('loan'), 'ILS') ->> 'movement_minor')::bigint, -120000::bigint, 'the year''s movement is the balance less the opening');
select is((pg_temp.cur(pg_temp.out_of('loan'), 'ILS') ->> 'count')::integer, 3, 'three movements this year in ILS');
select is((pg_temp.cur(pg_temp.out_of('loan'), 'USD') ->> 'balance_minor')::bigint, -10000::bigint, 'a USD payment is its own currency');
select is(jsonb_array_length(pg_temp.out_of('loan') -> 'rows'), 4, 'without a currency every currency''s movements are listed');
select is(
  (select (c ->> 'balance_minor')::bigint from jsonb_array_elements(pg_temp.out_of('sheet') -> 'currencies') x,
     jsonb_array_elements(x -> 'liabilities' -> 'accounts') c
   where x ->> 'currency' = 'ILS' and c ->> 'account_id' = pg_temp.ref('principal_acct')::text),
  (pg_temp.cur(pg_temp.out_of('loan'), 'ILS') ->> 'balance_minor')::bigint,
  'the balance is the balance sheet''s for the account');

-- 2. The rows: newest first, one per line, signed as the balance sheet shows them.
select is(pg_temp.descs(pg_temp.out_of('loan_ils')), array['pay-mar', 'pay-feb', 'pay-jan'], 'the ILS movements, newest first');
select is((pg_temp.out_of('loan_ils') -> 'rows' -> 0 ->> 'amount_minor')::bigint, -40000::bigint, 'a principal payment lowers the liability');
select is(pg_temp.out_of('loan_ils') -> 'rows' -> 0 ->> 'party_name', 'Example Lender', 'a row names its party');
select is(pg_temp.out_of('loan_ils') -> 'rows' -> 0 ->> 'project_name', 'Site Beta', 'a row names its project');
select is(pg_temp.out_of('loan_ils') -> 'rows' -> 0 ->> 'doc_date', '2026-03-10', 'a row has its date');
select is((pg_temp.out_of('loan_ils') -> 'rows' -> 0 ->> 'line_amount_minor')::bigint, -40000::bigint, 'a row has its line''s whole amount');
select is(pg_temp.out_of('loan_ils') -> 'rows' -> 2 ->> 'loan_id', pg_temp.ref('loan')::text, 'a loan part names its loan');
select is(pg_temp.out_of('loan_ils') -> 'loan_ids', jsonb_build_array(pg_temp.ref('loan')), 'the account lists the loans whose parts post to it');
select is(pg_temp.out_of('loan_ils') ->> 'has_more', 'false', 'one page holds them');

-- 3. Paging.
select is(pg_temp.descs(pg_temp.out_of('page1')), array['pay-mar', 'pay-feb'], 'the first page');
select is(pg_temp.out_of('page1') ->> 'has_more', 'true', 'the first page says there is more');
select is(pg_temp.descs(pg_temp.out_of('page2')), array['pay-jan'], 'the second page');
select is(pg_temp.out_of('page2') ->> 'has_more', 'false', 'the last page says so');
select is((pg_temp.cur(pg_temp.out_of('page2'), 'ILS') ->> 'count')::integer, 3, 'every page carries the year''s count');

-- 4. The date: up to as_of; an earlier year's own opening.
select is((pg_temp.cur(pg_temp.out_of('feb'), 'ILS') ->> 'balance_minor')::bigint, 15320000::bigint, 'the balance on 15 February');
select is(pg_temp.descs(pg_temp.out_of('feb')), array['pay-feb', 'pay-jan'], 'the movements up to 15 February');
select is((pg_temp.cur(pg_temp.out_of('y2025'), 'ILS') ->> 'opening_minor')::bigint, 0::bigint, '2025 opens at zero');
select is(pg_temp.descs(pg_temp.out_of('y2025')), array['loan-in'], 'the loan came in in 2025');

-- 5. One project: its legs only, and the balance sheet's figure for it.
select is(pg_temp.descs(pg_temp.out_of('beta')), array['pay-mar'], 'Beta''s movements only');
select is((pg_temp.cur(pg_temp.out_of('beta'), 'ILS') ->> 'balance_minor')::bigint, -40000::bigint, 'Beta has paid the loan down and owes none of it');
select is(
  (select (c ->> 'balance_minor')::bigint from jsonb_array_elements(pg_temp.out_of('sheet_b') -> 'currencies') x,
     jsonb_array_elements(x -> 'liabilities' -> 'accounts') c
   where x ->> 'currency' = 'ILS' and c ->> 'account_id' = pg_temp.ref('principal_acct')::text),
  -40000::bigint, 'the balance sheet for Beta agrees');
select is(pg_temp.out_of('beta') ->> 'project_name', 'Site Beta', 'the read names its project');
select is((pg_temp.cur(pg_temp.out_of('alpha'), 'ILS') ->> 'opening_minor')::bigint, 15400000::bigint, 'Alpha''s opening holds the loan');

-- 6. An asset reads its debit positive: the bank holds the loan less what went out.
select is((pg_temp.cur(pg_temp.out_of('bank'), 'ILS') ->> 'balance_minor')::bigint, 15400000::bigint - 120000 - 25000 - 10000,
  'the bank account''s balance, debit positive');

-- 7. get_breakdown_lines by project: a shared cost as the project's allocation, the project's own lines.
select is(pg_temp.descs(pg_temp.out_of('bd_alpha')), array['shared-repair', 'repair'], 'Alpha''s repairs: its share of the shared one and its own');
select is(
  (select sum((x ->> 'amount_minor')::bigint)::bigint from jsonb_array_elements(pg_temp.out_of('bd_alpha') -> 'rows') x),
  (select (n ->> 'amount_minor')::bigint from jsonb_array_elements(pg_temp.out_of('pnl_alpha') -> 'currencies' -> 0 -> 'expense') n
   where n ->> 'id' = pg_temp.ref('repairs')::text),
  'Alpha''s lines add up to the project statement''s category');
select is(pg_temp.descs(pg_temp.out_of('bd_beta')), array['shared-repair'], 'Beta has only its share');
select is(pg_temp.descs(pg_temp.out_of('bd_all')), array['shared-repair', 'repair'], 'without a project the category reads as before');
select is(pg_temp.descs(pg_temp.out_of('bd_parent')), array['shared-repair', 'repair'], 'by parent the project''s lines too');
select is(pg_temp.out_of('bd_page') ->> 'has_more', 'true', 'one project''s lines page');
select is(pg_temp.descs(pg_temp.out_of('bd_kept')), array['pay-mar'], 'the kept-out lines of one project');

select is((pg_temp.out_of('bd_page') ->> 'total_minor')::bigint, (select sum((x ->> 'amount_minor')::bigint)::bigint from jsonb_array_elements(pg_temp.out_of('bd_alpha') -> 'rows') x),
  'a page carries the whole group''s total');
select is((pg_temp.out_of('bd_page') ->> 'count')::integer, 2, 'and its row count');

-- 7b. Kept out by project: a line split over two kept-out categories stays two rows, each with its category.
reset role;
insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values (pg_temp.ref('co'), 'Example kept A', 'expense', 62, false, true), (pg_temp.ref('co'), 'Example kept B', 'expense', 63, false, true);
insert into al_ref (label, id) select 'kept_a', id from public.categories where company_id = pg_temp.ref('co') and name = 'Example kept A';
insert into al_ref (label, id) select 'kept_b', id from public.categories where company_id = pg_temp.ref('co') and name = 'Example kept B';
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
) values (pg_temp.ref('co'), 'expense', 'expense', 'project', 'posted', 'ILS', -10000, -10000, 10000, 0, 'source',
  '2026-07-05', '2026-07-05', 'manual', 'al:kept-split', pg_temp.ref('beta'), pg_temp.ref('kept_a'), 'kept-split', true);
insert into al_ref (label, id) select 'kept_split', id from public.transactions where idempotency_key = 'al:kept-split';
select private.set_line_parts(pg_temp.ref('co'), pg_temp.ref('kept_split'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.ref('kept_a'), 'amount_minor', 6000),
  jsonb_build_object('category_id', pg_temp.ref('kept_b'), 'amount_minor', 4000)));
select tests.authenticate_as('al_owner');
select is(
  (select array_agg(x ->> 'category_id' order by (x ->> 'amount_minor')::bigint desc)
   from jsonb_array_elements(public.get_breakdown_lines('expense', 'category', null, 'ILS', '2026-07-01', '2026-07-31', 'cash', true, 40, 0, pg_temp.ref('beta')) -> 'rows') x),
  array[pg_temp.ref('kept_a')::text, pg_temp.ref('kept_b')::text],
  'one project''s kept-out split parts stay apart, each with its category');

-- 7c. A draft leg is not on the books; a line's several legs on the account are one movement.
reset role;
insert into public.legs (company_id, transaction_id, account_id, amount_minor, ordinal, leg_kind, split_part, part_ordinal, draft)
select pg_temp.ref('co'), t.id, pg_temp.ref('principal_acct'), 99900, 40, 'item', true, 1, true
from public.transactions t where t.idempotency_key = 'al:pay-feb';
insert into public.legs (company_id, transaction_id, account_id, amount_minor, ordinal, leg_kind)
select pg_temp.ref('co'), t.id, v.acct, v.amount, v.ord, 'journal'
from public.transactions t,
  (values (pg_temp.ref('principal_acct'), 10000::bigint, 41::smallint), (pg_temp.ref('principal_acct'), 5000::bigint, 42::smallint),
          (pg_temp.ref('bank_acct'), -15000::bigint, 43::smallint)) as v(acct, amount, ord)
where t.idempotency_key = 'al:repair';
select tests.authenticate_as('al_owner');
insert into al_out values ('after', public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', null, 'ILS'));
select is((pg_temp.cur(pg_temp.out_of('after'), 'ILS') ->> 'balance_minor')::bigint, 15280000::bigint - 15000,
  'the draft leg is left out; the two legs of one line both count');
select is(pg_temp.descs(pg_temp.out_of('after')), array['repair', 'pay-mar', 'pay-feb', 'pay-jan'], 'one row per line');
select is((pg_temp.out_of('after') -> 'rows' -> 0 ->> 'amount_minor')::bigint, -15000::bigint, 'its legs on the account summed');
select is((pg_temp.cur(pg_temp.out_of('after'), 'ILS') ->> 'count')::integer, 4, 'the count is per line');

-- 4b. FLOW-171: from the very start: no opening, every movement since the account's first leg.
select is(pg_temp.out_of('start') ->> 'from_start', 'true', 'from the start says so');
select is(pg_temp.out_of('start') ->> 'from', null, 'from the start has no first day');
-- The app before FLOW-171 requires year_start: it stays for one release, 1 January of as_of's year.
select is(pg_temp.out_of('loan') ->> 'year_start', '2026-01-01', 'year_start stays for the app before FLOW-171');
select is(pg_temp.out_of('start') ->> 'year_start', '2026-01-01', 'and from the start too, so that app still parses it');
select is((pg_temp.cur(pg_temp.out_of('start'), 'ILS') ->> 'opening_minor')::bigint, 0::bigint, 'from the start opens at zero');
select is((pg_temp.cur(pg_temp.out_of('start'), 'ILS') ->> 'balance_minor')::bigint, 15280000::bigint, 'the balance is the same as the year''s');
select is((pg_temp.cur(pg_temp.out_of('start'), 'ILS') ->> 'movement_minor')::bigint, 15280000::bigint, 'the change since the start is the balance');
select is((pg_temp.cur(pg_temp.out_of('start'), 'ILS') ->> 'count')::integer, 4, 'four movements since the start');
select is(pg_temp.descs(pg_temp.out_of('start')), array['pay-mar', 'pay-feb', 'pay-jan', 'loan-in'], 'the 2025 movement is listed after this year''s');
select is(pg_temp.descs(pg_temp.out_of('start_page')), array['pay-jan', 'loan-in'], 'from the start pages in the same order');
select is(pg_temp.out_of('start_page') ->> 'has_more', 'false', 'its last page says so');
select is(pg_temp.descs(pg_temp.out_of('start_beta')), array['pay-mar'], 'from the start for one project, its legs only');

-- 4c. FLOW-171: from a custom date: the opening is the balance before it.
select is(pg_temp.out_of('from_feb') ->> 'from', '2026-02-01', 'the period starts on p_from');
select is((pg_temp.cur(pg_temp.out_of('from_feb'), 'ILS') ->> 'opening_minor')::bigint, 15360000::bigint, 'the opening is the balance before 1 February');
select is((pg_temp.cur(pg_temp.out_of('from_feb'), 'ILS') ->> 'movement_minor')::bigint, -80000::bigint, 'the change from 1 February');
select is(pg_temp.descs(pg_temp.out_of('from_feb')), array['pay-mar', 'pay-feb'], 'the movements from 1 February');
select is((pg_temp.cur(pg_temp.out_of('from_feb'), 'ILS') ->> 'count')::integer, 2, 'two movements from 1 February');
select is(jsonb_array_length(pg_temp.out_of('from_day') -> 'rows'), 0, 'a start on as_of itself is allowed');
select throws_ok($$ select public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', null, 'ILS', 50, 0, '2026-10-16') $$,
  'P0001', 'validation', 'a start after as_of is refused');
select throws_ok($$ select public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', null, 'ILS', 50, 0, '2026-02-01', true) $$,
  'P0001', 'validation', 'a start date and from the start together are refused');

-- 8. Another company's account or project, an unknown account and a P&L account read as unknown; a bad
-- currency and a project by payer are refused.
select tests.authenticate_as('al_other');
select ok(
  public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15') is null
  and public.get_account_lines(pg_temp.ref('other_principal'), '2026-10-15', pg_temp.ref('alpha')) is null
  and public.get_account_lines(gen_random_uuid()) is null
  and public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', null, null, 50, 0, null, true) is null
  and public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', null, null, 50, 0, '2026-11-01') is null
  and public.get_breakdown_lines('expense', 'category', pg_temp.ref('repairs')::text, 'ILS', null, null, 'cash', false, 40, 0, pg_temp.ref('alpha')) is null
  and public.get_breakdown_lines('nope', 'payer', 'x', 'ILS', null, null, 'cash', false, 40, 0, pg_temp.ref('alpha')) is null,
  'another company''s account or project, or an unknown account, is null, before any other check');
select tests.authenticate_as('al_owner');
select ok(public.get_account_lines(pg_temp.ref('repairs_acct')) is null, 'a P&L account has no balance-sheet movements');
select throws_ok($$ select public.get_account_lines(pg_temp.ref('principal_acct'), null, null, 'usd') $$, 'P0001', 'validation', 'a currency is three capitals');
select throws_ok($$ select public.get_breakdown_lines('expense', 'payer', 'none', 'ILS', null, null, 'cash', false, 40, 0, pg_temp.ref('alpha')) $$,
  'P0001', 'validation', 'a project goes with a category or a parent only');

-- 9. FLOW-171: a viewer of the company reads the account from the start too.
reset role;
insert into public.company_members (company_id, user_id, role) values (pg_temp.ref('co'), tests.get_supabase_uid('al_viewer'), 'viewer');
select tests.authenticate_as('al_viewer');
select is(
  (pg_temp.cur(public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', null, 'ILS', 50, 0, null, true), 'ILS') ->> 'count')::integer,
  5, 'a viewer reads every movement since the start (the repair''s legs included)');
select is(
  (pg_temp.cur(public.get_account_lines(pg_temp.ref('principal_acct'), '2026-10-15', null, 'ILS', 50, 0, '2026-02-01'), 'ILS') ->> 'opening_minor')::bigint,
  15360000::bigint, 'and from a custom date');

select * from finish();
rollback;
