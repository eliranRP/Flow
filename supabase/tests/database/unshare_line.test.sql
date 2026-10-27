-- FLOW-150 (decision 0229): move a shared line back to one project. A property manager's fee is
-- shared 50/50 between two houses; from this year it serves one of them only. assign_expense with
-- unshare moves one line 100% to that house, keeps its category unless a new one is given, leaves the
-- other lines of the fee shared, and undoes back to the shares. assign_expenses does it per row.
-- Fixed dates. @example.com only.

begin;

select plan(26);

do $users$
begin
  perform tests.create_supabase_user('f150_owner', 'owner150@example.com');
end
$users$;

create temp table f150 (label text primary key, id uuid);
grant all on f150 to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
set search_path = ''
as $$
  select id from pg_temp.f150 where label = p_label;
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
  uid := tests.get_supabase_uid('f150_owner');
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

-- A fee of p_minor on a date, shared 50/50 between the two houses, under the label 'fee_<date>'.
create or replace function pg_temp.shared_fee(p_date date, p_minor bigint)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.transactions (
    company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
    vat_amount, vat_status, doc_date, cash_date, currency, source, idempotency_key, description
  )
  values (pg_temp.id('company'), 'expense', 'other', 'posted', -p_minor, -p_minor, p_minor, 0, 'unknown',
    p_date, p_date, 'USD', 'manual', 'f150:' || p_date::text, 'Example Property Managers')
  returning id into new_id;
  insert into pg_temp.f150 (label, id) values ('fee_' || p_date::text, new_id);
  perform pg_temp.as_mcp();
  perform public.mcp_assign_expense_split('f150-share-' || p_date::text, new_id, jsonb_build_array(
    jsonb_build_object('project_id', pg_temp.id('maple'), 'share', 50),
    jsonb_build_object('project_id', pg_temp.id('oak'), 'share', 50)
  ), pg_temp.id('management'));
  reset role;
  return new_id;
end;
$$;
grant execute on function pg_temp.shared_fee(date, bigint) to authenticated, service_role;

create or replace function pg_temp.assign(p_key text, p_date date, p_project uuid, p_category uuid, p_unshare boolean)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_assign_expense(p_key, pg_temp.id('fee_' || p_date::text), p_project, p_category, false, p_unshare);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.assign(text, date, uuid, uuid, boolean) to authenticated, service_role;

-- A project's cost in a year as get_project reads it: direct plus its share of shared lines, signed
-- as the P&L shows a cost (negative).
create or replace function pg_temp.cost(p_project text, p_year integer)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  result bigint;
begin
  perform tests.authenticate_as('f150_owner');
  select -coalesce(sum((b->>'direct_minor')::bigint + (b->>'shared_minor')::bigint), 0)
  into result
  from jsonb_array_elements(public.get_project(pg_temp.id(p_project), 'cash',
    make_date(p_year, 1, 1), make_date(p_year, 12, 31))->'by_currency') b
  where b->>'currency' = 'USD';
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.cost(text, integer) to authenticated, service_role;

create or replace function pg_temp.shares(p_date date)
returns integer
language sql
set search_path = ''
as $$
  select count(*)::integer from public.allocations a where a.transaction_id = pg_temp.id('fee_' || p_date::text);
$$;
grant execute on function pg_temp.shares(date) to authenticated, service_role;

select tests.authenticate_as('f150_owner');
select public.create_company('Example Houses Co', true);
reset role;
insert into f150 (label, id) select 'company', id from public.companies where name = 'Example Houses Co';
insert into public.projects (company_id, name, status)
values (pg_temp.id('company'), 'Example Maple House', 'active'), (pg_temp.id('company'), 'Example Oak House', 'active');
insert into f150 (label, id) select 'maple', id from public.projects where name = 'Example Maple House';
insert into f150 (label, id) select 'oak', id from public.projects where name = 'Example Oak House';
insert into public.categories (company_id, name, kind, sort_order)
values (pg_temp.id('company'), 'Example management', 'expense', 900), (pg_temp.id('company'), 'Example other fees', 'expense', 901);
insert into f150 (label, id) select 'management', id from public.categories where company_id = pg_temp.id('company') and name = 'Example management';
insert into f150 (label, id) select 'other_fees', id from public.categories where company_id = pg_temp.id('company') and name = 'Example other fees';
select public.store_mcp_credential(
  tests.get_supabase_uid('f150_owner'), 'hash-f150-write-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into f150 (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-f150-write-1';

-- Last year's fee and this year's three, each 100.00 shared 50/50.
select pg_temp.shared_fee('2025-11-11', 10000);
select pg_temp.shared_fee('2026-02-11', 10000);
select pg_temp.shared_fee('2026-03-11', 10000);
select pg_temp.shared_fee('2026-04-11', 10000);

select is(
  (select t.pnl_role::text from public.transactions t where t.id = pg_temp.id('fee_2026-03-11')),
  'shared',
  'the fee is a shared line'
);
select is(pg_temp.cost('maple', 2026), -15000::bigint, 'the house has half of this year''s fees');

-- A plain assign still refuses a shared line.
select is(
  pg_temp.assign('f150-plain', '2026-03-11', pg_temp.id('maple'), pg_temp.id('management'), false)->'error'->>'message',
  'shared costs are split, not assigned to one project',
  'without unshare a shared line is refused'
);

-- unshare: March goes 100% to the house; its category stays.
select is(
  pg_temp.assign('f150-march', '2026-03-11', pg_temp.id('maple'), null, true)->'data'->>'unshared',
  'true',
  'assign_expense with unshare moves the shared line'
);
select is(
  (select jsonb_build_object('role', t.pnl_role, 'project', t.project_id = pg_temp.id('maple'), 'category', t.category_id = pg_temp.id('management'))
   from public.transactions t where t.id = pg_temp.id('fee_2026-03-11')),
  '{"role": "project", "project": true, "category": true}'::jsonb,
  'the line is the house''s, under its own category'
);
select is(
  (select jsonb_agg(jsonb_build_object('project', a.project_id = pg_temp.id('maple'), 'bp', a.share_bp, 'net', a.amount_net))
   from public.allocations a where a.transaction_id = pg_temp.id('fee_2026-03-11')),
  '[{"project": true, "bp": 10000, "net": -10000}]'::jsonb,
  'its one share is the whole line on the house'
);
select is(pg_temp.cost('maple', 2026), -20000::bigint, 'the house''s cost rises by the other half');
select is(pg_temp.cost('oak', 2026), -10000::bigint, 'the other house''s cost drops by it');
select is(pg_temp.shares('2026-02-11'), 2, 'the other lines of the fee stay shared');
select is(pg_temp.shares('2025-11-11'), 2, 'last year''s fee stays shared');
select is(pg_temp.cost('oak', 2025), -5000::bigint, 'and last year''s P&L does not move');
select is(
  pg_temp.assign('f150-march', '2026-03-11', pg_temp.id('maple'), null, true),
  pg_temp.assign('f150-march', '2026-03-11', pg_temp.id('maple'), null, true),
  'a replay with the same key returns the same response'
);

-- Undo puts the shares and the shared role back.
select is(
  (select public.mcp_undo('f150-undo-march', 'reassign',
     (pg_temp.assign('f150-march', '2026-03-11', pg_temp.id('maple'), null, true)->'data'->>'id')::uuid)->>'ok'
   from (select pg_temp.as_mcp()) x),
  'true',
  'undo of the reassign succeeds'
);
reset role;
select is(pg_temp.shares('2026-03-11'), 2, 'the shares are back');
select is(
  (select t.pnl_role::text from public.transactions t where t.id = pg_temp.id('fee_2026-03-11')),
  'shared',
  'and the line is shared again'
);
select is(pg_temp.cost('maple', 2026), -15000::bigint, 'the house is back to half');

-- A new category may be given with unshare.
select is(
  pg_temp.assign('f150-april', '2026-04-11', pg_temp.id('oak'), pg_temp.id('other_fees'), true)->>'ok',
  'true',
  'unshare with a new category'
);
select is(
  (select t.category_id from public.transactions t where t.id = pg_temp.id('fee_2026-04-11')),
  pg_temp.id('other_fees'),
  'the line takes the new category'
);

-- Refusals.
select is(
  pg_temp.assign('f150-no-project', '2026-02-11', null, null, true)->'error'->>'code',
  'validation',
  'unshare needs a project'
);
select is(
  (select public.mcp_assign_expense('f150-no-category', pg_temp.id('fee_2026-02-11'), pg_temp.id('maple'), null, false, false)->'error'->>'code'
   from (select pg_temp.as_mcp()) x),
  'validation',
  'without unshare a category is still required'
);
reset role;
select is(
  pg_temp.assign('f150-other-project', '2026-02-11', gen_random_uuid(), null, true)->'error'->>'message',
  'project or category not found',
  'an unknown project is refused'
);
select is(pg_temp.shares('2026-02-11'), 2, 'a refused unshare leaves the shares');

-- assign_expenses: unshare per row, one undo_batch.
select is(
  (select jsonb_agg(r->>'ok') from jsonb_array_elements((
     select public.mcp_assign_expenses('f150-batch', jsonb_build_array(
       jsonb_build_object('transaction_id', pg_temp.id('fee_2026-02-11'), 'project_id', pg_temp.id('maple'), 'unshare', true),
       jsonb_build_object('transaction_id', pg_temp.id('fee_2026-03-11'), 'project_id', pg_temp.id('maple'), 'unshare', true)
     )) from (select pg_temp.as_mcp()) x)->'data'->'results') r),
  '["true", "true"]'::jsonb,
  'assign_expenses unshares each row'
);
reset role;
-- February and March are the house's now; April went to the other house above.
select is(pg_temp.cost('maple', 2026), -20000::bigint, 'both lines are the house''s');
select is(
  (select public.mcp_assign_expenses('f150-batch-bad', jsonb_build_array(
     jsonb_build_object('transaction_id', pg_temp.id('fee_2025-11-11'), 'unshare', true, 'shares', '[]'::jsonb)
   ))->'data'->'results'->0->>'code' from (select pg_temp.as_mcp()) x),
  'validation',
  'unshare with shares is a validation error'
);
reset role;

select is(
  (select t.pnl_role::text from public.transactions t where t.id = pg_temp.id('fee_2025-11-11')),
  'shared',
  'the refused row left last year''s fee shared'
);

select * from finish();

rollback;
