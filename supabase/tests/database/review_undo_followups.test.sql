-- FLOW-208: undo puts category_assigned back as it was before the write, a batch retry with a
-- split row's shares in another order replays, and undo onto a line with no category lets
-- the trigger fill a fresh guess.

begin;

select plan(21);

do $users$
begin
  perform tests.create_supabase_user('rufu_owner', 'rufu-owner@example.com');
end
$users$;

create temp table rufu (label text primary key, id uuid);
grant all on rufu to authenticated, service_role;

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid('rufu_owner');
  select id into tid from pg_temp.rufu where label = 'write';
  if uid is null or tid is null then
    raise exception 'missing mcp actor';
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
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

create or replace function pg_temp.flags(p_label text)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_object(
    'category', t.category_id = (select id from pg_temp.rufu where label = 'labor'),
    'suggested', t.category_suggested,
    'assigned', t.category_assigned,
    'user', t.user_assigned
  )
  from public.transactions t
  where t.id = (select id from pg_temp.rufu where label = p_label)
$$;
grant execute on function pg_temp.flags(text) to authenticated, service_role;

select tests.authenticate_as('rufu_owner');
select lives_ok($$select public.create_company('Example Co', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'North Property', null, 'active')$$, 'north project');
select lives_ok($$select public.upsert_project(null, 'South Property', null, 'active')$$, 'south project');
reset role;

insert into rufu (label, id) select 'company', id from public.companies;
insert into rufu (label, id) select 'north', id from public.projects where name = 'North Property';
insert into rufu (label, id) select 'south', id from public.projects where name = 'South Property';
insert into rufu (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into rufu (label, id)
select 'labor', id from public.categories where name = 'עבודה' and kind = 'expense';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('rufu_owner'), c.id, 'hash-rufu-write01', 'kid', array['write']::text[], '2099-01-01'::timestamptz
from rufu c where c.label = 'company';
insert into rufu (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-rufu-write01';

-- Lines whose category came from the provider: neither a suggestion nor confirmed.
insert into public.transactions (
  company_id, direction, doc_kind, amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, category_id, description, user_assigned
)
select c.id, 'expense', 'expense', -10000, -10000, 0, 'unknown',
  '2026-09-15', 'manual', v.k, (select id from rufu where label = 'materials'), 'Synthetic line', false
from rufu c
cross join (values ('rufu:provider'), ('rufu:provider-review'), ('rufu:confirmed')) v(k)
where c.label = 'company';

insert into rufu (label, id)
select v.label, t.id
from public.transactions t
join (values
  ('provider', 'rufu:provider'),
  ('provider_rev', 'rufu:provider-review'),
  ('confirmed', 'rufu:confirmed')
) v(label, k) on t.idempotency_key = v.k;

update public.transactions set category_assigned = true
where id = (select id from rufu where label = 'confirmed');

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_project'
from public.transactions t
where t.id = (select id from rufu where label = 'provider_rev');

select is(
  pg_temp.flags('provider'),
  '{"category": false, "suggested": false, "assigned": false, "user": false}'::jsonb,
  'setup: the provider category is neither a suggestion nor confirmed'
);

-- Reassign undo.
do $$ begin perform pg_temp.as_mcp(); end $$;
select is(
  public.mcp_assign_expense_split(
    'rufu-provider', (select id from rufu where label = 'provider'),
    jsonb_build_array(
      jsonb_build_object('project_id', (select id from rufu where label = 'north'), 'share', 50),
      jsonb_build_object('project_id', (select id from rufu where label = 'south'), 'share', 50)
    ),
    (select id from rufu where label = 'labor')
  )->'data'->>'undo_kind',
  'reassign',
  'a line without a review records reassign undo'
);
reset role;
select is(
  (select jsonb_build_object('assigned', t.category_assigned, 'prior', u.prior_category_assigned)
   from public.transactions t join public.reassign_undo u on u.transaction_id = t.id
   where t.id = (select id from rufu where label = 'provider')),
  '{"assigned": true, "prior": false}'::jsonb,
  'the split confirms the category and the snapshot keeps the flag from before'
);
insert into rufu (label, id)
select 'provider_undo', w.reassign_id from private.mcp_writes w where w.transaction_id = (select id from rufu where label = 'provider');

do $$ begin perform pg_temp.as_mcp(); end $$;
select is(
  public.mcp_undo('rufu-undo-provider', 'reassign', (select id from rufu where label = 'provider_undo'))->>'ok',
  'true',
  'reassign undo succeeds'
);
reset role;
select is(
  pg_temp.flags('provider'),
  '{"category": false, "suggested": false, "assigned": false, "user": false}'::jsonb,
  'reassign undo leaves the provider category unconfirmed'
);

-- Review undo (reopen_review).
do $$ begin perform pg_temp.as_mcp(); end $$;
select is(
  public.mcp_assign_expense_split(
    'rufu-provider-rev', (select id from rufu where label = 'provider_rev'),
    jsonb_build_array(
      jsonb_build_object('project_id', (select id from rufu where label = 'north'), 'share', 50),
      jsonb_build_object('project_id', (select id from rufu where label = 'south'), 'share', 50)
    ),
    (select id from rufu where label = 'labor')
  )->'data'->>'undo_kind',
  'review',
  'a line in review records review undo'
);
reset role;
select is(
  (select jsonb_build_object('assigned', t.category_assigned, 'prior', q.prior_category_assigned)
   from public.transactions t join public.review_queue q on q.transaction_id = t.id
   where t.id = (select id from rufu where label = 'provider_rev')),
  '{"assigned": true, "prior": false}'::jsonb,
  'the review write confirms the category and the review keeps the flag from before'
);

do $$ begin perform pg_temp.as_mcp(); end $$;
select is(
  public.mcp_undo(
    'rufu-undo-provider-rev', 'review',
    (select q.id from public.review_queue q where q.transaction_id = (select id from rufu where label = 'provider_rev'))
  )->>'ok',
  'true',
  'review undo succeeds'
);
reset role;
select is(
  pg_temp.flags('provider_rev'),
  '{"category": false, "suggested": false, "assigned": false, "user": false}'::jsonb,
  'review undo leaves the provider category unconfirmed'
);

-- A category the owner already confirmed stays confirmed after undo.
do $$ begin perform pg_temp.as_mcp(); end $$;
select is(
  public.mcp_assign_expense(
    'rufu-confirmed', (select id from rufu where label = 'confirmed'),
    (select id from rufu where label = 'north'), (select id from rufu where label = 'labor'), false
  )->>'ok',
  'true',
  'write onto a confirmed category'
);
reset role;
insert into rufu (label, id)
select 'confirmed_undo', w.reassign_id from private.mcp_writes w where w.transaction_id = (select id from rufu where label = 'confirmed');
do $$ begin perform pg_temp.as_mcp(); end $$;
select is(
  public.mcp_undo('rufu-undo-confirmed', 'reassign', (select id from rufu where label = 'confirmed_undo'))->>'ok',
  'true',
  'undo of the write onto a confirmed category succeeds'
);
reset role;
select is(
  (select jsonb_build_object('assigned', t.category_assigned, 'materials', t.category_id = (select id from rufu where label = 'materials'))
   from public.transactions t where t.id = (select id from rufu where label = 'confirmed')),
  '{"assigned": true, "materials": true}'::jsonb,
  'undo keeps a confirmed category confirmed'
);

-- Undo of a write onto a line with no category lets the trigger fill a fresh guess.
update public.categories set hidden = true
where company_id = (select id from rufu where label = 'company') and kind = 'expense';
insert into public.transactions (
  company_id, direction, doc_kind, amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, user_assigned
)
select c.id, 'expense', 'expense', -10000, -10000, 0, 'unknown',
  '2026-09-15', 'manual', 'rufu:empty', 'Synthetic line', false
from rufu c where c.label = 'company';
insert into rufu (label, id) select 'empty', id from public.transactions where idempotency_key = 'rufu:empty';
update public.categories set hidden = false
where company_id = (select id from rufu where label = 'company') and kind = 'expense';

select is(
  (select t.category_id from public.transactions t where t.id = (select id from rufu where label = 'empty')),
  null,
  'setup: the line has no category'
);

do $$ begin perform pg_temp.as_mcp(); end $$;
select is(
  public.mcp_assign_expense(
    'rufu-empty', (select id from rufu where label = 'empty'),
    (select id from rufu where label = 'north'), (select id from rufu where label = 'labor'), false
  )->>'ok',
  'true',
  'write onto the line with no category'
);
reset role;
insert into rufu (label, id)
select 'empty_undo', w.reassign_id from private.mcp_writes w where w.transaction_id = (select id from rufu where label = 'empty');
do $$ begin perform pg_temp.as_mcp(); end $$;
select is(
  public.mcp_undo('rufu-undo-empty', 'reassign', (select id from rufu where label = 'empty_undo'))->>'ok',
  'true',
  'undo of the write onto the line with no category succeeds'
);
reset role;
select is(
  (select jsonb_build_object('has_category', t.category_id is not null, 'suggested', t.category_suggested,
     'assigned', t.category_assigned, 'user', t.user_assigned)
   from public.transactions t where t.id = (select id from rufu where label = 'empty')),
  '{"has_category": true, "suggested": true, "assigned": false, "user": false}'::jsonb,
  'the trigger fills a fresh guess after the undo'
);

-- assign_expenses: a retry with a split row's shares in another order replays.
insert into public.transactions (
  company_id, direction, doc_kind, amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, user_assigned
)
select c.id, 'expense', 'expense', -10000, -10000, 0, 'unknown',
  '2026-09-15', 'manual', 'rufu:batch', 'Synthetic line', false
from rufu c where c.label = 'company';
insert into rufu (label, id) select 'batch', id from public.transactions where idempotency_key = 'rufu:batch';

create or replace function pg_temp.batch(p_reverse boolean)
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_array(jsonb_build_object(
    'transaction_id', (select id from pg_temp.rufu where label = 'batch'),
    'category_id', (select id from pg_temp.rufu where label = 'labor'),
    'shares', (
      select jsonb_agg(s order by case when p_reverse then -ord else ord end)
      from jsonb_array_elements(jsonb_build_array(
        jsonb_build_object('project_id', (select id from pg_temp.rufu where label = 'north'), 'share', 30),
        jsonb_build_object('project_id', (select id from pg_temp.rufu where label = 'south'), 'share', 70)
      )) with ordinality x(s, ord)
    )
  ))
$$;
grant execute on function pg_temp.batch(boolean) to authenticated, service_role;

do $$ begin perform pg_temp.as_mcp(); end $$;
create temp table rufu_batch as select public.mcp_assign_expenses('rufu-batch', pg_temp.batch(false)) as first;
select is((select first->>'ok' from rufu_batch), 'true', 'the split batch succeeds');
select is(
  public.mcp_assign_expenses('rufu-batch', pg_temp.batch(true)),
  (select first from rufu_batch),
  'the same batch with the shares in another order replays the stored response'
);
reset role;

select * from finish();
rollback;
