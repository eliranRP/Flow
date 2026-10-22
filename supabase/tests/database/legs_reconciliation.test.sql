-- FLOW-948 (decision 0208). The reconciliation proof: the P&L projection of the balanced legs
-- EQUALS the live private.pnl_lines output, per line/category/project, over a broad invented
-- fixture — plain, line-split, loan-split, reversal, gross-up normal + contra, kept-out proceeds,
-- overhead, shared, VAT, in ILS and USD, on the cash and invoiced bases. This is how we prove the
-- legs faithfully mirror the P&L WITHOUT changing pnl_lines. The legs are maintained only by the
-- migration's triggers (we never call rebuild_legs here), so this also proves the maintenance
-- path. Invented data only. USD amounts are cents, ILS amounts are agorot.

begin;

select plan(9);

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

-- ---- The reconciliation assertions. ----

-- Every transaction's legs balance to 0 with exactly one bank leg.
select is(
  (select coalesce(count(*), 0) from (
     select l.transaction_id
     from public.legs l join public.accounts a on a.id = l.account_id
     where l.company_id = (select id from lr where label = 'co')
     group by l.transaction_id
     having sum(l.amount_minor) <> 0 or count(*) filter (where a.is_bank) <> 1
   ) bad)::bigint,
  0::bigint,
  'every backfilled line balances to 0 with exactly one bank leg'
);

-- The projection EQUALS pnl_lines per line/category/project/kind (no row differs, none missing/extra).
select is(
  (select coalesce(count(*), 0) from (
     select 1
     from private.legs_pnl_projection((select id from lr where label = 'co')) p
     full outer join (
       select transaction_id, category_id, project_id, kind, sum(amount_net)::bigint amount_net
       from private.pnl_lines
       where company_id = (select id from lr where label = 'co') and in_pnl and kind in ('income','expense')
       group by transaction_id, category_id, project_id, kind
     ) q
       on p.transaction_id = q.transaction_id
      and p.category_id is not distinct from q.category_id
      and p.project_id is not distinct from q.project_id
      and p.kind = q.kind
     where coalesce(p.amount_net, 0) <> coalesce(q.amount_net, 0)
        or p.transaction_id is null or q.transaction_id is null
   ) diff)::bigint,
  0::bigint,
  'the legs P&L projection equals pnl_lines per line/category/project/kind'
);

-- The projection's grand total equals pnl_lines' in-P&L total (income positive, expense negative).
select is(
  (select coalesce(sum(amount_net), 0) from private.legs_pnl_projection((select id from lr where label = 'co')))::bigint,
  (select coalesce(sum(amount_net), 0) from private.pnl_lines
   where company_id = (select id from lr where label = 'co') and in_pnl and kind in ('income','expense'))::bigint,
  'projection grand total equals the live P&L total'
);

-- Spot checks of the trickiest cases (the whole point of the model).
-- gross-up normal: Proceeds income +10000, Repairs expense -3000.
select is(
  (select amount_net from private.legs_pnl_projection((select id from lr where label='co')) p
   where p.transaction_id = (select id from public.transactions where idempotency_key='gu_normal')
     and p.category_id = (select id from lr where label='proceeds')),
  10000::bigint, 'gross-up normal: gross proceeds project as +10000 income'
);
select is(
  (select amount_net from private.legs_pnl_projection((select id from lr where label='co')) p
   where p.transaction_id = (select id from public.transactions where idempotency_key='gu_normal')
     and p.category_id = (select id from lr where label='repairs')),
  -3000::bigint, 'gross-up normal: the closing cost projects as -3000 expense'
);
-- gross-up contra: PropTax nets to -6000 across its two parts (10000 debit - 4000 credit).
select is(
  (select sum(amount_net)::bigint from private.legs_pnl_projection((select id from lr where label='co')) p
   where p.transaction_id = (select id from public.transactions where idempotency_key='gu_contra')
     and p.category_id = (select id from lr where label='proptax')),
  -6000::bigint, 'gross-up contra: PropTax nets to -6000 (the escrow credit reduces its own category)'
);
-- loan split: principal (1000) is kept out of the projection; interest + escrow in.
select is(
  (select coalesce(sum(amount_net),0)::bigint from private.legs_pnl_projection((select id from lr where label='co')) p
   where p.transaction_id = (select id from public.transactions where idempotency_key='loan')),
  -9000::bigint, 'loan split: interest+escrow in P&L (-9000), principal kept out'
);
-- kept-out proceeds contribute nothing to the projection.
select is(
  (select count(*) from private.legs_pnl_projection((select id from lr where label='co')) p
   where p.transaction_id = (select id from public.transactions where idempotency_key='kept_inc'))::bigint,
  0::bigint, 'kept-out proceeds produce no P&L projection row'
);
-- the no-category income line projects under a null category.
select is(
  (select amount_net from private.legs_pnl_projection((select id from lr where label='co')) p
   where p.transaction_id = (select id from public.transactions where idempotency_key='nocat')
     and p.category_id is null),
  2000::bigint, 'a no-category income line projects as +2000 under a null category'
);

select finish();
rollback;
