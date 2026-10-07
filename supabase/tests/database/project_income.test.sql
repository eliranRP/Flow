-- FLOW-109. Income filed to a project through MCP counts in that project and once in the company total.
-- Income keeps pnl_role null and has no allocation row by design; the P&L reads its project_id.

begin;

select plan(26);

do $users$
begin
  perform tests.create_supabase_user('projinc_owner', 'projinc-owner@example.com');
end
$users$;

create temp table projinc (label text primary key, id uuid);
grant all on projinc to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid('projinc_owner');
  select id into tid from pg_temp.projinc where label = p_label;
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

-- Income on project p in the given currency, as get_project and get_dashboard report it.
create or replace function pg_temp.project_income(p_label text, p_currency text default 'ILS')
returns jsonb
language sql
set search_path = ''
as $$
  select jsonb_build_object(
    'project', case when p_currency = 'ILS'
      then (public.get_project(p.id, 'cash')->>'income_agorot')::bigint
      else (
        select (b->>'income_minor')::bigint
        from jsonb_array_elements(public.get_project(p.id, 'cash')->'by_currency') b
        where b->>'currency' = p_currency
      ) end,
    'dashboard', (
      select case when p_currency = 'ILS'
        then (r->>'income_agorot')::bigint
        else (
          select (b->>'income_minor')::bigint
          from jsonb_array_elements(r->'by_currency') b
          where b->>'currency' = p_currency
        ) end
      from jsonb_array_elements(public.get_dashboard(null, null, 'cash')->'projects') r
      where (r->>'id')::uuid = p.id
    )
  )
  from pg_temp.projinc p
  where p.label = p_label;
$$;
grant execute on function pg_temp.project_income(text, text) to authenticated, service_role;

select tests.authenticate_as('projinc_owner');
select lives_ok($$select public.create_company('Example Co', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'North Property', null, 'active')$$, 'north project');
select lives_ok($$select public.upsert_project(null, 'South Property', null, 'active')$$, 'south project');

insert into projinc (label, id) select 'company', id from public.companies;
insert into projinc (label, id) select 'north', id from public.projects where name = 'North Property';
insert into projinc (label, id) select 'south', id from public.projects where name = 'South Property';
insert into projinc (label, id)
select 'income_cat', id from public.categories where name = 'תקבול מלקוח' and kind = 'income';

reset role;

-- Three unfiled income lines, the way a bank sync lands them: no project, no category, no role.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, currency,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description
)
select c.id, 'income', 'invoice_receipt', null, v.currency,
  v.amount, v.amount, 0, 'unknown',
  '2026-09-10', '2026-09-10', 'manual', v.key, null, null, v.descr
from projinc c
cross join (values
  ('projinc:one', 'ILS', 50000::bigint, 'Rent payment one'),
  ('projinc:two', 'ILS', 30000::bigint, 'Rent payment two'),
  ('projinc:usd', 'USD', 10000::bigint, 'Rent payment usd')
) as v(key, currency, amount, descr)
where c.label = 'company';

insert into projinc (label, id) select 'one', id from public.transactions where idempotency_key = 'projinc:one';
insert into projinc (label, id) select 'two', id from public.transactions where idempotency_key = 'projinc:two';
insert into projinc (label, id) select 'usd', id from public.transactions where idempotency_key = 'projinc:usd';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('projinc_owner'), c.id, 'hash-projinc-write1', 'kid', array['write']::text[], '2099-01-01'::timestamptz
from projinc c where c.label = 'company';
insert into projinc (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-projinc-write1';

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  (public.get_dashboard(null, null, 'cash')->>'income_agorot')::bigint,
  80000::bigint,
  'unfiled income counts in the company total'
);
select is(pg_temp.project_income('north'), '{"project": 0, "dashboard": 0}'::jsonb, 'north has no income yet');

-- Single assign.
select is(
  public.mcp_assign_expense(
    'projinc-one',
    (select id from projinc where label = 'one'),
    (select id from projinc where label = 'north'),
    (select id from projinc where label = 'income_cat'),
    false
  )->>'ok',
  'true',
  'assign_expense files the income to north'
);

select is(
  (select jsonb_build_object('project', t.project_id = n.id, 'role', t.pnl_role, 'allocations',
     (select count(*) from public.allocations a where a.transaction_id = t.id))
   from public.transactions t, projinc n
   where t.idempotency_key = 'projinc:one' and n.label = 'north'),
  '{"project": true, "role": null, "allocations": 0}'::jsonb,
  'income keeps a null role and no allocation row'
);

select is(pg_temp.project_income('north'), '{"project": 50000, "dashboard": 50000}'::jsonb, 'north shows the filed income');
select is(pg_temp.project_income('south'), '{"project": 0, "dashboard": 0}'::jsonb, 'south does not');
select is(
  (public.get_dashboard(null, null, 'cash')->>'income_agorot')::bigint,
  80000::bigint,
  'the company total counts the filed income once'
);
select is(
  (select (r->>'income_agorot')::bigint
   from jsonb_array_elements(public.get_dashboard(null, null, 'invoiced')->'projects') r
   where (r->>'id')::uuid = (select id from projinc where label = 'north')),
  50000::bigint,
  'north shows it on the invoiced basis too'
);

-- Batch assign.
select is(
  public.mcp_assign_expenses(
    'projinc-batch',
    jsonb_build_array(jsonb_build_object(
      'transaction_id', (select id::text from projinc where label = 'two'),
      'project_id', (select id::text from projinc where label = 'south'),
      'category_id', (select id::text from projinc where label = 'income_cat')
    ))
  )->'data'->>'ok_count',
  '1',
  'assign_expenses files the second income to south'
);

select is(pg_temp.project_income('south'), '{"project": 30000, "dashboard": 30000}'::jsonb, 'south shows the batch-filed income');
select is(pg_temp.project_income('north'), '{"project": 50000, "dashboard": 50000}'::jsonb, 'north is unchanged');
select is(
  (public.get_dashboard(null, null, 'cash')->>'income_agorot')::bigint,
  80000::bigint,
  'the company total still counts each income once'
);
select is(
  (select sum((r->>'income_agorot')::bigint)
   from jsonb_array_elements(public.get_dashboard(null, null, 'cash')->'projects') r),
  80000::numeric,
  'project incomes add up to the company income'
);

-- Another currency.
select is(
  public.mcp_assign_expense(
    'projinc-usd',
    (select id from projinc where label = 'usd'),
    (select id from projinc where label = 'north'),
    (select id from projinc where label = 'income_cat'),
    false
  )->>'ok',
  'true',
  'assign_expense files USD income to north'
);
select is(pg_temp.project_income('north', 'USD'), '{"project": 10000, "dashboard": 10000}'::jsonb, 'north shows the USD income in its currency');
select is(pg_temp.project_income('north'), '{"project": 50000, "dashboard": 50000}'::jsonb, 'USD income stays out of the ILS figure');
select is(
  (select (b->>'income_minor')::bigint
   from jsonb_array_elements(public.get_dashboard(null, null, 'cash')->'by_currency') b
   where b->>'currency' = 'USD'),
  10000::bigint,
  'the company USD total counts it once'
);

-- Idempotent replay changes nothing.
select is(
  public.mcp_assign_expense(
    'projinc-one',
    (select id from projinc where label = 'one'),
    (select id from projinc where label = 'north'),
    (select id from projinc where label = 'income_cat'),
    false
  )->>'ok',
  'true',
  'a replay of the same key succeeds'
);
select is(pg_temp.project_income('north'), '{"project": 50000, "dashboard": 50000}'::jsonb, 'a replay does not double the income');

-- Undo.
reset role;
insert into projinc (label, id)
select 'one_undo', w.reassign_id
from private.mcp_writes w
join projinc t on t.id = w.transaction_id
where t.label = 'one';

do $$ begin perform pg_temp.as_mcp('write'); end $$;

select is(
  public.mcp_undo('projinc-undo', 'reassign', (select id from projinc where label = 'one_undo'))->>'ok',
  'true',
  'undo of the income assign succeeds'
);
select is(
  (select project_id from public.transactions where idempotency_key = 'projinc:one'),
  null,
  'undo clears the project'
);
select is(pg_temp.project_income('north'), '{"project": 0, "dashboard": 0}'::jsonb, 'undo removes the income from north');
select is(
  (public.get_dashboard(null, null, 'cash')->>'income_agorot')::bigint,
  80000::bigint,
  'the company total is unchanged by the undo'
);

select * from finish();
rollback;
