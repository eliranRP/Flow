-- FLOW-948 (decision 0208). The reconciliation proof: the P&L projection of the balanced legs
-- EQUALS the live private.pnl_lines output, per line/category/project, over a broad invented
-- fixture — plain, line-split, loan-split, reversal, gross-up normal + contra, kept-out proceeds,
-- overhead, shared, VAT, in ILS and USD, on the cash and invoiced bases. This is how we prove the
-- legs faithfully mirror the P&L WITHOUT changing pnl_lines. The legs are maintained only by the
-- migration's triggers (we never call rebuild_legs here), so this also proves the maintenance
-- path. Invented data only. USD amounts are cents, ILS amounts are agorot.
-- FLOW-951 (decision 0209) adds the mutation matrix at the end: after each legacy writer, the shadow
-- P&L over the legs (private.pnl_lines_ledger) equals the posting rules (private.pnl_lines_legacy)
-- on all 19 pnl_lines columns, kept-out rows included (private.ledger_pnl_diff, both ways).

begin;

select plan(58);

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
-- gross-up contra, same category and project: one projection row, PropTax on north nets to -6000.
select is(
  (select array_agg(amount_net)::bigint[] from private.legs_pnl_projection((select id from lr where label='co')) p
   where p.transaction_id = (select id from public.transactions where idempotency_key='gu_contra_same')),
  array[-6000]::bigint[], 'gross-up contra on the same category and project nets to one -6000 row'
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

-- ---- FLOW-951: the mutation matrix. ----
-- pg_temp.diff_rows runs the deferred leg checks now (balance, category FK), then counts the rows
-- where the shadow and the posting rules differ, both ways, on all 19 columns.
create or replace function pg_temp.diff_rows() returns bigint language plpgsql as $$
begin
  set constraints public.legs_balance, public.legs_company_id_category_id_fkey immediate;
  set constraints public.legs_balance, public.legs_company_id_category_id_fkey deferred;
  return (select count(*) from private.ledger_pnl_diff((select id from lr where label = 'co')));
end $$;
create or replace function pg_temp.tid(p_key text) returns uuid language sql as $$
  select id from public.transactions
  where company_id = (select id from lr where label = 'co') and idempotency_key = p_key $$;
create or replace function pg_temp.lid(p_label text) returns uuid language sql as $$
  select id from lr where label = p_label $$;
grant execute on function pg_temp.tid(text) to authenticated, service_role;
grant execute on function pg_temp.lid(text) to authenticated, service_role;
-- A posting-rules read for the "did the writer really change something" checks.
create or replace function pg_temp.rules(p_key text) returns text language sql as $$
  select string_agg(concat_ws(':', category_id, project_id, kind, amount_net, in_pnl, unassigned, pnl_role, loan_split_fallback),
    '|' order by category_id, project_id, amount_net)
  from private.pnl_lines_legacy where transaction_id = pg_temp.tid(p_key) $$;
create temp table lr_seen (label text primary key, v text);

select is(pg_temp.diff_rows(), 0::bigint, 'M0 the fixture: the shadow equals the posting rules on all 19 columns');
select cmp_ok(
  (select count(*) from private.pnl_lines_ledger where company_id = pg_temp.lid('co') and not in_pnl), '>=', 3::bigint,
  'M0 kept-out rows are in the shadow too (owner draw, owner funds, principal)');

-- M1 category P&L toggle, then the toggle back (what undo of set_category_pnl writes).
select tests.authenticate_as('lr_owner');
select public.set_category_excluded_from_pnl(pg_temp.lid('repairs'), true);
reset role;
select is((select count(*) from private.pnl_lines where category_id = pg_temp.lid('repairs') and in_pnl), 0::bigint,
  'M1 the keep-out took effect on every Repairs row');
select is(pg_temp.diff_rows(), 0::bigint, 'M1 category kept out: shadow equals rules');
select tests.authenticate_as('lr_owner');
select public.set_category_excluded_from_pnl(pg_temp.lid('repairs'), false);
reset role;
select is(pg_temp.diff_rows(), 0::bigint, 'M1 category counted again: shadow equals rules');

-- M2 per-line overrides: out, in on a kept-out category, cleared.
select tests.authenticate_as('lr_owner');
select public.set_transaction_pnl(pg_temp.tid('plain_inc'), false);
select public.set_transaction_pnl(pg_temp.tid('kept_exp'), true);
reset role;
select is((select bool_and(in_pnl) from private.pnl_lines where transaction_id = pg_temp.tid('kept_exp')), true,
  'M2 the override counts the kept-out line');
select is(pg_temp.diff_rows(), 0::bigint, 'M2 overrides out and in: shadow equals rules');
select tests.authenticate_as('lr_owner');
select public.set_transaction_pnl(pg_temp.tid('plain_inc'), null);
select public.set_transaction_pnl(pg_temp.tid('kept_exp'), null);
reset role;
select is(pg_temp.diff_rows(), 0::bigint, 'M2 overrides cleared: shadow equals rules');

-- M3 a loan split flagged for review falls back to the whole line, then the review is cleared.
insert into lr_seen values ('loan', pg_temp.rules('loan'));
update public.loan_splits set needs_review = true where transaction_id = pg_temp.tid('loan') and part = 'interest';
select isnt(pg_temp.rules('loan'), (select v from lr_seen where label = 'loan'), 'M3 the flagged split falls back');
select is(pg_temp.diff_rows(), 0::bigint, 'M3 loan split flagged: shadow equals rules');
-- No client grant: called as the owner's session, without the client role.
select tests.authenticate_as('lr_owner');
reset role;
select public.clear_loan_split_review(pg_temp.tid('loan'));
select is(pg_temp.diff_rows(), 0::bigint, 'M3 loan split review cleared: shadow equals rules');

-- M4 a sync changes the loan line's amount (the stale trigger flags the split), then adds VAT.
update public.transactions set amount_net = -10100, amount_gross = -10100, amount_original = 10100
where id = pg_temp.tid('loan');
select is(pg_temp.diff_rows(), 0::bigint, 'M4 loan line amount changed (split stale): shadow equals rules');
update public.transactions set amount_net = -10000, amount_gross = -10000, amount_original = 10000
where id = pg_temp.tid('loan');
update public.loan_splits set needs_review = false where transaction_id = pg_temp.tid('loan');
update public.transactions set amount_gross = -10100, vat_amount = -100, amount_original = 10100
where id = pg_temp.tid('loan');
select is((select bool_and(loan_split_fallback) from private.pnl_lines where transaction_id = pg_temp.tid('loan')), true,
  'M4 a loan line with VAT falls back to its own category');
select is(pg_temp.diff_rows(), 0::bigint, 'M4 loan line with VAT: shadow equals rules');
update public.transactions set amount_gross = -10000, vat_amount = 0, amount_original = 10000
where id = pg_temp.tid('loan');

-- M5 a line split invalidated by a sync amount change, then restored.
insert into lr_seen values ('split', pg_temp.rules('split'));
update public.transactions set amount_net = -8100, amount_gross = -8100, amount_original = 8100
where id = pg_temp.tid('split');
select isnt(pg_temp.rules('split'), (select v from lr_seen where label = 'split'), 'M5 the split no longer adds up');
select is(pg_temp.diff_rows(), 0::bigint, 'M5 split invalidated by an amount change: shadow equals rules');
update public.transactions set amount_net = -8000, amount_gross = -8000, amount_original = 8000
where id = pg_temp.tid('split');
select is(pg_temp.diff_rows(), 0::bigint, 'M5 split adds up again: shadow equals rules');

-- M6 save_line_split on the overhead line: one part names a project, one keeps the line's.
select tests.authenticate_as('lr_owner');
select public.save_line_split(pg_temp.tid('overhead'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.lid('repairs'), 'project_id', pg_temp.lid('north'), 'amount_minor', 3000),
  jsonb_build_object('category_id', pg_temp.lid('closing'), 'amount_minor', 1000)));
reset role;
select is((select count(*) from private.pnl_lines where transaction_id = pg_temp.tid('overhead')), 2::bigint,
  'M6 the overhead line is split in two');
select is(pg_temp.diff_rows(), 0::bigint, 'M6 save_line_split (explicit and inherited project): shadow equals rules');

-- M7 delete_category on a category a whole line and a split part use.
insert into public.categories (company_id, name, kind, sort_order, is_default)
values (pg_temp.lid('co'), 'Temp', 'expense', 91, false);
insert into lr select 'temp', id from public.categories where company_id = pg_temp.lid('co') and name = 'Temp';
update public.transactions set category_id = pg_temp.lid('temp') where id = pg_temp.tid('plain_exp');
update public.line_splits set category_id = pg_temp.lid('temp')
where transaction_id = pg_temp.tid('split') and ordinal = 2;
select is(pg_temp.diff_rows(), 0::bigint, 'M7 lines moved onto a new category: shadow equals rules');
select tests.authenticate_as('lr_owner');
select public.delete_category(pg_temp.lid('temp'));
reset role;
select is((select count(*) from public.legs where category_id = pg_temp.lid('temp')), 0::bigint,
  'M7 no leg names the deleted category');
select is(pg_temp.diff_rows(), 0::bigint, 'M7 delete_category: shadow equals rules');

-- M8 merge_category: Closing into Repairs (whole lines and split parts move).
select tests.authenticate_as('lr_owner');
select public.merge_category(pg_temp.lid('closing'), pg_temp.lid('repairs'));
reset role;
select is((select count(*) from public.legs where category_id = pg_temp.lid('closing')), 0::bigint,
  'M8 no leg names the merged category');
select is(pg_temp.diff_rows(), 0::bigint, 'M8 merge_category: shadow equals rules');

-- M9 a project is deleted: a line's project is cleared by the key (set null); delete_project on an
-- empty one.
insert into public.projects (company_id, name, status) values (pg_temp.lid('co'), 'East', 'active'), (pg_temp.lid('co'), 'West', 'active');
insert into lr select lower(name), id from public.projects where company_id = pg_temp.lid('co') and name in ('East', 'West');
update public.transactions set project_id = pg_temp.lid('east') where id = pg_temp.tid('plain_inc');
delete from public.projects where id = pg_temp.lid('east');
select is((select project_id from public.legs where transaction_id = pg_temp.tid('plain_inc') and leg_kind = 'item'), null::uuid,
  'M9 the line''s legs lose the deleted project');
select is(pg_temp.diff_rows(), 0::bigint, 'M9 project deleted under a line: shadow equals rules');
select tests.authenticate_as('lr_owner');
select public.delete_project(pg_temp.lid('west'));
reset role;
select is(pg_temp.diff_rows(), 0::bigint, 'M9 delete_project: shadow equals rules');

-- M10 set_overhead_project moves the overhead role (read at view time), and back.
select tests.authenticate_as('lr_owner');
select public.set_overhead_project(pg_temp.lid('south'));
reset role;
select is(pg_temp.diff_rows(), 0::bigint, 'M10 overhead project changed: shadow equals rules');
select tests.authenticate_as('lr_owner');
select public.set_overhead_project(pg_temp.lid('overhead'));
reset role;
select is(pg_temp.diff_rows(), 0::bigint, 'M10 overhead project back: shadow equals rules');

-- M11 allocation edits on the shared line (unassigned is read at view time).
delete from public.allocations where transaction_id = pg_temp.tid('shared');
select is((select bool_and(unassigned) from private.pnl_lines where transaction_id = pg_temp.tid('shared')), true,
  'M11 a shared line with no allocations is unassigned');
select is(pg_temp.diff_rows(), 0::bigint, 'M11 allocations removed: shadow equals rules');
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net) values
  (pg_temp.lid('co'), pg_temp.tid('shared'), pg_temp.lid('north'), 3333, -3000),
  (pg_temp.lid('co'), pg_temp.tid('shared'), pg_temp.lid('south'), 6667, -6000);
select is(pg_temp.diff_rows(), 0::bigint, 'M11 allocations added: shadow equals rules');

-- M12 a transfer match is confirmed on a line, then undone.
create temp table lr_transfer as select private.transfer_mark_line(pg_temp.lid('co'), pg_temp.tid('plain_inc')) as p;
select is((select bool_and(not in_pnl) from private.pnl_lines where transaction_id = pg_temp.tid('plain_inc')), true,
  'M12 the confirmed transfer is kept out');
select is(pg_temp.diff_rows(), 0::bigint, 'M12 transfer confirmed: shadow equals rules');
select private.transfer_restore_line(pg_temp.lid('co'), (select p from lr_transfer));
select is(pg_temp.diff_rows(), 0::bigint, 'M12 transfer undone: shadow equals rules');

-- M13 Jev fills a line in review, then the owner undoes it.
do $$ declare rid uuid; begin
  rid := pg_temp.line('jev', 'expense', -2500, 0, 'repairs', null);
  update public.transactions set category_id = null, user_assigned = false, category_assigned = false,
    pnl_role = null where id = rid;
  insert into public.review_queue (company_id, transaction_id, status, reason)
  values (pg_temp.lid('co'), rid, 'open', 'missing_category');
end $$;
select set_config('role', 'service_role', true);
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.jev_prefill(pg_temp.lid('co'), pg_temp.tid('jev'), pg_temp.lid('north'), pg_temp.lid('repairs'));
reset role;
select is((select category_id from public.transactions where id = pg_temp.tid('jev')), pg_temp.lid('repairs'),
  'M13 Jev filled the category');
select is(pg_temp.diff_rows(), 0::bigint, 'M13 jev_prefill: shadow equals rules');
select tests.authenticate_as('lr_owner');
select public.undo_jev_prefill(pg_temp.tid('jev'));
reset role;
select is(pg_temp.diff_rows(), 0::bigint, 'M13 undo_jev_prefill: shadow equals rules');

-- M14 reassign and recategorize a line.
select tests.authenticate_as('lr_owner');
select public.reassign_transaction(pg_temp.tid('plain_exp'), pg_temp.lid('north'), pg_temp.lid('proptax'));
select public.set_transaction_category(pg_temp.tid('nocat'), pg_temp.lid('proceeds'));
reset role;
select is(pg_temp.diff_rows(), 0::bigint, 'M14 reassign_transaction and set_transaction_category: shadow equals rules');

-- M15 a guessed category keeps a line out; pending, removed and back.
-- (A guessed kept-out category still counts; only category_suggested changes in this update.)
insert into lr_seen values ('kept_inc', pg_temp.rules('kept_inc'));
update public.transactions set user_assigned = false, category_assigned = false where id = pg_temp.tid('kept_inc');
update public.transactions set category_suggested = true where id = pg_temp.tid('kept_inc');
select isnt(pg_temp.rules('kept_inc'), (select v from lr_seen where label = 'kept_inc'), 'M15 the guessed kept-out category counts');
select is(pg_temp.diff_rows(), 0::bigint, 'M15 suggested category: shadow equals rules');
update public.transactions set line_status = 'pending' where id = pg_temp.tid('reversal');
update public.transactions set removed_at = now() where id = pg_temp.tid('gu_normal');
select is((select count(*) from public.legs where transaction_id in (pg_temp.tid('reversal'), pg_temp.tid('gu_normal'))), 0::bigint,
  'M15 a pending or removed line has no legs');
select is(pg_temp.diff_rows(), 0::bigint, 'M15 pending and removed lines: shadow equals rules');
update public.transactions set line_status = 'posted' where id = pg_temp.tid('reversal');
update public.transactions set removed_at = null where id = pg_temp.tid('gu_normal');
select is(pg_temp.diff_rows(), 0::bigint, 'M15 posted again: shadow equals rules');

-- M16 a category's kind changes (its rows' kind, and the gross-up part's effect, contra or normal).
insert into lr_seen values ('gu_contra', pg_temp.rules('gu_contra'));
update public.categories set kind = 'income' where id = pg_temp.lid('proptax');
select isnt(pg_temp.rules('gu_contra'), (select v from lr_seen where label = 'gu_contra'), 'M16 the kind change moved the posting rules');
select is(pg_temp.diff_rows(), 0::bigint, 'M16 category kind changed: shadow equals rules');

-- And still: every line balances with one bank leg, and the projection book_line checks still agrees.
select is(
  (select count(*) from (
     select l.transaction_id from public.legs l join public.accounts a on a.id = l.account_id
     where l.company_id = pg_temp.lid('co')
     group by l.transaction_id
     having sum(l.amount_minor) <> 0 or count(*) filter (where a.is_bank) <> 1) bad)::bigint,
  0::bigint, 'after the matrix every line balances with one bank leg');
select is(
  (select coalesce(sum(amount_net), 0) from private.legs_pnl_projection(pg_temp.lid('co')))::bigint,
  (select coalesce(sum(amount_net), 0) from private.pnl_lines where company_id = pg_temp.lid('co') and in_pnl)::bigint,
  'after the matrix the projection total equals the live P&L total');

select finish();
rollback;
