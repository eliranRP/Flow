-- MCP cycle 3a: single-expense writes, typed undo, and the gates around them.
-- Dates are fixed. Addresses and names are fixtures.

begin;

select plan(92);

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

select ok(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where (
      (n.nspname = 'public' and p.proname in (
        'approve_review_item', 'mcp_assign_expense', 'mcp_set_expense_category', 'mcp_undo'
      ))
      or (n.nspname = 'private' and p.proname in (
        'mcp_error', 'mcp_refused', 'mcp_shares', 'mcp_require_writer',
        'mcp_idempotency_lookup', 'mcp_idempotency_store', 'mcp_record_write'
      ))
    )
    and exists (
      select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as cfg
      where cfg = 'search_path=""'
    )
  ) = 11,
  'each write wrapper pins search_path to the empty string'
);

select ok(
  has_function_privilege('authenticated', 'public.mcp_assign_expense(text, uuid, uuid, uuid, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.mcp_set_expense_category(text, uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.mcp_undo(text, text, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.approve_review_item(uuid, uuid, uuid, boolean, uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.mcp_assign_expense(text, uuid, uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('service_role', 'public.mcp_assign_expense(text, uuid, uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('service_role', 'public.mcp_undo(text, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.mcp_require_writer()', 'execute')
  and not has_function_privilege('anon', 'private.mcp_idempotency_store(uuid, text, text, jsonb)', 'execute'),
  'authenticated can call the wrappers and cannot call the private helpers'
);

select ok(
  not (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'mcp_error'
  )
  and not (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'mcp_refused'
  )
  and (
    select p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'mcp_require_writer'
  ),
  'json helpers are not security definer and the writer gate is'
);

select ok(
  strpos(
    pg_get_functiondef('public.mcp_assign_expense(text, uuid, uuid, uuid, boolean)'::regprocedure),
    'for update'
  ) < strpos(
    pg_get_functiondef('public.mcp_assign_expense(text, uuid, uuid, uuid, boolean)'::regprocedure),
    'from public.review_queue q'
  )
  and strpos(
    pg_get_functiondef('public.mcp_set_expense_category(text, uuid, uuid)'::regprocedure),
    'for update'
  ) < strpos(
    pg_get_functiondef('public.mcp_set_expense_category(text, uuid, uuid)'::regprocedure),
    'from public.review_queue q'
  ),
  'assign and category lock the expense before the review'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select throws_ok(
  $$select id from private.mcp_writes$$,
  '42501',
  null,
  'a client cannot read undo rows'
);

select throws_ok(
  $$select idempotency_key from private.mcp_idempotency$$,
  '42501',
  null,
  'a client cannot read idempotency rows'
);

select throws_ok(
  format(
    $$insert into private.mcp_writes (token_id, user_id, review_id, kind) values (%L::uuid, %L::uuid, %L::uuid, 'review')$$,
    (select id from mcp3 where label = 'write'),
    (select id from mcp3 where label = 'owner_user'),
    (select id from mcp3 where label = 'queued_review')
  ),
  '42501',
  null,
  'a client cannot forge an undo row'
);

select throws_ok(
  format(
    $$insert into private.mcp_idempotency (token_id, idempotency_key, request_hash, response) values (%L::uuid, 'forged', 'hash', '{}'::jsonb)$$,
    (select id from mcp3 where label = 'write')
  ),
  '42501',
  null,
  'a client cannot forge an idempotency row'
);

reset role;
do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-plain',
      (select id from mcp3 where label = 'plain'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'data'->>'undo_kind'
  ),
  'reassign',
  'assign with no open review returns a reassign undo'
);

select is(
  (select project_id from public.transactions where idempotency_key = 'mcp3:plain'),
  (select id from mcp3 where label = 'beta'),
  'assign writes the owner project'
);

select is(
  (select user_assigned from public.transactions where idempotency_key = 'mcp3:plain'),
  true,
  'assign sets user_assigned'
);

reset role;
select is(
  (select count(*) from private.mcp_writes w join mcp3 t on t.id = w.transaction_id where t.label = 'plain'),
  1::bigint,
  'the assign and its undo row commit together'
);

insert into mcp3 (label, id)
select 'plain_undo', w.reassign_id
from private.mcp_writes w
join mcp3 t on t.id = w.transaction_id
where t.label = 'plain';

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_undo(
      'undo-plain',
      'reassign',
      (select id from mcp3 where label = 'plain_undo')
    )->'data'->>'kind'
  ),
  'reassign',
  'undo of a reassign returns that kind'
);

select is(
  (
    select jsonb_build_object(
      'project_id', t.project_id,
      'category_id', t.category_id,
      'pnl_role', t.pnl_role,
      'user_assigned', t.user_assigned,
      'category_suggested', t.category_suggested,
      'shares', coalesce((
        select jsonb_agg(jsonb_build_object(
          'project_id', a.project_id, 'share_bp', a.share_bp, 'amount_net', a.amount_net
        ) order by a.project_id)
        from public.allocations a
        where a.transaction_id = t.id
      ), '[]'::jsonb)
    )
    from public.transactions t
    where t.idempotency_key = 'mcp3:plain'
  ),
  (
    select jsonb_build_object(
      'project_id', project_id,
      'category_id', category_id,
      'pnl_role', pnl_role::public.pnl_role,
      'user_assigned', user_assigned,
      'category_suggested', category_suggested,
      'shares', shares
    )
    from mcp3_prior
    where label = 'plain'
  ),
  'undo restores the exact prior project, category, role, flags, and shares'
);

select is(
  (
    public.mcp_undo(
      'undo-plain-again',
      'reassign',
      (select id from mcp3 where label = 'plain_undo')
    )->'error'->>'code'
  ),
  'not_found',
  'a second undo is not_found'
);

select is(
  (
    public.mcp_assign_expense(
      'assign-queued',
      (select id from mcp3 where label = 'queued'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      true
    )->'data'->>'closed_review'
  ),
  'true',
  'assign closes an open review'
);

select is(
  (select remembered_category_id from public.suppliers where name = 'ספק בדיקה'),
  (select id from mcp3 where label = 'haul'),
  'remember writes the supplier rule'
);

select is(
  (
    select q.status
    from public.review_queue q
    where q.id = (select id from mcp3 where label = 'queued_review')
  ),
  'approved'::public.review_status,
  'the review leaves the open queue'
);

select is(
  (
    public.mcp_undo(
      'undo-queued',
      'review',
      (select id from mcp3 where label = 'queued_review')
    )->'data'->>'kind'
  ),
  'review',
  'undo of a closed review reopens it'
);

select is(
  (
    select q.status
    from public.review_queue q
    where q.id = (select id from mcp3 where label = 'queued_review')
  ),
  'open'::public.review_status,
  'the card is back in the queue'
);

select is(
  (select remembered_category_id from public.suppliers where name = 'ספק בדיקה'),
  null,
  'undo restores the supplier rule'
);

select is(
  (select project_id from public.transactions where idempotency_key = 'mcp3:queued'),
  (select id from mcp3 where label = 'alpha'),
  'review undo restores the prior project'
);

select is(
  (
    public.mcp_set_expense_category(
      'cat-queued',
      (select id from mcp3 where label = 'queued'),
      (select id from mcp3 where label = 'haul')
    )->'data'->>'closed_review'
  ),
  'true',
  'set category closes an open review and keeps the project path'
);

select is(
  (select project_id from public.transactions where idempotency_key = 'mcp3:queued'),
  (select id from mcp3 where label = 'alpha'),
  'set category keeps the current project'
);

select is(
  (select category_id from public.transactions where idempotency_key = 'mcp3:queued'),
  (select id from mcp3 where label = 'haul'),
  'set category writes the category'
);

select is(
  (
    public.mcp_set_expense_category(
      'cat-plain',
      (select id from mcp3 where label = 'category'),
      (select id from mcp3 where label = 'haul')
    )->'data'->>'undo_kind'
  ),
  'reassign',
  'a category change with no review is a reassign undo'
);

select is(
  (select project_id from public.transactions where idempotency_key = 'mcp3:category'),
  (select id from mcp3 where label = 'alpha'),
  'a category change keeps the project'
);

select is(
  (
    select jsonb_agg(jsonb_build_object('project_id', a.project_id, 'share_bp', a.share_bp) order by a.project_id)
    from public.allocations a
    join public.transactions t on t.id = a.transaction_id
    where t.idempotency_key = 'mcp3:category'
  ),
  jsonb_build_array(jsonb_build_object(
    'project_id', (select id from mcp3 where label = 'alpha'),
    'share_bp', 10000
  )),
  'a category change keeps the shares'
);

select is(
  (
    public.mcp_assign_expense(
      'assign-edit',
      (select id from mcp3 where label = 'edit'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'ok'
  )::boolean,
  true,
  'the edit row is assigned'
);

reset role;
insert into mcp3 (label, id)
select 'edit_undo', w.reassign_id
from private.mcp_writes w
where w.transaction_id = (select id from mcp3 where label = 'edit')
  and w.kind = 'reassign';

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select lives_ok(
  format(
    $$select public.set_transaction_category(%L::uuid, %L::uuid, true)$$,
    (select id from mcp3 where label = 'edit'),
    (select id from mcp3 where label = 'materials')
  ),
  'the owner edits the category after the assistant'
);

select is(
  (
    public.mcp_undo(
      'undo-edit',
      'reassign',
      (select id from mcp3 where label = 'edit_undo')
    )->'error'->>'code'
  ),
  'conflict',
  'undo after an owner edit is conflict'
);

select is(
  (select category_id from public.transactions where idempotency_key = 'mcp3:edit'),
  (select id from mcp3 where label = 'materials'),
  'the later edit stays'
);

select is(
  (
    public.mcp_undo(
      'undo-unknown',
      'reassign',
      '99999999-9999-4000-8000-000000000099'
    )->'error'->>'code'
  ),
  'not_found',
  'an unknown undo id is not_found'
);

select is(
  (
    public.mcp_assign_expense(
      'assign-cross',
      (select id from mcp3 where label = 'other_txn'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'error'->>'message'
  ),
  'transaction not found',
  'a cross-company transaction is refused'
);

reset role;
select is(
  (select project_id from public.transactions where idempotency_key = 'mcp3:other'),
  (select id from mcp3 where label = 'other_project'),
  'the other company row is unchanged'
);
do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-cross-category',
      (select id from mcp3 where label = 'own'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'other_category'),
      false
    )->'error'->>'message'
  ),
  'category not found',
  'another company category cannot be written'
);

select is(
  (
    public.mcp_assign_expense(
      'assign-own',
      (select id from mcp3 where label = 'own'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'data'->>'undo_kind'
  ),
  'reassign',
  'the owner can still assign their own row'
);

select is(
  (select project_id from public.transactions where idempotency_key = 'mcp3:own'),
  (select id from mcp3 where label = 'beta'),
  'the owner row received the project'
);

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

reset role;

do $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;

select is(
  public.upsert_sumit_documents(
    (select id from mcp3 where label = 'company'),
    jsonb_build_array(jsonb_build_object(
      'idempotency_key', 'mcp3:sync',
      'external_id', 'mcp3-sync',
      'direction', 'expense',
      'doc_kind', 'expense',
      'pnl_role', 'project',
      'amount_gross', '-10000',
      'amount_net', '-10000',
      'vat_amount', '0',
      'vat_status', 'unknown',
      'doc_date', '2026-09-11',
      'description', 'לפני',
      'budget_section_name', 'סעיף',
      'party_name', 'ספק סנכרון',
      'party_kind', 'supplier'
    ))
  ),
  1,
  'the first sync files the expense'
);

insert into mcp3 (label, id)
select 'sync', id from public.transactions where idempotency_key = 'mcp3:sync';

insert into mcp3_prior (label, project_id, category_id, pnl_role, user_assigned, category_suggested, shares)
select 'sync', t.project_id, t.category_id, t.pnl_role::text, t.user_assigned, t.category_suggested,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'project_id', a.project_id, 'share_bp', a.share_bp, 'amount_net', a.amount_net
    ) order by a.project_id)
    from public.allocations a
    where a.transaction_id = t.id
  ), '[]'::jsonb)
from public.transactions t
where t.idempotency_key = 'mcp3:sync';

reset role;
do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-sync',
      (select id from mcp3 where label = 'sync'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'data'->>'closed_review'
  ),
  'true',
  'the assistant assign closes the sync review'
);

reset role;
insert into mcp3 (label, id)
select 'sync_review', w.review_id
from private.mcp_writes w
where w.transaction_id = (select id from mcp3 where label = 'sync')
  and w.kind = 'review';

reset role;
do $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;

select is(
  public.upsert_sumit_documents(
    (select id from mcp3 where label = 'company'),
    jsonb_build_array(jsonb_build_object(
      'idempotency_key', 'mcp3:sync',
      'external_id', 'mcp3-sync',
      'direction', 'expense',
      'doc_kind', 'expense',
      'pnl_role', 'overhead',
      'amount_gross', '-10000',
      'amount_net', '-10000',
      'vat_amount', '0',
      'vat_status', 'unknown',
      'doc_date', '2026-09-11',
      'description', 'אחרי',
      'budget_section_name', 'אחר',
      'party_name', 'ספק סנכרון',
      'party_kind', 'supplier'
    ))
  ),
  1,
  'a later sync runs'
);

select is(
  (
    select jsonb_build_object(
      'project_id', t.project_id,
      'category_id', t.category_id,
      'category_suggested', t.category_suggested,
      'pnl_role', t.pnl_role,
      'shares', coalesce((
        select jsonb_agg(jsonb_build_object(
          'project_id', a.project_id, 'share_bp', a.share_bp, 'amount_net', a.amount_net
        ) order by a.project_id)
        from public.allocations a
        where a.transaction_id = t.id
      ), '[]'::jsonb)
    )
    from public.transactions t
    where t.idempotency_key = 'mcp3:sync'
  ),
  jsonb_build_object(
    'project_id', (select id from mcp3 where label = 'beta'),
    'category_id', (select id from mcp3 where label = 'haul'),
    'category_suggested', false,
    'pnl_role', 'project'::public.pnl_role,
    'shares', jsonb_build_array(jsonb_build_object(
      'project_id', (select id from mcp3 where label = 'beta'),
      'share_bp', 10000,
      'amount_net', -10000
    ))
  ),
  'sync does not overwrite an assistant assignment'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_undo(
      'undo-sync',
      'review',
      (select id from mcp3 where label = 'sync_review')
    )->'ok'
  )::boolean,
  true,
  'undo still succeeds after a sync that only bumps the row'
);

select is(
  (select project_id from public.transactions where idempotency_key = 'mcp3:sync'),
  (select project_id from mcp3_prior where label = 'sync'),
  'undo after sync restores the pre-assign project'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-again',
      (select id from mcp3 where label = 'again'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'data'->>'closed_review'
  ),
  'true',
  'the assistant closes the review'
);

select tests.authenticate_as('mcp3_owner');
select lives_ok(
  format(
    $$select public.reopen_review(%L::uuid)$$,
    (select id from mcp3 where label = 'again_review')
  ),
  'the app reopens that review'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-again-2',
      (select id from mcp3 where label = 'again'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'ok'
  )::boolean,
  true,
  'a second assistant approve after the reopen succeeds'
);

reset role;

select is(
  (
    select count(*)
    from private.mcp_writes w
    where w.review_id = (select id from mcp3 where label = 'again_review')
  ),
  2::bigint,
  'both assistant closes are recorded'
);

select is(
  (
    select count(*)
    from private.mcp_writes w
    where w.review_id = (select id from mcp3 where label = 'again_review')
      and w.undone_at is null
  ),
  1::bigint,
  'the earlier open assistant row is superseded'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_undo(
      'undo-again',
      'review',
      (select id from mcp3 where label = 'again_review')
    )->'ok'
  )::boolean,
  true,
  'undo after the second approve succeeds'
);

select is(
  (
    select q.status
    from public.review_queue q
    where q.id = (select id from mcp3 where label = 'again_review')
  ),
  'open'::public.review_status,
  'undo reopens the review'
);

do $$ begin perform pg_temp.as_mcp('expired'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-expired',
      (select id from mcp3 where label = 'gate_a'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'error'->>'message'
  ),
  'expired',
  'an expired token that is not revoked is refused'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-gate-a',
      (select id from mcp3 where label = 'gate_a'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'ok'
  )::boolean,
  true,
  'the live token still assigns after the expired refusal'
);

do $$ begin perform pg_temp.as_mcp('other_write'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-other-token',
      (select id from mcp3 where label = 'gate_b'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'error'->>'message'
  ),
  'The write was refused.',
  'another user''s token id is refused'
);

do $$ begin perform pg_temp.as_mcp('cross_company'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-cross-company',
      (select id from mcp3 where label = 'gate_b'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'error'->>'message'
  ),
  'The write was refused.',
  'a token for another company is refused'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-gate-b',
      (select id from mcp3 where label = 'gate_b'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'data'->>'undo_kind'
  ),
  'reassign',
  'the owner token still assigns after the foreign token refusals'
);

select is(
  (
    public.mcp_assign_expense(
      'assign-gate-c',
      (select id from mcp3 where label = 'gate_c'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'data'->>'id'
  ) is not null,
  true,
  'the owner records an undo id'
);

insert into mcp3 (label, id)
select 'gate_c_undo', (
  public.mcp_assign_expense(
    'assign-gate-c',
    (select id from mcp3 where label = 'gate_c'),
    (select id from mcp3 where label = 'beta'),
    (select id from mcp3 where label = 'haul'),
    false
  )->'data'->>'id'
)::uuid;

do $$ begin perform pg_temp.as_mcp('other_write', 'mcp3_other'); end $$;

select is(
  (
    public.mcp_undo(
      'undo-other-user',
      'reassign',
      (select id from mcp3 where label = 'gate_c_undo')
    )->'error'->>'code'
  ),
  'not_found',
  'another user cannot undo the owner write'
);

reset role;

select is(
  (select project_id from public.transactions where idempotency_key = 'mcp3:gate-c'),
  (select id from mcp3 where label = 'beta'),
  'the other user undo changes nothing'
);

select is(
  (
    select w.undone_at is null
    from private.mcp_writes w
    where w.transaction_id = (select id from mcp3 where label = 'gate_c')
  ),
  true,
  'the owner undo row stays open'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_undo(
      'undo-gate-c',
      'reassign',
      (select id from mcp3 where label = 'gate_c_undo')
    )->'ok'
  )::boolean,
  true,
  'the owner can still undo that write'
);

reset role;

create or replace function pg_temp.mcp3_deadlock()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = '40P01', message = 'deadlock detected';
end;
$$;

create trigger mcp3_deadlock
before insert on private.mcp_writes
for each row execute function pg_temp.mcp3_deadlock();

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-dead',
      (select id from mcp3 where label = 'dead'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'error'->>'message'
  ),
  'retry',
  'a deadlock is retryable'
);

reset role;

select is(
  (
    select count(*)
    from private.mcp_idempotency
    where idempotency_key = 'assign-dead'
  ),
  0::bigint,
  'a deadlock is not stored for the idempotency key'
);

drop trigger mcp3_deadlock on private.mcp_writes;

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-dead',
      (select id from mcp3 where label = 'dead'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'ok'
  )::boolean,
  true,
  'the same key proceeds after the deadlock'
);

reset role;

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select
  (select id from auth.users where email = 'mcp3-owner@test.flow'),
  (select id from mcp3 where label = 'company'),
  'hash-mcp3-legacy',
  'pepper-1',
  array['read','write'],
  now() + interval '90 days';

update private.mcp_credentials
set scope = array['read']::text[];

select is(
  (select scope from private.mcp_credentials where token_hash = 'hash-mcp3-legacy'),
  array['read']::text[],
  'the backfill sets an existing token to read only'
);

select lives_ok(
  format(
    $$select public.store_mcp_credential(%L::uuid, 'hash-mcp3-new001', array['read','write'], now() + interval '90 days', 'pepper-1')$$,
    (select id from auth.users where email = 'mcp3-owner@test.flow')
  ),
  'a new token can still be stored with write'
);

select is(
  (select scope from private.mcp_credentials where token_hash = 'hash-mcp3-new001'),
  array['read','write']::text[],
  'a new token keeps read and write'
);

select tests.authenticate_as('mcp3_owner');

select is(
  (
    public.mcp_assign_expense(
      'assign-no-claim',
      (select id from mcp3 where label = 'plain'),
      (select id from mcp3 where label = 'beta'),
      (select id from mcp3 where label = 'haul'),
      false
    )->'error'->>'message'
  ),
  'The write was refused.',
  'a missing mcp_tid claim is refused'
);

select * from finish();
rollback;
