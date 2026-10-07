-- FLOW-201: undo_batch on a split row that changed after the batch is conflict for that row only.
-- Dates are fixed. Emails use @example.com.

begin;

select plan(6);

do $users$
begin
  perform tests.create_supabase_user('mcpbu_owner', 'mcpbu-owner@example.com');
end
$users$;

create temp table mcpbu (label text primary key, id uuid);
grant all on mcpbu to authenticated, service_role;

create temp table mcpbu_json (label text primary key, body jsonb);
grant all on mcpbu_json to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid('mcpbu_owner');
  select id into tid from pg_temp.mcpbu where label = p_label;
  if uid is null or tid is null then
    raise exception 'missing mcp actor %', p_label;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

create or replace function pg_temp.share(p_label text, p_share int)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_object(
    'project_id', (select id::text from pg_temp.mcpbu where label = p_label),
    'share', p_share
  )
$$;
grant execute on function pg_temp.share(text, int) to authenticated, service_role;

select tests.authenticate_as('mcpbu_owner');
select lives_ok($$select public.create_company('Example Co', true)$$, 'owner creates a company');
select public.upsert_project(null, 'North Property', null, 'active');
select public.upsert_project(null, 'South Property', null, 'active');

insert into mcpbu (label, id) select 'company', id from public.companies;
insert into mcpbu (label, id) select 'north', id from public.projects where name = 'North Property';
insert into mcpbu (label, id) select 'south', id from public.projects where name = 'South Property';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_suggested
)
select c.id, 'expense', 'expense', null, 'ILS',
  -12000, -12000, 12000, 0, 'unknown',
  '2026-09-15', 'manual', v.k, null, null, 'Synthetic line',
  false, false
from mcpbu c
cross join (values ('mcpbu:changed'), ('mcpbu:kept')) v(k)
where c.label = 'company';

insert into mcpbu (label, id)
select replace(t.idempotency_key, 'mcpbu:', ''), t.id
from public.transactions t
where t.idempotency_key like 'mcpbu:%';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mcpbu_owner'), c.id, 'hash-mcpbu-write01', 'kid', array['write']::text[], '2099-01-01'::timestamptz
from mcpbu c
where c.label = 'company';
insert into mcpbu (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-mcpbu-write01';

do $$ begin perform pg_temp.as_mcp('write'); end $$;

insert into mcpbu_json (label, body)
select 'batch', public.mcp_assign_expenses('batch-split-undo', jsonb_build_array(
  jsonb_build_object(
    'transaction_id', (select id::text from mcpbu where label = 'changed'),
    'shares', jsonb_build_array(pg_temp.share('north', 50), pg_temp.share('south', 50))
  ),
  jsonb_build_object(
    'transaction_id', (select id::text from mcpbu where label = 'kept'),
    'shares', jsonb_build_array(pg_temp.share('north', 50), pg_temp.share('south', 50))
  )
));

select is(
  (select body->'data'->>'ok_count' from mcpbu_json where label = 'batch'),
  '2',
  'both split rows apply'
);

-- The changed line is split again after the batch.
select is(
  public.mcp_assign_expense_split(
    'resplit-after-batch',
    (select id from mcpbu where label = 'changed'),
    jsonb_build_array(pg_temp.share('north', 30), pg_temp.share('south', 70))
  )->>'ok',
  'true',
  'the line is split again after the batch'
);

insert into mcpbu_json (label, body)
select 'undo', public.mcp_undo_batch(
  'undo-batch-split-changed',
  (select body->'data'->>'batch_key' from mcpbu_json where label = 'batch')
);

reset role;

select is(
  (
    select jsonb_agg(coalesce(elem->>'code', 'ok') order by elem->>'transaction_id' = (select id::text from mcpbu where label = 'kept'))
    from mcpbu_json j, jsonb_array_elements(j.body->'data'->'results') elem
    where j.label = 'undo'
  ),
  '["conflict", "ok"]'::jsonb,
  'undo_batch is conflict for the re-split row and still undoes the other'
);

select is(
  (select array_agg(a.amount_net order by a.amount_net) from public.allocations a where a.transaction_id = (select id from mcpbu where label = 'changed')),
  array[-8400, -3600]::bigint[],
  'the re-split line keeps its newer split'
);

select is(
  (select count(*)::int from public.allocations a where a.transaction_id = (select id from mcpbu where label = 'kept')),
  0,
  'the unchanged split row goes back to no split'
);

select * from finish();
rollback;
