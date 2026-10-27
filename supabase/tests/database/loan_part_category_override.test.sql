-- FLOW-148 (decision 0227): a category for each part of one loan payment, and a dated category
-- switch on the loan. attach_loan_payment names a category on any part; set_loan_part_category
-- moves a part of attached payments, which stay attached; set_loan_category_from files a part of
-- payments from a date on, and with apply_to_existing re-files the attached ones. Each undoes all
-- or nothing. The category rules that hold for a loan's own categories hold for a switch.
-- Fixed dates. @example.com only.

begin;

select plan(58);

do $users$
begin
  perform tests.create_supabase_user('f148_owner', 'owner148@example.com');
end
$users$;

create temp table f148 (label text primary key, id uuid);
grant all on f148 to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
set search_path = ''
as $$
  select id from pg_temp.f148 where label = p_label;
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
  uid := tests.get_supabase_uid('f148_owner');
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

-- A payment line of 1,000.00 on a date, under the label 'line_<date>'.
create or replace function pg_temp.line(p_date date)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.transactions (
    company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
    vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
  )
  values (pg_temp.id('company'), 'expense', 'expense', 'posted', -100000, -100000, 100000, 0, 'unknown',
    p_date, 'USD', 'manual', 'f148:' || p_date::text, 'Example loan payment')
  returning id into new_id;
  insert into pg_temp.f148 (label, id) values ('line_' || p_date::text, new_id);
  return new_id;
end;
$$;
grant execute on function pg_temp.line(date) to authenticated, service_role;

-- Interest 500.00, escrow 100.00, principal 400.00; p_interest_cat names the interest category.
create or replace function pg_temp.attach(p_key text, p_date date, p_interest_cat uuid default null)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_attach_loan_payment(
    p_key,
    pg_temp.id('line_' || p_date::text),
    pg_temp.id('loan'),
    jsonb_build_array(
      jsonb_build_object('part', 'interest', 'amount_minor', 50000, 'scheduled_minor', 50000)
        || case when p_interest_cat is null then '{}'::jsonb else jsonb_build_object('category_id', p_interest_cat) end,
      jsonb_build_object('part', 'escrow', 'amount_minor', 10000, 'scheduled_minor', 10000),
      jsonb_build_object('part', 'principal', 'amount_minor', 40000, 'scheduled_minor', 40000)
    )
  );
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.attach(text, date, uuid) to authenticated, service_role;

create or replace function pg_temp.set_part(p_key text, p_dates date[], p_part text, p_category uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_set_loan_part_category(
    p_key,
    array(select coalesce(pg_temp.id('line_' || d::text), '00000000-0000-4000-8000-000000000148'::uuid)
          from unnest(p_dates) d),
    p_part,
    p_category
  );
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.set_part(text, date[], text, uuid) to authenticated, service_role;

create or replace function pg_temp.switch(
  p_key text, p_part text, p_date date, p_category uuid, p_apply boolean default false
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_set_loan_category_from(p_key, pg_temp.id('loan'), p_part, p_date, p_category, p_apply);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.switch(text, text, date, uuid, boolean) to authenticated, service_role;

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

create or replace function pg_temp.cat(p_date date, p_part text)
returns uuid
language sql
set search_path = ''
as $$
  select s.category_id from public.loan_splits s
  where s.transaction_id = pg_temp.id('line_' || p_date::text) and s.part = p_part::public.loan_split_part;
$$;
grant execute on function pg_temp.cat(date, text) to authenticated, service_role;

create or replace function pg_temp.interest_in_pnl(p_date date)
returns boolean
language sql
set search_path = ''
as $$
  select l.in_pnl from private.pnl_lines l
  where l.transaction_id = pg_temp.id('line_' || p_date::text) and l.part = 'interest'::public.loan_split_part;
$$;
grant execute on function pg_temp.interest_in_pnl(date) to authenticated, service_role;

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

select tests.authenticate_as('f148_owner');
select public.create_company('Example Loan Parts Co', true);
reset role;
insert into f148 (label, id) select 'company', id from public.companies where name = 'Example Loan Parts Co';

-- Holding costs (kept out of the P&L), two interest categories in the P&L, a kept-out
-- principal category, and one only a switch will use.
insert into public.categories (company_id, name, kind, sort_order)
values
  (pg_temp.id('company'), 'Example holding costs', 'expense', 900),
  (pg_temp.id('company'), 'Example rental interest', 'expense', 901),
  (pg_temp.id('company'), 'Example other interest', 'expense', 902),
  (pg_temp.id('company'), 'Example rehab principal', 'expense', 903),
  (pg_temp.id('company'), 'Example switch only', 'expense', 904);
update public.categories set excluded_from_pnl = true
where company_id = pg_temp.id('company')
  and name in ('Example holding costs', 'Example rehab principal');
insert into f148 (label, id)
select v.label, c.id
from public.categories c
join (values
  ('holding', 'Example holding costs'),
  ('rental', 'Example rental interest'),
  ('other', 'Example other interest'),
  ('principal_out', 'Example rehab principal'),
  ('switch_only', 'Example switch only')
) v(label, name) on v.name = c.name
where c.company_id = pg_temp.id('company');
insert into f148 (label, id)
select 'keyed_' || c.loan_part::text, c.id
from public.categories c
where c.company_id = pg_temp.id('company') and c.loan_part is not null;

select public.store_mcp_credential(
  tests.get_supabase_uid('f148_owner'), 'hash-f148-write-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into f148 (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-f148-write-1';

-- A rehab loan of 100,000.00 whose interest is a holding cost while the rehab runs.
select pg_temp.as_mcp();
insert into f148 (label, id)
select 'loan', (
  public.mcp_add_loan('f148-add', 'Example Rehab Loan', 10000000, 60000, 360, '2026-01-01'::date, 100000, 10000, 'USD')->'data'->>'id'
)::uuid;
select public.mcp_update_loan('f148-holding', pg_temp.id('loan'), jsonb_build_object('interest_category_id', pg_temp.id('holding')));
reset role;

select pg_temp.line('2026-01-01');
select pg_temp.line('2026-02-01');
select pg_temp.line('2026-02-20');
select pg_temp.line('2026-03-01');
select pg_temp.line('2026-04-01');
select pg_temp.line('2026-05-01');

-- attach_loan_payment: a part with no category takes the loan's; one that names a category
-- takes it.
select is(pg_temp.attach('f148-jan', '2026-01-01')->>'ok', 'true', 'a payment attaches with the loan''s categories');
select is(pg_temp.cat('2026-01-01', 'interest'), pg_temp.id('holding'), 'its interest goes to the loan''s holding costs');
select is(pg_temp.interest_in_pnl('2026-01-01'), false, 'holding-cost interest stays out of the P&L');
select is(
  pg_temp.attach('f148-feb', '2026-02-01', pg_temp.id('rental'))->'data'->>'undo_kind',
  'loan_split',
  'a payment attaches with its own interest category'
);
select is(pg_temp.cat('2026-02-01', 'interest'), pg_temp.id('rental'), 'the named interest category is used');
select is(pg_temp.interest_in_pnl('2026-02-01'), true, 'that interest counts in the P&L');

-- A category on a part is checked like the fees one.
select is(
  pg_temp.attach('f148-bad-fit', '2026-02-20', pg_temp.id('keyed_escrow'))->'error'->>'message',
  'category does not fit the loan part',
  'interest cannot go to the keyed escrow category'
);
select is(
  pg_temp.attach('f148-bad-cat', '2026-02-20', '00000000-0000-4000-8000-000000000999')->'error'->>'message',
  'category not found',
  'an unknown category is not found'
);
select is(
  (select count(*)::integer from public.loan_splits where transaction_id = pg_temp.id('line_2026-02-20')),
  0,
  'a refused attach writes nothing'
);

-- set_loan_part_category: the January interest into the P&L; the line stays attached.
select is(
  pg_temp.set_part('f148-part', array['2026-01-01']::date[], 'interest', pg_temp.id('rental'))->'data'->'lines'->0->>'previous_category_id',
  pg_temp.id('holding')::text,
  'set_loan_part_category reports the category it replaced'
);
select is(pg_temp.cat('2026-01-01', 'interest'), pg_temp.id('rental'), 'the interest moved');
select is(pg_temp.interest_in_pnl('2026-01-01'), true, 'the moved interest counts in the P&L');
select is(
  (select count(*)::integer from public.loan_splits where transaction_id = pg_temp.id('line_2026-01-01')),
  3,
  'the payment is still attached to the loan, all three parts'
);
select is(pg_temp.cat('2026-01-01', 'principal'), pg_temp.id('keyed_principal'), 'the other parts are untouched');
select is(
  pg_temp.set_part('f148-part', array['2026-01-01']::date[], 'interest', pg_temp.id('rental')),
  pg_temp.set_part('f148-part', array['2026-01-01']::date[], 'interest', pg_temp.id('rental')),
  'a replay with the same key returns the same response'
);
select is(
  (pg_temp.listed()->>'balance_minor')::bigint,
  10000000::bigint - 80000,
  'the loan balance still counts both payments'' principal'
);
select is(
  (select p->>'category_id' from jsonb_array_elements(
    public.get_loan_split(pg_temp.id('line_2026-01-01'))->'parts') p where p->>'part' = 'interest'),
  pg_temp.id('rental')::text,
  'get_loan_split shows the part''s category'
);

-- Refusals.
select is(
  pg_temp.set_part('f148-part-unattached', array['2026-02-20']::date[], 'interest', pg_temp.id('rental'))->'error'->>'message',
  'line has no loan split',
  'a line with no loan split is refused'
);
select is(
  pg_temp.set_part('f148-part-fees', array['2026-01-01']::date[], 'fees', pg_temp.id('rental'))->'error'->>'message',
  'payment has no such part',
  'a payment with no fees part is refused for fees'
);
select is(
  pg_temp.set_part('f148-part-principal', array['2026-01-01']::date[], 'principal', pg_temp.id('rental'))->'error'->>'message',
  'category does not fit the loan part',
  'principal cannot go to a category in the P&L'
);
select is(
  pg_temp.set_part('f148-part-missing', array['2026-01-01', '2026-12-31']::date[], 'interest', pg_temp.id('rental'))->'error'->>'message',
  'transaction not found',
  'an unknown line is not found, and nothing is written'
);
select is(
  pg_temp.set_part('f148-part-dup', array['2026-01-01', '2026-01-01']::date[], 'interest', pg_temp.id('rental'))->'error'->>'code',
  'validation',
  'the same line twice is a validation error'
);
select is(
  pg_temp.set_part('f148-part-kind', array['2026-01-01']::date[], 'rent', pg_temp.id('rental'))->'error'->>'code',
  'validation',
  'an unknown part is a validation error'
);

-- Undo puts every part back; a second undo finds nothing; an undo after the owner
-- changed the part is a conflict.
select is(
  pg_temp.undo('f148-undo-part', 'loan_part_category',
    (pg_temp.set_part('f148-part', array['2026-01-01']::date[], 'interest', pg_temp.id('rental'))->'data'->>'id')::uuid)->>'ok',
  'true',
  'undo of loan_part_category succeeds'
);
select is(pg_temp.cat('2026-01-01', 'interest'), pg_temp.id('holding'), 'the interest is back in holding costs');
select is(
  pg_temp.undo('f148-undo-part-2', 'loan_part_category',
    (pg_temp.set_part('f148-part', array['2026-01-01']::date[], 'interest', pg_temp.id('rental'))->'data'->>'id')::uuid)->'error'->>'code',
  'not_found',
  'a second undo finds nothing'
);
insert into f148 (label, id)
select 'part_write', (pg_temp.set_part('f148-part-2', array['2026-01-01', '2026-02-01']::date[], 'interest', pg_temp.id('other'))->'data'->>'id')::uuid;
update public.loan_splits set category_id = pg_temp.id('rental')
where transaction_id = pg_temp.id('line_2026-02-01') and part = 'interest';
select is(
  pg_temp.undo('f148-undo-part-3', 'loan_part_category', pg_temp.id('part_write'))->'error'->>'code',
  'conflict',
  'an undo after a part changed is a conflict, all or nothing'
);
select is(pg_temp.cat('2026-01-01', 'interest'), pg_temp.id('other'), 'the conflict left every part as it was');

-- null: back to what the payment would take today (here the loan's holding costs).
select is(
  pg_temp.set_part('f148-part-null', array['2026-01-01']::date[], 'interest', null)->'data'->'lines'->0->>'category_id',
  pg_temp.id('holding')::text,
  'no category puts the part back on the loan''s category'
);

-- set_loan_category_from: from March on, interest goes to rental interest.
select is(
  pg_temp.switch('f148-switch', 'interest', '2026-03-01', pg_temp.id('rental'))->'data'->>'undo_kind',
  'loan_category_from',
  'a switch is set'
);
select is(
  pg_temp.listed()->'category_switches',
  jsonb_build_array(jsonb_build_object(
    'part', 'interest', 'effective_date', '2026-03-01',
    'category_id', pg_temp.id('rental'), 'category_name', 'Example rental interest')),
  'list_loans shows the switch'
);
select is(pg_temp.cat('2026-01-01', 'interest'), pg_temp.id('holding'), 'without apply_to_existing an attached payment keeps its category');
select pg_temp.attach('f148-mar', '2026-03-01');
select pg_temp.attach('f148-feb20', '2026-02-20');
select is(pg_temp.cat('2026-03-01', 'interest'), pg_temp.id('rental'), 'a payment dated on the switch takes it');
select is(pg_temp.cat('2026-02-20', 'interest'), pg_temp.id('holding'), 'a payment dated before it, attached later, keeps the loan''s');
select is(pg_temp.cat('2026-03-01', 'escrow'), pg_temp.id('keyed_escrow'), 'a switch for interest leaves escrow alone');
select is(
  pg_temp.attach('f148-apr', '2026-04-01', pg_temp.id('other'))->>'ok',
  'true',
  'a category named on the attach still wins over a switch'
);
select is(pg_temp.cat('2026-04-01', 'interest'), pg_temp.id('other'), 'the named category is used');

-- Refusals.
select is(
  pg_temp.switch('f148-switch-early', 'interest', '2025-12-01', pg_temp.id('rental'))->'error'->>'message',
  'switch before the loan start',
  'a switch before the loan start is refused'
);
select is(
  pg_temp.switch('f148-switch-principal', 'principal', '2026-03-01', pg_temp.id('rental'))->'error'->>'message',
  'category does not fit the loan part',
  'a principal switch into the P&L is refused'
);
select is(
  pg_temp.switch('f148-switch-none', 'interest', '2026-06-01', null)->'error'->>'message',
  'switch not found',
  'removing a switch that is not there is refused'
);
select throws_ok(
  $$ insert into public.loan_category_switches (company_id, loan_id, part, effective_date, category_id)
     values (pg_temp.id('company'), pg_temp.id('loan'), 'principal', '2026-07-01', pg_temp.id('rental')) $$,
  '23514',
  'category does not fit the loan part',
  'the table refuses a category that does not fit, whoever writes'
);

-- apply_to_existing: from January on, interest to other interest. It moves the payments
-- dated from January until the March switch; March and April are left as they are.
insert into f148 (label, id)
select 'apply_write', (pg_temp.switch('f148-apply', 'interest', '2026-01-01', pg_temp.id('other'), true)->'data'->>'id')::uuid;
select is(pg_temp.cat('2026-01-01', 'interest'), pg_temp.id('other'), 'January moved');
select is(pg_temp.cat('2026-02-20', 'interest'), pg_temp.id('other'), 'the payment of 20 February moved');
select is(pg_temp.cat('2026-02-01', 'interest'), pg_temp.id('other'), 'February moved');
select is(pg_temp.cat('2026-03-01', 'interest'), pg_temp.id('rental'), 'March, under the next switch, did not');
select is(
  pg_temp.undo('f148-undo-apply', 'loan_category_from', pg_temp.id('apply_write'))->>'ok',
  'true',
  'undo of loan_category_from succeeds'
);
select is(
  (select array[pg_temp.cat('2026-01-01', 'interest'), pg_temp.cat('2026-02-20', 'interest'), pg_temp.cat('2026-02-01', 'interest')]),
  array[pg_temp.id('holding'), pg_temp.id('holding'), pg_temp.id('rental')],
  'undo puts each moved part back on its own category'
);
select is(
  jsonb_array_length(pg_temp.listed()->'category_switches'),
  1,
  'undo removes the switch it added'
);

-- Removing the March switch with apply_to_existing files March back under the loan's
-- category; its undo brings the switch and March's category back.
insert into f148 (label, id)
select 'remove_write', (pg_temp.switch('f148-remove', 'interest', '2026-03-01', null, true)->'data'->>'id')::uuid;
select is(pg_temp.cat('2026-03-01', 'interest'), pg_temp.id('holding'), 'with the switch gone, March is back in holding costs');
select is(
  pg_temp.undo('f148-undo-remove', 'loan_category_from', pg_temp.id('remove_write'))->>'ok',
  'true',
  'undo of a removal succeeds'
);
select is(
  (select array[w.category_id::text, pg_temp.cat('2026-03-01', 'interest')::text]
   from public.loan_category_switches w where w.loan_id = pg_temp.id('loan') and w.effective_date = '2026-03-01'),
  array[pg_temp.id('rental')::text, pg_temp.id('rental')::text],
  'the switch and March''s category are back'
);

-- A category a switch uses follows the loan rules: a principal one stays kept out, and
-- it cannot be deleted.
select pg_temp.switch('f148-switch-principal-out', 'principal', '2026-05-01', pg_temp.id('principal_out'));
select tests.authenticate_as('f148_owner');
select throws_ok(
  $$ select public.set_category_excluded_from_pnl(pg_temp.id('principal_out'), false) $$,
  '23514',
  'loan category is fixed',
  'a category a principal switch uses cannot be counted in the P&L'
);
reset role;
select pg_temp.switch('f148-switch-only', 'interest', '2026-06-01', pg_temp.id('switch_only'));
select tests.authenticate_as('f148_owner');
select throws_ok(
  $$ select public.delete_category(pg_temp.id('switch_only')) $$,
  null,
  'a loan uses this category',
  'a category only a switch uses cannot be deleted'
);

-- Moving a category's lines moves the switches too, and its undo moves them back.
reset role;
select tests.authenticate_as('f148_owner');
insert into f148 (label, id)
select 'move', (public.move_category_lines(pg_temp.id('switch_only'), pg_temp.id('rental'))->>'move_id')::uuid;
reset role;
select is(
  (select w.category_id from public.loan_category_switches w
   where w.loan_id = pg_temp.id('loan') and w.effective_date = '2026-06-01'),
  pg_temp.id('rental'),
  'the move took the switch to the other category'
);
select tests.authenticate_as('f148_owner');
select public.undo_category_move(pg_temp.id('move'));
reset role;
select is(
  (select w.category_id from public.loan_category_switches w
   where w.loan_id = pg_temp.id('loan') and w.effective_date = '2026-06-01'),
  pg_temp.id('switch_only'),
  'the move''s undo took it back'
);

-- Deleting the loan and restoring it keeps the switches.
select tests.authenticate_as('f148_owner');
select public.delete_loan(pg_temp.id('loan'));
reset role;
select is(
  (select count(*)::integer from public.loan_category_switches where loan_id = pg_temp.id('loan')),
  0,
  'the switches go with the deleted loan'
);
select tests.authenticate_as('f148_owner');
select public.restore_loan(pg_temp.id('loan'));
reset role;
select is(
  (select count(*)::integer from public.loan_category_switches where loan_id = pg_temp.id('loan')),
  3,
  'restoring the loan brings its switches back'
);

-- The loan split check's internal names come out in words.
select is(
  private.mcp_refused('loan_split_category')->'error'->>'message',
  'category does not fit the loan part',
  'loan_split_category reads as a category that does not fit'
);

select * from finish();

rollback;
