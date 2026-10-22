-- FLOW-954 (decision 0208). The ledger on the app's screens, read only: get_line_journal reads one
-- line's legs for the line screen (names, types, in-profit flag, project, balanced, booked by an MCP
-- write); get_breakdown's excluded_groups lists the kept-out categories by category; the kept-out
-- drill-down lines name their category id. Nothing here moves a P&L figure: groups, totals and
-- excluded are pinned before and after. Invented books only; USD cents.

begin;
select plan(30);

do $u$ begin
  perform tests.create_supabase_user('lj_owner', 'lj-owner@example.com');
  perform tests.create_supabase_user('lj_other', 'lj-other@example.com');
end $u$;

insert into public.companies (owner_id, name, is_demo) values
  (tests.get_supabase_uid('lj_owner'), 'Example Journal LLC', false),
  (tests.get_supabase_uid('lj_other'), 'Example Other Journal LLC', false);

create temp table lj (label text primary key, id uuid);
grant all on lj to authenticated, service_role;
insert into lj select 'co', id from public.companies where name = 'Example Journal LLC';
insert into lj select 'other_co', id from public.companies where name = 'Example Other Journal LLC';

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.lj where label = p_label
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into public.projects (company_id, name, status) values (pg_temp.id('co'), 'Alpha', 'active');
insert into lj select 'alpha', id from public.projects where company_id = pg_temp.id('co');

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select pg_temp.id('co'), v.name, v.kind::public.category_kind, 90, false, v.ex
from (values ('Build', 'expense', false), ('Purchase', 'expense', true)) v(name, kind, ex);
insert into lj select lower(name), id from public.categories where company_id = pg_temp.id('co') and sort_order = 90;
-- The default principal category (kept out, loan_part principal).
insert into lj select 'principal', id from public.categories where company_id = pg_temp.id('co') and loan_part = 'principal';

create function pg_temp.line(p_key text, p_company text, p_gross bigint, p_category text,
  p_status text default 'posted') returns void
language sql as $$
  insert into public.transactions (
    company_id, direction, doc_kind, pnl_role, line_status, currency,
    amount_gross, amount_net, amount_original, vat_amount, vat_status,
    doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
  )
  values (pg_temp.id(p_company), 'expense', 'expense', 'project', p_status::public.line_status, 'USD',
    p_gross, p_gross, abs(p_gross), 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'lj:' || p_key,
    case when p_company = 'co' then pg_temp.id('alpha') end,
    case when p_company = 'co' then pg_temp.id(p_category) end, p_key, true);
  insert into pg_temp.lj select 'txn_' || p_key, id from public.transactions where idempotency_key = 'lj:' || p_key;
$$;
select pg_temp.line('pay', 'co', -240000, 'build');
select pg_temp.line('buy', 'co', -8034714, 'purchase');
select pg_temp.line('princ', 'co', -35000, 'principal');
select pg_temp.line('booked', 'co', -10000, 'build');
select pg_temp.line('undone', 'co', -10000, 'build');
select pg_temp.line('pend', 'co', -10000, 'build', 'pending');
select pg_temp.line('foreign', 'other_co', -240000, null);

-- An MCP write on 'booked' (live) and on 'undone' (undone since).
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('lj_owner'), pg_temp.id('co'), 'hash-lj-write', 'kid', array['read', 'write']::text[], '2099-01-01');
insert into private.mcp_writes (token_id, user_id, company_id, kind, transaction_id, prior, undone_at)
select c.id, tests.get_supabase_uid('lj_owner'), pg_temp.id('co'), 'book_line', pg_temp.id(v.line),
  jsonb_build_object('after', '{}'::jsonb), v.undone
from private.mcp_credentials c, (values ('txn_booked', null::timestamptz), ('txn_undone', now())) v(line, undone)
where c.token_hash = 'hash-lj-write';

-- One leg of a line's journal, by its account name.
create function pg_temp.leg(p_line text, p_account text) returns jsonb language sql stable as $$
  select l from jsonb_array_elements(public.get_line_journal(pg_temp.id(p_line)) -> 'legs') l
  where l ->> 'account_name' = p_account
$$;
grant execute on function pg_temp.leg(text, text) to authenticated, service_role;

select tests.authenticate_as('lj_owner');

-- ---------------------------------------------------------------------------
-- get_line_journal: one line's legs.
-- ---------------------------------------------------------------------------
select is(jsonb_array_length(public.get_line_journal(pg_temp.id('txn_pay')) -> 'legs'), 2, 'a plain line has two legs');
select is(public.get_line_journal(pg_temp.id('txn_pay')) ->> 'balanced', 'true', 'the legs balance');
select is(public.get_line_journal(pg_temp.id('txn_pay')) ->> 'currency', 'USD', 'the line''s currency');
select is(pg_temp.leg('txn_pay', 'Build') ->> 'account_type', 'expense', 'the category leg is an expense');
select is(pg_temp.leg('txn_pay', 'Build') ->> 'in_pnl', 'true', 'the category leg counts in profit');
select is((pg_temp.leg('txn_pay', 'Build') ->> 'amount_minor')::bigint, 240000::bigint, 'an expense leg is a debit (+)');
select is(pg_temp.leg('txn_pay', 'Build') ->> 'project_name', 'Alpha', 'the leg names its project');
select is(pg_temp.leg('txn_pay', 'Build') ->> 'category_name', 'Build', 'the bridge leg names its live category');
select is(pg_temp.leg('txn_pay', 'Bank/Clearing') ->> 'is_bank', 'true', 'the bank leg');
select is((pg_temp.leg('txn_pay', 'Bank/Clearing') ->> 'amount_minor')::bigint, -240000::bigint, 'the bank leg is a credit (−)');
select is(pg_temp.leg('txn_pay', 'Bank/Clearing') ->> 'in_pnl', 'false', 'the bank leg is not in profit');
select is(public.get_line_journal(pg_temp.id('txn_pay')) ->> 'booked_by_ai', 'false', 'a line no MCP write touched');

-- A kept-out line: its leg is on a system account, outside profit.
select is(pg_temp.leg('txn_buy', 'Suspense') ->> 'account_type', 'asset', 'a kept-out purchase is an asset leg');
select is(pg_temp.leg('txn_buy', 'Suspense') ->> 'in_pnl', 'false', 'the kept-out leg is not in profit');
select is(pg_temp.leg('txn_buy', 'Suspense') ->> 'system', 'true', 'the kept-out leg is a system account');
select is(pg_temp.leg('txn_princ', 'Loan principal') ->> 'account_type', 'liability', 'principal is a liability leg');

-- Renaming the category renames the leg (the live name).
reset role;
update public.categories set name = 'Build work' where id = pg_temp.id('build');
select tests.authenticate_as('lj_owner');
select is(pg_temp.leg('txn_pay', 'Build work') ->> 'category_name', 'Build work', 'the leg follows a category rename');

-- booked_by_ai: an MCP book_line write that was not undone.
select is(public.get_line_journal(pg_temp.id('txn_booked')) ->> 'booked_by_ai', 'true', 'an MCP write marks the line');
select is(public.get_line_journal(pg_temp.id('txn_undone')) ->> 'booked_by_ai', 'false', 'an undone MCP write does not');

-- A pending line has no legs; another company's or an unknown line is null.
select is(public.get_line_journal(pg_temp.id('txn_pend')) -> 'legs', '[]'::jsonb, 'a pending line has no legs');
select is(public.get_line_journal(pg_temp.id('txn_pend')) ->> 'balanced', 'true', 'no legs: balanced');
select is(public.get_line_journal(pg_temp.id('txn_foreign')), null, 'another company''s line is null');
select is(public.get_line_journal(gen_random_uuid()), null, 'an unknown line is null');

-- ---------------------------------------------------------------------------
-- get_breakdown excluded_groups and the kept-out lines' category.
-- ---------------------------------------------------------------------------
create temp table xg as
select g from jsonb_array_elements(
  public.get_breakdown('expense', '2026-06-01', '2026-06-30', 'category') -> 'excluded_groups') g;

select is((select (g ->> 'amount_minor')::bigint from xg where g ->> 'key' = pg_temp.id('purchase')::text),
  8034714::bigint, 'the purchase is a kept-out group with its sum');
select is((select g ->> 'loan_part' from xg where g ->> 'key' = pg_temp.id('principal')::text),
  'principal', 'the principal group carries its loan part');
select is((select sum((g ->> 'amount_minor')::bigint) from xg),
  (select sum((e ->> 'amount_minor')::bigint) from jsonb_array_elements(
    public.get_breakdown('expense', '2026-06-01', '2026-06-30', 'category') -> 'excluded') e),
  'the kept-out groups add up to excluded');
select is((select count(*)::integer from xg where (g ->> 'key') = pg_temp.id('build')::text), 0,
  'a counted category is not a kept-out group');
select is(public.get_breakdown('expense', '2026-06-01', '2026-06-30', 'project') -> 'excluded_groups', '[]'::jsonb,
  'by project there are no kept-out groups');
select is((select string_agg(r ->> 'category_id', ',' order by r ->> 'category_id') from jsonb_array_elements(
    public.get_breakdown_lines('expense', 'category', '', 'USD', '2026-06-01', '2026-06-30', 'cash', true) -> 'rows') r),
  (select string_agg(x::text, ',' order by x::text) from unnest(array[pg_temp.id('purchase'), pg_temp.id('principal')]) x),
  'each kept-out line names its category');

-- The P&L keys keep their figures: only the counted lines are in groups and totals.
select is(
  (select format('%s/%s|%s|%s', g ->> 'amount_minor', g ->> 'count', b -> 'totals' -> 0 ->> 'amount_minor', b -> 'excluded' -> 0 ->> 'amount_minor')
   from public.get_breakdown('expense', '2026-06-01', '2026-06-30', 'category') b,
     jsonb_array_elements(b -> 'groups') g
   where g ->> 'key' = pg_temp.id('build')::text),
  '260000/3|260000|8069714', 'groups, totals and excluded keep their figures');

select * from finish();
rollback;
