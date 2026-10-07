-- FLOW-311 review. Guards with no test of their own: save_line_split refuses another
-- company's line (and the owner still saves it), a line with a loan split refuses a split by
-- category through the RPC and through a direct insert, and undo of a created project or
-- category that a part uses is a conflict. Invented data only. Amounts are cents.

begin;

select plan(8);

do $users$
begin
  perform tests.create_supabase_user('lsg_owner', 'lsg-owner@example.com');
  perform tests.create_supabase_user('lsg_other', 'lsg-other@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values
  (tests.get_supabase_uid('lsg_owner'), 'Example Guard LLC', false),
  (tests.get_supabase_uid('lsg_other'), 'Example Stranger LLC', false);

create temp table lsg (label text primary key, id uuid);
grant all on lsg to authenticated, service_role;
insert into lsg (label, id) select 'co', id from public.companies where name = 'Example Guard LLC';
insert into lsg (label, id) select 'other_co', id from public.companies where name = 'Example Stranger LLC';

insert into public.categories (company_id, name, kind, sort_order, is_default)
select c.id, v.name, 'expense', 90, false
from (values ('co'), ('other_co')) as o(label)
join lsg c on c.label = o.label
cross join (values ('Repairs'), ('Supplies')) as v(name);
insert into lsg (label, id)
select lower(c.name) || case when c.company_id = (select id from lsg where label = 'co') then '' else '_other' end, c.id
from public.categories c
where c.company_id in (select id from lsg where label in ('co', 'other_co')) and c.name in ('Repairs', 'Supplies');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select (select id from lsg where label = 'co'), 'expense', 'expense', null, 'posted', 'USD',
  v.amount, v.amount, abs(v.amount), 0, 'source', '2026-06-10', '2026-06-10', 'manual', v.key,
  null, (select id from lsg where label = 'repairs'), v.key, true
from (values ('lsg:bill', -10000), ('lsg:loan', -1000), ('lsg:new', -2000)) as v(key, amount);
insert into lsg (label, id) select replace(idempotency_key, 'lsg:', 'txn_'), id
from public.transactions where idempotency_key like 'lsg:%';

insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, currency)
values ((select id from lsg where label = 'co'), 'Example note', 1000000, 60000, 360, '2026-01-01', 10000, 0, 'USD');
insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id)
select t.company_id, l.id, t.id, 'interest', 1000, 1000, (select id from lsg where label = 'repairs')
from public.transactions t join public.loans l on l.company_id = t.company_id
where t.id = (select id from lsg where label = 'txn_loan');

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('lsg_owner'), (select id from lsg where label = 'co'), 'hash-lsg-write', 'kid', array['write']::text[], '2099-01-01');
insert into lsg (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-lsg-write';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('lsg_owner');
  tid uuid;
begin
  select id into tid from pg_temp.lsg where label = 'write';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

create function pg_temp.two(p_a bigint, p_b bigint, p_suffix text default '') returns jsonb
language sql
as $$
  select jsonb_build_array(
    jsonb_build_object('category_id', (select id from lsg where label = 'repairs' || p_suffix), 'amount_minor', p_a),
    jsonb_build_object('category_id', (select id from lsg where label = 'supplies' || p_suffix), 'amount_minor', p_b)
  )
$$;
grant execute on function pg_temp.two(bigint, bigint, text) to authenticated, service_role;

-- Cross-tenant: the stranger cannot split the owner's line, even with their own categories.
select tests.authenticate_as('lsg_other');
select throws_ok(
  $$select public.save_line_split((select id from lsg where label = 'txn_bill'), pg_temp.two(4000, 6000, '_other'))$$,
  'transaction not found', 'another company''s line is not found');
select tests.authenticate_as('lsg_owner');
select is(
  jsonb_array_length(public.save_line_split((select id from lsg where label = 'txn_bill'), pg_temp.two(4000, 6000))),
  2, 'the owner still splits their own line');

-- A line with a loan split takes no split by category, by the RPC or by a direct insert.
select throws_ok(
  $$select public.save_line_split((select id from lsg where label = 'txn_loan'), pg_temp.two(400, 600))$$,
  'line has a loan split', 'the RPC refuses a line with a loan split');
reset role;
select throws_ok(
  $$insert into public.line_splits (company_id, transaction_id, ordinal, category_id, amount_minor)
    values ((select id from lsg where label = 'co'), (select id from lsg where label = 'txn_loan'), 1,
      (select id from lsg where label = 'supplies'), 1000)$$,
  'line has a loan split', 'the trigger refuses a direct insert on a line with a loan split');

-- Undo of a created project or category that a part uses is a conflict, not a refusal.
select pg_temp.as_mcp();
insert into lsg (label, id)
select 'new_project', (public.mcp_create_project('lsg-p', 'Example Site', 'active') -> 'data' ->> 'id')::uuid;
insert into lsg (label, id)
select 'new_category', (public.mcp_create_category('lsg-c', 'Example Permits', 'expense') -> 'data' ->> 'id')::uuid;
select is(
  public.mcp_split_line('lsg-s', (select id from lsg where label = 'txn_new'), jsonb_build_array(
    jsonb_build_object('category_id', (select id from lsg where label = 'new_category'),
      'project_id', (select id from lsg where label = 'new_project'), 'amount_minor', 1500),
    jsonb_build_object('category_id', (select id from lsg where label = 'repairs'), 'amount_minor', 500))) -> 'ok',
  'true'::jsonb, 'a part uses the new project and category');
select is(
  public.mcp_undo('lsg-u1', 'project', (select id from lsg where label = 'new_project')) -> 'error' ->> 'code',
  'conflict', 'undo of a project a part uses is a conflict');
select is(
  public.mcp_undo('lsg-u2', 'category', (select id from lsg where label = 'new_category')) -> 'error' ->> 'code',
  'conflict', 'undo of a category a part uses is a conflict');
select is(
  (select count(*)::integer from public.line_splits where transaction_id = (select id from lsg where label = 'txn_new')),
  2, 'and the parts stay');

select * from finish();
rollback;
