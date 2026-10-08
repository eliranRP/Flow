-- FLOW-106 part 3: a loan payment can carry a fees part (decision 0130).
-- A 4-part attach; the fees category (the call's, else the loan's, else refused; no
-- default); the category rule for fees (any expense category, in or out of the P&L);
-- fees at 0 or twice; the P&L; undo of a 4-part split; update_loan fees_category_id and
-- its undo; a fees category that flips freely; and list_loans.
-- Fixed dates. @example.com only.

begin;

select plan(47);

do $users$
begin
  perform tests.create_supabase_user('f106f_owner', 'owner106f@example.com');
  perform tests.create_supabase_user('f106f_other', 'other106f@example.com');
end
$users$;

create temp table f106f (label text primary key, id uuid);
grant all on f106f to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
set search_path = ''
as $$
  select id from pg_temp.f106f where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
begin
  uid := tests.get_supabase_uid('f106f_owner');
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id('write'))::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

create or replace function pg_temp.update_loan(p_key text, p_patch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_update_loan(p_key, pg_temp.id('loan'), p_patch);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.update_loan(text, jsonb) to authenticated, service_role;

create or replace function pg_temp.undo(p_key text, p_kind text, p_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_undo(p_key, p_kind, p_id);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.undo(text, text, uuid) to authenticated, service_role;

create or replace function pg_temp.attach(p_key text, p_line text, p_parts jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_attach_loan_payment(p_key, pg_temp.line(p_line), pg_temp.id('loan'), p_parts);
  reset role;
  return result;
end;
$$;

create or replace function pg_temp.listed()
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  select l into result
  from jsonb_array_elements(public.mcp_list_loans()) l
  where l->>'id' = pg_temp.id('loan')::text;
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.listed() to authenticated, service_role;

create or replace function pg_temp.line(p_key text)
returns uuid
language sql
set search_path = ''
as $$
  select t.id from public.transactions t where t.idempotency_key = p_key;
$$;
grant execute on function pg_temp.line(text) to authenticated, service_role;
grant execute on function pg_temp.attach(text, text, jsonb) to authenticated, service_role;

create or replace function pg_temp.part_category(p_key text, p_part text)
returns uuid
language sql
set search_path = ''
as $$
  select s.category_id
  from public.loan_splits s
  join public.transactions t on t.id = s.transaction_id
  where t.idempotency_key = p_key and s.part = p_part::public.loan_split_part;
$$;
grant execute on function pg_temp.part_category(text, text) to authenticated, service_role;

-- A posted 1,250.00 expense line on a fixed day.
create or replace function pg_temp.add_line(p_key text, p_day date, p_minor bigint)
returns void
language sql
set search_path = ''
as $$
  insert into public.transactions (
    company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
    vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
  )
  values (pg_temp.id('company'), 'expense', 'expense', 'posted', -p_minor, -p_minor, p_minor, 0, 'unknown',
    p_day, 'USD', 'manual', p_key, 'Example loan payment');
$$;

-- Interest 500.00, escrow 100.00, principal 400.00 and fees 250.00: 1,250.00.
create or replace function pg_temp.four_parts(p_fees bigint default 25000, p_category uuid default null)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('part', 'interest', 'amount_minor', 50000, 'scheduled_minor', 50000),
    jsonb_build_object('part', 'escrow', 'amount_minor', 10000, 'scheduled_minor', 10000),
    jsonb_build_object('part', 'principal', 'amount_minor', 65000 - p_fees, 'scheduled_minor', 40000),
    jsonb_build_object('part', 'fees', 'amount_minor', p_fees, 'scheduled_minor', p_fees)
      || case when p_category is null then '{}'::jsonb else jsonb_build_object('category_id', p_category) end
  );
$$;

select tests.authenticate_as('f106f_owner');
select public.create_company('Example Loan Fees Co', true);
reset role;
insert into f106f (label, id) select 'company', id from public.companies where name = 'Example Loan Fees Co';

insert into public.categories (company_id, name, kind, sort_order)
values
  (pg_temp.id('company'), 'Example closing costs', 'expense', 900),
  (pg_temp.id('company'), 'Example named fees', 'expense', 901),
  (pg_temp.id('company'), 'Example kept-out costs', 'expense', 902),
  (pg_temp.id('company'), 'Example call fees', 'expense', 903),
  (pg_temp.id('company'), 'Example partner interest', 'expense', 904);
update public.categories set excluded_from_pnl = true
where company_id = pg_temp.id('company') and name = 'Example kept-out costs';
insert into f106f (label, id)
select v.label, c.id
from public.categories c
join (values
  ('cat_fees', 'Example closing costs'),
  ('cat_named', 'Example named fees'),
  ('cat_out', 'Example kept-out costs'),
  ('cat_call', 'Example call fees'),
  ('cat_int', 'Example partner interest')
) v(label, name) on v.name = c.name
where c.company_id = pg_temp.id('company');
insert into f106f (label, id)
select 'keyed_' || c.loan_part::text, c.id
from public.categories c
where c.company_id = pg_temp.id('company') and c.loan_part is not null;
insert into f106f (label, id)
select 'income_cat', c.id from public.categories c
where c.company_id = pg_temp.id('company') and c.kind = 'income' order by c.sort_order limit 1;

select tests.authenticate_as('f106f_other');
select public.create_company('Example Other Fees Co', true);
reset role;
insert into f106f (label, id)
select 'other_cat', c.id
from public.categories c join public.companies co on co.id = c.company_id
where co.name = 'Example Other Fees Co' and c.kind = 'expense' and c.loan_part is null and not c.excluded_from_pnl
order by c.sort_order limit 1;

select public.store_mcp_credential(
  tests.get_supabase_uid('f106f_owner'), 'hash-f106f-write-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into f106f (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-f106f-write-1';

-- 100,000.00 at 6 percent over 360 months: 1,000.00 a month, 100.00 escrow, interest 500.00 in month one.
select pg_temp.as_mcp();
insert into f106f (label, id)
select 'loan', (
  public.mcp_add_loan('f106f-add', 'Example Fees Lender', 10000000, 60000, 360, '2026-01-01'::date, 100000, 10000, 'USD')->'data'->>'id'
)::uuid;
reset role;

select pg_temp.add_line('f106f:jan', '2026-01-01', 125000);
select pg_temp.add_line('f106f:feb', '2026-02-01', 125000);
select pg_temp.add_line('f106f:mar', '2026-03-01', 125000);
select pg_temp.add_line('f106f:bad', '2026-04-01', 125000);
select pg_temp.add_line('f106f:kept', '2026-05-01', 125000);

-- No default for fees: with no category on the call and none on the loan, it is refused.
select is(
  pg_temp.attach('f106f-none', 'f106f:jan', pg_temp.four_parts())->'error'->>'message',
  'fees category required',
  'fees with no category on the call or the loan are refused'
);
select is(
  (select count(*)::int from public.loan_splits where transaction_id = pg_temp.line('f106f:jan')),
  0,
  'and nothing is written'
);

-- A 4-part attach with the call's fees category. The loan's own interest category does
-- not pull the fees along: interest goes there, fees where the call says.
select pg_temp.update_loan('f106f-int', jsonb_build_object('interest_category_id', pg_temp.id('cat_int')));
select is(pg_temp.attach('f106f-jan', 'f106f:jan', pg_temp.four_parts(25000, pg_temp.id('cat_fees')))->>'ok', 'true', 'a 4-part attach succeeds');
select is(
  (select count(*)::int from public.loan_splits where transaction_id = pg_temp.line('f106f:jan')),
  4,
  'the line has four parts'
);
select is(pg_temp.part_category('f106f:jan', 'fees'), pg_temp.id('cat_fees'), 'fees go to the call''s category');
select is(pg_temp.part_category('f106f:jan', 'interest'), pg_temp.id('cat_int'), 'interest goes to the loan''s own interest category');
select is(
  (select balance_minor from public.loan_balances where loan_id = pg_temp.id('loan')),
  10000000::bigint - 40000,
  'the balance counts the principal part only'
);

-- The P&L counts the fees under their category, like interest.
select is(
  (select jsonb_agg(jsonb_build_object('part', l.part, 'in_pnl', l.in_pnl, 'amount_net', l.amount_net) order by l.part)
   from private.pnl_lines l
   where l.transaction_id = pg_temp.line('f106f:jan')),
  '[{"part": "interest", "in_pnl": true, "amount_net": -50000},
    {"part": "escrow", "in_pnl": true, "amount_net": -10000},
    {"part": "principal", "in_pnl": false, "amount_net": -40000},
    {"part": "fees", "in_pnl": true, "amount_net": -25000}]'::jsonb,
  'pnl_lines emits the four parts, fees counted in the P&L'
);
select is(
  (select bool_or(l.loan_split_fallback) from private.pnl_lines l where l.transaction_id = pg_temp.line('f106f:jan')),
  false,
  'a 4-part split does not fall back to the whole line'
);
select is(
  (select sum(-l.amount_net)::bigint from private.pnl_lines l
   where l.transaction_id = pg_temp.line('f106f:jan') and l.in_pnl),
  85000::bigint,
  'interest, escrow and fees count: 850.00'
);
select tests.authenticate_as('f106f_owner');
select is(
  (select jsonb_agg(p->>'part') from jsonb_array_elements(public.get_loan_split(pg_temp.line('f106f:jan'))->'parts') p),
  '["interest", "escrow", "principal", "fees"]'::jsonb,
  'get_loan_split lists fees last'
);
reset role;

-- The call's category must fit and be the company's.
select is(
  pg_temp.attach('f106f-call-escrow', 'f106f:bad', pg_temp.four_parts(25000, pg_temp.id('keyed_escrow')))->'error'->>'message',
  'category does not fit the loan part',
  'the keyed escrow category does not take fees'
);
select is(
  pg_temp.attach('f106f-call-income', 'f106f:bad', pg_temp.four_parts(25000, pg_temp.id('income_cat')))->'error'->>'message',
  'category does not fit the loan part',
  'an income category does not take fees'
);
select is(
  pg_temp.attach('f106f-call-other', 'f106f:bad', pg_temp.four_parts(25000, pg_temp.id('other_cat')))->'error'->>'message',
  'category not found',
  'another company''s category is not found'
);
select is(
  pg_temp.attach('f106f-cat-on-interest', 'f106f:bad',
    '[{"part": "interest", "amount_minor": 50000, "scheduled_minor": 50000, "category_id": "00000000-0000-4000-8000-000000000001"},
      {"part": "escrow", "amount_minor": 10000, "scheduled_minor": 10000},
      {"part": "principal", "amount_minor": 40000, "scheduled_minor": 40000},
      {"part": "fees", "amount_minor": 25000, "scheduled_minor": 25000}]'::jsonb
  )->'error'->>'message',
  'invalid loan parts',
  'only the fees part may name a category'
);

-- Fees refused at 0, twice, or in place of a part.
select is(
  pg_temp.attach('f106f-zero', 'f106f:bad', pg_temp.four_parts(0, pg_temp.id('cat_fees')))->'error'->>'message',
  'invalid loan parts',
  'a fees part at 0 is refused'
);
select is(
  pg_temp.attach('f106f-twice', 'f106f:bad',
    pg_temp.four_parts(12500, pg_temp.id('cat_fees')) || '[{"part": "fees", "amount_minor": 12500, "scheduled_minor": 12500}]'::jsonb
  )->'error'->>'message',
  'invalid loan parts',
  'two fees parts are refused'
);
select is(
  pg_temp.attach('f106f-no-principal', 'f106f:bad',
    jsonb_build_array(
      '{"part": "interest", "amount_minor": 50000, "scheduled_minor": 50000}'::jsonb,
      '{"part": "escrow", "amount_minor": 10000, "scheduled_minor": 10000}'::jsonb,
      jsonb_build_object('part', 'fees', 'amount_minor', 65000, 'scheduled_minor', 65000, 'category_id', pg_temp.id('cat_fees'))
    )
  )->'error'->>'message',
  'invalid loan parts',
  'fees cannot stand in for a missing part'
);

-- The app's own writes: a fees part at 0 is refused; fees may move to a kept-out category.
select tests.authenticate_as('f106f_owner');
select throws_ok(
  $$ insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id)
     values
       (pg_temp.id('company'), pg_temp.id('loan'), pg_temp.line('f106f:bad'), 'interest', 50000, 50000, pg_temp.id('keyed_interest')),
       (pg_temp.id('company'), pg_temp.id('loan'), pg_temp.line('f106f:bad'), 'escrow', 10000, 10000, pg_temp.id('keyed_escrow')),
       (pg_temp.id('company'), pg_temp.id('loan'), pg_temp.line('f106f:bad'), 'principal', 65000, 40000, pg_temp.id('keyed_principal')),
       (pg_temp.id('company'), pg_temp.id('loan'), pg_temp.line('f106f:bad'), 'fees', 0, 0, pg_temp.id('cat_fees'));
     set constraints all immediate; $$,
  '23514',
  'loan_split_incomplete',
  'the app cannot write a fees part at 0'
);
reset role;
select tests.authenticate_as('f106f_owner');
select throws_ok(
  $$ update public.loan_splits s set category_id = pg_temp.id('income_cat')
     where s.transaction_id = pg_temp.line('f106f:jan') and s.part = 'fees';
     set constraints all immediate; $$,
  '23514',
  'loan_split_category',
  'fees cannot be corrected into an income category'
);
reset role;
set constraints all deferred;

-- A fees part in a kept-out category stays out of the P&L.
select is(
  pg_temp.attach('f106f-kept', 'f106f:kept', pg_temp.four_parts(25000, pg_temp.id('cat_out')))->>'ok',
  'true',
  'fees may go to a kept-out category'
);
select is(
  (select jsonb_build_object('in_pnl', l.in_pnl, 'category_id', l.category_id) from private.pnl_lines l
   where l.transaction_id = pg_temp.line('f106f:kept') and l.part = 'fees'),
  jsonb_build_object('in_pnl', false, 'category_id', pg_temp.id('cat_out')),
  'and they stay out of the P&L'
);

-- update_loan sets fees_category_id; list_loans names it; the rule holds.
select is(pg_temp.listed()->'fees_category_id', 'null'::jsonb, 'a new loan has no fees category');
select is(
  pg_temp.update_loan('f106f-escrow', jsonb_build_object('fees_category_id', pg_temp.id('keyed_escrow')))->'error'->>'message',
  'category does not fit the loan part',
  'fees cannot go to the keyed escrow category'
);
select is(
  pg_temp.update_loan('f106f-other', jsonb_build_object('fees_category_id', pg_temp.id('other_cat')))->'error'->>'message',
  'category not found',
  'another company''s category is not found'
);
select is(
  pg_temp.update_loan('f106f-out', jsonb_build_object('fees_category_id', pg_temp.id('cat_out')))->>'ok',
  'true',
  'the loan may name a kept-out category for fees'
);
select is(
  pg_temp.update_loan('f106f-keyed-int', jsonb_build_object('fees_category_id', pg_temp.id('keyed_interest')))->>'ok',
  'true',
  'fees may go to the keyed interest category'
);
select is(
  pg_temp.update_loan('f106f-set', jsonb_build_object('fees_category_id', pg_temp.id('cat_fees')))->'data'->>'fees_category_id',
  pg_temp.id('cat_fees')::text,
  'update_loan sets a fees category'
);
select is(
  (select jsonb_build_object('id', l->>'fees_category_id', 'name', l->>'fees_category_name') from (select pg_temp.listed() l) x),
  jsonb_build_object('id', pg_temp.id('cat_fees')::text, 'name', 'Example closing costs'),
  'list_loans returns fees_category_id and fees_category_name'
);

-- The loan's category is used when the call names none; the call's wins over it.
select is(pg_temp.attach('f106f-feb', 'f106f:feb', pg_temp.four_parts())->>'ok', 'true', 'an attach with no call category succeeds');
select is(pg_temp.part_category('f106f:feb', 'fees'), pg_temp.id('cat_fees'), 'fees go to the loan''s fees category');
select is(pg_temp.attach('f106f-mar', 'f106f:mar', pg_temp.four_parts(25000, pg_temp.id('cat_call')))->>'ok', 'true', 'an attach with a call category succeeds');
select is(pg_temp.part_category('f106f:mar', 'fees'), pg_temp.id('cat_call'), 'the call''s category wins over the loan''s');

-- A category that holds fees, or that a loan names for fees, may flip sides freely.
select tests.authenticate_as('f106f_owner');
select lives_ok(
  $$ select public.set_category_excluded_from_pnl(pg_temp.id('cat_fees'), true) $$,
  'a category holding fees and named by the loan can be kept out'
);
reset role;
select is(
  (select l.in_pnl from private.pnl_lines l where l.transaction_id = pg_temp.line('f106f:feb') and l.part = 'fees'),
  false,
  'and its fees part follows it out of the P&L'
);
select tests.authenticate_as('f106f_owner');
select lives_ok(
  $$ select public.set_category_excluded_from_pnl(pg_temp.id('cat_fees'), false) $$,
  'and counted again'
);
select throws_ok(
  $$ update public.loans set fees_category_id = pg_temp.id('income_cat') where id = pg_temp.id('loan') $$,
  '23514',
  'loan_category_not_allowed',
  'the app cannot name an income category for fees'
);
reset role;

-- Undo of update_loan restores the previous fees category; null clears it.
select pg_temp.update_loan('f106f-named', jsonb_build_object('fees_category_id', pg_temp.id('cat_named')));
select is(pg_temp.undo('f106f-undo-named', 'loan_update', pg_temp.id('loan'))->>'ok', 'true', 'undo of the fees category succeeds');
select is(
  (select fees_category_id from public.loans where id = pg_temp.id('loan')),
  pg_temp.id('cat_fees'),
  'and the previous fees category is back'
);
select pg_temp.update_loan('f106f-clear', '{"fees_category_id": null}');
select is(
  (select fees_category_id from public.loans where id = pg_temp.id('loan')),
  null,
  'null clears the fees category'
);

-- Undo of a 4-part split removes every part and puts the whole line back.
select is(pg_temp.undo('f106f-undo-feb', 'loan_split', pg_temp.line('f106f:feb'))->>'ok', 'true', 'undo of a 4-part split succeeds');
select is(
  (select count(*)::int from public.loan_splits where transaction_id = pg_temp.line('f106f:feb')),
  0,
  'no part is left'
);
select is(
  (select jsonb_agg(jsonb_build_object('part', l.part, 'amount_net', l.amount_net))
   from private.pnl_lines l where l.transaction_id = pg_temp.line('f106f:feb')),
  '[{"part": null, "amount_net": -125000}]'::jsonb,
  'the whole line counts again'
);

-- Undo cannot restore a fees category deleted since, and deleting the category a loan
-- names for fees clears it.
select pg_temp.update_loan('f106f-again', jsonb_build_object('fees_category_id', pg_temp.id('cat_named')));
select pg_temp.update_loan('f106f-swap', jsonb_build_object('fees_category_id', pg_temp.id('cat_call')));
delete from public.categories where id = pg_temp.id('cat_named');
select is(
  pg_temp.undo('f106f-undo-swap', 'loan_update', pg_temp.id('loan'))->'error'->>'message',
  'category not found',
  'undo cannot restore a deleted fees category'
);
insert into public.categories (company_id, name, kind, sort_order)
values (pg_temp.id('company'), 'Example short-lived fees', 'expense', 905);
insert into f106f (label, id)
select 'cat_temp', c.id from public.categories c
where c.company_id = pg_temp.id('company') and c.name = 'Example short-lived fees';
select pg_temp.update_loan('f106f-temp', jsonb_build_object('fees_category_id', pg_temp.id('cat_temp')));
delete from public.categories where id = pg_temp.id('cat_temp');
select is(
  (select fees_category_id from public.loans where id = pg_temp.id('loan')),
  null,
  'a deleted category clears the loan''s fees category'
);

-- An exact split with no interest (fees, escrow and principal only) is a 4-part split.
select is(
  pg_temp.attach('f106f-exact', 'f106f:bad',
    jsonb_build_array(
      '{"part": "interest", "amount_minor": 0, "scheduled_minor": 50000}'::jsonb,
      '{"part": "escrow", "amount_minor": 30000, "scheduled_minor": 10000}'::jsonb,
      '{"part": "principal", "amount_minor": 35000, "scheduled_minor": 40000}'::jsonb,
      jsonb_build_object('part', 'fees', 'amount_minor', 60000, 'scheduled_minor', 60000, 'category_id', pg_temp.id('cat_fees'))
    )
  )->>'ok',
  'true',
  'an exact split with interest at 0 and fees is attached'
);
select is(
  (select sum(-l.amount_net)::bigint from private.pnl_lines l
   where l.transaction_id = pg_temp.line('f106f:bad') and l.in_pnl),
  90000::bigint,
  'its escrow and fees count, its principal stays out'
);

select * from finish();
rollback;
