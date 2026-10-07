-- FLOW-108. One line in or out of the P&L: precedence over the category on both bases,
-- the owner API, MCP set_line_pnl and set_lines_pnl, undo, undo_batch, cross-tenant.
-- Invented data only. Amounts are agorot.

begin;

select plan(50);

do $users$
begin
  perform tests.create_supabase_user('lpo_owner', 'lpo-owner@example.com');
  perform tests.create_supabase_user('lpo_other', 'lpo-other@example.com');
  perform tests.create_supabase_user('lpo_viewer', 'lpo-viewer@example.com');
  perform tests.create_supabase_user('lpo_demo', 'lpo-demo@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('lpo_owner'), 'Example Override LLC', false),
  (tests.get_supabase_uid('lpo_other'), 'Example Next Door LLC', false),
  (tests.get_supabase_uid('lpo_demo'), 'Example Demo LLC', true);

create temp table lpo (label text primary key, id uuid);
grant all on lpo to authenticated, service_role;
insert into lpo (label, id) select 'co', id from public.companies where name = 'Example Override LLC';
insert into lpo (label, id) select 'other_co', id from public.companies where name = 'Example Next Door LLC';
insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('lpo_viewer'), id from public.companies where name = 'Example Demo LLC';

insert into public.projects (company_id, name, status)
values ((select id from lpo where label = 'co'), 'North', 'active');
insert into lpo (label, id) select 'north', id from public.projects where name = 'North';

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values
  ((select id from lpo where label = 'co'), 'Rent in', 'income', 90, false, false),
  ((select id from lpo where label = 'co'), 'Parts', 'expense', 91, false, false),
  ((select id from lpo where label = 'co'), 'Held deposits', 'expense', 92, false, true);
insert into lpo (label, id) select 'cat_' || lower(replace(name, ' ', '_')), id
from public.categories where name in ('Rent in', 'Parts', 'Held deposits');
insert into lpo (label, id)
select 'cat_principal', id from public.categories
where company_id = (select id from lpo where label = 'co') and loan_part = 'principal';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description
)
select
  (select id from lpo where label = v.co),
  v.direction::public.txn_direction, v.doc_kind::public.doc_kind, v.pnl_role::public.pnl_role,
  'posted', 'ILS', v.amount, v.amount, abs(v.amount), 0, 'source',
  '2026-06-10', '2026-06-10', 'manual', v.ikey,
  case when v.co = 'co' then (select id from lpo where label = 'north') end,
  (select id from lpo where label = v.cat),
  v.ikey
from (values
  ('co',       'income',  'receipt', null,       100000, 'lpo:rent',    'cat_rent_in'),
  ('co',       'expense', 'expense', 'project',  -40000, 'lpo:parts',   'cat_parts'),
  ('co',       'expense', 'expense', 'project',  -10000, 'lpo:deposit', 'cat_held_deposits'),
  ('co',       'expense', 'expense', 'project',  -30000, 'lpo:loan',    'cat_principal'),
  ('other_co', 'expense', 'expense', null,       -20000, 'lpo:foreign', null)
) as v(co, direction, doc_kind, pnl_role, amount, ikey, cat);
insert into lpo (label, id) select replace(idempotency_key, 'lpo:', 'txn_'), id
from public.transactions where idempotency_key like 'lpo:%';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values
  (tests.get_supabase_uid('lpo_owner'), (select id from lpo where label = 'co'), 'hash-lpo-write', 'kid', array['write']::text[], '2099-01-01'),
  (tests.get_supabase_uid('lpo_owner'), (select id from lpo where label = 'co'), 'hash-lpo-read', 'kid', array['read']::text[], '2099-01-01');
insert into lpo (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-lpo-write';
insert into lpo (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-lpo-read';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('lpo_owner');
  tid uuid;
begin
  select id into tid from pg_temp.lpo where label = p_label;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

-- company_pnl figures for June 2026 on one basis.
create or replace function pg_temp.pnl(p_basis text, p_key text)
returns bigint
language sql
as $$
  select (public.company_pnl(
    (select id from pg_temp.lpo where label = 'co'), '2026-06-01', '2026-06-30', p_basis
  )->>p_key)::bigint;
$$;
grant execute on function pg_temp.pnl(text, text) to authenticated, service_role;

create or replace function pg_temp.txn(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.lpo where label = p_label; $$;
grant execute on function pg_temp.txn(text) to authenticated, service_role;

-- Baseline: rent and parts count; the held deposit is kept out by its category.
select tests.authenticate_as('lpo_owner');
select is(pg_temp.pnl('cash', 'income_agorot'), 100000::bigint, 'baseline income counts the rent');
-- The loan principal line is kept out by its category too.
select is(pg_temp.pnl('cash', 'excluded_expense_agorot'), 40000::bigint, 'baseline kept-out expense is the deposit and the principal');
select is(
  (public.get_transaction(pg_temp.txn('txn_parts'))->>'in_pnl')::boolean, true,
  'get_transaction: an ordinary line is in the P&L'
);
select is(
  public.get_transaction(pg_temp.txn('txn_parts'))->'in_pnl_override', 'null'::jsonb,
  'get_transaction: no override by default'
);
select is(
  (public.get_transaction(pg_temp.txn('txn_deposit'))->>'category_excluded_from_pnl')::boolean, true,
  'get_transaction: says the category is kept out'
);

-- App API: take the rent out, bring the deposit in.
select lives_ok(
  $$select public.set_transaction_pnl(pg_temp.txn('txn_rent'), false)$$,
  'owner takes one income line out'
);
select lives_ok(
  $$select public.set_transaction_pnl(pg_temp.txn('txn_deposit'), true)$$,
  'owner brings one line of a kept-out category in'
);
select is(pg_temp.pnl('cash', 'income_agorot'), 0::bigint, 'cash: the rent left income');
select is(pg_temp.pnl('cash', 'excluded_income_agorot'), 100000::bigint, 'cash: the rent moved to kept-out income');
select is(pg_temp.pnl('invoiced', 'direct_agorot'), 50000::bigint, 'invoiced: the deposit counts as direct cost');
select is(pg_temp.pnl('cash', 'net_profit_agorot'), -50000::bigint, 'cash: net profit drops the rent and adds the deposit');
select is(pg_temp.pnl('cash', 'excluded_expense_agorot'), 30000::bigint, 'cash: the override wins over the kept-out category');
select is(pg_temp.pnl('invoiced', 'excluded_expense_agorot'), 30000::bigint, 'invoiced: the override wins over the kept-out category');
select is(pg_temp.pnl('cash', 'direct_agorot'), 50000::bigint, 'cash: the deposit now counts as direct cost');
select is(
  (public.get_transaction(pg_temp.txn('txn_rent'))->>'in_pnl')::boolean, false,
  'get_transaction: the rent reads out'
);
select is(
  (select l.in_pnl from private.pnl_lines l where l.transaction_id = pg_temp.txn('txn_deposit')), true,
  'pnl_lines: the deposit counts'
);
select is(
  (select coalesce(sum((x->>'amount_minor')::bigint), 0)
   from jsonb_array_elements(public.get_project(pg_temp.txn('north'), 'cash')->'categories_by_currency') x)::bigint,
  50000::bigint,
  'get_project: the category list counts parts and the forced-in deposit'
);
select is(
  (select coalesce(sum((x->>'amount_minor')::bigint), 0)
   from jsonb_array_elements(public.get_project(pg_temp.txn('north'), 'cash')->'excluded_categories_by_currency') x)::bigint,
  30000::bigint,
  'get_project: only the principal stays kept out once the deposit is forced in'
);
select is(
  (public.get_breakdown('income', '2026-06-01', '2026-06-30', 'category', 'cash')->'excluded'->0->>'amount_minor')::bigint,
  100000::bigint,
  'breakdown: the rent shows in the kept-out group'
);

-- Clearing the override follows the category again.
select lives_ok(
  $$select public.set_transaction_pnl(pg_temp.txn('txn_deposit'), null)$$,
  'owner clears the override'
);
select is(pg_temp.pnl('cash', 'excluded_expense_agorot'), 40000::bigint, 'cleared: the deposit follows its category again');

-- Guards.
select throws_ok(
  $$select public.set_transaction_pnl(pg_temp.txn('txn_loan'), false)$$,
  'P0001', 'loan line is fixed',
  'a loan category line is refused'
);
select throws_ok(
  $$select public.set_transaction_pnl(pg_temp.txn('txn_foreign'), false)$$,
  'P0001', 'transaction not found',
  'another company''s line is refused'
);
select is(
  (select in_pnl_override from public.transactions where id = pg_temp.txn('txn_rent')), false,
  'positive control: the owner''s own line keeps its override'
);
reset role;
select is(
  (select in_pnl_override from public.transactions where id = pg_temp.txn('txn_foreign')), null::boolean,
  'the other company''s line is unchanged'
);
select tests.authenticate_as('lpo_viewer');
select throws_ok(
  $$select public.set_transaction_pnl(pg_temp.txn('txn_rent'), true)$$,
  '42501', 'forbidden',
  'a viewer is refused'
);
reset role;
select is(
  has_function_privilege('anon', 'public.set_transaction_pnl(uuid, boolean)', 'execute'),
  false,
  'anon cannot call set_transaction_pnl'
);
-- Back to a clean slate for the MCP part.
update public.transactions set in_pnl_override = null where company_id = (select id from lpo where label = 'co');

-- MCP: scope, validation, write, replay, undo, conflict.
select pg_temp.as_mcp('read');
select is(
  public.mcp_set_line_pnl('k-read', pg_temp.txn('txn_parts'), false)->'error'->>'code', 'forbidden',
  'a read token cannot write'
);
reset role;
select pg_temp.as_mcp('write');
select is(
  public.mcp_set_line_pnl('', pg_temp.txn('txn_parts'), false)->'error'->>'code', 'validation',
  'an empty key is refused'
);
select is(
  (public.mcp_set_line_pnl('k-1', pg_temp.txn('txn_parts'), false)->'data'->>'in_pnl')::boolean, false,
  'set_line_pnl takes the parts line out'
);
select is(
  public.mcp_set_line_pnl('k-1', pg_temp.txn('txn_parts'), false)->'data'->>'undo_kind', 'line_pnl',
  'the same key and body replays'
);
select is(
  public.mcp_set_line_pnl('k-1', pg_temp.txn('txn_parts'), true)->'error'->>'code', 'conflict',
  'the same key with another body is a conflict'
);
select is(
  public.mcp_set_line_pnl('k-foreign', pg_temp.txn('txn_foreign'), false)->'error'->>'code', 'refused',
  'another company''s line is refused over MCP'
);
select is(
  public.mcp_set_line_pnl('k-loan', pg_temp.txn('txn_loan'), false)->'error'->>'message', 'loan line is fixed',
  'a loan line is refused over MCP'
);
select is(pg_temp.pnl('cash', 'excluded_expense_agorot'), 80000::bigint, 'MCP: parts moved to kept-out expense');
select is(
  public.mcp_undo('u-1', 'line_pnl', pg_temp.txn('txn_parts'))->>'ok', 'true',
  'undo restores the line'
);
select is(pg_temp.pnl('cash', 'excluded_expense_agorot'), 40000::bigint, 'undo: parts count again');
select is(
  (public.mcp_set_line_pnl('k-2', pg_temp.txn('txn_parts'), false)->>'ok'), 'true',
  'take the parts line out again'
);
reset role;
select tests.authenticate_as('lpo_owner');
select lives_ok(
  $$select public.set_transaction_pnl(pg_temp.txn('txn_parts'), null)$$,
  'the owner changes it in the app'
);
reset role;
select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('u-2', 'line_pnl', pg_temp.txn('txn_parts'))->'error'->>'code', 'conflict',
  'undo after an app change is a conflict'
);

-- MCP batch: partial success, then undo_batch.
select is(
  public.mcp_set_lines_pnl('b-dup', jsonb_build_array(
    jsonb_build_object('transaction_id', pg_temp.txn('txn_rent'), 'in_pnl', false),
    jsonb_build_object('transaction_id', pg_temp.txn('txn_rent'), 'in_pnl', true)
  ))->'error'->>'code', 'validation',
  'a batch with the same line twice is refused'
);
create temp table lpo_batch as
select public.mcp_set_lines_pnl('b-1', jsonb_build_array(
  jsonb_build_object('transaction_id', pg_temp.txn('txn_rent'), 'in_pnl', false),
  jsonb_build_object('transaction_id', pg_temp.txn('txn_deposit'), 'in_pnl', true),
  jsonb_build_object('transaction_id', pg_temp.txn('txn_foreign'), 'in_pnl', false),
  jsonb_build_object('transaction_id', pg_temp.txn('txn_parts'), 'in_pnl', 'yes')
)) as body;
select is((select (body->'data'->>'ok_count')::int from lpo_batch), 2, 'batch: two rows written');
select is(
  (select body->'data'->'results'->2->>'code' || '/' || (body->'data'->'results'->3->>'code') from lpo_batch),
  'refused/validation',
  'batch: the foreign row is refused and the bad row fails validation'
);
select is(pg_temp.pnl('cash', 'income_agorot') + pg_temp.pnl('cash', 'excluded_expense_agorot'), 30000::bigint,
  'batch: rent out and deposit in');
select is(
  (public.mcp_undo_batch('ub-1', (select body->'data'->>'batch_key' from lpo_batch))->'data'->>'ok_count')::int, 2,
  'undo_batch undoes both rows'
);
select is(pg_temp.pnl('cash', 'income_agorot'), 100000::bigint, 'undo_batch: the rent counts again');

-- An override left on a line that later becomes a loan line never moves the loan part,
-- because the owner can no longer clear it (loan line is fixed).
reset role;
select tests.authenticate_as('lpo_owner');
select lives_ok(
  $$select public.set_transaction_pnl(pg_temp.txn('txn_parts'), false)$$,
  'stale: the owner takes the parts line out'
);
select lives_ok(
  $$select public.set_transaction_category(
    pg_temp.txn('txn_parts'),
    (select c.id from public.categories c where c.company_id = pg_temp.txn('co') and c.loan_part = 'interest')
  )$$,
  'stale: the line is then filed as loan interest'
);
select is(
  (select l.in_pnl from private.pnl_lines l where l.transaction_id = pg_temp.txn('txn_parts')), true,
  'stale: loan interest counts by its category, whatever the old override says'
);
select is(
  (public.get_transaction(pg_temp.txn('txn_parts'))->>'in_pnl')::boolean, true,
  'stale: get_transaction agrees with the P&L'
);

reset role;
select * from finish();
rollback;
