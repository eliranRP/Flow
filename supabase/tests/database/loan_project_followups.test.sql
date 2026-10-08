-- FLOW-120: loan project follow-ups (#89 review). Invented data only.
-- Amounts are USD minor units (100000 is 1000.00). @example.com only.

begin;

select plan(33);

do $users$
begin
  perform tests.create_supabase_user('lf_owner', 'lf-owner@example.com');
  perform tests.create_supabase_user('lf_demo', 'lf-demo@example.com');
  perform tests.create_supabase_user('lf_viewer', 'lf-viewer@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('lf_owner'), 'Example Loan Followups LLC', false),
  (tests.get_supabase_uid('lf_demo'), 'Example Demo Followups LLC', true);

insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('lf_viewer'), c.id
from public.companies c
where c.name = 'Example Demo Followups LLC';

create temp table lf (label text primary key, id uuid);
grant all on lf to authenticated, service_role;

insert into lf (label, id)
select 'co', id from public.companies where name = 'Example Loan Followups LLC';
insert into lf (label, id)
select 'cod', id from public.companies where name = 'Example Demo Followups LLC';

insert into public.projects (company_id, name, status)
values
  ((select id from lf where label = 'co'), 'Site One', 'active'),
  ((select id from lf where label = 'co'), 'Site Two', 'active');
insert into lf (label, id)
select case name when 'Site One' then 'p1' else 'p2' end, id
from public.projects
where company_id = (select id from lf where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default)
values
  ((select id from lf where label = 'co'), 'Mortgage servicer', 'expense', 50, false),
  ((select id from lf where label = 'co'), 'Servicer refund', 'income', 51, false);
insert into lf (label, id)
select case kind when 'expense' then 'cat_exp' else 'cat_inc' end, id
from public.categories
where company_id = (select id from lf where label = 'co')
  and name in ('Mortgage servicer', 'Servicer refund');

create or replace function pg_temp.as_mcp(p_label text, p_user text default 'lf_owner')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  select id into tid from pg_temp.lf where label = p_label;
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

create or replace function pg_temp.parts()
returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object('part', 'interest', 'amount_minor', 70000, 'scheduled_minor', 70000),
    jsonb_build_object('part', 'escrow', 'amount_minor', 20000, 'scheduled_minor', 20000),
    jsonb_build_object('part', 'principal', 'amount_minor', 10000, 'scheduled_minor', 10000)
  );
$$;
grant execute on function pg_temp.parts() to authenticated, service_role;

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (
  tests.get_supabase_uid('lf_owner'), (select id from lf where label = 'co'),
  'hash-lf-write', 'pepper-1', array['read','write'], now() + interval '90 days'
);
insert into lf (label, id)
select 'write', id from private.mcp_credentials where token_hash = 'hash-lf-write';

insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months, start_date,
  payment_minor, escrow_minor, currency, project_id
)
values
  ((select id from lf where label = 'co'), 'Example Mortgage F', 12000000, 60000, 360,
    '2026-01-01', 100000, 20000, 'USD', (select id from lf where label = 'p1')),
  ((select id from lf where label = 'cod'), 'Example Demo Mortgage', 5000000, 60000, 120,
    '2026-01-01', 60000, 0, 'USD', null);
insert into lf (label, id)
select case name when 'Example Mortgage F' then 'loan' else 'loan_demo' end, id
from public.loans
where name in ('Example Mortgage F', 'Example Demo Mortgage');

-- Unassigned expense lines. g1 has a guessed category with an open review item,
-- r1 sits under an income (reversal) category, f1 has an open shared review that
-- makes reassign_transaction raise, o1 is the old-style write.
insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, category_id, description, user_assigned,
  category_suggested
)
select
  (select id from lf where label = 'co'), 'expense', 'expense', 'posted', 'USD',
  -100000, -100000, 100000, 0, 'source',
  '2026-06-10', '2026-06-10', 'manual', v.ikey,
  (select id from lf where label = v.cat), v.ikey, false, v.suggested
from (values
  ('g1', 'cat_exp', true),
  ('r1', 'cat_inc', false),
  ('f1', 'cat_exp', false),
  ('o1', 'cat_exp', false)
) as v(ikey, cat, suggested);
insert into lf (label, id)
select idempotency_key, id from public.transactions
where idempotency_key in ('g1', 'r1', 'f1', 'o1');

-- Set the guess after the insert, as the categorize step would.
update public.transactions set category_suggested = true
where id = (select id from lf where label = 'g1');
select is(
  (select category_suggested from public.transactions where id = (select id from lf where label = 'g1')),
  true,
  'g1''s category is a guess'
);

-- The trigger may already have queued g1; make sure exactly one item is open.
insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_category'
from public.transactions t
where t.id = (select id from lf where label = 'g1')
  and not exists (
    select 1 from public.review_queue q where q.transaction_id = t.id and q.status = 'open'
  );
insert into public.review_queue (company_id, transaction_id, status, reason)
select company_id, id, 'open', 'unallocated_shared'
from public.transactions where id = (select id from lf where label = 'f1');

-- 1. A guessed category is not confirmed by the attach.
select pg_temp.as_mcp('write');
select is(
  public.mcp_attach_loan_payment(
    'lf-att-g1', (select id from lf where label = 'g1'), (select id from lf where label = 'loan'), pg_temp.parts()
  )->'data'->>'project_inherited_reason',
  'line category is a guess',
  'a guessed category is not filed under the loan''s project'
);
reset role;
select is(
  (select count(*)::int from public.transactions t
   where t.id = (select id from lf where label = 'g1')
     and t.project_id is null and t.pnl_role is null and t.category_suggested),
  1,
  'the line keeps no project and its guess'
);
select is(
  (select count(*)::int from public.review_queue
   where transaction_id = (select id from lf where label = 'g1') and status = 'open'),
  1,
  'the review item stays open'
);
select is(
  (select count(*)::int from public.loan_splits where transaction_id = (select id from lf where label = 'g1')),
  3,
  'the parts are still attached'
);

-- Positive control: the same line once the category is confirmed inherits.
select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('lf-undo-g1', 'loan_split', (select id from lf where label = 'g1'))->'ok',
  'true'::jsonb,
  'the guessed attach is undone'
);
reset role;
update public.transactions set category_suggested = false
where id = (select id from lf where label = 'g1');
select pg_temp.as_mcp('write');
select is(
  public.mcp_attach_loan_payment(
    'lf-att-g1b', (select id from lf where label = 'g1'), (select id from lf where label = 'loan'), pg_temp.parts()
  )->'data'->>'project_inherited',
  'true',
  'positive control: a confirmed category is filed under the loan''s project'
);

-- 3. The reassign id is in its column, not in prior.
reset role;
select is(
  (select count(*)::int from private.mcp_writes w
   where w.kind = 'loan_split' and w.transaction_id = (select id from lf where label = 'g1')
     and w.undone_at is null and w.reassign_id is not null and not (w.prior ? 'reassign_id')),
  1,
  'the attach keeps the reassign id in its column'
);
select is(
  (select w.prior->>'pnl_role' from private.mcp_writes w
   where w.kind = 'loan_split' and w.transaction_id = (select id from lf where label = 'g1')
     and w.undone_at is null),
  'project',
  'the attach keeps the role it gave the line'
);
select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('lf-undo-g1b', 'loan_split', (select id from lf where label = 'g1'))->'data'->>'project_restored',
  'true',
  'undo restores the line through the column'
);
reset role;
select is(
  (select count(*)::int from public.transactions t
   where t.id = (select id from lf where label = 'g1') and t.project_id is null and t.pnl_role is null),
  1,
  'the line has no project and no role again'
);

-- 2. An error inside reassign_transaction leaves the line and keeps the parts.
select pg_temp.as_mcp('write');
select is(
  public.mcp_attach_loan_payment(
    'lf-att-f1', (select id from lf where label = 'f1'), (select id from lf where label = 'loan'), pg_temp.parts()
  )->'data',
  jsonb_build_object(
    'loan_id', (select id from lf where label = 'loan'),
    'transaction_id', (select id from lf where label = 'f1'),
    'project_inherited', false,
    'project_id', null,
    'project_inherited_reason', 'project not set',
    'undo_kind', 'loan_split'
  ),
  'a failed reassign is reported, not refused'
);
reset role;
select is(
  (select count(*)::int from public.loan_splits where transaction_id = (select id from lf where label = 'f1')),
  3,
  'the parts are attached'
);
select is(
  (select count(*)::int from public.transactions t
   where t.id = (select id from lf where label = 'f1') and t.project_id is null and t.pnl_role is null),
  1,
  'the line is left as it was'
);
select is(
  (select count(*)::int from public.reassign_undo where transaction_id = (select id from lf where label = 'f1')),
  0,
  'no reassign was kept'
);
select is(
  (select count(*)::int from private.mcp_writes w
   where w.kind = 'loan_split' and w.transaction_id = (select id from lf where label = 'f1')
     and w.reassign_id is null and not (w.prior ? 'project_id')),
  1,
  'the write has no reassign to undo'
);
select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('lf-undo-f1', 'loan_split', (select id from lf where label = 'f1'))->'data',
  jsonb_build_object('kind', 'loan_split', 'id', (select id from lf where label = 'f1')),
  'undo of that attach removes the parts and reports no project'
);

-- 4. A line under an income (reversal) category: the role guard follows what the attach gave it.
select is(
  public.mcp_attach_loan_payment(
    'lf-att-r1', (select id from lf where label = 'r1'), (select id from lf where label = 'loan'), pg_temp.parts()
  )->'data'->>'project_inherited',
  'true',
  'a reversal-category line inherits the loan''s project'
);
reset role;
select is(
  (select count(*)::int from public.transactions t
   where t.id = (select id from lf where label = 'r1')
     and t.project_id = (select id from lf where label = 'p1') and t.pnl_role is null),
  1,
  'the reversal line has the project and no role'
);
select ok(
  (select (w.prior ? 'pnl_role') and w.prior->'pnl_role' = 'null'::jsonb from private.mcp_writes w
   where w.kind = 'loan_split' and w.transaction_id = (select id from lf where label = 'r1')
     and w.undone_at is null),
  'the attach keeps the empty role'
);
select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('lf-undo-r1', 'loan_split', (select id from lf where label = 'r1'))->'data'->>'project_restored',
  'true',
  'undo restores a reversal-category line'
);
reset role;
select is(
  (select project_id from public.transactions where id = (select id from lf where label = 'r1')),
  null::uuid,
  'the reversal line has no project again'
);

-- The role guard: a line whose role changed after the attach is left alone.
select pg_temp.as_mcp('write');
select is(
  public.mcp_attach_loan_payment(
    'lf-att-r1b', (select id from lf where label = 'r1'), (select id from lf where label = 'loan'), pg_temp.parts()
  )->'data'->>'project_inherited',
  'true',
  'the reversal line is attached again'
);
reset role;
update public.transactions set pnl_role = 'overhead'
where id = (select id from lf where label = 'r1');
select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('lf-undo-r1b', 'loan_split', (select id from lf where label = 'r1'))->'data'->>'project_restored',
  'false',
  'undo leaves a line whose role changed since'
);
reset role;
select is(
  (select pnl_role::text from public.transactions where id = (select id from lf where label = 'r1')),
  'overhead',
  'the changed role stays'
);

-- An attach written before FLOW-120 (reassign id in prior, no role) still undoes.
select pg_temp.as_mcp('write');
select is(
  public.mcp_attach_loan_payment(
    'lf-att-o1', (select id from lf where label = 'o1'), (select id from lf where label = 'loan'), pg_temp.parts()
  )->'data'->>'project_inherited',
  'true',
  'the old-style line is attached'
);
reset role;
update private.mcp_writes w
set prior = (w.prior - 'pnl_role') || jsonb_build_object('reassign_id', w.reassign_id),
    reassign_id = null
where w.kind = 'loan_split' and w.transaction_id = (select id from lf where label = 'o1')
  and w.undone_at is null;
select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('lf-undo-o1', 'loan_split', (select id from lf where label = 'o1'))->'data'->>'project_restored',
  'true',
  'undo of an older write reads the reassign id from prior'
);
reset role;
select is(
  (select count(*)::int from public.transactions t
   where t.id = (select id from lf where label = 'o1') and t.project_id is null and t.pnl_role is null),
  1,
  'the older write''s line has no project again'
);

-- 9. A viewer of the company cannot change its loan through the table.
select tests.authenticate_as('lf_viewer');
select is(
  (select count(*)::int from public.loans where id = (select id from lf where label = 'loan_demo')),
  1,
  'positive control: the viewer reads its company''s loan'
);
select lives_ok(
  format(
    $$update public.loans set name = 'Example Viewer Rename', project_id = null where id = %L$$,
    (select id from lf where label = 'loan_demo')
  ),
  'a viewer''s update of its own company''s loan runs and matches no row'
);
select tests.clear_authentication();
reset role;
select is(
  (select name from public.loans where id = (select id from lf where label = 'loan_demo')),
  'Example Demo Mortgage',
  'the viewer''s update changed nothing'
);
select tests.authenticate_as('lf_demo');
select is(
  (select count(*)::int from public.loans where id = (select id from lf where label = 'loan_demo')),
  1,
  'positive control: the owner reads the loan'
);
update public.loans set name = 'Example Demo Mortgage 2'
where id = (select id from lf where label = 'loan_demo');
select tests.clear_authentication();
reset role;
select is(
  (select name from public.loans where id = (select id from lf where label = 'loan_demo')),
  'Example Demo Mortgage 2',
  'positive control: the owner''s update is stored'
);

select * from finish();
rollback;
