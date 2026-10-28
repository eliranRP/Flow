-- FLOW-949. A normal part and a gross-up part may share a category and project on one line
-- (decision 0207, amended). The per-(category, project) key of save_line_split and of the
-- the split parts' unique key includes gross_up: one normal and one gross-up part per pair;
-- two of the same kind are still 'same category and project twice'. Category merges follow the same
-- key, and a shared line's project cash keeps the two parts apart. Invented books only; USD cents.

begin;

select plan(43);

do $users$
begin
  perform tests.create_supabase_user('gsc_owner', 'gsc-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('gsc_owner'), 'Example Same Pair LLC', false);

create temp table gsc (label text primary key, id uuid);
grant all on gsc to authenticated, service_role;
insert into gsc (label, id) select 'co', id from public.companies where name = 'Example Same Pair LLC';

insert into public.projects (company_id, name, status)
select (select id from gsc where label = 'co'), v.name, 'active'
from (values ('Alpha'), ('Beta')) as v(name);
insert into gsc (label, id) select lower(name), id from public.projects
where company_id = (select id from gsc where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default)
select (select id from gsc where label = 'co'), v.name, v.kind::public.category_kind, 90, false
from (values ('Build', 'expense'), ('Taxes', 'expense'), ('Levy', 'expense'), ('OtherInc', 'income'), ('Rent', 'income'))
  as v(name, kind);
insert into gsc (label, id) select lower(name), id from public.categories
where company_id = (select id from gsc where label = 'co') and name in ('Build', 'Taxes', 'Levy', 'OtherInc', 'Rent');

-- A payment filed to Build. pay is the headline (2000 + 249.48 - 850.77 = 1398.71) on Beta; the
-- merge and shared lines come in their own sections, so the headline totals read pay alone.
create function pg_temp.line(p_key text, p_role text, p_amount bigint, p_project text) returns void
language sql
as $$
  insert into public.transactions (
    company_id, direction, doc_kind, pnl_role, line_status, currency,
    amount_gross, amount_net, amount_original, vat_amount, vat_status,
    doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
  )
  values ((select id from gsc where label = 'co'), 'expense', 'expense', p_role::public.pnl_role, 'posted', 'USD',
    p_amount, p_amount, abs(p_amount), 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'gsc:' || p_key,
    (select id from gsc where label = p_project), (select id from gsc where label = 'build'), p_key, true);
  insert into gsc (label, id) select 'txn_' || p_key, id from public.transactions where idempotency_key = 'gsc:' || p_key;
$$;
select pg_temp.line('pay', 'project', -139871, 'beta');

create function pg_temp.part(p_category text, p_amount bigint, p_project text default null,
  p_gross_up boolean default false)
returns jsonb
language sql
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'category_id', (select id from gsc where label = p_category),
    'project_id', (select id from gsc where label = p_project),
    'amount_minor', p_amount,
    'gross_up', p_gross_up
  ))
$$;
grant execute on function pg_temp.part(text, bigint, text, boolean) to authenticated, service_role;

-- The headline parts: Build on Beta, then the Taxes cost and its contra credit, both on Alpha.
create function pg_temp.headline() returns jsonb
language sql
as $$
  select jsonb_build_array(
    pg_temp.part('build', 200000, 'beta'),
    pg_temp.part('taxes', 24948, 'alpha'),
    pg_temp.part('taxes', 85077, 'alpha', true))
$$;
grant execute on function pg_temp.headline() to authenticated, service_role;

create function pg_temp.cur(p_basis text) returns jsonb
language sql
as $$
  select x from jsonb_array_elements(public.get_dashboard(null, null, p_basis) -> 'by_currency') x
  where x ->> 'currency' = 'USD'
$$;
grant execute on function pg_temp.cur(text) to authenticated;

create function pg_temp.bd(p_direction text, p_basis text, p_category text) returns bigint
language sql
as $$
  select (g ->> 'amount_minor')::bigint
  from jsonb_array_elements(public.get_breakdown(p_direction, null, null, 'category', p_basis) -> 'groups') g
  where g ->> 'key' = (select id::text from gsc where label = p_category)
$$;
grant execute on function pg_temp.bd(text, text, text) to authenticated;

-- A project's USD cash net in June 2026.
create function pg_temp.cash(p_project text) returns bigint
language sql
as $$
  select (c ->> 'net_minor')::bigint
  from jsonb_array_elements(public.projects_cash_month('2026-06-01') -> 'projects') p
  cross join jsonb_array_elements(p -> 'cash') c
  where p ->> 'id' = (select id::text from gsc where label = p_project) and c ->> 'currency' = 'USD'
$$;
grant execute on function pg_temp.cash(text) to authenticated;

-- A line's parts as (category label, project label, amount, gross_up) text, in stored order.
create function pg_temp.parts_of(p_line text) returns text
language sql
as $$
  select string_agg(format('%s/%s/%s/%s', c.label, coalesce(p.label, '-'), s.amount_minor, s.gross_up::text), ' ' order by s.ordinal)
  from private.split_parts s
  join gsc c on c.id = s.category_id
  left join gsc p on p.id = s.project_id
  where s.transaction_id = (select id from gsc where label = p_line)
$$;
grant execute on function pg_temp.parts_of(text) to authenticated;

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('gsc_owner'), (select id from gsc where label = 'co'),
  'hash-gsc-write', 'kid', array['write']::text[], '2099-01-01');
insert into gsc (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-gsc-write';

create function pg_temp.as_mcp() returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('gsc_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1',
    'mcp_tid', (select id from pg_temp.gsc where label = 'write'))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

select tests.authenticate_as('gsc_owner');

-- ===========================================================================
-- The two-sided booking first (the 850.77 on Other income), for the comparison.
-- ===========================================================================
select lives_ok(
  $$select public.save_line_split((select id from gsc where label = 'txn_pay'), jsonb_build_array(
    pg_temp.part('build', 200000, 'beta'),
    pg_temp.part('taxes', 24948, 'alpha'),
    pg_temp.part('otherinc', 85077, 'alpha', true)))$$,
  'the two-sided split saves');
create temp table gsc_two_sided as
select (pg_temp.cur('cash') ->> 'income_minor')::bigint as income, (pg_temp.cur('cash') ->> 'expense_minor')::bigint as expense;
grant select on gsc_two_sided to authenticated;
select is((select income from gsc_two_sided), 85077::bigint, 'two-sided: Other income is 850.77');

-- ===========================================================================
-- The same-pair split: a normal Taxes cost and a gross-up Taxes contra credit, both on Alpha.
-- ===========================================================================
select lives_ok(
  $$select public.save_line_split((select id from gsc where label = 'txn_pay'), pg_temp.headline())$$,
  'a normal and a gross-up part on the same category and project save');
select is(pg_temp.parts_of('txn_pay'), 'build/beta/200000/false taxes/alpha/24948/false taxes/alpha/85077/true',
  'both Taxes/Alpha parts are stored, as two rows');
select is(pg_temp.bd('expense', 'cash', 'taxes'), -60129::bigint,
  'Taxes nets to a 601.29 credit (249.48 cost less the 850.77 contra credit)');
select is(pg_temp.bd('expense', 'cash', 'build'), 200000::bigint, 'Build is 2000');
select is(coalesce(pg_temp.bd('income', 'cash', 'otherinc'), 0), 0::bigint, 'Other income is 0');
select is(
  (pg_temp.cur('cash') ->> 'income_minor')::bigint - (pg_temp.cur('cash') ->> 'expense_minor')::bigint,
  (select income - expense from gsc_two_sided),
  'the P&L total is unchanged vs the two-sided booking');
select is((pg_temp.cur('cash') ->> 'expense_minor')::bigint, 139871::bigint,
  'the expense is the bank amount: 2000 less the 601.29 credit');
select is((pg_temp.cur('invoiced') ->> 'expense_minor')::bigint, (pg_temp.cur('cash') ->> 'expense_minor')::bigint,
  'cash and invoiced agree');
select is(pg_temp.cash('alpha') + pg_temp.cash('beta'), -139871::bigint,
  'the projects'' cash sums to the bank line');
select is(pg_temp.cash('alpha'), 60129::bigint, 'Alpha''s cash is the net 601.29 credit');
select is(
  (select string_agg(coalesce(x ->> 'effect', '-'), ' ' order by o)
   from jsonb_array_elements(public.get_line_split((select id from gsc where label = 'txn_pay')) -> 'parts')
     with ordinality as p(x, o)),
  '- - contra', 'get_line_split reports the gross-up part as contra, the normal ones without an effect');
select is(public.get_line_split((select id from gsc where label = 'txn_pay')) -> 'parts_match', 'true'::jsonb,
  'the signed parts match the line');

-- ===========================================================================
-- Real duplicates are still refused.
-- ===========================================================================
select throws_ok(
  $$select public.save_line_split((select id from gsc where label = 'txn_pay'), jsonb_build_array(
    pg_temp.part('build', 200000, 'beta'),
    pg_temp.part('taxes', 24948, 'alpha'),
    pg_temp.part('taxes', 1, 'alpha'),
    pg_temp.part('levy', 85077, 'alpha', true)))$$,
  'P0001', 'same category and project twice', 'two normal parts on one category and project are refused');
select throws_ok(
  $$select public.save_line_split((select id from gsc where label = 'txn_pay'), jsonb_build_array(
    pg_temp.part('build', 225025, 'beta'),
    pg_temp.part('taxes', 85077, 'alpha', true),
    pg_temp.part('taxes', 77, 'alpha', true)))$$,
  'P0001', 'same category and project twice', 'two gross-up parts on one category and project are refused');
select throws_ok(
  $$select public.save_line_split((select id from gsc where label = 'txn_pay'), jsonb_build_array(
    pg_temp.part('taxes', 24948),
    pg_temp.part('taxes', 114923, 'beta')))$$,
  'P0001', 'same category and project twice', 'a part with no project still pairs with the line''s project');
select is(pg_temp.parts_of('txn_pay'), 'build/beta/200000/false taxes/alpha/24948/false taxes/alpha/85077/true',
  'the refused saves changed nothing');
-- The writer holds the same key.
reset role;
select throws_ok(
  format($$select tests.line_split(%L, jsonb_build_array(
      jsonb_build_object('category_id', %L, 'project_id', %L, 'amount_minor', 2, 'gross_up', true),
      jsonb_build_object('category_id', %L, 'project_id', %L, 'amount_minor', 1, 'gross_up', true)))$$,
    (select id from gsc where label = 'txn_pay'),
    (select id from gsc where label = 'taxes'), (select id from gsc where label = 'alpha'),
    (select id from gsc where label = 'taxes'), (select id from gsc where label = 'alpha')),
  '23505', null, 'the writer refuses a second gross-up part on one category and project');
select tests.authenticate_as('gsc_owner');

-- ===========================================================================
-- Undo (MCP) restores the prior split, both ways.
-- ===========================================================================
select pg_temp.as_mcp();
select ok(public.mcp_split_line('gsc-k1', (select id from gsc where label = 'txn_pay'), jsonb_build_array(
    pg_temp.part('build', 200000, 'beta'),
    pg_temp.part('taxes', 24948, 'alpha'),
    pg_temp.part('otherinc', 85077, 'alpha', true))) -> 'data' ? 'parts',
  'MCP replaces the same-pair split with the two-sided one');
select is(public.mcp_undo('gsc-u1', 'line_split', (select id from gsc where label = 'txn_pay')) ->> 'ok', 'true',
  'undo of that write succeeds');
select is(pg_temp.parts_of('txn_pay'), 'build/beta/200000/false taxes/alpha/24948/false taxes/alpha/85077/true',
  'undo restored the same-pair split');
select ok(public.mcp_split_line('gsc-k2', (select id from gsc where label = 'txn_pay'), jsonb_build_array(
    pg_temp.part('build', 139871, 'beta'),
    pg_temp.part('taxes', 24948, 'alpha'),
    pg_temp.part('taxes', 24948, 'alpha', true))) -> 'data' ? 'parts',
  'MCP saves another same-pair split');
select is(public.mcp_undo('gsc-u2', 'line_split', (select id from gsc where label = 'txn_pay')) ->> 'ok', 'true',
  'undo of the second write succeeds');
select is(pg_temp.parts_of('txn_pay'), 'build/beta/200000/false taxes/alpha/24948/false taxes/alpha/85077/true',
  'undo restored the prior split again');
select is(public.mcp_split_line('gsc-k3', (select id from gsc where label = 'txn_pay'), jsonb_build_array(
    pg_temp.part('build', 139871, 'beta'),
    pg_temp.part('taxes', 100, 'alpha'),
    pg_temp.part('taxes', 100, 'alpha', false),
    pg_temp.part('levy', 200, 'alpha', true))) -> 'error' ->> 'message',
  'same category and project twice', 'MCP names a real duplicate');
select tests.authenticate_as('gsc_owner');

-- ===========================================================================
-- Category merge follows the same key: parts that differ only by gross_up move side by side.
-- ===========================================================================
reset role;
select pg_temp.line('merge', 'project', -50000, 'beta');
select tests.authenticate_as('gsc_owner');
select lives_ok(
  $$select public.save_line_split((select id from gsc where label = 'txn_merge'), jsonb_build_array(
    pg_temp.part('build', 40000, 'beta'),
    pg_temp.part('taxes', 30000, 'alpha'),
    pg_temp.part('levy', 20000, 'alpha', true)))$$,
  'a line with a normal Taxes part and a gross-up Levy part on Alpha saves');
create temp table gsc_move (body jsonb);
grant all on gsc_move to authenticated;
select lives_ok(
  $$insert into gsc_move select public.move_category_lines((select id from gsc where label = 'levy'), (select id from gsc where label = 'taxes'))$$,
  'a normal Taxes part and a gross-up Levy part on one project merge into Taxes');
select is(pg_temp.parts_of('txn_merge'), 'build/beta/40000/false taxes/alpha/30000/false taxes/alpha/20000/true',
  'the two parts stay separate rows, not summed');
select is(public.get_line_split((select id from gsc where label = 'txn_merge')) -> 'parts_match', 'true'::jsonb,
  'the merged split still matches the line');
select lives_ok(format('select public.undo_category_move(%L)', (select body ->> 'move_id' from gsc_move)),
  'the merge undoes');
select is(pg_temp.parts_of('txn_merge'), 'build/beta/40000/false taxes/alpha/30000/false levy/alpha/20000/true',
  'undo puts the gross-up part back on Levy');
select lives_ok(
  $$select public.save_line_split((select id from gsc where label = 'txn_merge'), jsonb_build_array(
    pg_temp.part('build', 90000, 'beta'),
    pg_temp.part('taxes', 20000, 'alpha', true),
    pg_temp.part('levy', 20000, 'alpha', true)))$$,
  'the line now has a gross-up part in each category on Alpha');
select throws_ok(
  $$select public.move_category_lines((select id from gsc where label = 'levy'), (select id from gsc where label = 'taxes'))$$,
  'a split line has both categories', 'two gross-up parts that would share a pair still refuse the merge');

-- ===========================================================================
-- A shared line: the project cash keeps two parts of one category apart and sums to the bank line.
-- ===========================================================================
reset role;
select pg_temp.line('shared', 'shared', -100000, null);
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from gsc where label = 'co'), (select id from gsc where label = 'txn_shared'),
  (select id from gsc where label = v.project), 5000, -50000
from (values ('alpha'), ('beta')) as v(project);
select tests.authenticate_as('gsc_owner');
select lives_ok(
  $$select public.save_line_split((select id from gsc where label = 'txn_shared'), jsonb_build_array(
    pg_temp.part('build', 100000),
    pg_temp.part('rent', 20000, 'alpha'),
    pg_temp.part('rent', 20000, 'alpha', true)))$$,
  'a shared line takes a normal and a gross-up Rent part on Alpha');
select is(
  (select sum((c ->> 'net_minor')::bigint)::bigint
   from jsonb_array_elements(public.projects_cash_month('2026-06-01') -> 'projects') p
   cross join jsonb_array_elements(p -> 'cash') c
   where c ->> 'currency' = 'USD') - pg_temp.cash('alpha') - pg_temp.cash('beta'),
  0::bigint, 'only Alpha and Beta hold cash');
-- pay puts +601.29 on Alpha, merge's two gross-up credits +400 (its Build is on Beta), and the
-- shared line -500 on each project.
select is(pg_temp.cash('alpha') + pg_temp.cash('beta'), -289871::bigint,
  'the projects'' cash sums to the three bank lines');
select is(pg_temp.cash('alpha') - 60129 - 40000, -50000::bigint,
  'Alpha holds half the shared line: its Rent parts cancel instead of absorbing each other''s shares');

-- ===========================================================================
-- Regression (the shape in use today): a shared line with two NORMAL parts of one category on
-- different projects. Each part names its project, so it is a project part, not a shared one: each
-- project gets its own part and the projects' cash sums to the line. July, so no other line counts.
-- ===========================================================================
reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
values ((select id from gsc where label = 'co'), 'expense', 'expense', 'shared', 'posted', 'USD',
  -317000, -317000, 317000, 0, 'source', '2026-07-10', '2026-07-10', 'manual', 'gsc:july', null,
  (select id from gsc where label = 'levy'), 'gsc:july', true);
insert into gsc (label, id) select 'txn_july', id from public.transactions where idempotency_key = 'gsc:july';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from gsc where label = 'co'), (select id from gsc where label = 'txn_july'),
  (select id from gsc where label = v.project), 5000, -158500
from (values ('alpha'), ('beta')) as v(project);
select tests.authenticate_as('gsc_owner');
select lives_ok(
  $$select public.save_line_split((select id from gsc where label = 'txn_july'), jsonb_build_array(
    pg_temp.part('levy', 25000, 'alpha'),
    pg_temp.part('levy', 292000, 'beta')))$$,
  'a shared line takes two normal Levy parts on different projects');
select is(
  (select string_agg(l.pnl_role::text, ' ' order by l.amount_net) from private.pnl_lines l
   where l.transaction_id = (select id from gsc where label = 'txn_july')),
  'project project', 'both parts count as project parts, not shared ones');
create function pg_temp.july(p_project text) returns bigint
language sql
as $$
  select (c ->> 'net_minor')::bigint
  from jsonb_array_elements(public.projects_cash_month('2026-07-01') -> 'projects') p
  cross join jsonb_array_elements(p -> 'cash') c
  where p ->> 'id' = (select id::text from gsc where label = p_project) and c ->> 'currency' = 'USD'
$$;
grant execute on function pg_temp.july(text) to authenticated;
select is(pg_temp.july('alpha'), -25000::bigint, 'Alpha''s July cash is its 250.00 part');
select is(pg_temp.july('beta'), -292000::bigint, 'Beta''s July cash is its 2920.00 part');
select is(pg_temp.july('alpha') + pg_temp.july('beta'), -317000::bigint, 'the projects'' July cash sums to the line');

select * from finish();
rollback;
