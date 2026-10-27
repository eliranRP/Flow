-- FLOW-952 (decision 0209 item 9): the golden test of the flip. private.pnl_lines now reads the item legs.
-- On a broad invented fixture (the FLOW-948 reconciliation lines: plain income and expense with VAT,
-- kept out both ways, no category, a line split, a reversal part, gross-up normal and contra, a loan
-- split, the overhead project and a shared line; ILS and USD; paid and unpaid; plus a project group,
-- a pending line and a removed line), every reader of the P&L gives the same result::text with the
-- legs body and with the legacy body (swapped back in inside this transaction). Then the same for a
-- viewer, who reads the legs through RLS. Invented data only. USD amounts are cents, ILS agorot.

begin;

select plan(37);

do $u$ begin perform tests.create_supabase_user('lr_owner', 'lr-owner@example.com'); end $u$;

insert into public.companies (owner_id, name, is_demo, vat_rate_bp)
values (tests.get_supabase_uid('lr_owner'), 'Ledger Recon LLC', false, 1800);

create temp table lr (label text primary key, id uuid);
grant all on lr to authenticated, service_role;
insert into lr select 'co', id from public.companies where name = 'Ledger Recon LLC';

insert into public.projects (company_id, name, status)
select (select id from lr where label = 'co'), v.n, 'active'
from (values ('North'), ('South'), ('Overhead')) v(n);
insert into lr select lower(name), id from public.projects
where company_id = (select id from lr where label = 'co');
update public.companies set overhead_project_id = (select id from lr where label = 'overhead')
where id = (select id from lr where label = 'co');

-- Categories (loan-part categories are auto-seeded on company create).
insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select (select id from lr where label = 'co'), v.name, v.kind::public.category_kind, 90, false, v.ex
from (values
  ('Repairs', 'expense', false),
  ('Closing', 'expense', false),
  ('PropTax', 'expense', false),
  ('Rent', 'income', false),
  ('Proceeds', 'income', false),
  ('Draw', 'expense', true),        -- kept out
  ('OwnerFunds', 'income', true)    -- kept out proceeds
) v(name, kind, ex);
insert into lr select lower(name), id from public.categories
where company_id = (select id from lr where label = 'co') and sort_order = 90;

-- The loan.
insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency)
select (select id from lr where label = 'co'), 'L1', 1000000, 50000, 120, '2026-01-01', 10000, 2000, 'USD';
insert into lr select 'loan', id from public.loans where company_id = (select id from lr where label = 'co');

-- A helper for a whole line.
create or replace function pg_temp.line(
  p_key text, p_dir text, p_net bigint, p_vat bigint, p_cat text,
  p_proj text default null, p_cur text default 'ILS', p_doc text default 'receipt',
  p_cash date default '2026-06-10', p_override boolean default null
) returns uuid language plpgsql as $$
declare cid uuid; rid uuid;
begin
  cid := (select id from lr where label = 'co');
  insert into public.transactions (company_id, direction, doc_kind, pnl_role, line_status, currency,
    amount_gross, amount_net, amount_original, vat_amount, vat_status, doc_date, cash_date, source,
    idempotency_key, project_id, category_id, user_assigned, in_pnl_override)
  values (cid, p_dir::public.txn_direction, p_doc::public.doc_kind, 'project', 'posted', p_cur,
    p_net + p_vat, p_net, abs(p_net + p_vat), p_vat, 'source', '2026-06-01', p_cash, 'manual',
    p_key, (select id from lr where label = p_proj), (select id from lr where label = p_cat), true, p_override)
  returning id into rid;
  return rid;
end $$;

-- 1. plain income + VAT (ILS, paid/receipt)
select pg_temp.line('plain_inc', 'income', 10000, 1800, 'rent', 'north');
-- 2. plain expense + VAT (USD, invoice/unpaid -> invoiced basis)
select pg_temp.line('plain_exp', 'expense', -5000, -900, 'repairs', 'south', 'USD', 'invoice', null);
-- 3. kept-out expense (owner draw, excluded)
select pg_temp.line('kept_exp', 'expense', -3000, 0, 'draw', 'north');
-- 4. kept-out proceeds (income, excluded, e.g. owner funds deposited)
select pg_temp.line('kept_inc', 'income', 20000, 0, 'ownerfunds', 'north');
-- 5. no-category income line
do $$ declare rid uuid; begin
  rid := pg_temp.line('nocat', 'income', 2000, 0, 'rent', 'north');
  update public.transactions set category_id = null where id = rid;
end $$;

-- 6. line split (expense -8000 -> Repairs 5000 North + Closing 3000 South), USD
do $$ declare rid uuid; begin
  rid := pg_temp.line('split', 'expense', -8000, 0, 'repairs', null, 'USD');
  update public.transactions set category_id = null where id = rid;
  insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor, is_rest, gross_up)
  select (select id from lr where label='co'), rid, 1, (select id from lr where label='repairs'), (select id from lr where label='north'), 5000, false, false;
  insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor, is_rest, gross_up)
  select (select id from lr where label='co'), rid, 2, (select id from lr where label='closing'), (select id from lr where label='south'), 3000, false, false;
end $$;

-- 7. reversal part: income line 6000 with an expense refund part reducing the other side (not gross_up)
do $$ declare rid uuid; begin
  rid := pg_temp.line('reversal', 'income', 6000, 0, 'rent', null);
  update public.transactions set category_id = null where id = rid;
  insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor, is_rest, gross_up)
  select (select id from lr where label='co'), rid, 1, (select id from lr where label='rent'), (select id from lr where label='north'), 8000, false, false;
  insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor, is_rest, gross_up)
  select (select id from lr where label='co'), rid, 2, (select id from lr where label='repairs'), (select id from lr where label='south'), 2000, false, false;
end $$;

-- 8. gross-up NORMAL: deposit (income) net 7000 = Proceeds 10000 (income) - cost 3000 (expense gross_up)
do $$ declare rid uuid; begin
  rid := pg_temp.line('gu_normal', 'income', 7000, 0, 'proceeds', null);
  update public.transactions set category_id = null where id = rid;
  insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor, is_rest, gross_up)
  select (select id from lr where label='co'), rid, 1, (select id from lr where label='proceeds'), (select id from lr where label='north'), 10000, false, false;
  insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor, is_rest, gross_up)
  select (select id from lr where label='co'), rid, 2, (select id from lr where label='repairs'), (select id from lr where label='north'), 3000, false, true;
end $$;

-- 9. gross-up CONTRA: expense (PropTax) net -6000 = PropTax 10000 - escrow credit 4000 (same kind, own project)
do $$ declare rid uuid; begin
  rid := pg_temp.line('gu_contra', 'expense', -6000, 0, 'proptax', null);
  update public.transactions set category_id = null where id = rid;
  insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor, is_rest, gross_up)
  select (select id from lr where label='co'), rid, 1, (select id from lr where label='proptax'), (select id from lr where label='north'), 10000, false, false;
  insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor, is_rest, gross_up)
  select (select id from lr where label='co'), rid, 2, (select id from lr where label='proptax'), (select id from lr where label='south'), 4000, false, true;
end $$;

-- 9b. gross-up CONTRA on the SAME category AND project (FLOW-949): PropTax cost 10000 + PropTax
-- credit 4000 (gross_up), both on north, net -6000.
do $$ declare rid uuid; begin
  rid := pg_temp.line('gu_contra_same', 'expense', -6000, 0, 'proptax', null);
  update public.transactions set category_id = null where id = rid;
  insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor, is_rest, gross_up)
  select (select id from lr where label='co'), rid, 1, (select id from lr where label='proptax'), (select id from lr where label='north'), 10000, false, false;
  insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor, is_rest, gross_up)
  select (select id from lr where label='co'), rid, 2, (select id from lr where label='proptax'), (select id from lr where label='north'), 4000, false, true;
end $$;

-- 10. loan split: expense -10000 = interest 7000 (in) + escrow 2000 (in) + principal 1000 (kept out), USD, vat 0
do $$ declare rid uuid; begin
  rid := pg_temp.line('loan', 'expense', -10000, 0, 'rent', 'north', 'USD');
  update public.transactions set category_id = null where id = rid;
  insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review)
  select (select id from lr where label='co'), (select id from lr where label='loan'), rid, 'interest', 7000, 7000, (select id from public.categories where company_id=(select id from lr where label='co') and loan_part='interest'), false;
  insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review)
  select (select id from lr where label='co'), (select id from lr where label='loan'), rid, 'escrow', 2000, 2000, (select id from public.categories where company_id=(select id from lr where label='co') and loan_part='escrow'), false;
  insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review)
  select (select id from lr where label='co'), (select id from lr where label='loan'), rid, 'principal', 1000, 1000, (select id from public.categories where company_id=(select id from lr where label='co') and loan_part='principal'), false;
end $$;

-- 11. overhead line: expense on the overhead project
do $$ declare rid uuid; begin
  rid := pg_temp.line('overhead', 'expense', -4000, 0, 'repairs', 'overhead');
end $$;

-- 12. shared line: expense pnl_role shared, allocated across projects
do $$ declare rid uuid; begin
  rid := pg_temp.line('shared', 'expense', -9000, 0, 'repairs', null);
  update public.transactions set pnl_role = 'shared' where id = rid;
  insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net) values
    ((select id from lr where label='co'), rid, (select id from lr where label='north'), 5000, -4500),
    ((select id from lr where label='co'), rid, (select id from lr where label='south'), 5000, -4500);
end $$;

create function pg_temp.legs_pnl_projection(p_company uuid)
returns table (transaction_id uuid, category_id uuid, project_id uuid, kind text, amount_net bigint)
language sql stable as $$
  select l.transaction_id, a.category_id, l.project_id, a.type, sum(-l.amount_minor)::bigint
  from public.legs l join public.accounts a on a.id = l.account_id
  where l.company_id = p_company and a.type in ('income', 'expense')
  group by l.transaction_id, a.category_id, l.project_id, a.type
$$;

-- A project group with North, a pending line and a removed line (neither is in the P&L).
insert into public.project_groups (company_id, name) values ((select id from lr where label = 'co'), 'Group A');
insert into lr select 'group', id from public.project_groups where name = 'Group A';
update public.projects set group_id = (select id from lr where label = 'group') where id = (select id from lr where label = 'north');
do $$ declare rid uuid; begin
  rid := pg_temp.line('pending', 'expense', -700, 0, 'repairs', 'north');
  update public.transactions set line_status = 'pending' where id = rid;
  rid := pg_temp.line('removed', 'expense', -800, 0, 'repairs', 'south');
  update public.transactions set removed_at = now() where id = rid;
end $$;

-- A viewer of the company.
do $u$ begin perform tests.create_supabase_user('lr_viewer', 'lr-viewer@example.com'); end $u$;
insert into public.company_members (company_id, user_id, role)
values ((select id from lr where label = 'co'), tests.get_supabase_uid('lr_viewer'), 'viewer');

create or replace function pg_temp.lid(p_label text)
returns uuid language sql stable as $$ select id from lr where label = p_label $$;
grant execute on function pg_temp.lid(text) to authenticated, service_role;
create or replace function pg_temp.tid(p_key text)
returns uuid language sql stable as $$
  select id from public.transactions where company_id = pg_temp.lid('co') and idempotency_key = p_key
$$;
grant execute on function pg_temp.tid(text) to authenticated, service_role;

-- Every reader of the P&L, as a member of the company sees it.
create or replace function pg_temp.reads()
returns table (name text, result text)
language plpgsql
as $$
declare
  co uuid := pg_temp.lid('co');
  north uuid := pg_temp.lid('north');
  repairs uuid := pg_temp.lid('repairs');
  basis text;
begin
  foreach basis in array array['cash', 'invoiced'] loop
    name := 'get_dashboard ' || basis; result := public.get_dashboard('2026-01-01', '2026-12-31', basis)::text; return next;
    name := 'get_project ' || basis; result := public.get_project(north, basis, '2026-01-01', '2026-12-31')::text; return next;
    name := 'get_project all time ' || basis; result := public.get_project(north, basis)::text; return next;
    name := 'get_project_group ' || basis; result := public.get_project_group(pg_temp.lid('group'), basis, '2026-01-01', '2026-12-31')::text; return next;
    name := 'get_profit_months ' || basis; result := public.get_profit_months('2026-01-01', '2026-12-31', basis)::text; return next;
    name := 'get_profit_months north ' || basis; result := public.get_profit_months('2026-01-01', '2026-12-31', basis, north)::text; return next;
    name := 'get_breakdown expense by category ' || basis; result := public.get_breakdown('expense', '2026-01-01', '2026-12-31', 'category', basis)::text; return next;
    name := 'get_breakdown income by project ' || basis; result := public.get_breakdown('income', '2026-01-01', '2026-12-31', 'project', basis)::text; return next;
    name := 'get_breakdown_lines ' || basis; result := public.get_breakdown_lines('expense', 'category', repairs::text, 'USD', '2026-01-01', '2026-12-31', basis)::text; return next;
    name := 'list_project_category ' || basis; result := public.list_project_category(north, repairs, 0, 40, '2026-01-01', '2026-12-31', basis)::text; return next;
  end loop;
  name := 'get_project (one overload)'; result := public.get_project(north)::text; return next;
  name := 'get_home'; result := public.get_home()::text; return next;
  name := 'cash_months'; result := public.cash_months(6, '2026-06-30')::text; return next;
  name := 'cash_month_lines out'; result := public.cash_month_lines('2026-06-01', 'out', 'USD')::text; return next;
  name := 'cash_month_lines in'; result := public.cash_month_lines('2026-06-01', 'in', 'ILS')::text; return next;
  name := 'projects_cash_month'; result := public.projects_cash_month('2026-06-01', '2026-06-30')::text; return next;
  name := 'project_cash_months'; result := public.project_cash_months(north, 4, '2026-06-30')::text; return next;
  name := 'project_cash_month_lines'; result := public.project_cash_month_lines(north, '2026-06-01', 'out')::text; return next;
  name := 'company_next_month_inputs'; result := public.company_next_month_inputs('2026-06-15')::text; return next;
  name := 'weekly_summary'; result := public.weekly_summary('2026-06-07')::text; return next;
  name := 'get_loan_split'; result := public.get_loan_split(pg_temp.tid('loan'))::text; return next;
  name := 'get_transaction (line states)'; result := (
    select string_agg(coalesce(public.get_transaction(t.id)::text, 'null'), '|' order by t.idempotency_key)
    from public.transactions t where t.company_id = co
  ); return next;
end;
$$;
grant execute on function pg_temp.reads() to authenticated, service_role;

-- The line states of every line, in one text.
create or replace function pg_temp.line_states()
returns text
language sql
as $$
  select string_agg(x::text, '|' order by x::text)
  from private.line_pnl_states((select array_agg(id order by id) from public.transactions where company_id = pg_temp.lid('co'))) x
$$;

create temp table golden (name text primary key, legs text, legacy text);
grant all on golden to authenticated, service_role;

-- The readers with the legs body (this migration's private.pnl_lines).
select tests.authenticate_as('lr_owner');
insert into golden (name, legs) select r.name, r.result from pg_temp.reads() r;
insert into golden (name, legs) values ('viewer get_project', null);
reset role;
select tests.authenticate_as('lr_viewer');
update golden set legs = public.get_project(pg_temp.lid('north'), 'cash', '2026-01-01', '2026-12-31')::text
where name = 'viewer get_project';
reset role;
-- company_pnl and the line states are the service role's.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
insert into golden (name, legs) values
  ('company_pnl cash', public.company_pnl(pg_temp.lid('co'), '2026-01-01', '2026-12-31', 'cash')::text),
  ('company_pnl invoiced', public.company_pnl(pg_temp.lid('co'), '2026-01-01', '2026-12-31', 'invoiced')::text),
  ('line_pnl_states', pg_temp.line_states());
select set_config('request.jwt.claims', '', true);

-- The legacy body back in (rolled back with the test), and the same readers again.
grant select on private.pnl_lines_legacy to authenticated;
create or replace view private.pnl_lines with (security_invoker = true) as
select company_id, transaction_id, project_id, pnl_role, direction, doc_kind, doc_date, cash_date, currency,
  category_id, part, amount_net, line_amount_net, in_pnl, loan_split_fallback, unassigned, kind, unpaid, gross_up
from private.pnl_lines_legacy;

select tests.authenticate_as('lr_owner');
update golden g set legacy = r.result from pg_temp.reads() r where r.name = g.name;
reset role;
select tests.authenticate_as('lr_viewer');
update golden set legacy = public.get_project(pg_temp.lid('north'), 'cash', '2026-01-01', '2026-12-31')::text
where name = 'viewer get_project';
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
update golden set legacy = public.company_pnl(pg_temp.lid('co'), '2026-01-01', '2026-12-31', 'cash')::text where name = 'company_pnl cash';
update golden set legacy = public.company_pnl(pg_temp.lid('co'), '2026-01-01', '2026-12-31', 'invoiced')::text where name = 'company_pnl invoiced';
update golden set legacy = pg_temp.line_states() where name = 'line_pnl_states';
select set_config('request.jwt.claims', '', true);

-- Every reader reads a non-empty result, the same from the legs as from the legacy body.
select is(g.legs, g.legacy, 'the legs and the legacy body agree: ' || g.name)
from golden g
order by g.name;
select is(
  (select count(*)::integer from golden where legs is null or legs in ('null', '[]', '{}')),
  0,
  'every reader read something'
);

select * from finish();

rollback;
