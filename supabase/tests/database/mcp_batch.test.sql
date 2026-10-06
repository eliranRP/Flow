-- MCP cycle 6: assign_expenses and undo_batch.
-- Dates are fixed. Emails use @example.com.

begin;

select plan(26);

do $users$
begin
  perform tests.create_supabase_user('mcp6_owner', 'owner@example.com');
  perform tests.create_supabase_user('mcp6_other', 'other@example.com');
  perform tests.create_supabase_user('mcp6_viewer', 'viewer@example.com');
end
$users$;

create temp table mcp6 (label text primary key, id uuid);
grant all on mcp6 to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text, p_user text default 'mcp6_owner')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  select id into tid from pg_temp.mcp6 where label = p_label;
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

select tests.authenticate_as('mcp6_owner');
select lives_ok($$select public.create_company('Fixture Co', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'Alpha Site', null, 'active')$$, 'owner opens Alpha');
select lives_ok($$select public.upsert_project(null, 'Beta Site', null, 'active')$$, 'owner opens Beta');

insert into mcp6 (label, id) select 'company', id from public.companies;
insert into mcp6 (label, id) select 'alpha', id from public.projects where name = 'Alpha Site';
insert into mcp6 (label, id) select 'beta', id from public.projects where name = 'Beta Site';
insert into mcp6 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into mcp6 (label, id)
select 'haul', id from public.categories where name = 'הובלה' and kind = 'expense';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_suggested
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-01', 'manual', 'mcp6:plain', a.id, m.id, 'Plain row',
  false, true
from mcp6 c
join mcp6 a on a.label = 'alpha'
join mcp6 m on m.label = 'materials'
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key = 'mcp6:plain';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_suggested
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-02', 'manual', 'mcp6:queued', a.id, m.id, 'Queued row',
  false, true
from mcp6 c
join mcp6 a on a.label = 'alpha'
join mcp6 m on m.label = 'materials'
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key = 'mcp6:queued';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_project'
from public.transactions t
where t.idempotency_key = 'mcp6:queued';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-03', 'manual', 'mcp6:category', a.id, m.id, 'Category row',
  true
from mcp6 c
join mcp6 a on a.label = 'alpha'
join mcp6 m on m.label = 'materials'
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key = 'mcp6:category';

insert into mcp6 (label, id)
select 'plain', id from public.transactions where idempotency_key = 'mcp6:plain';
insert into mcp6 (label, id)
select 'queued', id from public.transactions where idempotency_key = 'mcp6:queued';
insert into mcp6 (label, id)
select 'category', id from public.transactions where idempotency_key = 'mcp6:category';
insert into mcp6 (label, id)
select 'queued_review', q.id
from public.review_queue q
join mcp6 t on t.id = q.transaction_id
where t.label = 'queued';

select tests.authenticate_as('mcp6_other');
select lives_ok($$select public.create_company('Other Co', true)$$, 'other creates a company');
insert into mcp6 (label, id) select 'other_company', id from public.companies where name = 'Other Co';
select lives_ok($$select public.upsert_project(null, 'Gamma Site', null, 'active')$$, 'other opens Gamma');
insert into mcp6 (label, id) select 'gamma', id from public.projects where name = 'Gamma Site';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, user_assigned
)
select c.id, 'expense', 'expense', 'overhead',
  -5000, -5000, 0, 'unknown',
  '2026-09-04', 'manual', 'mcp6:foreign', 'Foreign row',
  false
from mcp6 c
where c.label = 'other_company';

insert into mcp6 (label, id)
select 'foreign', id from public.transactions where idempotency_key = 'mcp6:foreign';

select lives_ok(
  format(
    $$select public.store_mcp_credential(%L::uuid, 'hash-mcp6-write1', array['read','write'], now() + interval '90 days', 'pepper-1')$$,
    tests.get_supabase_uid('mcp6_owner')
  ),
  'store write token'
);
insert into mcp6 (label, id)
select 'write', id from private.mcp_credentials where token_hash = 'hash-mcp6-write1';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mcp6_owner'), c.id, 'hash-mcp6-read01', 'pepper-1', array['read'], now() + interval '90 days'
from mcp6 c where c.label = 'company';
insert into mcp6 (label, id)
select 'read', id from private.mcp_credentials where token_hash = 'hash-mcp6-read01';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mcp6_other'), c.id, 'hash-mcp6-otherw', 'pepper-1', array['read','write'], now() + interval '90 days'
from mcp6 c where c.label = 'other_company';
insert into mcp6 (label, id)
select 'other_write', id from private.mcp_credentials where token_hash = 'hash-mcp6-otherw';

update public.companies set is_demo = true where id = (select id from mcp6 where label = 'company');
insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('mcp6_viewer'), c.id from mcp6 c where c.label = 'company';
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('mcp6_viewer'), c.id, 'hash-mcp6-viewer', 'pepper-1', array['read','write'], now() + interval '90 days'
from mcp6 c where c.label = 'company';
insert into mcp6 (label, id)
select 'viewer_write', id from private.mcp_credentials where token_hash = 'hash-mcp6-viewer';

create temp table mcp6_body (label text primary key, body jsonb);
grant all on mcp6_body to authenticated, service_role;
insert into mcp6_body (label, body)
select 'mixed', jsonb_build_array(
    jsonb_build_object(
      'transaction_id', (select id::text from mcp6 where label = 'plain'),
      'project_id', (select id::text from mcp6 where label = 'beta'),
      'category_id', (select id::text from mcp6 where label = 'haul')
    ),
    jsonb_build_object(
      'transaction_id', (select id::text from mcp6 where label = 'queued'),
      'project_id', (select id::text from mcp6 where label = 'beta'),
      'category_id', (select id::text from mcp6 where label = 'haul')
    ),
    jsonb_build_object(
      'transaction_id', (select id::text from mcp6 where label = 'category'),
      'category_id', (select id::text from mcp6 where label = 'haul')
    ),
    jsonb_build_object(
      'transaction_id', 'aaaaaaaa-aaaa-4000-8000-000000000099',
      'project_id', (select id::text from mcp6 where label = 'beta'),
      'category_id', (select id::text from mcp6 where label = 'haul')
    ),
    jsonb_build_object(
      'transaction_id', (select id::text from mcp6 where label = 'foreign'),
      'project_id', (select id::text from mcp6 where label = 'beta'),
      'category_id', (select id::text from mcp6 where label = 'haul')
    )
  );

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  public.mcp_assign_expenses('batch-mixed', '[]'::jsonb)->'error'->>'code',
  'validation',
  'zero items is validation'
);

insert into mcp6 (label, id)
select 'batch_key', (
  public.mcp_assign_expenses(
    'batch-mixed',
    (select body from mcp6_body where label = 'mixed')
  )->'data'->>'batch_key'
)::uuid;

select is(
  (
    public.mcp_assign_expenses(
      'batch-mixed',
      (select body from mcp6_body where label = 'mixed')
    )->'data'->>'ok_count'
  ),
  '3',
  'mixed batch applies three good rows'
);

select is(
  (select project_id from public.transactions where id = (select id from mcp6 where label = 'plain')),
  (select id from mcp6 where label = 'beta'),
  'assign row updates project like a single call'
);

select is(
  (
    select q.status
    from public.review_queue q
    where q.id = (select id from mcp6 where label = 'queued_review')
  ),
  'approved'::public.review_status,
  'queued assign row closes review like a single call'
);

select is(
  public.mcp_assign_expenses('batch-mixed', (select body from mcp6_body where label = 'mixed'))->'data'->>'batch_key',
  (select id::text from mcp6 where label = 'batch_key'),
  'replay returns the same batch_key'
);

select is(
  (
    select jsonb_agg(elem->>'code' order by ord)
    from jsonb_array_elements(
      public.mcp_assign_expenses('batch-mixed', (select body from mcp6_body where label = 'mixed'))->'data'->'results'
    ) with ordinality as r(elem, ord)
    where ord > 3
  ),
  '["refused", "refused"]'::jsonb,
  'unknown id and other-company transaction are refused per row'
);

select is(
  public.mcp_assign_expenses('batch-mixed', jsonb_build_array(
    jsonb_build_object(
      'transaction_id', (select id::text from mcp6 where label = 'plain'),
      'project_id', (select id::text from mcp6 where label = 'alpha'),
      'category_id', (select id::text from mcp6 where label = 'materials')
    )
  ))->'error'->>'code',
  'conflict',
  'same key with a different body is conflict'
);

select is(
  public.mcp_assign_expenses('batch-foreign-project', jsonb_build_array(
    jsonb_build_object(
      'transaction_id', (select id::text from mcp6 where label = 'category'),
      'project_id', (select id::text from mcp6 where label = 'gamma'),
      'category_id', (select id::text from mcp6 where label = 'haul')
    )
  ))->'data'->'results'->0->>'code',
  'refused',
  'an owner row with another company project is refused'
);

select is(
  (select project_id from public.transactions where id = (select id from mcp6 where label = 'category')),
  (select id from mcp6 where label = 'alpha'),
  'the refused row keeps its project'
);

do $$ begin perform pg_temp.as_mcp('other_write', 'mcp6_other'); end $$;

select is(
  public.mcp_assign_expenses('batch-other', (select body from mcp6_body where label = 'mixed'))->'data'->>'ok_count',
  '0',
  'other company token cannot assign owner rows or use owner projects'
);

select is(
  (
    public.mcp_undo_batch(
      'undo-other',
      (select id::text from mcp6 where label = 'batch_key')
    )->'error'->>'code'
  ),
  'not_found',
  'other company cannot undo_batch an owner batch'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-pos',
      (select id from mcp6 where label = 'plain'),
      (select id from mcp6 where label = 'beta'),
      (select id from mcp6 where label = 'haul'),
      false
    )->'data'->>'undo_kind'
  ),
  'reassign',
  'owner positive control after cross-company refusal'
);

select is(
  (
    public.mcp_undo_batch(
      'undo-batch-1',
      (select id::text from mcp6 where label = 'batch_key')
    )->'data'->>'ok_count'
  ),
  '3',
  'undo_batch restores the good rows'
);

select is(
  (
    select q.status
    from public.review_queue q
    where q.id = (select id from mcp6 where label = 'queued_review')
  ),
  'open'::public.review_status,
  'undo_batch reopens the closed review'
);

select is(
  public.mcp_undo_batch(
    'undo-batch-1',
    (select id::text from mcp6 where label = 'batch_key')
  )->'data'->>'ok_count',
  '3',
  'undo_batch replay is a no-op'
);

insert into mcp6 (label, id)
select 'batch_conflict', (
  public.mcp_assign_expenses(
    'batch-undo-conflict',
    jsonb_build_array(
      jsonb_build_object(
        'transaction_id', (select id::text from mcp6 where label = 'plain'),
        'project_id', (select id::text from mcp6 where label = 'beta'),
        'category_id', (select id::text from mcp6 where label = 'haul')
      ),
      jsonb_build_object(
        'transaction_id', (select id::text from mcp6 where label = 'category'),
        'category_id', (select id::text from mcp6 where label = 'haul')
      )
    )
  )->'data'->>'batch_key'
)::uuid;

reset role;

update public.transactions
set project_id = (select id from mcp6 where label = 'alpha')
where id = (select id from mcp6 where label = 'plain');

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    select count(*)::int
    from jsonb_array_elements(
      public.mcp_undo_batch(
        'undo-batch-conflict',
        (select id::text from mcp6 where label = 'batch_conflict')
      )->'data'->'results'
    ) elem
    where elem->>'code' = 'conflict'
  ),
  1,
  'a row changed since assign is conflict on undo'
);

select is(
  (
    select count(*)::int
    from jsonb_array_elements(
      public.mcp_undo_batch(
        'undo-batch-conflict',
        (select id::text from mcp6 where label = 'batch_conflict')
      )->'data'->'results'
    ) elem
    where elem->>'ok' = 'true'
  ),
  1,
  'the other row still undoes'
);

do $$ begin perform pg_temp.as_mcp('read'); end $$;

select is(
  public.mcp_assign_expenses('batch-read', (select body from mcp6_body where label = 'mixed'))->'error'->>'code',
  'forbidden',
  'read token cannot assign_expenses'
);

do $$ begin perform pg_temp.as_mcp('viewer_write', 'mcp6_viewer'); end $$;

select is(
  public.mcp_assign_expenses('batch-viewer', (select body from mcp6_body where label = 'mixed'))->'error'->>'code',
  'forbidden',
  'viewer write row is still forbidden'
);

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -100, -100, 0, 'unknown',
  '2026-09-10', 'manual', 'mcp6:bulk-' || g::text, a.id, m.id, 'Bulk ' || g::text,
  true
from mcp6 c
join mcp6 a on a.label = 'alpha'
join mcp6 m on m.label = 'materials'
cross join generate_series(1, 200) g
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key like 'mcp6:bulk-%';

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expenses(
      'batch-200',
      (
        select jsonb_agg(
          jsonb_build_object(
            'transaction_id', t.id::text,
            'category_id', (select id::text from mcp6 where label = 'haul')
          )
          order by t.idempotency_key
        )
        from public.transactions t
        where t.idempotency_key like 'mcp6:bulk-%'
      )
    )->'data'->>'ok_count'
  ),
  '200',
  'a 200-item batch succeeds'
);

select * from finish();

rollback;
