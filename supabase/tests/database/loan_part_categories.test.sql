-- FLOW-106 part 2: a loan names its own category for each part (decision 0127).
-- update_loan sets them, attach uses them, undo restores them, and the rule holds for
-- the app's own writes and for a category that flips in or out of the P&L.
-- Fixed dates. @example.com only.

begin;

select plan(30);

do $users$
begin
  perform tests.create_supabase_user('f106d_owner', 'owner106d@example.com');
  perform tests.create_supabase_user('f106d_other', 'other106d@example.com');
end
$users$;

create temp table f106d (label text primary key, id uuid);
grant all on f106d to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
set search_path = ''
as $$
  select id from pg_temp.f106d where label = p_label;
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
  uid := tests.get_supabase_uid('f106d_owner');
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

create or replace function pg_temp.undo(p_key text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_undo(p_key, 'loan_update', pg_temp.id('loan'));
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.undo(text) to authenticated, service_role;

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

select tests.authenticate_as('f106d_owner');
select public.create_company('Example Part Categories Co', true);
reset role;
insert into f106d (label, id) select 'company', id from public.companies where name = 'Example Part Categories Co';

-- Two categories of the owner's own: one in the P&L, one kept out.
insert into public.categories (company_id, name, kind, sort_order)
values
  (pg_temp.id('company'), 'Example partner interest', 'expense', 900),
  (pg_temp.id('company'), 'Example other interest', 'expense', 901),
  (pg_temp.id('company'), 'Example partner principal', 'expense', 902);
update public.categories set excluded_from_pnl = true
where company_id = pg_temp.id('company') and name = 'Example partner principal';
insert into f106d (label, id)
select v.label, c.id
from public.categories c
join (values
  ('cat_in', 'Example partner interest'),
  ('cat_in2', 'Example other interest'),
  ('cat_out', 'Example partner principal')
) v(label, name) on v.name = c.name
where c.company_id = pg_temp.id('company');
insert into f106d (label, id)
select 'keyed_' || c.loan_part::text, c.id
from public.categories c
where c.company_id = pg_temp.id('company') and c.loan_part is not null;

select public.store_mcp_credential(
  tests.get_supabase_uid('f106d_owner'), 'hash-f106d-write-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into f106d (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-f106d-write-1';

-- 100,000.00 at 6 percent over 360 months: 1,000.00 a month, 100.00 escrow, interest 500.00 in month one.
select pg_temp.as_mcp();
insert into f106d (label, id)
select 'loan', (
  public.mcp_add_loan('f106d-add', 'Example Partner', 10000000, 60000, 360, '2026-01-01'::date, 100000, 10000, 'USD')->'data'->>'id'
)::uuid;
reset role;

-- 1-3. Defaults until set.
select is(pg_temp.listed()->'interest_category_id', 'null'::jsonb, 'a new loan uses the default interest category');

select is(
  pg_temp.update_loan('f106d-set', jsonb_build_object('interest_category_id', pg_temp.id('cat_in'), 'principal_category_id', pg_temp.id('cat_out')))->>'ok',
  'true',
  'update_loan sets an interest and a principal category'
);
select is(pg_temp.listed()->>'interest_category_name', 'Example partner interest', 'list_loans names the interest category');

-- 4-7. Categories that do not fit the part, or are not the company's.
select is(
  pg_temp.update_loan('f106d-bad-1', jsonb_build_object('interest_category_id', pg_temp.id('cat_out')))->'error'->>'message',
  'category does not fit the loan part',
  'interest cannot go to a kept-out category'
);
select is(
  pg_temp.update_loan('f106d-bad-2', jsonb_build_object('principal_category_id', pg_temp.id('cat_in2')))->'error'->>'message',
  'category does not fit the loan part',
  'principal cannot go to a category in the P&L'
);
select is(
  pg_temp.update_loan('f106d-bad-3', jsonb_build_object('interest_category_id', pg_temp.id('keyed_escrow')))->'error'->>'message',
  'category does not fit the loan part',
  'a keyed loan category takes only its own part'
);
select is(
  pg_temp.update_loan('f106d-bad-4', '{"escrow_category_id": "00000000-0000-4000-8000-000000000999"}')->'error'->>'message',
  'category not found',
  'an unknown category is not found'
);
select is(
  pg_temp.update_loan('f106d-bad-5', '{"escrow_category_id": "not-a-uuid"}')->'error'->>'code',
  'validation',
  'a malformed id is a validation error'
);

-- 9-11. The attach files each part under the loan's category, or the default.
reset role;
insert into public.transactions (
  company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
values (pg_temp.id('company'), 'expense', 'expense', 'posted', -100000, -100000, 100000, 0, 'unknown',
  '2026-01-01', 'USD', 'manual', 'f106d:jan', 'Example loan payment');
select pg_temp.as_mcp();
select is(
  public.mcp_attach_loan_payment(
    'f106d-attach',
    (select id from public.transactions where idempotency_key = 'f106d:jan'),
    pg_temp.id('loan'),
    '[{"part": "interest", "amount_minor": 50000, "scheduled_minor": 50000},
      {"part": "escrow", "amount_minor": 10000, "scheduled_minor": 10000},
      {"part": "principal", "amount_minor": 40000, "scheduled_minor": 40000}]'::jsonb
  )->>'ok',
  'true',
  'attach_loan_payment succeeds'
);
reset role;
select is(pg_temp.part_category('f106d:jan', 'interest'), pg_temp.id('cat_in'), 'interest goes to the loan''s category');
select is(pg_temp.part_category('f106d:jan', 'escrow'), pg_temp.id('keyed_escrow'), 'escrow keeps the default');
select is(pg_temp.part_category('f106d:jan', 'principal'), pg_temp.id('cat_out'), 'principal goes to the loan''s kept-out category');

-- 13. The P&L counts the interest under the loan's category and keeps the principal out.
select is(
  (select jsonb_agg(jsonb_build_object('part', l.part, 'in_pnl', l.in_pnl) order by l.part)
   from private.pnl_lines l
   join public.transactions t on t.id = l.transaction_id
   where t.idempotency_key = 'f106d:jan'),
  '[{"part": "interest", "in_pnl": true}, {"part": "escrow", "in_pnl": true}, {"part": "principal", "in_pnl": false}]'::jsonb,
  'the parts count by their categories'
);

-- 14-15. A category in use cannot flip sides of the P&L.
select tests.authenticate_as('f106d_owner');
select throws_ok(
  $$ select public.set_category_excluded_from_pnl(pg_temp.id('cat_in'), true) $$,
  '23514',
  'loan category is fixed',
  'a category holding interest cannot be kept out'
);
select throws_ok(
  $$ select public.set_category_excluded_from_pnl(pg_temp.id('cat_out'), false) $$,
  '23514',
  'loan category is fixed',
  'a category holding principal cannot be counted'
);

-- 16-17. The app's own writes follow the rule: a loan row, and a corrected part.
select throws_ok(
  $$ update public.loans set principal_category_id = pg_temp.id('cat_in2') where id = pg_temp.id('loan') $$,
  '23514',
  'loan_category_not_allowed',
  'the app cannot name a P&L category for principal'
);
select lives_ok(
  $$ update public.loan_splits s set category_id = pg_temp.id('cat_in2')
     from public.transactions t
     where t.id = s.transaction_id and t.idempotency_key = 'f106d:jan' and s.part = 'interest';
     set constraints all immediate; $$,
  'the owner can correct interest into another category in the P&L'
);
reset role;
select tests.authenticate_as('f106d_owner');
select throws_ok(
  $$ update public.loan_splits s set category_id = pg_temp.id('cat_out')
     from public.transactions t
     where t.id = s.transaction_id and t.idempotency_key = 'f106d:jan' and s.part = 'escrow';
     set constraints all immediate; $$,
  '23514',
  'loan_split_category',
  'but not escrow into a kept-out category'
);
reset role;
-- The corrections above ran the deferred checks at once; later writes defer them again.
set constraints all deferred;

-- 19-21. null goes back to the default, and undo restores the previous mapping.
select is(
  pg_temp.update_loan('f106d-clear', '{"interest_category_id": null}')->'data'->'interest_category_id',
  'null'::jsonb,
  'null clears the interest category'
);
select is(
  (select (public.mcp_undo('f106d-undo-clear', 'loan_update', pg_temp.id('loan')))->>'ok'
   from (select pg_temp.as_mcp()) a),
  'true',
  'undo of the clear succeeds'
);
reset role;
select is(
  (select interest_category_id from public.loans where id = pg_temp.id('loan')),
  pg_temp.id('cat_in'),
  'and the interest category is back'
);

-- 22. Deleting a named category puts the loan back on the default.
delete from public.loan_splits s using public.transactions t
where t.id = s.transaction_id and t.idempotency_key = 'f106d:jan';
delete from public.categories where id = pg_temp.id('cat_in');
select is(
  (select interest_category_id from public.loans where id = pg_temp.id('loan')),
  null,
  'a deleted category clears the loan''s interest category'
);

-- 23. Another company's category is not found.
select tests.authenticate_as('f106d_other');
select public.create_company('Example Other Part Co', true);
reset role;
insert into f106d (label, id)
select 'other_cat', c.id
from public.categories c join public.companies co on co.id = c.company_id
where co.name = 'Example Other Part Co' and c.kind = 'expense' and c.loan_part is null and not c.excluded_from_pnl
order by c.sort_order limit 1;
select is(
  pg_temp.update_loan('f106d-other', jsonb_build_object('interest_category_id', pg_temp.id('other_cat')))->'error'->>'message',
  'category not found',
  'another company''s category is not found'
);

-- 24. A category a loan names, with no parts filed yet, keeps its side of the P&L.
insert into public.categories (company_id, name, kind, sort_order)
values
  (pg_temp.id('company'), 'Example named escrow', 'expense', 910),
  (pg_temp.id('company'), 'Example temp interest', 'expense', 911),
  (pg_temp.id('company'), 'Example side interest', 'expense', 912);
insert into f106d (label, id)
select v.label, c.id
from public.categories c
join (values
  ('cat_named', 'Example named escrow'),
  ('cat_temp', 'Example temp interest'),
  ('cat_side', 'Example side interest')
) v(label, name) on v.name = c.name
where c.company_id = pg_temp.id('company');
select pg_temp.update_loan('f106d-named', jsonb_build_object('escrow_category_id', pg_temp.id('cat_named')));
select tests.authenticate_as('f106d_owner');
select throws_ok(
  $$ select public.set_category_excluded_from_pnl(pg_temp.id('cat_named'), true) $$,
  '23514',
  'loan category is fixed',
  'a category a loan names for escrow cannot be kept out, before any part is filed'
);
reset role;

-- 25. Undo is refused when the category it would restore was deleted since.
select pg_temp.update_loan('f106d-temp', jsonb_build_object('interest_category_id', pg_temp.id('cat_temp')));
select pg_temp.update_loan('f106d-swap', jsonb_build_object('interest_category_id', pg_temp.id('cat_in2')));
delete from public.categories where id = pg_temp.id('cat_temp');
select is(
  pg_temp.undo('f106d-undo-swap')->'error'->>'message',
  'category not found',
  'undo cannot restore a deleted category'
);

-- 26. Undo is refused when that category changed sides of the P&L since.
select pg_temp.update_loan('f106d-side', jsonb_build_object('interest_category_id', pg_temp.id('cat_side')));
select pg_temp.update_loan('f106d-swap-2', jsonb_build_object('interest_category_id', pg_temp.id('cat_in2')));
update public.categories set excluded_from_pnl = true where id = pg_temp.id('cat_side');
select is(
  pg_temp.undo('f106d-undo-swap-2')->'error'->>'message',
  'category does not fit the loan part',
  'undo cannot put interest back on a category now kept out'
);
select is(
  (select interest_category_id from public.loans where id = pg_temp.id('loan')),
  pg_temp.id('cat_in2'),
  'and the mapping is unchanged'
);

-- 28-29. A corrected part follows the rule for principal and for an income category.
insert into public.transactions (
  company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
)
values (pg_temp.id('company'), 'expense', 'expense', 'posted', -100000, -100000, 100000, 0, 'unknown',
  '2026-02-01', 'USD', 'manual', 'f106d:feb', 'Example loan payment');
select pg_temp.as_mcp();
select public.mcp_attach_loan_payment(
  'f106d-attach-feb',
  (select id from public.transactions where idempotency_key = 'f106d:feb'),
  pg_temp.id('loan'),
  '[{"part": "interest", "amount_minor": 50000, "scheduled_minor": 50000},
    {"part": "escrow", "amount_minor": 10000, "scheduled_minor": 10000},
    {"part": "principal", "amount_minor": 40000, "scheduled_minor": 40000}]'::jsonb
);
reset role;
select tests.authenticate_as('f106d_owner');
select throws_ok(
  $$ update public.loan_splits s set category_id = pg_temp.id('cat_in2')
     from public.transactions t
     where t.id = s.transaction_id and t.idempotency_key = 'f106d:feb' and s.part = 'principal';
     set constraints all immediate; $$,
  '23514',
  'loan_split_category',
  'principal cannot be corrected into a category in the P&L'
);
reset role;
select tests.authenticate_as('f106d_owner');
select throws_ok(
  format(
    $$ update public.loan_splits s set category_id = %L
       from public.transactions t
       where t.id = s.transaction_id and t.idempotency_key = 'f106d:feb' and s.part = 'interest';
       set constraints all immediate; $$,
    (select c.id from public.categories c
     where c.company_id = pg_temp.id('company') and c.kind = 'income' order by c.sort_order limit 1)
  ),
  '23514',
  'loan_split_category',
  'interest cannot be corrected into an income category'
);
reset role;

-- 30. The app's own insert of a loan follows the rule.
select tests.authenticate_as('f106d_owner');
select throws_ok(
  $$ insert into public.loans (
       company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor,
       escrow_minor, currency, principal_category_id
     )
     values (pg_temp.id('company'), 'Example App Loan', 1000000, 60000, 120, '2026-01-01', 20000, 0, 'USD',
       pg_temp.id('cat_in2')) $$,
  '23514',
  'loan_category_not_allowed',
  'the app cannot add a loan with a P&L category for principal'
);
reset role;

select * from finish();
rollback;
