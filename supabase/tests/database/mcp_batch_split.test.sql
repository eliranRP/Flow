-- FLOW-201: split rows inside assign_expenses. Mixed batch, partial success, replay, batch undo.
-- Dates are fixed. Emails use @example.com.

begin;

select plan(24);

do $users$
begin
  perform tests.create_supabase_user('mcpbs_owner', 'mcpbs-owner@example.com');
  perform tests.create_supabase_user('mcpbs_other', 'mcpbs-other@example.com');
end
$users$;

create temp table mcpbs (label text primary key, id uuid);
grant all on mcpbs to authenticated, service_role;

create temp table mcpbs_json (label text primary key, body jsonb);
grant all on mcpbs_json to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text, p_user text default 'mcpbs_owner')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  select id into tid from pg_temp.mcpbs where label = p_label;
  if uid is null or tid is null then
    raise exception 'missing mcp actor %', p_label;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', uid,
      'role', 'authenticated',
      'aal', 'aal1',
      'mcp_tid', tid
    )::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated, service_role;

create or replace function pg_temp.line_state(p_id uuid)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_object(
    'project_id', t.project_id,
    'category_id', t.category_id,
    'pnl_role', t.pnl_role,
    'user_assigned', t.user_assigned,
    'shares', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', a.project_id, 'share_bp', a.share_bp, 'amount_net', a.amount_net
      ) order by a.project_id)
      from public.allocations a where a.transaction_id = t.id
    ), '[]'::jsonb)
  )
  from public.transactions t
  where t.id = p_id
$$;
grant execute on function pg_temp.line_state(uuid) to authenticated, service_role;

create or replace function pg_temp.share(p_label text, p_share int)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_object(
    'project_id', (select id::text from pg_temp.mcpbs where label = p_label),
    'share', p_share
  )
$$;
grant execute on function pg_temp.share(text, int) to authenticated, service_role;

select tests.authenticate_as('mcpbs_owner');
select lives_ok($$select public.create_company('Example Co', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'North Property', null, 'active')$$, 'north project');
select lives_ok($$select public.upsert_project(null, 'South Property', null, 'active')$$, 'south project');

insert into mcpbs (label, id) select 'company', id from public.companies;
insert into mcpbs (label, id) select 'north', id from public.projects where name = 'North Property';
insert into mcpbs (label, id) select 'south', id from public.projects where name = 'South Property';
insert into mcpbs (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';

select tests.authenticate_as('mcpbs_other');
select lives_ok($$select public.create_company('Other Co', true)$$, 'other company');
insert into mcpbs (label, id) select 'other_company', id from public.companies where name = 'Other Co';

reset role;

insert into public.projects (company_id, name, status)
select id, 'Other North', 'active' from mcpbs where label = 'other_company';
insert into mcpbs (label, id) select 'other_north', id from public.projects where name = 'Other North';

-- plain: filed 100% to north, no review. review: no project, open review. single: plain assign row.
-- bad_sum and foreign: split rows that fail.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_suggested
)
select c.id, 'expense', 'expense', v.role::public.pnl_role, v.currency,
  -12000, -12000, 12000, 0, 'unknown',
  '2026-09-15', v.source::public.txn_source, v.k,
  case when v.filed then n.id end, null, 'Synthetic line',
  false, false
from mcpbs c
join mcpbs n on n.label = 'north'
cross join (values
  ('mcpbs:plain', 'project', 'ILS', 'manual', true),
  ('mcpbs:review', null, 'USD', 'mercury', false),
  ('mcpbs:single', null, 'ILS', 'manual', false),
  ('mcpbs:bad-sum', null, 'ILS', 'manual', false),
  ('mcpbs:foreign', null, 'ILS', 'manual', false)
) v(k, role, currency, source, filed)
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key = 'mcpbs:plain';

insert into mcpbs (label, id)
select replace(t.idempotency_key, 'mcpbs:', ''), t.id
from public.transactions t
where t.idempotency_key like 'mcpbs:%';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_category'
from public.transactions t
where t.id = (select id from mcpbs where label = 'review');

create temp table mcpbs_state (label text primary key, state jsonb);
grant all on mcpbs_state to authenticated, service_role;
insert into mcpbs_state (label, state)
select v.label, pg_temp.line_state((select id from mcpbs where label = v.label))
from (values ('plain'), ('review'), ('single'), ('bad-sum')) v(label);

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mcpbs_owner'), c.id, v.hash, 'kid', v.scope, '2099-01-01'::timestamptz
from mcpbs c
cross join (values
  ('hash-mcpbs-write01', array['write']::text[]),
  ('hash-mcpbs-read001', array['read']::text[])
) v(hash, scope)
where c.label = 'company';
insert into mcpbs (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-mcpbs-write01';
insert into mcpbs (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-mcpbs-read001';

-- Ordinals: 1 plain split, 2 review split with category, 3 plain assign, 4 bad sum, 5 foreign project,
-- 6 shares with project_id, 7 shares with remember, 8 shares not an array.
insert into mcpbs_json (label, body)
select 'mixed', jsonb_build_array(
  jsonb_build_object(
    'transaction_id', (select id::text from mcpbs where label = 'plain'),
    'shares', jsonb_build_array(pg_temp.share('north', 50), pg_temp.share('south', 50))
  ),
  jsonb_build_object(
    'transaction_id', (select id::text from mcpbs where label = 'review'),
    'category_id', (select id::text from mcpbs where label = 'materials'),
    'shares', jsonb_build_array(pg_temp.share('north', 50), pg_temp.share('south', 50))
  ),
  jsonb_build_object(
    'transaction_id', (select id::text from mcpbs where label = 'single'),
    'project_id', (select id::text from mcpbs where label = 'south'),
    'category_id', (select id::text from mcpbs where label = 'materials')
  ),
  jsonb_build_object(
    'transaction_id', (select id::text from mcpbs where label = 'bad-sum'),
    'shares', jsonb_build_array(pg_temp.share('north', 40), pg_temp.share('south', 50))
  ),
  jsonb_build_object(
    'transaction_id', (select id::text from mcpbs where label = 'foreign'),
    'shares', jsonb_build_array(pg_temp.share('north', 50), pg_temp.share('other_north', 50))
  ),
  jsonb_build_object(
    'transaction_id', '11111111-1111-4000-8000-000000000006',
    'project_id', (select id::text from mcpbs where label = 'north'),
    'category_id', (select id::text from mcpbs where label = 'materials'),
    'shares', jsonb_build_array(pg_temp.share('north', 50), pg_temp.share('south', 50))
  ),
  jsonb_build_object(
    'transaction_id', '11111111-1111-4000-8000-000000000007',
    'remember', true,
    'shares', jsonb_build_array(pg_temp.share('north', 50), pg_temp.share('south', 50))
  ),
  jsonb_build_object(
    'transaction_id', '11111111-1111-4000-8000-000000000008',
    'shares', pg_temp.share('north', 100)
  )
);

do $$ begin perform pg_temp.as_mcp('read'); end $$;

select is(
  public.mcp_assign_expenses('batch-split-read', (select body from mcpbs_json where label = 'mixed'))->'error'->>'code',
  'forbidden',
  'a read token cannot run a batch with split rows'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

insert into mcpbs_json (label, body)
select 'first', public.mcp_assign_expenses('batch-split', (select body from mcpbs_json where label = 'mixed'));

select is(
  (select body->'data'->>'ok_count' from mcpbs_json where label = 'first'),
  '3',
  'three good rows apply in one call'
);

select is(
  (select body->'data'->>'error_count' from mcpbs_json where label = 'first'),
  '5',
  'five bad rows fail without blocking the good ones'
);

select is(
  (
    select jsonb_agg(coalesce(elem->>'code', 'ok') order by ord)
    from mcpbs_json j,
      jsonb_array_elements(j.body->'data'->'results') with ordinality as r(elem, ord)
    where j.label = 'first'
  ),
  '["ok", "ok", "ok", "validation", "refused", "validation", "validation", "validation"]'::jsonb,
  'per-row results keep order and give a code to each failed row'
);

select is(
  (select body->'data'->'results'->0 from mcpbs_json where label = 'first'),
  jsonb_build_object(
    'transaction_id', (select id::text from mcpbs where label = 'plain'),
    'ok', true,
    'undo_kind', 'reassign',
    'closed_review', false
  ),
  'a split row with no review reports reassign undo and closed_review false'
);

select is(
  (select body->'data'->'results'->1 from mcpbs_json where label = 'first'),
  jsonb_build_object(
    'transaction_id', (select id::text from mcpbs where label = 'review'),
    'ok', true,
    'undo_kind', 'review',
    'closed_review', true
  ),
  'a split row that closes a review reports review undo and closed_review true'
);

select ok(
  (select (body->'data'->'results'->2->>'ok')::boolean and not (body->'data'->'results'->2 ? 'closed_review')
   from mcpbs_json where label = 'first'),
  'a plain assign row keeps its old result shape, without closed_review'
);

reset role;

select is(
  (select array_agg(a.amount_net order by a.project_id) from public.allocations a where a.transaction_id = (select id from mcpbs where label = 'plain')),
  array[-6000, -6000]::bigint[],
  'the plain line splits 50/50 to the cent'
);

select is(
  (select count(*)::int from public.allocations a where a.transaction_id = (select id from mcpbs where label = 'review')),
  2,
  'the review line is split across two projects'
);

select isnt(
  (select q.status::text from public.review_queue q where q.transaction_id = (select id from mcpbs where label = 'review')),
  'open',
  'the split closes the open review'
);

select is(
  (select project_id from public.transactions where id = (select id from mcpbs where label = 'single')),
  (select id from mcpbs where label = 'south'),
  'the plain assign row in the same batch files its line'
);

select is(
  pg_temp.line_state((select id from mcpbs where label = 'bad-sum')),
  (select state from mcpbs_state where label = 'bad-sum'),
  'a failed split row leaves its line untouched'
);

insert into mcpbs_json (label, body)
select 'writes_before', jsonb_build_object(
  'writes', (select count(*) from private.mcp_writes w where w.transaction_id in (select id from mcpbs)),
  'undo', (select count(*) from public.reassign_undo u where u.transaction_id in (select id from mcpbs)),
  'batches', (select count(*) from private.mcp_batches)
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  public.mcp_assign_expenses('batch-split', (select body from mcpbs_json where label = 'mixed')),
  (select body from mcpbs_json where label = 'first'),
  'replay with the same key and body returns the stored response'
);

select is(
  public.mcp_assign_expenses(
    'batch-split',
    jsonb_build_array(jsonb_build_object(
      'transaction_id', (select id::text from mcpbs where label = 'plain'),
      'shares', jsonb_build_array(pg_temp.share('north', 30), pg_temp.share('south', 70))
    ))
  )->'error'->>'code',
  'conflict',
  'the same key with other shares is a conflict'
);

reset role;

select is(
  jsonb_build_object(
    'writes', (select count(*) from private.mcp_writes w where w.transaction_id in (select id from mcpbs)),
    'undo', (select count(*) from public.reassign_undo u where u.transaction_id in (select id from mcpbs)),
    'batches', (select count(*) from private.mcp_batches)
  ),
  (select body from mcpbs_json where label = 'writes_before'),
  'replay and conflict add no write, undo or batch row'
);

select is(
  (select array_agg(a.amount_net order by a.project_id) from public.allocations a where a.transaction_id = (select id from mcpbs where label = 'plain')),
  array[-6000, -6000]::bigint[],
  'the conflicting call does not change the split'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  public.mcp_undo_batch(
    'undo-batch-split',
    (select body->'data'->>'batch_key' from mcpbs_json where label = 'first')
  )->'data'->>'ok_count',
  '3',
  'undo_batch undoes the three good rows'
);

reset role;

select is(
  pg_temp.line_state((select id from mcpbs where label = 'plain')),
  (select state from mcpbs_state where label = 'plain'),
  'batch undo restores the plain line to 100% north'
);

select is(
  pg_temp.line_state((select id from mcpbs where label = 'review')),
  (select state from mcpbs_state where label = 'review'),
  'batch undo restores the review line as it was before the split'
);

select is(
  (select q.status::text from public.review_queue q where q.transaction_id = (select id from mcpbs where label = 'review')),
  'open',
  'batch undo reopens the review the split closed'
);

select * from finish();
rollback;
