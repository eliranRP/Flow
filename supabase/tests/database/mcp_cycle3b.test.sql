-- MCP cycle 3b. Lock order, deadlock re-raise, and שויכו היום.
-- Dates follow now(), so the Jerusalem day boundary stays in the fixture.

begin;

select plan(24);

do $users$
begin
  perform tests.create_supabase_user('c3b_owner', 'c3b-owner@test.flow');
  perform tests.create_supabase_user('c3b_other', 'c3b-other@test.flow');
end
$users$;

create temp table c3b (label text primary key, id uuid);
grant all on c3b to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text, p_user text default 'c3b_owner')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  select id into tid from pg_temp.c3b where label = p_label;
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
grant execute on function pg_temp.as_mcp(text, text) to authenticated, service_role;

select tests.authenticate_as('c3b_owner');
select lives_ok($$select public.create_company('חברה', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'אלפא', null, 'active')$$, 'owner opens אלפא');

insert into c3b (label, id) select 'company', id from public.companies;
insert into c3b (label, id) select 'alpha', id from public.projects where name = 'אלפא';
insert into c3b (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-01', 'manual', 'c3b:queue', a.id, m.id, 'בתור'
from c3b c
join c3b a on a.label = 'alpha'
join c3b m on m.label = 'materials'
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key = 'c3b:queue';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_project'
from public.transactions t
where t.idempotency_key = 'c3b:queue';

insert into c3b (label, id)
select 'queue', id from public.transactions where idempotency_key = 'c3b:queue';
insert into c3b (label, id)
select 'queue_review', id from public.review_queue
where transaction_id = (select id from c3b where label = 'queue') and status = 'open';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select c.id, 'expense', 'expense', 'project',
  -10000, -10000, 0, 'unknown',
  '2026-09-02', 'manual', 'c3b:bare', a.id, 'בלי קטגוריה'
from c3b c
join c3b a on a.label = 'alpha'
where c.label = 'company';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_category'
from public.transactions t
where t.idempotency_key = 'c3b:bare';

insert into c3b (label, id)
select 'bare_review', id from public.review_queue
where transaction_id = (select id from public.transactions where idempotency_key = 'c3b:bare');

select lives_ok(
  format(
    $$select public.store_mcp_credential(%L::uuid, 'hash-c3b-write01', array['read','write'], now() + interval '90 days', 'pepper-1')$$,
    (select id from auth.users where email = 'c3b-owner@test.flow')
  ),
  'store the owner write token'
);

insert into c3b (label, id)
select 'write', id from private.mcp_credentials where token_hash = 'hash-c3b-write01';

select tests.authenticate_as('c3b_owner');

select is(
  (
    public.approve_review_item(
      (select id from c3b where label = 'bare_review'),
      (select id from c3b where label = 'alpha'),
      null,
      false,
      null,
      null,
      false
    )->'error'->>'code'
  ),
  'refused',
  'a resolve_review refusal stays refused'
);

reset role;

create or replace function pg_temp.c3b_lock_error()
returns trigger
language plpgsql
as $$
begin
  raise exception using errcode = current_setting('c3b.errcode', true), message = 'deadlock detected';
end;
$$;

do $$ begin perform set_config('c3b.errcode', '40P01', true); end $$;

create trigger c3b_lock_error
before update on public.transactions
for each row execute function pg_temp.c3b_lock_error();

select tests.authenticate_as('c3b_owner');

select throws_ok(
  format(
    $$select public.approve_review_item(%L::uuid, %L::uuid, %L::uuid, false, %L::uuid, %L::uuid, true)$$,
    (select id from c3b where label = 'queue_review'),
    (select id from c3b where label = 'alpha'),
    (select id from c3b where label = 'materials'),
    (select id from c3b where label = 'alpha'),
    (select id from c3b where label = 'materials')
  ),
  '40P01',
  'deadlock detected',
  'a deadlock inside resolve_review is re-raised'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-dead',
      (select id from c3b where label = 'queue'),
      (select id from c3b where label = 'alpha'),
      (select id from c3b where label = 'materials'),
      false
    )->'error'->>'message'
  ),
  'retry',
  'the wrapper returns retry for a deadlock'
);

reset role;

select is(
  (select count(*) from private.mcp_idempotency where idempotency_key = 'assign-dead'),
  0::bigint,
  'a deadlock is not stored'
);

do $$ begin perform set_config('c3b.errcode', '40001', true); end $$;

select tests.authenticate_as('c3b_owner');

select throws_ok(
  format(
    $$select public.approve_review_item(%L::uuid, %L::uuid, %L::uuid, false, %L::uuid, %L::uuid, true)$$,
    (select id from c3b where label = 'queue_review'),
    (select id from c3b where label = 'alpha'),
    (select id from c3b where label = 'materials'),
    (select id from c3b where label = 'alpha'),
    (select id from c3b where label = 'materials')
  ),
  '40001',
  'deadlock detected',
  'a serialization failure inside resolve_review is re-raised'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (
    public.mcp_assign_expense(
      'assign-serial',
      (select id from c3b where label = 'queue'),
      (select id from c3b where label = 'alpha'),
      (select id from c3b where label = 'materials'),
      false
    )->'error'->>'message'
  ),
  'retry',
  'the wrapper returns retry for a serialization failure'
);

reset role;

select is(
  (select count(*) from private.mcp_idempotency where idempotency_key = 'assign-serial'),
  0::bigint,
  'a serialization failure is not stored'
);

drop trigger c3b_lock_error on public.transactions;

select tests.authenticate_as('c3b_owner');
do $$ begin perform set_config('flow.test_lock_log', 'on', true); end $$;

select is(
  (
    public.approve_review_item(
      (select id from c3b where label = 'queue_review'),
      (select id from c3b where label = 'alpha'),
      (select id from c3b where label = 'materials'),
      false,
      (select id from c3b where label = 'alpha'),
      (select id from c3b where label = 'materials'),
      true
    )->>'ok'
  )::boolean,
  true,
  'approve succeeds once the lock error is gone'
);

select is(
  current_setting('flow.test_lock_log', true),
  'on>transactions>review_queue',
  'approve locks the transaction before the review'
);

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description, created_at
)
select c.id, 'expense', 'expense', 'project',
  -20000, -20000, 0, 'unknown',
  current_date, 'sumit', 'c3b:sumit', a.id, m.id, 'חול', now()
from c3b c
join c3b a on a.label = 'alpha'
join c3b m on m.label = 'materials'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description, created_at
)
select c.id, 'expense', 'expense', 'project',
  -30000, -30000, 0, 'unknown',
  current_date - 2, 'manual', 'c3b:assistant', a.id, m.id, 'צבע', now() - interval '2 days'
from c3b c
join c3b a on a.label = 'alpha'
join c3b m on m.label = 'materials'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description, created_at
)
select c.id, 'expense', 'expense', 'project',
  -40000, -40000, 0, 'unknown',
  current_date, 'sumit', 'c3b:both', a.id, m.id, 'ברגים', now()
from c3b c
join c3b a on a.label = 'alpha'
join c3b m on m.label = 'materials'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description, created_at
)
select c.id, 'expense', 'expense', 'project',
  -50000, -50000, 0, 'unknown',
  current_date, 'sumit', 'c3b:open', a.id, m.id, 'פתוח', now()
from c3b c
join c3b a on a.label = 'alpha'
join c3b m on m.label = 'materials'
where c.label = 'company';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_project'
from public.transactions t
where t.idempotency_key = 'c3b:open';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description, created_at
)
select c.id, 'expense', 'expense', 'project',
  -60000, -60000, 0, 'unknown',
  current_date - 2, 'manual', 'c3b:undone', a.id, m.id, 'בוטל', now() - interval '2 days'
from c3b c
join c3b a on a.label = 'alpha'
join c3b m on m.label = 'materials'
where c.label = 'company';

insert into private.mcp_writes (token_id, user_id, transaction_id, review_id, kind, created_at)
select
  (select id from c3b where label = 'write'),
  (select id from auth.users where email = 'c3b-owner@test.flow'),
  t.id,
  gen_random_uuid(),
  'review',
  now()
from public.transactions t
where t.idempotency_key in ('c3b:assistant', 'c3b:both');

insert into private.mcp_writes (token_id, user_id, transaction_id, review_id, kind, created_at, undone_at)
select
  (select id from c3b where label = 'write'),
  (select id from auth.users where email = 'c3b-owner@test.flow'),
  t.id,
  gen_random_uuid(),
  'review',
  now(),
  now()
from public.transactions t
where t.idempotency_key = 'c3b:undone';

select tests.authenticate_as('c3b_other');
select lives_ok($$select public.create_company('אחרת', true)$$, 'the other user creates a company');

insert into c3b (label, id) select 'other_company', id from public.companies where name = 'אחרת';
insert into c3b (label, id)
select 'other_materials', id from public.categories
where company_id = (select id from c3b where label = 'other_company') and name = 'חומרים' and kind = 'expense';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, category_id, description, created_at
)
select c.id, 'income', 'invoice', 'project',
  70000, 70000, 0, 'unknown',
  current_date, 'sumit', 'c3b:other', m.id, 'הכנסה', now()
from c3b c
join c3b m on m.label = 'other_materials'
where c.label = 'other_company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, category_id, description, created_at
)
select c.id, 'income', 'invoice', 'project',
  1000, 1000, 0, 'unknown',
  current_date - 3, 'manual', 'c3b:other-wait', m.id, 'ממתין', now() - interval '3 days'
from c3b c
join c3b m on m.label = 'other_materials'
where c.label = 'other_company';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_project'
from public.transactions t
where t.idempotency_key = 'c3b:other-wait';

select tests.authenticate_as('c3b_owner');

select is(
  (
    select count(*)
    from jsonb_array_elements(public.list_auto_assigned_today()) elem
    where elem->>'description' = 'חול'
  ),
  1::bigint,
  'today''s SUMIT filing is listed'
);

select is(
  (
    select count(*)
    from jsonb_array_elements(public.list_auto_assigned_today()) elem
    where elem->>'description' = 'צבע'
  ),
  1::bigint,
  'an assistant approval of an older row is listed'
);

select is(
  (
    select count(*)
    from jsonb_array_elements(public.list_auto_assigned_today()) elem
    where elem->>'description' = 'ברגים'
  ),
  1::bigint,
  'a row in both sets is one row'
);

select is(
  (select count(*) from private.filed_today_rows() where assistant),
  2::bigint,
  'the assistant flag is set on the assistant rows only'
);

select is(
  (
    select count(*)
    from jsonb_array_elements(public.list_auto_assigned_today()) elem
    where elem->>'description' in ('פתוח', 'בוטל', 'הכנסה')
  ),
  0::bigint,
  'an open review, an undone approval, and another company stay out'
);

select is(
  (select jsonb_array_length(public.list_auto_assigned_today())),
  3,
  'the owner count is the union'
);

select is(
  (select (public.list_review() -> 0 ->> 'auto_approved_today')::int),
  (select jsonb_array_length(public.list_auto_assigned_today())),
  'the banner count matches the list'
);

select is(
  (select (public.list_review() -> 0 ->> 'assistant_filed_today')::boolean),
  true,
  'the banner knows an assistant approval is in the count'
);

select tests.authenticate_as('c3b_other');

select is(
  (select jsonb_array_length(public.list_auto_assigned_today())),
  1,
  'the other user still sees their own SUMIT filing'
);

select is(
  (select public.list_auto_assigned_today() -> 0 ->> 'description'),
  'הכנסה',
  'that filing is their own row'
);

select is(
  (select (public.list_review() -> 0 ->> 'assistant_filed_today')::boolean),
  false,
  'their banner stays on the old set'
);

select * from finish();
rollback;
