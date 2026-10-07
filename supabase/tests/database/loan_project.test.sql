-- FLOW-105: link a loan to a project. Invented data only.
-- Amounts are USD minor units (100000 is 1000.00). @example.com only.

begin;

select plan(74);

do $users$
begin
  perform tests.create_supabase_user('lp_owner', 'lp-owner@example.com');
  perform tests.create_supabase_user('lp_other', 'lp-other@example.com');
  perform tests.create_supabase_user('lp_demo', 'lp-demo@example.com');
  perform tests.create_supabase_user('lp_viewer', 'lp-viewer@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('lp_owner'), 'Example Loan Project LLC', false),
  (tests.get_supabase_uid('lp_other'), 'Example Neighbour Loans LLC', false),
  (tests.get_supabase_uid('lp_demo'), 'Example Demo Loans LLC', true);

insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('lp_viewer'), c.id
from public.companies c
where c.name = 'Example Demo Loans LLC';

create temp table lp (label text primary key, id uuid);
grant all on lp to authenticated, service_role;

insert into lp (label, id)
select 'co', id from public.companies where name = 'Example Loan Project LLC';
insert into lp (label, id)
select 'co2', id from public.companies where name = 'Example Neighbour Loans LLC';
insert into lp (label, id)
select 'co3', id from public.companies where name = 'Example Demo Loans LLC';

insert into public.projects (company_id, name, status)
select c.id, v.name, 'active'
from public.companies c
join (values
  ('Example Loan Project LLC', 'Site One'),
  ('Example Loan Project LLC', 'Site Two'),
  ('Example Loan Project LLC', 'Site Three'),
  ('Example Neighbour Loans LLC', 'Site Nine'),
  ('Example Demo Loans LLC', 'Site Demo')
) as v(company, name) on v.company = c.name;

insert into lp (label, id)
select case name
  when 'Site One' then 'p1' when 'Site Two' then 'p2' when 'Site Three' then 'p3'
  when 'Site Nine' then 'p9' else 'pd' end,
  id
from public.projects;

insert into public.categories (company_id, name, kind, sort_order, is_default)
select c.id, 'Mortgage servicer', 'expense'::public.category_kind, 50, false
from public.companies c
where c.name in ('Example Loan Project LLC', 'Example Neighbour Loans LLC');

create or replace function pg_temp.as_mcp(p_label text, p_user text default 'lp_owner')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  select id into tid from pg_temp.lp where label = p_label;
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

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid(v.usr), c.id, v.hash, 'pepper-1', v.scope, now() + interval '90 days'
from (values
  ('lp_owner', 'co', 'hash-lp-write', array['read','write']),
  ('lp_owner', 'co', 'hash-lp-read', array['read']),
  ('lp_other', 'co2', 'hash-lp-other', array['read','write']),
  ('lp_viewer', 'co3', 'hash-lp-viewer', array['read','write'])
) as v(usr, co, hash, scope)
join lp c on c.label = v.co;
insert into lp (label, id)
select case token_hash
  when 'hash-lp-write' then 'write' when 'hash-lp-read' then 'read'
  when 'hash-lp-other' then 'other' else 'viewer' end,
  id
from private.mcp_credentials where token_hash like 'hash-lp-%';

-- Lines for the owner's company. t1 is unassigned, t2 already has a project,
-- t3 is shared across two projects, t4 is for a loan with no project.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select
  (select id from lp where label = 'co'), 'expense', 'expense',
  v.role::public.pnl_role, 'posted', 'USD',
  -100000, -100000, 100000, 0, 'source',
  '2026-06-10', '2026-06-10', 'manual', v.ikey,
  case when v.project is not null then (select id from lp where label = v.project) end,
  (select k.id from public.categories k
   where k.company_id = (select id from lp where label = 'co')
     and k.name = 'Mortgage servicer' and k.kind = 'expense'),
  v.ikey, v.assigned
from (values
  ('t1', null, null, false),
  ('t2', 'project', 'p2', true),
  ('t3', 'shared', null, true),
  ('t4', null, null, false),
  ('t5', null, null, false)
) as v(ikey, role, project, assigned);

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, p.id, 5000, -50000
from public.transactions t
join public.projects p on p.company_id = t.company_id and p.name in ('Site One', 'Site Two')
where t.idempotency_key = 't3';

insert into lp (label, id)
select idempotency_key, id from public.transactions where idempotency_key in ('t1', 't2', 't3', 't4', 't5');

-- add_loan with a project.
select pg_temp.as_mcp('write');
insert into lp (label, id)
select 'la', (
  public.mcp_add_loan(
    'lp-add-1', 'Example Mortgage A', 12000000, 60000, 360, '2026-01-01'::date, 100000, 20000, 'USD',
    (select id from lp where label = 'p1')
  )->'data'->>'id'
)::uuid;

select is(
  (select project_id from public.loans where id = (select id from lp where label = 'la')),
  (select id from lp where label = 'p1'),
  'add_loan stores the project'
);
select is(
  public.mcp_add_loan(
    'lp-add-1', 'Example Mortgage A', 12000000, 60000, 360, '2026-01-01'::date, 100000, 20000, 'USD',
    (select id from lp where label = 'p1')
  )->'data'->>'id',
  (select id::text from lp where label = 'la'),
  'add_loan replays the same loan'
);
select is(
  public.mcp_add_loan(
    'lp-add-1', 'Example Mortgage A', 12000000, 60000, 360, '2026-01-01'::date, 100000, 20000, 'USD',
    (select id from lp where label = 'p2')
  )->'error'->>'code',
  'conflict',
  'add_loan with the same key and another project is a conflict'
);

insert into lp (label, id)
select 'lb', (
  public.mcp_add_loan(
    'lp-add-2', 'Example Mortgage B', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'USD'
  )->'data'->>'id'
)::uuid;
select is(
  (select project_id from public.loans where id = (select id from lp where label = 'lb')),
  null::uuid,
  'add_loan without a project leaves it null'
);

-- A project of another company is refused by the RPC, before the insert.
select is(
  public.mcp_add_loan(
    'lp-add-x', 'Example Cross Loan', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'USD',
    (select id from lp where label = 'p9')
  )->'error'->>'message',
  'project not found',
  'add_loan refuses another company''s project'
);
select is(
  (select count(*)::int from public.loans where name = 'Example Cross Loan'),
  0,
  'the refused add_loan wrote no loan'
);
select is(
  public.mcp_add_loan(
    'lp-add-unknown', 'Example Unknown Loan', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'USD',
    gen_random_uuid()
  )->'error'->>'message',
  'project not found',
  'add_loan refuses an unknown project id'
);

-- update_loan sets, changes, leaves, and clears the project.
select is(
  public.mcp_update_loan('lp-up-1', (select id from lp where label = 'lb'),
    jsonb_build_object('project_id', (select id from lp where label = 'p1')))->'data'->>'project_id',
  (select id::text from lp where label = 'p1'),
  'update_loan sets the project'
);
select is(
  (select project_id from public.loans where id = (select id from lp where label = 'lb')),
  (select id from lp where label = 'p1'),
  'the set is stored'
);
select is(
  public.mcp_update_loan('lp-up-2', (select id from lp where label = 'lb'),
    jsonb_build_object('project_id', (select id from lp where label = 'p2')))->'ok',
  'true'::jsonb,
  'update_loan changes the project'
);
select is(
  public.mcp_update_loan('lp-up-3', (select id from lp where label = 'lb'),
    jsonb_build_object('name', 'Example Mortgage B2'))->'ok',
  'true'::jsonb,
  'update_loan with no project key succeeds'
);
select is(
  (select project_id from public.loans where id = (select id from lp where label = 'lb')),
  (select id from lp where label = 'p2'),
  'an absent project_id leaves the project'
);
select is(
  public.mcp_update_loan('lp-up-4', (select id from lp where label = 'lb'),
    '{"project_id": null}'::jsonb)->'ok',
  'true'::jsonb,
  'update_loan with a JSON null clears the project'
);
select is(
  (select project_id from public.loans where id = (select id from lp where label = 'lb')),
  null::uuid,
  'the clear is stored'
);

-- Undo unwinds the edits newest first and restores each previous project.
select is(
  public.mcp_undo('lp-undo-1', 'loan_update', (select id from lp where label = 'lb'))->'data'->>'kind',
  'loan_update',
  'undo of the clear succeeds'
);
select is(
  (select project_id from public.loans where id = (select id from lp where label = 'lb')),
  (select id from lp where label = 'p2'),
  'undo of the clear restores the project'
);
select is(
  public.mcp_undo('lp-undo-2', 'loan_update', (select id from lp where label = 'lb'))->'data'->>'kind',
  'loan_update',
  'undo of the name edit succeeds'
);
select is(
  public.mcp_undo('lp-undo-3', 'loan_update', (select id from lp where label = 'lb'))->'data'->>'kind',
  'loan_update',
  'undo of the change succeeds'
);
select is(
  (select project_id from public.loans where id = (select id from lp where label = 'lb')),
  (select id from lp where label = 'p1'),
  'undo of the change restores the previous project'
);
select is(
  public.mcp_undo('lp-undo-4', 'loan_update', (select id from lp where label = 'lb'))->'data'->>'kind',
  'loan_update',
  'undo of the first set succeeds'
);
select is(
  (select project_id from public.loans where id = (select id from lp where label = 'lb')),
  null::uuid,
  'undo of the first set restores no project'
);

-- Bad values.
select is(
  public.mcp_update_loan('lp-up-bad1', (select id from lp where label = 'lb'),
    '{"project_id": "not-a-uuid"}'::jsonb)->'error'->>'code',
  'validation',
  'a project_id that is not a uuid is a validation error'
);
select is(
  public.mcp_update_loan('lp-up-bad2', (select id from lp where label = 'lb'),
    '{"project_id": 5}'::jsonb)->'error'->>'code',
  'validation',
  'a numeric project_id is a validation error'
);
select is(
  public.mcp_update_loan('lp-up-x', (select id from lp where label = 'lb'),
    jsonb_build_object('project_id', (select id from lp where label = 'p9')))->'error'->>'message',
  'project not found',
  'update_loan refuses another company''s project'
);
select is(
  (select project_id from public.loans where id = (select id from lp where label = 'lb')),
  null::uuid,
  'the refused update changed nothing'
);

-- Another company's caller: refused, with the owner as the positive control.
select pg_temp.as_mcp('other', 'lp_other');
select is(
  public.mcp_update_loan('lp-x-1', (select id from lp where label = 'la'),
    jsonb_build_object('project_id', (select id from lp where label = 'p9')))->'error'->>'message',
  'loan not found',
  'another company cannot edit the loan'
);
reset role;
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months, start_date,
  payment_minor, escrow_minor, currency
)
select id, 'Example Neighbour Loan', 5000000, 60000, 120, '2026-01-01', 60000, 0, 'USD'
from lp where label = 'co2';
insert into lp (label, id) select 'lx', id from public.loans where name = 'Example Neighbour Loan';

select pg_temp.as_mcp('other', 'lp_other');
select is(
  public.mcp_update_loan('lp-x-2', (select id from lp where label = 'lx'),
    jsonb_build_object('project_id', (select id from lp where label = 'p1')))->'error'->>'message',
  'project not found',
  'another company cannot use the owner''s project on its own loan'
);
select is(
  public.mcp_update_loan('lp-x-3', (select id from lp where label = 'lx'),
    jsonb_build_object('project_id', (select id from lp where label = 'p9')))->'ok',
  'true'::jsonb,
  'positive control: the same caller sets its own project'
);
select is(
  public.mcp_add_loan(
    'lp-x-4', 'Example Cross Loan 2', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'USD',
    (select id from lp where label = 'p1')
  )->'error'->>'message',
  'project not found',
  'another company cannot add a loan under the owner''s project'
);

-- A read-only token and a demo viewer cannot write.
select pg_temp.as_mcp('read');
select is(
  public.mcp_update_loan('lp-ro-1', (select id from lp where label = 'lb'),
    jsonb_build_object('project_id', (select id from lp where label = 'p1')))->'error'->>'code',
  'forbidden',
  'a read-only token cannot set a project'
);
select is(
  public.mcp_add_loan(
    'lp-ro-2', 'Example Read Loan', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'USD',
    (select id from lp where label = 'p1')
  )->'error'->>'code',
  'forbidden',
  'a read-only token cannot add a loan with a project'
);
select pg_temp.as_mcp('viewer', 'lp_viewer');
select is(
  public.mcp_add_loan(
    'lp-v-1', 'Example Viewer Loan', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'USD',
    (select id from lp where label = 'pd')
  )->'error'->>'code',
  'forbidden',
  'a demo viewer cannot add a loan with a project'
);
select is(
  (select count(*)::int from public.loans where name = 'Example Viewer Loan'),
  0,
  'the viewer wrote no loan'
);
select lives_ok(
  format(
    $$update public.loans set project_id = %L where id = %L$$,
    (select id from lp where label = 'p1'), (select id from lp where label = 'lb')
  ),
  'a viewer''s direct update runs and matches no row'
);

-- The FK: no cross-company project, even around the RPC.
reset role;
select is(
  (select project_id from public.loans where id = (select id from lp where label = 'lb')),
  null::uuid,
  'the viewer''s update changed nothing'
);
select throws_ok(
  format(
    $$update public.loans set project_id = %L where id = %L$$,
    (select id from lp where label = 'p9'), (select id from lp where label = 'la')
  ),
  '23503',
  null,
  'the foreign key refuses another company''s project'
);
select throws_ok(
  format(
    $$insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months,
      start_date, payment_minor, escrow_minor, currency, project_id)
      values (%L, 'Example Direct Loan', 100000, 0, 12, '2026-01-01', 10000, 0, 'USD', %L)$$,
    (select id from lp where label = 'co'), (select id from lp where label = 'p9')
  ),
  '23503',
  null,
  'the foreign key refuses it on insert too'
);

-- list_loans and the project's loans.
select pg_temp.as_mcp('read');
select is(
  (select l->>'project_id' from jsonb_array_elements(public.mcp_list_loans()) l where l->>'name' = 'Example Mortgage A'),
  (select id::text from lp where label = 'p1'),
  'list_loans shows project_id'
);
select is(
  (select l->>'project_name' from jsonb_array_elements(public.mcp_list_loans()) l where l->>'name' = 'Example Mortgage A'),
  'Site One',
  'list_loans shows project_name'
);
select is(
  (select (l->'project_id') from jsonb_array_elements(public.mcp_list_loans()) l where l->>'name' = 'Example Mortgage B'),
  'null'::jsonb,
  'a loan with no project lists a null project_id'
);
select is(
  public.get_project((select id from lp where label = 'p1'), 'cash')->'loans'->0->>'id',
  (select id::text from lp where label = 'la'),
  'the project lists its loan'
);
select is(
  public.get_project((select id from lp where label = 'p1'), 'cash')->'loans'->0->>'balance_minor',
  '12000000',
  'the project''s loan carries its balance'
);
select is(
  jsonb_array_length(public.get_project((select id from lp where label = 'p2'), 'cash')->'loans'),
  0,
  'a project with no loan lists none'
);
select pg_temp.as_mcp('other', 'lp_other');
select is(
  jsonb_array_length(coalesce(public.get_project((select id from lp where label = 'p1'), 'cash')->'loans', '[]'::jsonb)),
  0,
  'another company gets no project and so no loans'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.mcp_list_loans()) l where l->>'name' = 'Example Mortgage A'),
  0,
  'another company''s list_loans does not show the loan'
);
select is(
  (select count(*)::int from public.loans where project_id = (select id from lp where label = 'p1')),
  0,
  'another company cannot read the loan through the table'
);
select is(
  jsonb_array_length(public.get_project((select id from lp where label = 'p9'), 'cash')->'loans'),
  1,
  'positive control: the neighbour sees its own project''s loan'
);

-- Attach: an unassigned line takes the loan's project.
select pg_temp.as_mcp('write');
select is(
  public.mcp_attach_loan_payment(
    'lp-att-1', (select id from lp where label = 't1'), (select id from lp where label = 'la'),
    jsonb_build_array(
      jsonb_build_object('part', 'interest', 'amount_minor', 70000, 'scheduled_minor', 70000),
      jsonb_build_object('part', 'escrow', 'amount_minor', 20000, 'scheduled_minor', 20000),
      jsonb_build_object('part', 'principal', 'amount_minor', 10000, 'scheduled_minor', 10000)
    )
  )->'data'->>'project_inherited',
  'true',
  'attach reports the project was inherited'
);
select is(
  (select project_id from public.transactions where id = (select id from lp where label = 't1')),
  (select id from lp where label = 'p1'),
  'the line takes the loan''s project'
);
select is(
  (select pnl_role::text from public.transactions where id = (select id from lp where label = 't1')),
  'project',
  'the line becomes a direct cost on the project'
);
select is(
  (select (e->>'direct_minor')::bigint
   from jsonb_array_elements(public.get_project((select id from lp where label = 'p1'), 'cash')->'by_currency') e
   where e->>'currency' = 'USD'),
  90000::bigint,
  'cash basis: direct cost is interest plus escrow'
);
select is(
  (select (e->>'direct_minor')::bigint
   from jsonb_array_elements(public.get_project((select id from lp where label = 'p1'), 'invoiced')->'by_currency') e
   where e->>'currency' = 'USD'),
  90000::bigint,
  'invoiced basis: direct cost is interest plus escrow'
);
select is(
  (select (e->>'amount_minor')::bigint
   from jsonb_array_elements(public.get_project((select id from lp where label = 'p1'), 'cash')->'excluded_categories_by_currency') e
   where e->>'currency' = 'USD' and e->>'name' = 'תשלומי הלוואה'),
  10000::bigint,
  'cash basis: principal is in the excluded totals'
);
select is(
  (select (e->>'amount_minor')::bigint
   from jsonb_array_elements(public.get_project((select id from lp where label = 'p1'), 'invoiced')->'excluded_categories_by_currency') e
   where e->>'currency' = 'USD' and e->>'name' = 'תשלומי הלוואה'),
  10000::bigint,
  'invoiced basis: principal is in the excluded totals'
);

-- A line that already has a project or shares keeps it.
select is(
  public.mcp_attach_loan_payment(
    'lp-att-2', (select id from lp where label = 't2'), (select id from lp where label = 'la'),
    jsonb_build_array(
      jsonb_build_object('part', 'interest', 'amount_minor', 70000, 'scheduled_minor', 70000),
      jsonb_build_object('part', 'escrow', 'amount_minor', 20000, 'scheduled_minor', 20000),
      jsonb_build_object('part', 'principal', 'amount_minor', 10000, 'scheduled_minor', 10000)
    )
  )->'data'->>'project_inherited_reason',
  'line already has a project',
  'a line with a project is left alone and says why'
);
select is(
  (select project_id from public.transactions where id = (select id from lp where label = 't2')),
  (select id from lp where label = 'p2'),
  'the line keeps its own project'
);
select is(
  public.mcp_attach_loan_payment(
    'lp-att-3', (select id from lp where label = 't3'), (select id from lp where label = 'la'),
    jsonb_build_array(
      jsonb_build_object('part', 'interest', 'amount_minor', 70000, 'scheduled_minor', 70000),
      jsonb_build_object('part', 'escrow', 'amount_minor', 20000, 'scheduled_minor', 20000),
      jsonb_build_object('part', 'principal', 'amount_minor', 10000, 'scheduled_minor', 10000)
    )
  )->'data'->>'project_inherited',
  'false',
  'a line with shares is not given the loan''s project'
);
select is(
  (select count(*)::int from public.transactions t
   where t.id = (select id from lp where label = 't3') and t.project_id is null and t.pnl_role = 'shared'),
  1,
  'the shared line keeps its role and no project'
);
select is(
  (select count(*)::int from public.allocations where transaction_id = (select id from lp where label = 't3')),
  2,
  'the shared line keeps its two shares'
);

-- A loan with no project leaves the line alone.
select is(
  public.mcp_attach_loan_payment(
    'lp-att-4', (select id from lp where label = 't4'), (select id from lp where label = 'lb'),
    jsonb_build_array(
      jsonb_build_object('part', 'interest', 'amount_minor', 70000, 'scheduled_minor', 70000),
      jsonb_build_object('part', 'escrow', 'amount_minor', 20000, 'scheduled_minor', 20000),
      jsonb_build_object('part', 'principal', 'amount_minor', 10000, 'scheduled_minor', 10000)
    )
  )->'data'->>'project_inherited_reason',
  'loan has no project',
  'a loan with no project leaves the line unassigned'
);
select is(
  (select project_id from public.transactions where id = (select id from lp where label = 't4')),
  null::uuid,
  'the line stays without a project'
);

-- Changing the loan's project later does not move a line already attached.
select is(
  public.mcp_update_loan('lp-up-5', (select id from lp where label = 'la'),
    jsonb_build_object('project_id', (select id from lp where label = 'p2')))->'ok',
  'true'::jsonb,
  'the loan moves to another project'
);
select is(
  (select project_id from public.transactions where id = (select id from lp where label = 't1')),
  (select id from lp where label = 'p1'),
  'the attached line stays on the first project'
);
select is(
  public.mcp_undo('lp-undo-5', 'loan_update', (select id from lp where label = 'la'))->'ok',
  'true'::jsonb,
  'the move is undone'
);

-- Undo of the attach gives the line its earlier (null) project back.
select is(
  public.mcp_undo('lp-undo-6', 'loan_split', (select id from lp where label = 't1'))->'data'->>'project_restored',
  'true',
  'undo of the attach restores the line''s project'
);
select is(
  (select count(*)::int from public.transactions t
   where t.id = (select id from lp where label = 't1')
     and t.project_id is null and t.pnl_role is null),
  1,
  'the line has no project and no role again'
);
select is(
  (select count(*)::int from public.allocations where transaction_id = (select id from lp where label = 't1')),
  0,
  'the inherited share is gone'
);

-- A line changed after the attach is not touched by the undo.
select is(
  public.mcp_attach_loan_payment(
    'lp-att-5', (select id from lp where label = 't5'), (select id from lp where label = 'la'),
    jsonb_build_array(
      jsonb_build_object('part', 'interest', 'amount_minor', 70000, 'scheduled_minor', 70000),
      jsonb_build_object('part', 'escrow', 'amount_minor', 20000, 'scheduled_minor', 20000),
      jsonb_build_object('part', 'principal', 'amount_minor', 10000, 'scheduled_minor', 10000)
    )
  )->'data'->>'project_inherited',
  'true',
  'a second unassigned line inherits the project'
);
reset role;
update public.transactions set project_id = (select id from lp where label = 'p2')
where id = (select id from lp where label = 't5');
select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('lp-undo-7', 'loan_split', (select id from lp where label = 't5'))->'data'->>'project_restored',
  'false',
  'undo does not restore a line that changed since'
);
select is(
  (select project_id from public.transactions where id = (select id from lp where label = 't5')),
  (select id from lp where label = 'p2'),
  'the changed line keeps its new project'
);

-- Deleting a project clears the loan's project and keeps the loan.
reset role;
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months, start_date,
  payment_minor, escrow_minor, currency, project_id
)
select (select id from lp where label = 'co'), 'Example Mortgage C', 5000000, 60000, 120,
  '2026-01-01', 60000, 0, 'USD', (select id from lp where label = 'p3');
select is(
  (select project_id from public.loans where name = 'Example Mortgage C'),
  (select id from lp where label = 'p3'),
  'the loan sits under the third project'
);
delete from public.projects where id = (select id from lp where label = 'p3');
select is(
  (select count(*)::int from public.loans
   where name = 'Example Mortgage C' and project_id is null
     and company_id = (select id from lp where label = 'co')),
  1,
  'deleting the project keeps the loan and clears project_id'
);

-- Undoing a created project is a conflict while a loan sits under it.
select pg_temp.as_mcp('write');
insert into lp (label, id)
select 'pnew', (public.mcp_create_project('lp-proj-1', 'Example New Site')->'data'->>'id')::uuid;
select is(
  public.mcp_update_loan('lp-up-6', (select id from lp where label = 'lb'),
    jsonb_build_object('project_id', (select id from lp where label = 'pnew')))->'ok',
  'true'::jsonb,
  'a loan is filed under the new project'
);
select is(
  public.mcp_undo('lp-undo-8', 'project', (select id from lp where label = 'pnew'))->'error'->>'code',
  'conflict',
  'undo of the project is a conflict while a loan uses it'
);

select * from finish();
rollback;
