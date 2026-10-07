-- FLOW-204: assign_expense_split follow-ups. Share cap, order-free idempotency, hidden
-- category and finished project accepted, closed unallocated_shared review, and undo keeping a suggested category.

begin;

select plan(20);

do $users$
begin
  perform tests.create_supabase_user('splitfu_owner', 'splitfu-owner@example.com');
end
$users$;

create temp table splitfu (label text primary key, id uuid);
grant all on splitfu to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid('splitfu_owner');
  select id into tid from pg_temp.splitfu where label = p_label;
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

create or replace function pg_temp.shares(p_north integer, p_south integer)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('project_id', (select id::text from pg_temp.splitfu where label = 'north'), 'share', p_north),
    jsonb_build_object('project_id', (select id::text from pg_temp.splitfu where label = 'south'), 'share', p_south)
  )
$$;
grant execute on function pg_temp.shares(integer, integer) to authenticated, service_role;

select tests.authenticate_as('splitfu_owner');
select lives_ok($$select public.create_company('Example Co', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'North Property', null, 'active')$$, 'north project');
select lives_ok($$select public.upsert_project(null, 'South Property', null, 'active')$$, 'south project');
reset role;

insert into splitfu (label, id) select 'company', id from public.companies;
insert into splitfu (label, id) select 'north', id from public.projects where name = 'North Property';
insert into splitfu (label, id) select 'south', id from public.projects where name = 'South Property';
insert into splitfu (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
-- The shared line's guess is חומרים, so its split writes another category to tell the snapshots apart.
insert into splitfu (label, id)
select 'labor', id from public.categories where name = 'עבודה' and kind = 'expense';
insert into splitfu (label, id)
select 'hidden', c.id
from public.categories c
where c.kind = 'expense' and c.id <> (select id from splitfu where label = 'materials')
order by c.sort_order, c.name
limit 1;
update public.categories set hidden = true where id = (select id from splitfu where label = 'hidden');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_suggested
)
select c.id, 'expense', 'expense', v.role::public.pnl_role,
  -10000, -10000, 0, 'unknown',
  '2026-09-15', 'manual', v.k, null, v.category, 'Synthetic line',
  false, false
from splitfu c
cross join (values
  ('splitfu:suggested', null, (select id from splitfu where label = 'materials')),
  ('splitfu:suggested-review', null, (select id from splitfu where label = 'materials')),
  ('splitfu:shared', 'shared', null),
  ('splitfu:plain', null, null)
) v(k, role, category)
where c.label = 'company';

insert into splitfu (label, id)
select v.label, t.id
from public.transactions t
join (values
  ('sugg', 'splitfu:suggested'),
  ('sugg_rev', 'splitfu:suggested-review'),
  ('shared', 'splitfu:shared'),
  ('plain', 'splitfu:plain')
) v(label, k) on t.idempotency_key = v.k;

-- The shared line gets a guessed category on insert; remember it.
insert into splitfu (label, id)
select 'shared_guess', t.category_id from public.transactions t where t.id = (select id from splitfu where label = 'shared');

-- The category on these two lines is a guess, not the owner's pick.
update public.transactions
set category_suggested = true
where id in (select id from splitfu where label in ('sugg', 'sugg_rev'));

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', v.reason
from public.transactions t
join (values ('sugg_rev', 'missing_category'), ('shared', 'unallocated_shared')) v(label, reason)
  on t.id = (select id from splitfu where label = v.label);

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('splitfu_owner'), c.id, 'hash-splitfu-write01', 'kid', array['write']::text[], '2099-01-01'::timestamptz
from splitfu c where c.label = 'company';
insert into splitfu (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-splitfu-write01';

select is(
  (select bool_and(t.category_suggested) from public.transactions t where t.id in (select id from splitfu where label in ('sugg', 'sugg_rev'))),
  true,
  'setup: both lines carry a suggested category'
);

-- Share cap: 50 shares pass the parser, 51 are validation before any project lookup.
select lives_ok(
  $$select private.mcp_shares_for_save(
    (select jsonb_agg(jsonb_build_object('project_id', gen_random_uuid(), 'share', 2)) from generate_series(1, 50))
  )$$,
  '50 shares pass the share parser'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  public.mcp_assign_expense_split(
    'splitfu-cap',
    (select id from splitfu where label = 'plain'),
    (select jsonb_agg(jsonb_build_object('project_id', gen_random_uuid(), 'share', case when g = 1 then 50 else 1 end))
     from generate_series(1, 51) g)
  )->'error'->>'code',
  'validation',
  '51 shares are validation'
);

-- Idempotency ignores the order of the shares.
select is(
  public.mcp_assign_expense_split('splitfu-order', (select id from splitfu where label = 'plain'), pg_temp.shares(30, 70)) ->> 'ok',
  'true',
  'first split succeeds'
);

select is(
  public.mcp_assign_expense_split(
    'splitfu-order',
    (select id from splitfu where label = 'plain'),
    (select jsonb_agg(e order by ord desc) from jsonb_array_elements(pg_temp.shares(30, 70)) with ordinality x(e, ord))
  ) = public.mcp_assign_expense_split('splitfu-order', (select id from splitfu where label = 'plain'), pg_temp.shares(30, 70)),
  true,
  'the same shares in another order replay the stored response'
);

-- A hidden category and a finished project are accepted (owner's call, FLOW-204).
reset role;
update public.projects set status = 'finished' where id = (select id from splitfu where label = 'south');
do $$ begin perform pg_temp.as_mcp('write'); end $$;
select is(
  public.mcp_assign_expense_split(
    'splitfu-hidden',
    (select id from splitfu where label = 'plain'),
    pg_temp.shares(50, 50),
    (select id from splitfu where label = 'hidden')
  )->>'ok',
  'true',
  'a hidden category and a finished project are accepted'
);

reset role;
select is(
  (select t.category_id from public.transactions t where t.id = (select id from splitfu where label = 'plain')),
  (select id from splitfu where label = 'hidden'),
  'the hidden category is written'
);
update public.projects set status = 'active' where id = (select id from splitfu where label = 'south');

-- Undo of a reassign split puts the suggested category back.
do $$ begin perform pg_temp.as_mcp('write'); end $$;
select is(
  (public.mcp_assign_expense_split(
    'splitfu-sugg',
    (select id from splitfu where label = 'sugg'),
    pg_temp.shares(50, 50),
    (select id from splitfu where label = 'materials')
  )->'data') - 'id',
  '{"undo_kind": "reassign", "closed_review": false}'::jsonb,
  'a line without a review records reassign undo'
);

reset role;
insert into splitfu (label, id)
select 'sugg_undo', w.reassign_id from private.mcp_writes w where w.transaction_id = (select id from splitfu where label = 'sugg');

do $$ begin perform pg_temp.as_mcp('write'); end $$;
select is(
  public.mcp_undo('splitfu-undo-sugg', 'reassign', (select id from splitfu where label = 'sugg_undo'))->>'ok',
  'true',
  'reassign undo succeeds'
);

reset role;
select is(
  (select jsonb_build_object('suggested', t.category_suggested, 'assigned', t.category_assigned, 'user', t.user_assigned)
   from public.transactions t where t.id = (select id from splitfu where label = 'sugg')),
  '{"suggested": true, "assigned": false, "user": false}'::jsonb,
  'reassign undo keeps the category a suggestion'
);

-- Undo of a review split (reopen_review) puts the suggested category back.
do $$ begin perform pg_temp.as_mcp('write'); end $$;
select is(
  (public.mcp_assign_expense_split(
    'splitfu-sugg-rev',
    (select id from splitfu where label = 'sugg_rev'),
    pg_temp.shares(50, 50),
    (select id from splitfu where label = 'materials')
  )->'data') - 'id',
  '{"undo_kind": "review", "closed_review": true}'::jsonb,
  'a line in review records review undo'
);

select is(
  public.mcp_undo(
    'splitfu-undo-sugg-rev',
    'review',
    (select q.id from public.review_queue q where q.transaction_id = (select id from splitfu where label = 'sugg_rev'))
  )->>'ok',
  'true',
  'review undo succeeds'
);

reset role;
select is(
  (select jsonb_build_object('suggested', t.category_suggested, 'assigned', t.category_assigned, 'user', t.user_assigned)
   from public.transactions t where t.id = (select id from splitfu where label = 'sugg_rev')),
  '{"suggested": true, "assigned": false, "user": false}'::jsonb,
  'review undo keeps the category a suggestion'
);

-- An unallocated_shared review is closed by the split, reported, and keeps the true prior.
do $$ begin perform pg_temp.as_mcp('write'); end $$;
select is(
  (public.mcp_assign_expense_split(
    'splitfu-shared',
    (select id from splitfu where label = 'shared'),
    pg_temp.shares(40, 60),
    (select id from splitfu where label = 'labor')
  )->'data') - 'id',
  '{"undo_kind": "reassign", "closed_review": true}'::jsonb,
  'closing an unallocated_shared review reports closed_review true'
);

reset role;
select is(
  (select jsonb_build_object('status', q.status, 'prior_category_id', q.prior_category_id, 'prior_pnl_role', q.prior_pnl_role,
     'prior_category_suggested', q.prior_category_suggested)
   from public.review_queue q where q.transaction_id = (select id from splitfu where label = 'shared')),
  (select jsonb_build_object('status', 'changed', 'prior_category_id', id, 'prior_pnl_role', 'shared',
     'prior_category_suggested', true)
   from splitfu where label = 'shared_guess'),
  'the closed review stores the line from before the category write'
);
insert into splitfu (label, id)
select 'shared_undo', w.reassign_id from private.mcp_writes w where w.transaction_id = (select id from splitfu where label = 'shared');

do $$ begin perform pg_temp.as_mcp('write'); end $$;
select is(
  public.mcp_undo('splitfu-undo-shared', 'reassign', (select id from splitfu where label = 'shared_undo'))->>'ok',
  'true',
  'undo of the shared split succeeds'
);

reset role;
select is(
  (select jsonb_build_object('status', q.status, 'category_id', t.category_id, 'assigned', t.category_assigned)
   from public.review_queue q
   join public.transactions t on t.id = q.transaction_id
   where q.transaction_id = (select id from splitfu where label = 'shared')),
  (select jsonb_build_object('status', 'open', 'category_id', id, 'assigned', false)
   from splitfu where label = 'shared_guess'),
  'undo reopens the review and puts the guessed category back'
);

select * from finish();
rollback;
