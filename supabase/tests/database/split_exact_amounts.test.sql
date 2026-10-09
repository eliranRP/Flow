-- FLOW-346: save_split and MCP assign_expense_split take exact amount_minor shares.

begin;

select plan(18);

select tests.create_supabase_user('exactsplit_owner', 'exactsplit-owner@example.com');

create temp table exactsplit (label text primary key, id uuid);
grant all on exactsplit to authenticated, service_role;

select tests.authenticate_as('exactsplit_owner');
select lives_ok($$select public.create_company('Example Co', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'North Property', null, 'active')$$, 'north project');
select lives_ok($$select public.upsert_project(null, 'South Property', null, 'active')$$, 'south project');
insert into exactsplit (label, id) select 'company', id from public.companies;
insert into exactsplit (label, id) select 'north', id from public.projects where name = 'North Property';
insert into exactsplit (label, id) select 'south', id from public.projects where name = 'South Property';
reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description, user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -2866316, -2866316, 0, 'unknown',
  '2026-09-15', 'manual', 'exactsplit:garage', n.id, 'Garage work', false
from exactsplit c
join exactsplit n on n.label = 'north'
where c.label = 'company';
insert into exactsplit (label, id) select 'txn', id from public.transactions where idempotency_key = 'exactsplit:garage';

select tests.authenticate_as('exactsplit_owner');

select lives_ok(
  format(
    $sql$select public.save_split(%L::uuid, jsonb_build_array(
      jsonb_build_object('project_id', %L, 'amount_minor', 800000),
      jsonb_build_object('project_id', %L, 'amount_minor', 2066316)))$sql$,
    (select id from exactsplit where label = 'txn'),
    (select id from exactsplit where label = 'north'),
    (select id from exactsplit where label = 'south')
  ),
  'exact amounts that sum to the line save'
);

select is(
  (select a.amount_net from public.allocations a
   where a.transaction_id = (select id from exactsplit where label = 'txn')
     and a.project_id = (select id from exactsplit where label = 'north')),
  -800000::bigint,
  'north keeps its exact part, signed like the line'
);
select is(
  (select a.amount_net from public.allocations a
   where a.transaction_id = (select id from exactsplit where label = 'txn')
     and a.project_id = (select id from exactsplit where label = 'south')),
  -2066316::bigint,
  'south keeps its exact part'
);
select is(
  (select sum(a.share_bp)::integer from public.allocations a
   where a.transaction_id = (select id from exactsplit where label = 'txn')),
  10000,
  'derived shares sum to 10000'
);
select is(
  (select t.pnl_role::text || '|' || coalesce(t.project_id::text, 'none') from public.transactions t
   where t.id = (select id from exactsplit where label = 'txn')),
  'shared|none',
  'two parts make the line shared'
);

select throws_ok(
  format(
    $sql$select public.save_split(%L::uuid, jsonb_build_array(
      jsonb_build_object('project_id', %L, 'amount_minor', 800000),
      jsonb_build_object('project_id', %L, 'amount_minor', 100)))$sql$,
    (select id from exactsplit where label = 'txn'),
    (select id from exactsplit where label = 'north'),
    (select id from exactsplit where label = 'south')
  ),
  'parts must sum to the line',
  'parts short of the line are refused'
);
select throws_ok(
  format(
    $sql$select public.save_split(%L::uuid, jsonb_build_array(
      jsonb_build_object('project_id', %L, 'amount_minor', 2866316),
      jsonb_build_object('project_id', %L, 'amount_minor', 1)))$sql$,
    (select id from exactsplit where label = 'txn'),
    (select id from exactsplit where label = 'north'),
    (select id from exactsplit where label = 'south')
  ),
  'parts exceed the line',
  'parts over the line are refused'
);
select throws_ok(
  format(
    $sql$select public.save_split(%L::uuid, jsonb_build_array(
      jsonb_build_object('project_id', %L, 'amount_minor', 800000),
      jsonb_build_object('project_id', %L, 'share_bp', 7209)))$sql$,
    (select id from exactsplit where label = 'txn'),
    (select id from exactsplit where label = 'north'),
    (select id from exactsplit where label = 'south')
  ),
  'validation',
  'mixed share shapes are refused'
);
select throws_ok(
  format(
    $sql$select public.save_split(%L::uuid, jsonb_build_array(
      jsonb_build_object('project_id', %L, 'amount_minor', 1000000),
      jsonb_build_object('project_id', %L, 'amount_minor', 1866316)))$sql$,
    (select id from exactsplit where label = 'txn'),
    (select id from exactsplit where label = 'north'),
    (select id from exactsplit where label = 'north')
  ),
  'validation',
  'the same project twice is refused'
);

-- A one-cent part still gets a share point; the largest part gives it up.
select lives_ok(
  format(
    $sql$select public.save_split(%L::uuid, jsonb_build_array(
      jsonb_build_object('project_id', %L, 'amount_minor', 2866315),
      jsonb_build_object('project_id', %L, 'amount_minor', 1)))$sql$,
    (select id from exactsplit where label = 'txn'),
    (select id from exactsplit where label = 'north'),
    (select id from exactsplit where label = 'south')
  ),
  'a one-cent part saves'
);
select is(
  (select string_agg(a.share_bp::text || ':' || a.amount_net::text, ',' order by a.share_bp desc) from public.allocations a
   where a.transaction_id = (select id from exactsplit where label = 'txn')),
  '9999:-2866315,1:-1',
  'the one-cent part has one share point and its exact cent'
);

select lives_ok(
  format(
    $sql$select public.save_split(%L::uuid, jsonb_build_array(
      jsonb_build_object('project_id', %L, 'amount_minor', 2866316)))$sql$,
    (select id from exactsplit where label = 'txn'),
    (select id from exactsplit where label = 'south')
  ),
  'one exact part files the whole line to one project'
);
select is(
  (select t.pnl_role::text || '|' || (t.project_id = (select id from exactsplit where label = 'south'))::text from public.transactions t
   where t.id = (select id from exactsplit where label = 'txn')),
  'project|true',
  'one part makes it a project line'
);

reset role;

select is(
  private.mcp_shares_for_save(jsonb_build_array(
    jsonb_build_object('project_id', '00000000-0000-4000-8000-000000000001', 'amount_minor', 250),
    jsonb_build_object('project_id', '00000000-0000-4000-8000-000000000002', 'amount_minor', 750))),
  jsonb_build_array(
    jsonb_build_object('project_id', '00000000-0000-4000-8000-000000000001', 'amount_minor', 250),
    jsonb_build_object('project_id', '00000000-0000-4000-8000-000000000002', 'amount_minor', 750)),
  'MCP amount shares pass through to save_split'
);
select throws_ok(
  $$select private.mcp_shares_for_save(jsonb_build_array(
    jsonb_build_object('project_id', '00000000-0000-4000-8000-000000000001', 'amount_minor', 250),
    jsonb_build_object('project_id', '00000000-0000-4000-8000-000000000002', 'share', 50)))$$,
  'validation',
  'MCP shares cannot mix amounts and percents'
);

select * from finish();

rollback;
