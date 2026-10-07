-- FLOW-102: the unassigned bucket, the overhead project, and the unpaid-row rule.
-- Projects + overhead + unassigned = the company total, both bases, ILS and USD.

begin;

select plan(47);

do $users$
begin
  perform tests.create_supabase_user('uo_owner', 'uo-owner@example.com');
  perform tests.create_supabase_user('uo_other', 'uo-other@example.com');
end
$users$;

create temp table uo_ref (label text primary key, id uuid);
create temp table uo_out (label text primary key, body jsonb);
grant all on uo_ref, uo_out to authenticated;

create function pg_temp.cur(p jsonb, c text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p -> 'by_currency') x where x ->> 'currency' = c $$;

create function pg_temp.proj(p jsonb, n text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p -> 'projects') x where x ->> 'name' = n $$;

-- Net profit minus (project profits - overhead + unassigned income - unassigned expense).
-- Zero means the parts add up to the company total.
create function pg_temp.gap(p jsonb, c text) returns bigint
language sql immutable
as $$
  select (pg_temp.cur(p, c) ->> 'net_profit_minor')::bigint - (
    coalesce((
      select sum((b ->> 'profit_minor')::bigint)
      from jsonb_array_elements(p -> 'projects') pr,
        jsonb_array_elements(pr -> 'by_currency') b
      where b ->> 'currency' = c
    ), 0)
    - (pg_temp.cur(p, c) ->> 'overhead_minor')::bigint
    + (pg_temp.cur(p, c) ->> 'unassigned_income_minor')::bigint
    - (pg_temp.cur(p, c) ->> 'unassigned_expense_minor')::bigint
  )
$$;

-- Expense minus (direct + shared + overhead + unassigned expense). Zero means the buckets cover every cost.
create function pg_temp.split_gap(p jsonb, c text) returns bigint
language sql immutable
as $$
  select (pg_temp.cur(p, c) ->> 'expense_minor')::bigint - (
    (pg_temp.cur(p, c) ->> 'direct_minor')::bigint
    + (pg_temp.cur(p, c) ->> 'shared_minor')::bigint
    + (pg_temp.cur(p, c) ->> 'overhead_minor')::bigint
    + (pg_temp.cur(p, c) ->> 'unassigned_expense_minor')::bigint
  )
$$;

create function pg_temp.snap(l text) returns void
language sql
as $$
  insert into uo_out (label, body) values
    (l || ':cash', public.get_dashboard(null, null, 'cash')),
    (l || ':invoiced', public.get_dashboard(null, null, 'invoiced'))
  on conflict (label) do update set body = excluded.body
$$;

create function pg_temp.out_of(l text) returns jsonb
language sql stable
as $$ select body from uo_out where label = l $$;

grant execute on function pg_temp.cur(jsonb, text), pg_temp.proj(jsonb, text), pg_temp.gap(jsonb, text), pg_temp.split_gap(jsonb, text),
  pg_temp.snap(text), pg_temp.out_of(text) to authenticated;

select tests.authenticate_as('uo_owner');
select public.create_company('Example Builders LLC', true);
select public.upsert_project(null, 'Site Alpha', null, 'active');
select public.upsert_project(null, 'Office', null, 'active');
insert into uo_ref (label, id) select 'co', id from public.companies where name = 'Example Builders LLC';
insert into uo_ref (label, id) select 'alpha', id from public.projects where name = 'Site Alpha';
insert into uo_ref (label, id) select 'office', id from public.projects where name = 'Office';

select tests.authenticate_as('uo_other');
select public.create_company('Other Example Co', true);
select public.upsert_project(null, 'Other Site', null, 'active');
insert into uo_ref (label, id) select 'other_proj', id from public.projects where name = 'Other Site';

reset role;

-- One set of lines per currency. Amounts are invented and round.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description, user_assigned
)
select
  (select id from uo_ref where label = 'co'),
  v.direction::public.txn_direction,
  v.doc_kind::public.doc_kind,
  v.pnl_role::public.pnl_role,
  v.status::public.line_status,
  cur.c,
  v.amount, v.amount, abs(v.amount), 0, 'source',
  '2026-06-10', case when v.direction = 'income' then '2026-06-10'::date end,
  'manual', 'uo:' || cur.c || ':' || v.ikey,
  (select id from uo_ref where label = v.proj),
  v.ikey,
  true
from (values ('ILS'), ('USD')) as cur(c),
(values
  ('income',  'invoice_receipt', null,       100000, 'alpha',  'posted',  'in-alpha'),
  ('income',  'invoice',         null,        40000, 'alpha',  'posted',  'in-alpha-open'),
  ('income',  'invoice_receipt', null,        20000, null,     'posted',  'in-none'),
  ('expense', 'expense',         'project',  -30000, 'alpha',  'posted',  'ex-alpha'),
  ('expense', 'expense',         'project',  -15000, 'office', 'posted',  'ex-office'),
  ('expense', 'expense',         'overhead',  -5000, null,     'posted',  'ex-overhead'),
  ('expense', 'expense',         null,        -7000, null,     'posted',  'ex-norole'),
  ('expense', 'expense',         'project',   -3000, null,     'posted',  'ex-noproj'),
  ('expense', 'expense',         'shared',   -10000, null,     'posted',  'ex-shared'),
  ('expense', 'expense',         'shared',    -2000, null,     'posted',  'ex-shared-open'),
  ('expense', 'invoice',         'project',   -4000, 'alpha',  'posted',  'ex-unpaid'),
  ('expense', 'expense',         'project',   -9000, 'alpha',  'pending', 'ex-pending')
) as v(direction, doc_kind, pnl_role, amount, proj, status, ikey);

-- The shared line splits 60/40 between the two projects; the second shared line has no split.
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, (select id from uo_ref where label = s.proj), s.bp, t.amount_net * s.bp / 10000
from public.transactions t
join (values ('alpha', 6000), ('office', 4000)) as s(proj, bp) on true
where t.idempotency_key in ('uo:ILS:ex-shared', 'uo:USD:ex-shared');

select tests.authenticate_as('uo_owner');
select pg_temp.snap('before');

-- (1) Unassigned bucket.
select is((pg_temp.out_of('before:cash') ->> 'unassigned_income_agorot')::bigint, 20000::bigint,
  'income with no project is unassigned (ILS)');
select is((pg_temp.out_of('before:cash') ->> 'unassigned_expense_agorot')::bigint, 12000::bigint,
  'no role 7000 + project role with no project 3000 + unsplit shared 2000 are unassigned (ILS)');
select is((pg_temp.cur(pg_temp.out_of('before:cash'), 'USD') ->> 'unassigned_income_minor')::bigint, 20000::bigint,
  'income with no project is unassigned (USD)');
select is((pg_temp.cur(pg_temp.out_of('before:cash'), 'USD') ->> 'unassigned_expense_minor')::bigint, 12000::bigint,
  'unassigned expense (USD)');
select is(pg_temp.gap(pg_temp.out_of('before:cash'), 'ILS'), 0::bigint, 'parts add up: cash, ILS');
select is(pg_temp.gap(pg_temp.out_of('before:cash'), 'USD'), 0::bigint, 'parts add up: cash, USD');
select is(pg_temp.gap(pg_temp.out_of('before:invoiced'), 'ILS'), 0::bigint, 'parts add up: invoiced, ILS');
select is(pg_temp.gap(pg_temp.out_of('before:invoiced'), 'USD'), 0::bigint, 'parts add up: invoiced, USD');
select is(
  (pg_temp.out_of('before:cash') ->> 'net_profit_agorot')::bigint,
  (pg_temp.cur(pg_temp.out_of('before:cash'), 'ILS') ->> 'net_profit_minor')::bigint,
  'ILS top level matches the ILS by_currency row'
);
select is((pg_temp.out_of('before:cash') ->> 'overhead_agorot')::bigint, 5000::bigint, 'overhead before: only the overhead role');
select is((pg_temp.out_of('before:cash') ->> 'direct_agorot')::bigint, 49000::bigint,
  'direct before: alpha 30000 + office 15000 + unpaid alpha 4000; a project line with no project is not direct');
select is((pg_temp.out_of('before:cash') ->> 'shared_agorot')::bigint, 10000::bigint,
  'a shared line with no split is unassigned, not shared');
select is(pg_temp.split_gap(pg_temp.out_of('before:cash'), 'ILS'), 0::bigint,
  'direct + shared + overhead + unassigned = expense: cash, ILS');
select is(pg_temp.split_gap(pg_temp.out_of('before:invoiced'), 'USD'), 0::bigint,
  'direct + shared + overhead + unassigned = expense: invoiced, USD');
select is((pg_temp.proj(pg_temp.out_of('before:cash'), 'Office') ->> 'direct_agorot')::bigint, 15000::bigint,
  'office project carries its direct cost before');
select is((pg_temp.proj(pg_temp.out_of('before:cash'), 'Office') ->> 'is_overhead')::boolean, false,
  'no overhead project yet');
select is(pg_temp.out_of('before:cash') -> 'overhead_project_id', 'null'::jsonb, 'overhead_project_id is null');

-- (3) The unpaid-row rule. A posted unpaid supplier invoice counts by doc date on both bases.
-- A pending (unsettled) line counts on neither (decision 0086).
select is((pg_temp.proj(pg_temp.out_of('before:invoiced'), 'Site Alpha') ->> 'direct_agorot')::bigint, 34000::bigint,
  'invoiced basis: alpha direct includes the unpaid supplier invoice, not the pending line');
select is((pg_temp.proj(pg_temp.out_of('before:cash'), 'Site Alpha') ->> 'direct_agorot')::bigint, 34000::bigint,
  'cash basis: same expense rule');
select is((pg_temp.out_of('before:invoiced') ->> 'income_agorot')::bigint, 160000::bigint,
  'invoiced basis counts the open income invoice');
select is((pg_temp.out_of('before:cash') ->> 'income_agorot')::bigint, 120000::bigint,
  'cash basis leaves the open income invoice out');

-- (2) Overhead project, through MCP.
reset role;
select public.store_mcp_credential(
  tests.get_supabase_uid('uo_owner'), 'hash-uo-write-0001', array['read','write'], now() + interval '90 days', 'pepper-uo'
);
insert into uo_ref (label, id) select 'tok', id from private.mcp_credentials where token_hash = 'hash-uo-write-0001';
select public.store_mcp_credential(
  tests.get_supabase_uid('uo_other'), 'hash-uo-other-0001', array['read','write'], now() + interval '90 days', 'pepper-uo2'
);
insert into uo_ref (label, id) select 'tok_other', id from private.mcp_credentials where token_hash = 'hash-uo-other-0001';

create function pg_temp.as_mcp(u text, tok text) returns void
language sql
as $$
  select set_config('role', 'authenticated', true);
  select set_config('request.jwt.claim.sub', tests.get_supabase_uid(u)::text, true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', tests.get_supabase_uid(u), 'role', 'authenticated',
      'mcp_tid', (select id from uo_ref where label = tok))::text,
    true
  );
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated;

-- Cross-tenant: another company's token cannot name this company's project.
select pg_temp.as_mcp('uo_other', 'tok_other');
select is(
  public.mcp_set_overhead_project('uo-cross', (select id from uo_ref where label = 'office'))->'error'->>'message',
  'project not found',
  'cross-tenant overhead project is refused'
);
select is(
  public.mcp_set_overhead_project('uo-own-other', (select id from uo_ref where label = 'other_proj'))->'ok',
  'true'::jsonb,
  'the other company can set its own project (positive control)'
);
select throws_ok(
  format('select public.set_overhead_project(%L)', (select id from uo_ref where label = 'alpha')),
  'project not found',
  'app RPC refuses another company''s project'
);
select is(
  (select overhead_project_id from public.companies where id = (select id from uo_ref where label = 'co')),
  null::uuid,
  'the owner''s company is unchanged by the other tenant'
);

select pg_temp.as_mcp('uo_owner', 'tok');
select is(
  public.mcp_set_overhead_project('uo-set', (select id from uo_ref where label = 'office'))->'data'->>'undo_kind',
  'overhead_project',
  'owner sets the overhead project'
);
select is(
  public.mcp_set_overhead_project('uo-set', (select id from uo_ref where label = 'office'))->'ok',
  'true'::jsonb,
  'idempotent replay'
);
select is(
  public.mcp_set_overhead_project('uo-set', null)->'error'->>'code',
  'conflict',
  'same key with other args is conflict'
);
select pg_temp.snap('set');

select is((pg_temp.out_of('set:cash') ->> 'overhead_agorot')::bigint, 20000::bigint,
  'office lines move to overhead: 5000 + 15000');
select is((pg_temp.out_of('set:cash') ->> 'direct_agorot')::bigint, 34000::bigint, 'and out of direct');
select is(pg_temp.split_gap(pg_temp.out_of('set:cash'), 'USD'), 0::bigint,
  'expense parts still add up with an overhead project');
select is((pg_temp.cur(pg_temp.out_of('set:invoiced'), 'USD') ->> 'overhead_minor')::bigint, 20000::bigint,
  'USD overhead moves too');
select is((pg_temp.proj(pg_temp.out_of('set:cash'), 'Office') ->> 'direct_agorot')::bigint, 0::bigint,
  'the overhead project has no direct cost');
select is((pg_temp.proj(pg_temp.out_of('set:cash'), 'Office') ->> 'is_overhead')::boolean, true,
  'the overhead project is flagged');
select is(pg_temp.out_of('set:cash') ->> 'overhead_project_id', (select id::text from uo_ref where label = 'office'),
  'company_pnl returns the overhead project id');
select is(
  (pg_temp.out_of('set:cash') ->> 'net_profit_agorot')::bigint,
  (pg_temp.out_of('before:cash') ->> 'net_profit_agorot')::bigint,
  'company net is unchanged'
);
select is(pg_temp.gap(pg_temp.out_of('set:cash'), 'ILS'), 0::bigint, 'parts add up with an overhead project: cash, ILS');
select is(pg_temp.gap(pg_temp.out_of('set:invoiced'), 'USD'), 0::bigint, 'parts add up with an overhead project: invoiced, USD');
select is(
  (public.get_project((select id from uo_ref where label = 'office'), 'cash') ->> 'direct_agorot')::bigint,
  0::bigint,
  'get_project agrees: no direct cost on the overhead project'
);
select is(
  (public.get_project((select id from uo_ref where label = 'office'), 'cash') ->> 'is_overhead')::boolean,
  true,
  'get_project flags the overhead project'
);

select is(
  public.mcp_undo('uo-undo', 'overhead_project', (select id from uo_ref where label = 'co'))->'data'->>'kind',
  'overhead_project',
  'undo clears the overhead project'
);
select pg_temp.snap('undone');
select is((pg_temp.out_of('undone:cash') ->> 'overhead_agorot')::bigint, 5000::bigint, 'undo moves the lines back out of overhead');
select is((pg_temp.out_of('undone:cash') ->> 'direct_agorot')::bigint, 49000::bigint, 'and back into direct');
select is(
  public.mcp_undo('uo-undo-2', 'overhead_project', (select id from uo_ref where label = 'co'))->'error'->>'code',
  'not_found',
  'undo is single use'
);

-- Undo after a later manual change is a conflict.
select public.mcp_set_overhead_project('uo-set-2', (select id from uo_ref where label = 'office'));
select public.set_overhead_project((select id from uo_ref where label = 'alpha'));
select is(
  public.mcp_undo('uo-undo-3', 'overhead_project', (select id from uo_ref where label = 'co'))->'error'->>'code',
  'conflict',
  'undo after a later change is conflict'
);

-- Clearing through MCP with a null project.
select is(
  public.mcp_set_overhead_project('uo-clear', null)->'data'->'overhead_project_id',
  'null'::jsonb,
  'mcp clears the overhead project'
);

-- Deleting the overhead project clears the setting.
select public.set_overhead_project((select id from uo_ref where label = 'office'));
reset role;
delete from public.transactions where project_id = (select id from uo_ref where label = 'office');
delete from public.projects where id = (select id from uo_ref where label = 'office');
select is(
  (select overhead_project_id from public.companies where id = (select id from uo_ref where label = 'co')),
  null::uuid,
  'deleting the overhead project clears it'
);

select * from finish();
rollback;
