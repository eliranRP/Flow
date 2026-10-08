-- save_loan_split (the app's loan split write), the demand order checks under the loan lock
-- in the app and MCP, mcp_loan_payments for a viewer, and loan rates before the start
-- (FLOW-106 screens plan gaps 1 to 4, FLOW-136 item 3). Fixed dates. @example.com only.

begin;

select plan(27);

do $users$
begin
  perform tests.create_supabase_user('sls_owner', 'sls-owner@example.com');
  perform tests.create_supabase_user('sls_viewer', 'sls-viewer@example.com');
end
$users$;

create temp table sls (label text primary key, id uuid);
grant all on sls to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
set search_path = ''
as $$
  select id from pg_temp.sls where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

select tests.authenticate_as('sls_owner');
select public.create_company('Example Loan Split Co', true);
reset role;
insert into sls (label, id) select 'company', id from public.companies where name = 'Example Loan Split Co';
update public.companies set is_demo = true where id = pg_temp.id('company');
insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('sls_viewer'), pg_temp.id('company'));

select public.store_mcp_credential(
  tests.get_supabase_uid('sls_owner'), 'hash-sls-write-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into sls (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-sls-write-1';

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values (pg_temp.id('company'), 'Example bank fees', 'expense', 90, false, false);
insert into sls (label, id) select 'fees_cat', id from public.categories
where name = 'Example bank fees' and company_id = pg_temp.id('company');

-- 120,000.00 at 6 percent over 360 months, and a 0% demand loan, both from 2026-01-01.
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date,
  payment_minor, escrow_minor, currency, kind)
values
  (pg_temp.id('company'), 'Example Amortizing', 12000000, 60000, 360, '2026-01-01', 71946, 0, 'USD', 'amortizing'),
  (pg_temp.id('company'), 'Example Other', 12000000, 60000, 360, '2026-01-01', 71946, 0, 'USD', 'amortizing'),
  (pg_temp.id('company'), 'Example Demand', 100000, 0, null, '2026-01-01', null, 0, 'USD', 'demand');
insert into sls (label, id) select 'amort', id from public.loans where name = 'Example Amortizing';
insert into sls (label, id) select 'other', id from public.loans where name = 'Example Other';
insert into sls (label, id) select 'demand', id from public.loans where name = 'Example Demand';

insert into public.transactions (
  company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
select pg_temp.id('company'), 'expense', 'expense', 'posted', -v.minor, -v.minor, v.minor, 0, 'unknown',
  v.day, v.currency, 'manual', v.ikey, 'Example loan payment'
from (values
  ('sls:a1', '2026-02-01'::date, 71946::bigint, 'USD'),
  ('sls:ils', '2026-02-01'::date, 71946::bigint, 'ILS'),
  ('sls:d_early', '2025-12-31'::date, 10000::bigint, 'USD'),
  ('sls:d1', '2026-03-01'::date, 10000::bigint, 'USD'),
  ('sls:d2', '2026-04-01'::date, 10000::bigint, 'USD'),
  ('sls:d_between', '2026-03-15'::date, 10000::bigint, 'USD'),
  ('sls:d_mcp', '2026-03-20'::date, 10000::bigint, 'USD'),
  ('sls:big', '2026-02-01'::date, 20000000::bigint, 'USD')
) as v(ikey, day, minor, currency);
insert into sls (label, id) select replace(idempotency_key, 'sls:', 'txn_'), id
from public.transactions where idempotency_key like 'sls:%';

create or replace function pg_temp.parts(p_interest bigint, p_principal bigint, p_fees bigint default null, p_fees_cat uuid default null)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('part', 'interest', 'amount_minor', p_interest, 'scheduled_minor', p_interest),
    jsonb_build_object('part', 'escrow', 'amount_minor', 0, 'scheduled_minor', 0),
    jsonb_build_object('part', 'principal', 'amount_minor', p_principal, 'scheduled_minor', p_principal)
  ) || case when p_fees is null then '[]'::jsonb else jsonb_build_array(
    jsonb_build_object('part', 'fees', 'amount_minor', p_fees, 'scheduled_minor', 0)
      || case when p_fees_cat is null then '{}'::jsonb else jsonb_build_object('category_id', p_fees_cat) end
  ) end;
$$;
grant execute on function pg_temp.parts(bigint, bigint, bigint, uuid) to authenticated, service_role;

create or replace function pg_temp.rows(p_label text)
returns integer
language sql
set search_path = ''
as $$
  select count(*)::integer from public.loan_splits where transaction_id = pg_temp.id(p_label);
$$;
grant execute on function pg_temp.rows(text) to authenticated, service_role;

create or replace function pg_temp.mcp_attach(p_key text, p_line text, p_loan text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  result jsonb;
begin
  uid := tests.get_supabase_uid('sls_owner');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id('write'))::text,
    true
  );
  result := public.mcp_attach_loan_payment(p_key, pg_temp.id(p_line), pg_temp.id(p_loan), pg_temp.parts(0, 10000));
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.mcp_attach(text, text, text) to authenticated, service_role;

select tests.authenticate_as('sls_owner');

-- 1. Preview, attach, and replace in one call.
select is(
  public.save_loan_split(pg_temp.id('txn_a1'), pg_temp.id('amort'), pg_temp.parts(60000, 11946), true)->'parts'->2,
  jsonb_build_object('part', 'principal', 'amount_minor', 11946, 'scheduled_minor', 11946,
    'category_id', (select id from public.categories where company_id = pg_temp.id('company') and loan_part = 'principal')),
  'a preview lists the parts with the loan''s categories');
select is(pg_temp.rows('txn_a1'), 0, 'a preview writes nothing');
select is(
  public.save_loan_split(pg_temp.id('txn_a1'), pg_temp.id('amort'), pg_temp.parts(60000, 11946))->>'replaced',
  'false', 'a new split attaches');
select is(pg_temp.rows('txn_a1'), 3, 'with three parts');
select is(
  (select balance_minor from public.loan_balances where loan_id = pg_temp.id('amort')),
  12000000::bigint - 11946, 'the principal lowers the balance');
select is(
  public.save_loan_split(pg_temp.id('txn_a1'), pg_temp.id('amort'),
    pg_temp.parts(60000, 10946, 1000, pg_temp.id('fees_cat')))->>'replaced',
  'true', 'a split on the same loan is replaced, with a fees part');
select is(pg_temp.rows('txn_a1'), 4, 'the line now has four parts');
select is(
  (select category_id from public.loan_splits where transaction_id = pg_temp.id('txn_a1') and part = 'fees'),
  pg_temp.id('fees_cat'), 'fees go to the category the call names');
select is(
  public.save_loan_split(pg_temp.id('txn_a1'), pg_temp.id('amort'), pg_temp.parts(60000, 11946))->'balance_after_minor',
  to_jsonb(12000000 - 11946), 'replacing adds the line''s own principal back before the check');

-- 2. Refusals.
select throws_ok(
  format('select public.save_loan_split(%L, %L, %L)', pg_temp.id('txn_a1'), pg_temp.id('amort'), pg_temp.parts(60000, 1)),
  'invalid loan parts', 'parts that do not add up to the line are refused');
select is(pg_temp.rows('txn_a1'), 3, 'and the split is left as it was');
select throws_ok(
  format('select public.save_loan_split(%L, %L, %L)', pg_temp.id('txn_a1'), pg_temp.id('other'), pg_temp.parts(60000, 11946)),
  'loan already attached', 'a line attached to another loan is refused');
select throws_ok(
  format('select public.save_loan_split(%L, %L, %L)', pg_temp.id('txn_ils'), pg_temp.id('other'), pg_temp.parts(60000, 11946)),
  'loan currency mismatch', 'a line in another currency is refused');
select throws_ok(
  format('select public.save_loan_split(%L, %L, %L)', pg_temp.id('txn_big'), pg_temp.id('other'), pg_temp.parts(0, 20000000)),
  'loan balance exceeded', 'principal above the balance is refused');
select throws_ok(
  format('select public.save_loan_split(%L, %L, %L)', pg_temp.id('txn_a1'), pg_temp.id('amort'), pg_temp.parts(59000, 11946, 1000)),
  'fees category required', 'fees with no category on the call or the loan are refused');

-- 3. A demand loan's order, in the app and in MCP.
select throws_ok(
  format('select public.save_loan_split(%L, %L, %L)', pg_temp.id('txn_d_early'), pg_temp.id('demand'), pg_temp.parts(0, 10000)),
  'payment before the loan start', 'a demand payment before the loan start is refused');
select lives_ok(
  format('select public.save_loan_split(%L, %L, %L)', pg_temp.id('txn_d1'), pg_temp.id('demand'), pg_temp.parts(0, 10000)),
  'a demand payment attaches');
select lives_ok(
  format('select public.save_loan_split(%L, %L, %L)', pg_temp.id('txn_d2'), pg_temp.id('demand'), pg_temp.parts(0, 10000)),
  'and a later one');
select throws_ok(
  format('select public.save_loan_split(%L, %L, %L)', pg_temp.id('txn_d_between'), pg_temp.id('demand'), pg_temp.parts(0, 10000)),
  'a later payment is already attached', 'a new payment dated before one already attached is refused');
select lives_ok(
  format('select public.save_loan_split(%L, %L, %L)', pg_temp.id('txn_d1'), pg_temp.id('demand'), pg_temp.parts(100, 9900)),
  'correcting the earlier payment is allowed');
reset role;
select is(
  pg_temp.mcp_attach('sls-mcp-1', 'txn_d_mcp', 'demand')->'error'->>'message',
  'a later payment is already attached', 'MCP refuses the same order under the loan lock');

-- 4. A viewer reads the payments and cannot write.
select tests.authenticate_as('sls_viewer');
select is(jsonb_array_length(public.mcp_loan_payments(pg_temp.id('demand'))), 2, 'the viewer reads a loan''s payments');
select throws_ok(
  format('select public.save_loan_split(%L, %L, %L)', pg_temp.id('txn_d_mcp'), pg_temp.id('demand'), pg_temp.parts(0, 10000)),
  '42501', null, 'the viewer cannot save a split');

-- 5. Rates start on or after the loan.
select tests.authenticate_as('sls_owner');
select throws_ok(
  format($$insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm) values (%L, %L, '2025-12-31', 50000)$$,
    pg_temp.id('company'), pg_temp.id('amort')),
  '23514', 'rate before the loan start', 'a rate row before the loan start is refused');
select lives_ok(
  format($$insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm) values (%L, %L, '2026-06-01', 50000)$$,
    pg_temp.id('company'), pg_temp.id('amort')),
  'a rate row after the start is stored');
select throws_ok(
  format($$update public.loans set start_date = '2026-07-01' where id = %L$$, pg_temp.id('amort')),
  '23514', 'rate before the loan start', 'moving the start after a rate row is refused');
select lives_ok(
  format($$update public.loans set start_date = '2026-05-01' where id = %L$$, pg_temp.id('amort')),
  'moving the start up to the rate row is allowed');

select * from finish();
rollback;
