-- FLOW-106 part 4: loan kinds and a variable rate (decision 0132), plus the loan follow-ups
-- FLOW-132 (a closed loan's line that comes back or moves past closed_on), FLOW-134 items 1
-- and 4 (merge_category moves loan categories; the part-category trigger runs on a change
-- only) folded into the same migration.
-- Fixed dates. @example.com only.

begin;

select plan(60);

do $users$
begin
  perform tests.create_supabase_user('f106k_owner', 'owner106k@example.com');
  perform tests.create_supabase_user('f106k_other', 'other106k@example.com');
end
$users$;

create temp table f106k (label text primary key, id uuid);
grant all on f106k to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
set search_path = ''
as $$
  select id from pg_temp.f106k where label = p_label;
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
  uid := tests.get_supabase_uid('f106k_owner');
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

create or replace function pg_temp.add_loan(
  p_key text, p_term integer, p_payment bigint, p_kind text, p_io integer, p_am integer, p_rate integer default 60000
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_add_loan(
    p_key, 'Example ' || p_key, 12000000, p_rate, p_term, '2026-01-01'::date, p_payment, 0, 'USD', null,
    p_kind, p_io, p_am
  );
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.add_loan(text, integer, bigint, text, integer, integer, integer) to authenticated, service_role;

create or replace function pg_temp.update_loan(p_key text, p_loan text, p_patch jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_update_loan(p_key, pg_temp.id(p_loan), p_patch);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.update_loan(text, text, jsonb) to authenticated, service_role;

create or replace function pg_temp.set_rate(p_key text, p_loan text, p_day date, p_ppm integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_set_loan_rate(p_key, pg_temp.id(p_loan), p_day, p_ppm);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.set_rate(text, text, date, integer) to authenticated, service_role;

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

create or replace function pg_temp.listed(p_loan text)
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
  where l->>'id' = pg_temp.id(p_loan)::text;
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.listed(text) to authenticated, service_role;

create or replace function pg_temp.payments(p_loan text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_loan_payments(pg_temp.id(p_loan));
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.payments(text) to authenticated, service_role;

create or replace function pg_temp.line(p_key text)
returns uuid
language sql
set search_path = ''
as $$
  select t.id from public.transactions t where t.idempotency_key = p_key;
$$;
grant execute on function pg_temp.line(text) to authenticated, service_role;

create or replace function pg_temp.attach(p_key text, p_line text, p_loan text, p_interest bigint, p_principal bigint)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_attach_loan_payment(p_key, pg_temp.line(p_line), pg_temp.id(p_loan), jsonb_build_array(
    jsonb_build_object('part', 'interest', 'amount_minor', p_interest, 'scheduled_minor', p_interest),
    jsonb_build_object('part', 'escrow', 'amount_minor', 0, 'scheduled_minor', 0),
    jsonb_build_object('part', 'principal', 'amount_minor', p_principal, 'scheduled_minor', p_principal)
  ));
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.attach(text, text, text, bigint, bigint) to authenticated, service_role;

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

create or replace function pg_temp.flagged(p_key text)
returns boolean
language sql
set search_path = ''
as $$
  select bool_and(s.needs_review) from public.loan_splits s where s.transaction_id = pg_temp.line(p_key);
$$;

select tests.authenticate_as('f106k_owner');
select public.create_company('Example Loan Kinds Co', true);
reset role;
insert into f106k (label, id) select 'company', id from public.companies where name = 'Example Loan Kinds Co';

select public.store_mcp_credential(
  tests.get_supabase_uid('f106k_owner'), 'hash-f106k-write-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into f106k (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-f106k-write-1';

insert into public.projects (company_id, name) values (pg_temp.id('company'), 'Example Kinds Project');
insert into f106k (label, id) select 'project', id from public.projects where name = 'Example Kinds Project';

-- 120,000.00 at 6 percent: 600.00 of interest a month on the whole principal.
-- An amortizing loan made the old way (no kind) is amortizing.
select pg_temp.as_mcp();
insert into f106k (label, id)
select 'amort', (
  public.mcp_add_loan('f106k-amort', 'Example Amortizing', 12000000, 60000, 360, '2026-01-01'::date, 71946, 0, 'USD')->'data'->>'id'
)::uuid;
reset role;
select is((select kind::text from public.loans where id = pg_temp.id('amort')), 'amortizing', 'a loan added without a kind is amortizing');

-- Interest-only for 12 of 24 months; its payment is the one after them.
insert into f106k (label, id)
select 'io', (pg_temp.add_loan('f106k-io', 24, 1032797, 'interest_only', 12, null)->'data'->>'id')::uuid;
select is(
  (select jsonb_build_array(kind, interest_only_months, amortization_months) from public.loans where id = pg_temp.id('io')),
  '["interest_only", 12, null]'::jsonb,
  'mcp_add_loan stores an interest-only loan'
);

-- A balloon: 60 months, amortized over 360.
insert into f106k (label, id)
select 'balloon', (pg_temp.add_loan('f106k-balloon', 60, 71946, 'balloon', null, 360)->'data'->>'id')::uuid;
select is((select amortization_months from public.loans where id = pg_temp.id('balloon')), 360, 'mcp_add_loan stores a balloon loan');

-- A demand loan has no term, no payment and no escrow; a 0% rate is allowed.
insert into f106k (label, id)
select 'demand', (pg_temp.add_loan('f106k-demand', null, null, 'demand', null, null, 0)->'data'->>'id')::uuid;
select is(
  (select jsonb_build_array(kind, term_months, payment_minor, escrow_minor) from public.loans where id = pg_temp.id('demand')),
  '["demand", null, null, 0]'::jsonb,
  'mcp_add_loan stores a 0% demand loan'
);

-- The kind rule.
select is(pg_temp.add_loan('f106k-d-term', 12, null, 'demand', null, null)->'error'->>'code', 'validation', 'a demand loan with a term is a validation error');
select is(pg_temp.add_loan('f106k-a-null', null, null, 'amortizing', null, null)->'error'->>'code', 'validation', 'an amortizing loan without a term is a validation error');
select is(pg_temp.add_loan('f106k-kind', 12, 100000, 'revolving', null, null)->'error'->>'code', 'validation', 'an unknown kind is a validation error');
select is(pg_temp.add_loan('f106k-io-25', 24, 1032797, 'interest_only', 25, null)->'error'->>'message', 'invalid loan terms', 'interest-only months past the term are refused');
select is(pg_temp.add_loan('f106k-io-0', 24, 1032797, 'interest_only', null, null)->'error'->>'message', 'invalid loan terms', 'an interest-only loan without its months is refused');
select is(pg_temp.add_loan('f106k-b-59', 60, 71946, 'balloon', null, 59)->'error'->>'message', 'invalid loan terms', 'amortization months below the term are refused');
select is(pg_temp.add_loan('f106k-b-601', 60, 71946, 'balloon', null, 601)->'error'->>'message', 'invalid loan terms', 'amortization months above 600 are refused');
select is(pg_temp.add_loan('f106k-a-io', 24, 600000, 'amortizing', 3, null)->'error'->>'message', 'invalid loan terms', 'interest-only months on an amortizing loan are refused');
select throws_ok(
  $$insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency, kind)
    values (pg_temp.id('company'), 'Example Bad Demand', 100000, 0, null, '2026-01-01', null, 100, 'USD', 'demand')$$,
  '23514', null, 'a demand loan cannot carry escrow'
);

-- Payment covers interest, per kind: interest-only and balloon face a month on the whole principal.
select is(pg_temp.add_loan('f106k-io-low', 24, 59999, 'interest_only', 12, null)->'error'->>'message', 'invalid loan terms', 'an interest-only payment below a month of interest is refused');
select is(pg_temp.add_loan('f106k-b-low', 60, 59999, 'balloon', null, 360)->'error'->>'message', 'invalid loan terms', 'a balloon payment below a month of interest is refused');
select is(pg_temp.add_loan('f106k-d-rate', null, null, 'demand', null, null, 1000000)->>'ok', 'true', 'a demand loan has no payment to check, at any rate');
select throws_ok(
  $$update public.loans set kind = 'interest_only', interest_only_months = 3, payment_minor = 50000 where id = pg_temp.id('amort')$$,
  '23514', 'loan_payment_below_interest', 'the app''s own write is held to the same rule'
);

-- update_loan: a kind change, and undo puts the kind back.
select is(
  pg_temp.update_loan('f106k-u-null', 'amort', '{"payment_minor": null}'::jsonb)->'error'->>'code',
  'validation',
  'a null payment without kind demand is still a validation error'
);
select is(
  pg_temp.update_loan('f106k-u-d', 'amort', '{"kind": "demand", "term_months": null, "payment_minor": null, "escrow_minor": 0}'::jsonb)->'data'->>'kind',
  'demand',
  'update_loan makes a loan a demand loan'
);
select is(
  (select jsonb_build_array(kind, term_months, payment_minor) from public.loans where id = pg_temp.id('amort')),
  '["demand", null, null]'::jsonb,
  'and clears its term and payment'
);
select is(pg_temp.undo('f106k-u-d-undo', 'loan_update', pg_temp.id('amort'))->>'ok', 'true', 'undo of the kind change succeeds');
select is(
  (select jsonb_build_array(kind, term_months, payment_minor) from public.loans where id = pg_temp.id('amort')),
  '["amortizing", 360, 71946]'::jsonb,
  'undo restores the kind, term and payment'
);
select is(
  pg_temp.update_loan('f106k-u-io', 'amort', '{"kind": "interest_only", "interest_only_months": 6}'::jsonb)->'data'->>'interest_only_months',
  '6',
  'update_loan sets interest-only months with the kind'
);
select is(
  pg_temp.update_loan('f106k-u-bad', 'amort', '{"kind": "balloon"}'::jsonb)->'error'->>'message',
  'invalid loan terms',
  'a balloon without amortization months is refused'
);

-- Rate rows: set, change, remove, and undo each.
select is(pg_temp.set_rate('f106k-r1', 'io', '2026-07-01', 120000)->'data'->>'undo_kind', 'loan_rate', 'set_loan_rate adds a rate row');
insert into f106k (label, id) select 'rate', id from public.loan_rates where loan_id = pg_temp.id('io');
select is(
  pg_temp.listed('io')->'rates',
  jsonb_build_array(jsonb_build_object('id', pg_temp.id('rate'), 'effective_date', '2026-07-01', 'annual_rate_ppm', 120000)),
  'list_loans returns the rate rows'
);
select is(
  (pg_temp.listed('io') - 'rates') @> '{"kind": "interest_only", "interest_only_months": 12, "amortization_months": null}'::jsonb,
  true,
  'list_loans returns the kind fields'
);
select is(pg_temp.set_rate('f106k-r1', 'io', '2026-07-01', 120000)->'data'->>'id', pg_temp.id('rate')::text, 'the same key replays');
select is(pg_temp.set_rate('f106k-r2', 'io', '2026-07-01', 90000)->'data'->>'previous_rate_ppm', '120000', 'a second call on the date changes the rate');
select is(pg_temp.set_rate('f106k-r0', 'io', '2025-12-31', 90000)->'error'->>'message', 'rate before the loan start', 'a rate before the loan start is refused');
select is(pg_temp.set_rate('f106k-rx', 'io', '2026-08-01', null)->'error'->>'message', 'rate not found', 'removing a rate that is not there is refused');
select is(pg_temp.undo('f106k-r2-undo', 'loan_rate', pg_temp.id('rate'))->>'ok', 'true', 'undo of the change succeeds');
select is((select annual_rate_ppm from public.loan_rates where id = pg_temp.id('rate')), 120000, 'and puts the rate back');
select is(pg_temp.set_rate('f106k-r3', 'io', '2026-07-01', null)->'data'->>'annual_rate_ppm', null, 'a null rate removes the row');
select is((select count(*)::int from public.loan_rates where loan_id = pg_temp.id('io')), 0, 'the row is gone');
select is(pg_temp.undo('f106k-r3-undo', 'loan_rate', pg_temp.id('rate'))->>'ok', 'true', 'undo of the removal succeeds');
select is((select annual_rate_ppm from public.loan_rates where id = pg_temp.id('rate')), 120000, 'and brings the row back with its id');
-- The first write (an add) cannot be undone once the rate was changed since.
update public.loan_rates set annual_rate_ppm = 130000 where id = pg_temp.id('rate');
select is(pg_temp.undo('f106k-r1-undo', 'loan_rate', pg_temp.id('rate'))->'error'->>'code', 'conflict', 'undo of a rate changed since is a conflict');
update public.loan_rates set annual_rate_ppm = 120000 where id = pg_temp.id('rate');
select is(pg_temp.undo('f106k-r1-undo2', 'loan_rate', pg_temp.id('rate'))->>'ok', 'true', 'undo of the add removes the row');
select is((select count(*)::int from public.loan_rates where loan_id = pg_temp.id('io')), 0, 'no rate row is left');

-- loan_rates has RLS like loans: another company sees nothing and cannot write.
select pg_temp.set_rate('f106k-r4', 'io', '2026-09-01', 70000);
select tests.authenticate_as('f106k_other');
select is((select count(*)::int from public.loan_rates), 0, 'another user sees no rate rows');
select throws_ok(
  format($$insert into public.loan_rates (company_id, loan_id, effective_date, annual_rate_ppm) values (%L, %L, '2026-10-01', 1)$$,
    pg_temp.id('company'), pg_temp.id('io')),
  '42501', null, 'and cannot add one to the owner''s loan'
);
reset role;
select tests.authenticate_as('f106k_owner');
select is((select count(*)::int from public.loan_rates), 1, 'the owner sees the rate row');
reset role;

-- A demand loan's payments, and mcp_loan_payments.
select pg_temp.add_line('f106k:d1', '2026-02-01', 100000);
select is(pg_temp.attach('f106k-d1', 'f106k:d1', 'demand', 0, 100000)->>'ok', 'true', 'a 0% demand payment attaches as all principal');
select is(
  pg_temp.payments('demand'),
  jsonb_build_array(jsonb_build_object(
    'transaction_id', pg_temp.line('f106k:d1'), 'doc_date', '2026-02-01', 'line_status', 'posted', 'needs_review', false,
    'interest_minor', 0, 'escrow_minor', 0, 'principal_minor', 100000, 'fees_minor', 0
  )),
  'mcp_loan_payments lists the payment with its parts'
);
select is((select balance_minor from public.loan_balances where loan_id = pg_temp.id('demand')), 11900000::bigint, 'the demand balance goes down by the principal');

-- FLOW-132: a line attached to a closed loan that moves past closed_on, or comes back.
select pg_temp.add_line('f106k:c1', '2026-01-20', 100000);
select pg_temp.add_line('f106k:c2', '2026-01-25', 100000);
select pg_temp.attach('f106k-c1', 'f106k:c1', 'balloon', 60000, 40000);
select pg_temp.attach('f106k-c2', 'f106k:c2', 'balloon', 60000, 40000);
update public.transactions set removed_at = now() where id = pg_temp.line('f106k:c2');
select is(
  pg_temp.update_loan('f106k-close', 'balloon', '{"status": "paid_off", "closed_on": "2026-01-31"}'::jsonb)->>'ok',
  'true',
  'the loan is closed on 2026-01-31'
);
update public.transactions set doc_date = '2026-01-30' where id = pg_temp.line('f106k:c1');
select is(pg_temp.flagged('f106k:c1'), false, 'a date that stays on or before closed_on is fine');
update public.transactions set doc_date = '2026-02-15' where id = pg_temp.line('f106k:c1');
select is(pg_temp.flagged('f106k:c1'), true, 'a date moved past closed_on flags the parts for review');
select tests.authenticate_as('f106k_owner');
select throws_ok(
  format('select public.clear_loan_split_review(%L)', pg_temp.line('f106k:c1')),
  '23514', 'loan_closed', 'clearing that review runs the closed check'
);
reset role;
update public.transactions set doc_date = '2026-01-30' where id = pg_temp.line('f106k:c1');
select tests.authenticate_as('f106k_owner');
select lives_ok(
  format('select public.clear_loan_split_review(%L)', pg_temp.line('f106k:c1')),
  'moved back, the review clears'
);
reset role;
update public.transactions set doc_date = '2026-02-15' where id = pg_temp.line('f106k:c2');
update public.transactions set removed_at = null where id = pg_temp.line('f106k:c2');
select is(pg_temp.flagged('f106k:c2'), true, 'a removed line dated past closed_on that comes back is flagged');

-- get_project lists a loan's status, closed_on and kind.
select pg_temp.update_loan('f106k-proj', 'balloon', jsonb_build_object('project_id', pg_temp.id('project')));
select tests.authenticate_as('f106k_owner');
select is(
  (select jsonb_build_object('status', l->'status', 'closed_on', l->'closed_on', 'kind', l->'kind')
   from jsonb_array_elements(public.get_project(pg_temp.id('project'), 'cash')->'loans') l),
  '{"status": "paid_off", "closed_on": "2026-01-31", "kind": "balloon"}'::jsonb,
  'get_project loans[] has status, closed_on and kind'
);
reset role;

-- FLOW-134 item 1: merge_category moves a loan's part category when the target fits.
insert into public.categories (company_id, name, kind, sort_order)
values
  (pg_temp.id('company'), 'Example partner interest', 'expense', 900),
  (pg_temp.id('company'), 'Example interest two', 'expense', 901),
  (pg_temp.id('company'), 'Example principal out', 'expense', 902),
  (pg_temp.id('company'), 'Example counted cost', 'expense', 903);
update public.categories set excluded_from_pnl = true
where company_id = pg_temp.id('company') and name = 'Example principal out';
insert into f106k (label, id)
select v.label, c.id
from public.categories c
join (values
  ('cat_int', 'Example partner interest'),
  ('cat_int2', 'Example interest two'),
  ('cat_out', 'Example principal out'),
  ('cat_in', 'Example counted cost')
) v(label, name) on v.name = c.name
where c.company_id = pg_temp.id('company');
select pg_temp.update_loan('f106k-cats', 'demand', jsonb_build_object(
  'interest_category_id', pg_temp.id('cat_int'), 'principal_category_id', pg_temp.id('cat_out')
));
select tests.authenticate_as('f106k_owner');
select lives_ok(
  format('select public.merge_category(%L, %L)', pg_temp.id('cat_int'), pg_temp.id('cat_int2')),
  'merging the loan''s interest category into another that fits'
);
select is((select interest_category_id from public.loans where id = pg_temp.id('demand')), pg_temp.id('cat_int2'), 'moves the loan to the target');
select throws_ok(
  format('select public.merge_category(%L, %L)', pg_temp.id('cat_out'), pg_temp.id('cat_in')),
  '23514', 'a loan uses this category for a part the other category cannot take',
  'merging the principal category into one counted in the P&L is refused'
);
select is(
  (select jsonb_build_array(l.principal_category_id = pg_temp.id('cat_out'), c.hidden)
   from public.loans l, public.categories c where l.id = pg_temp.id('demand') and c.id = pg_temp.id('cat_out')),
  '[true, false]'::jsonb,
  'and nothing moves'
);
reset role;

-- FLOW-134 item 4: the part-category check runs only when a category changes, so a loan whose
-- category no longer fits (set before the rule, here forced past the triggers) still renames.
set local session_replication_role = replica;
update public.categories set kind = 'income' where id = pg_temp.id('cat_int2');
set local session_replication_role = origin;
select is(
  pg_temp.update_loan('f106k-rename', 'demand', '{"name": "Example Partner Renamed"}'::jsonb)->>'ok',
  'true',
  'a name-only edit does not re-check the part categories'
);
select is(
  pg_temp.update_loan('f106k-recat', 'demand', jsonb_build_object('interest_category_id', pg_temp.id('cat_int2')))->'error'->>'message',
  'category does not fit the loan part',
  'naming a category that does not fit is still refused'
);
select is(
  pg_temp.update_loan('f106k-unknown', 'demand', jsonb_build_object('escrow_category_id', gen_random_uuid()))->'error'->>'message',
  'category not found',
  'an unknown category is not found'
);

select * from finish();
rollback;
