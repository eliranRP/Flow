-- MCP cycle 3a, gates: revoked and read-only tokens, idempotent replays,
-- and review closes from the app.
-- Dates are fixed. Addresses and names are fixtures.

begin;

select plan(24);

do $users$
begin
  perform tests.create_supabase_user('mcp3_owner', 'mcp3-owner@test.flow');
  perform tests.create_supabase_user('mcp3_other', 'mcp3-other@test.flow');
end
$users$;

create temp table mcp3 (label text primary key, id uuid);
grant all on mcp3 to authenticated, service_role;

create temp table mcp3_prior (
  label text primary key,
  project_id uuid,
  category_id uuid,
  pnl_role text,
  user_assigned boolean,
  category_suggested boolean,
  shares jsonb
);
grant all on mcp3_prior to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text, p_user text default 'mcp3_owner')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  select id into tid from pg_temp.mcp3 where label = p_label;
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

select tests.authenticate_as('mcp3_owner');
select lives_ok($$select public.create_company('חברה', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'אלפא', null, 'active')$$, 'owner opens אלפא');
select lives_ok($$select public.upsert_project(null, 'ביתא', null, 'active')$$, 'owner opens ביתא');
select lives_ok($$select public.upsert_project(null, 'גמור', null, 'finished')$$, 'owner opens a finished project');

insert into mcp3 (label, id) select 'company', id from public.companies;
insert into mcp3 (label, id) select 'alpha', id from public.projects where name = 'אלפא';
insert into mcp3 (label, id) select 'beta', id from public.projects where name = 'ביתא';
insert into mcp3 (label, id) select 'finished', id from public.projects where name = 'גמור';
insert into mcp3 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into mcp3 (label, id)
select 'haul', id from public.categories where name = 'הובלה' and kind = 'expense';

reset role;
insert into public.suppliers (company_id, name)
select id, 'ספק בדיקה' from public.companies;
insert into mcp3 (label, id) select 'supplier', id from public.suppliers where name = 'ספק בדיקה';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_suggested
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-01', 'manual', 'mcp3:plain', a.id, m.id, 'רגילה',
  false, true
from mcp3 c
join mcp3 a on a.label = 'alpha'
join mcp3 m on m.label = 'materials'
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key = 'mcp3:plain';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, supplier_id, description,
  user_assigned, category_suggested
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-02', 'manual', 'mcp3:queued', a.id, m.id, s.id, 'בתור',
  false, true
from mcp3 c
join mcp3 a on a.label = 'alpha'
join mcp3 m on m.label = 'materials'
join mcp3 s on s.label = 'supplier'
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key = 'mcp3:queued';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_project'
from public.transactions t
where t.idempotency_key = 'mcp3:queued';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-03', 'manual', 'mcp3:category', a.id, m.id, 'קטגוריה',
  true
from mcp3 c
join mcp3 a on a.label = 'alpha'
join mcp3 m on m.label = 'materials'
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key = 'mcp3:category';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-04', 'manual', 'mcp3:edit', a.id, m.id, 'עריכה',
  true
from mcp3 c
join mcp3 a on a.label = 'alpha'
join mcp3 m on m.label = 'materials'
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key = 'mcp3:edit';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, user_assigned
)
select c.id, 'expense', 'expense', 'overhead',
  -10000, -10000, 0, 'unknown',
  '2026-09-05', 'manual', 'mcp3:own', 'שלי',
  false
from mcp3 c
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-06', 'manual', 'mcp3:replay', a.id, m.id, 'חזרה',
  true
from mcp3 c
join mcp3 a on a.label = 'alpha'
join mcp3 m on m.label = 'materials'
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key = 'mcp3:replay';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-07', 'manual', 'mcp3:finished', a.id, m.id, 'גמור',
  true
from mcp3 c
join mcp3 a on a.label = 'alpha'
join mcp3 m on m.label = 'materials'
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key = 'mcp3:finished';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-08', 'manual', 'mcp3:stale', a.id, m.id, 'מיושן',
  false
from mcp3 c
join mcp3 a on a.label = 'alpha'
join mcp3 m on m.label = 'materials'
where c.label = 'company';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_category'
from public.transactions t
where t.idempotency_key = 'mcp3:stale';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-09', 'manual', 'mcp3:app', a.id, m.id, 'אפליקציה',
  false
from mcp3 c
join mcp3 a on a.label = 'alpha'
join mcp3 m on m.label = 'materials'
where c.label = 'company';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_project'
from public.transactions t
where t.idempotency_key = 'mcp3:app';

insert into mcp3 (label, id)
select 'plain', id from public.transactions where idempotency_key = 'mcp3:plain';
insert into mcp3 (label, id)
select 'queued', id from public.transactions where idempotency_key = 'mcp3:queued';
insert into mcp3 (label, id)
select 'queued_review', q.id
from public.review_queue q
join public.transactions t on t.id = q.transaction_id
where t.idempotency_key = 'mcp3:queued' and q.status = 'open';
insert into mcp3 (label, id)
select 'category', id from public.transactions where idempotency_key = 'mcp3:category';
insert into mcp3 (label, id)
select 'edit', id from public.transactions where idempotency_key = 'mcp3:edit';
insert into mcp3 (label, id)
select 'own', id from public.transactions where idempotency_key = 'mcp3:own';
insert into mcp3 (label, id)
select 'replay', id from public.transactions where idempotency_key = 'mcp3:replay';
insert into mcp3 (label, id)
select 'finished_txn', id from public.transactions where idempotency_key = 'mcp3:finished';
insert into mcp3 (label, id)
select 'stale', id from public.transactions where idempotency_key = 'mcp3:stale';
insert into mcp3 (label, id)
select 'stale_review', q.id
from public.review_queue q
join public.transactions t on t.id = q.transaction_id
where t.idempotency_key = 'mcp3:stale' and q.status = 'open';
insert into mcp3 (label, id)
select 'app', id from public.transactions where idempotency_key = 'mcp3:app';
insert into mcp3 (label, id)
select 'app_review', q.id
from public.review_queue q
join public.transactions t on t.id = q.transaction_id
where t.idempotency_key = 'mcp3:app' and q.status = 'open';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-12', 'manual', 'mcp3:again', a.id, m.id, 'שוב',
  false
from mcp3 c
join mcp3 a on a.label = 'alpha'
join mcp3 m on m.label = 'materials'
where c.label = 'company';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key = 'mcp3:again';
insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_project'
from public.transactions t
where t.idempotency_key = 'mcp3:again';
insert into mcp3 (label, id)
select 'again', id from public.transactions where idempotency_key = 'mcp3:again';
insert into mcp3 (label, id)
select 'again_review', q.id
from public.review_queue q
join public.transactions t on t.id = q.transaction_id
where t.idempotency_key = 'mcp3:again' and q.status = 'open';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-13', 'manual', key, a.id, m.id, 'שער',
  false
from mcp3 c
join mcp3 a on a.label = 'alpha'
join mcp3 m on m.label = 'materials'
cross join (values ('mcp3:gate-a'), ('mcp3:gate-b'), ('mcp3:gate-c'), ('mcp3:dead')) as keys(key)
where c.label = 'company';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key in ('mcp3:gate-a', 'mcp3:gate-b', 'mcp3:gate-c', 'mcp3:dead');
insert into mcp3 (label, id)
select 'gate_a', id from public.transactions where idempotency_key = 'mcp3:gate-a';
insert into mcp3 (label, id)
select 'gate_b', id from public.transactions where idempotency_key = 'mcp3:gate-b';
insert into mcp3 (label, id)
select 'gate_c', id from public.transactions where idempotency_key = 'mcp3:gate-c';
insert into mcp3 (label, id)
select 'dead', id from public.transactions where idempotency_key = 'mcp3:dead';

insert into mcp3_prior (label, project_id, category_id, pnl_role, user_assigned, category_suggested, shares)
select 'plain', t.project_id, t.category_id, t.pnl_role::text, t.user_assigned, t.category_suggested,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'project_id', a.project_id, 'share_bp', a.share_bp, 'amount_net', a.amount_net
    ) order by a.project_id)
    from public.allocations a
    where a.transaction_id = t.id
  ), '[]'::jsonb)
from public.transactions t
where t.idempotency_key = 'mcp3:plain';

select tests.authenticate_as('mcp3_other');
select lives_ok($$select public.create_company('אחרת', true)$$, 'the other owner creates a company');
select lives_ok($$select public.upsert_project(null, 'זר', null, 'active')$$, 'the other owner opens a project');
insert into mcp3 (label, id) select 'other_company', id from public.companies where name = 'אחרת';
insert into mcp3 (label, id) select 'other_project', id from public.projects where name = 'זר';
insert into mcp3 (label, id)
select 'other_category', c.id
from public.categories c
join mcp3 company on company.label = 'other_company'
where c.company_id = company.id and c.name = 'חומרים' and c.kind = 'expense';
reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description,
  user_assigned
)
select c.id, 'expense', 'expense', 'project',
  -20000, -20000, 0, 'unknown',
  '2026-09-10', 'manual', 'mcp3:other', p.id, cat.id, 'של אחר',
  true
from mcp3 c
join mcp3 p on p.label = 'other_project'
join mcp3 cat on cat.label = 'other_category'
where c.label = 'other_company';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key = 'mcp3:other';
insert into mcp3 (label, id)
select 'other_txn', id from public.transactions where idempotency_key = 'mcp3:other';

reset role;

select lives_ok(
  format(
    $$select public.store_mcp_credential(%L::uuid, 'hash-mcp3-write1', array['read','write'], now() + interval '90 days', 'pepper-1')$$,
    (select id from auth.users where email = 'mcp3-owner@test.flow')
  ),
  'store the owner write token'
);

insert into mcp3 (label, id)
select 'write', id from private.mcp_credentials where token_hash = 'hash-mcp3-write1';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select user_id, company_id, 'hash-mcp3-read01', 'pepper-1', array['read'], now() + interval '90 days'
from private.mcp_credentials
where token_hash = 'hash-mcp3-write1';

insert into mcp3 (label, id)
select 'read', id from private.mcp_credentials where token_hash = 'hash-mcp3-read01';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at, revoked_at)
select user_id, company_id, 'hash-mcp3-revoked', 'pepper-1', array['read','write'], now() + interval '90 days', now()
from private.mcp_credentials
where token_hash = 'hash-mcp3-write1';

insert into mcp3 (label, id)
select 'revoked', id from private.mcp_credentials where token_hash = 'hash-mcp3-revoked';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select user_id, company_id, 'hash-mcp3-expired', 'pepper-1', array['read','write'], now() - interval '1 day'
from private.mcp_credentials
where token_hash = 'hash-mcp3-write1';

insert into mcp3 (label, id)
select 'expired', id from private.mcp_credentials where token_hash = 'hash-mcp3-expired';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select
  (select id from auth.users where email = 'mcp3-other@test.flow'),
  (select id from mcp3 where label = 'other_company'),
  'hash-mcp3-otherw',
  'pepper-1',
  array['read','write'],
  now() + interval '90 days';

insert into mcp3 (label, id)
select 'other_write', id from private.mcp_credentials where token_hash = 'hash-mcp3-otherw';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select
  (select id from auth.users where email = 'mcp3-owner@test.flow'),
  (select id from mcp3 where label = 'other_company'),
  'hash-mcp3-xcompan',
  'pepper-1',
  array['read','write'],
  now() + interval '90 days';

insert into mcp3 (label, id)
select 'cross_company', id from private.mcp_credentials where token_hash = 'hash-mcp3-xcompan';

insert into mcp3 (label, id)
select 'owner_user', id from auth.users where email = 'mcp3-owner@test.flow';

reset role;
do $$ begin perform pg_temp.as_mcp('revoked'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-revoked',
      (select id from mcp3 where label = 'finished_txn'),
      (select id from mcp3 where label = 'finished'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'error'->>'message'
  ),
  'revoked',
  'a revoked token is rejected'
);

select is(
  (select project_id from public.transactions where idempotency_key = 'mcp3:finished'),
  (select id from mcp3 where label = 'alpha'),
  'a revoked token writes nothing'
);

reset role;
do $$ begin perform pg_temp.as_mcp('read'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-readonly',
      (select id from mcp3 where label = 'finished_txn'),
      (select id from mcp3 where label = 'finished'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'error'->>'code'
  ),
  'forbidden',
  'a read-only token cannot write'
);

reset role;
do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-finished',
      (select id from mcp3 where label = 'finished_txn'),
      (select id from mcp3 where label = 'finished'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'ok'
  )::boolean,
  true,
  'a finished project can be assigned'
);

select is(
  (
    public.mcp_assign_expense(
      'assign-replay',
      (select id from mcp3 where label = 'replay'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'data'->>'id'
  ),
  (
    public.mcp_assign_expense(
      'assign-replay',
      (select id from mcp3 where label = 'replay'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'data'->>'id'
  ),
  'the same key and body return the stored response'
);

reset role;
select is(
  (select count(*) from private.mcp_writes w where w.transaction_id = (select id from mcp3 where label = 'replay')),
  1::bigint,
  'a replay does not write a second undo row'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-replay',
      (select id from mcp3 where label = 'replay'),
      (select id from mcp3 where label = 'alpha'),
      (select id from mcp3 where label = 'materials'),
      false
    )->'error'->>'code'
  ),
  'conflict',
  'the same key with a different body is conflict'
);

select is(
  (select project_id from public.transactions where idempotency_key = 'mcp3:replay'),
  (select id from mcp3 where label = 'beta'),
  'the conflict leaves the first assignment'
);

select is(
  (
    public.mcp_assign_expense(
      'assign-review-id',
      (select id from mcp3 where label = 'stale_review'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'error'->>'message'
  ),
  'id is not a transaction; list_review.id is the review id',
  'a review id in a transaction argument is validation'
);

select is(
  (
    public.approve_review_item(
      (select id from mcp3 where label = 'stale_review'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false,
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      true
    )->'error'->>'code'
  ),
  'stale',
  'shown values that differ write nothing'
);

select is(
  (select category_id from public.transactions where idempotency_key = 'mcp3:stale'),
  (select id from mcp3 where label = 'materials'),
  'a stale close leaves the category'
);

select is(
  (
    public.approve_review_item(
      (select id from mcp3 where label = 'app_review'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false,
      null,
      null,
      false
    )->'ok'
  )::boolean,
  true,
  'the app close succeeds when the shown check is off'
);

select is(
  (
    public.approve_review_item(
      (select id from mcp3 where label = 'app_review'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false,
      null,
      null,
      false
    )->'error'->>'code'
  ),
  'already_closed',
  'a second close is already_closed'
);

select is(
  (
    public.mcp_undo(
      'undo-app',
      'review',
      (select id from mcp3 where label = 'app_review')
    )->'error'->>'code'
  ),
  'not_found',
  'an app approval is not an assistant undo'
);

select is(
  (
    public.approve_review_item(
      '99999999-9999-4000-8000-000000000098',
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false,
      null,
      null,
      false
    )->'error'->>'code'
  ),
  'not_found',
  'a missing review is not_found'
);

select is(
  (
    public.approve_review_item(
      (select id from mcp3 where label = 'stale_review'),
      (select id from mcp3 where label = 'other_project'),
      (select id from mcp3 where label = 'haul'),
      false,
      null,
      null,
      false
    )->'error'->>'message'
  ),
  'project or category not found',
  'another company project is refused'
);

select is(
  (
    select q.status
    from public.review_queue q
    where q.id = (select id from mcp3 where label = 'stale_review')
  ),
  'open'::public.review_status,
  'the refused close leaves the review open'
);

select * from finish();
rollback;
