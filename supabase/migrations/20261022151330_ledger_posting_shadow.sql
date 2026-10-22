-- FLOW-951. Posting from rules + a shadow P&L over the legs. Decision 0209 (builds on 0208).
--
-- The live P&L does not change: private.pnl_lines and every consumer are untouched. This migration
-- makes the legs able to reproduce private.pnl_lines row for row, and proves it before it commits:
--   1. private.pnl_lines_legacy: today's pnl_lines body (the "posting rules"), plus one trailing
--      column project_explicit (a split part named its own project). service_role only. The legs are
--      compiled from it, so PR 2 (FLOW-952) can point pnl_lines at the legs without a cycle.
--   2. New additive columns on public.legs: leg_kind ('bank' | 'vat' | 'item'), category_id (the
--      category the person sees, kept on a kept-out leg too; deferrable composite FK), part,
--      gross_up, loan_split_fallback, project_explicit. One item leg per legacy row, no aggregation.
--   3. private.kept_out_account(company, category, loan_part): today's kept-out routing (principal ->
--      Loan principal, escrow -> Escrow, else Suspense), in one place PR 3 can widen.
--   4. private.rebuild_legs_many(company, uuid[]): set-based posting (one delete, one insert);
--      private.rebuild_legs(company, txn) calls it.
--   5. Trigger hygiene: the transactions update trigger recompiles only the lines whose posting
--      columns changed (old/new transition tables); inserts and child-table changes post set-based;
--      the categories trigger (FLOW-950's legs_category_sync) posts set-based; the allocation
--      triggers go (allocations are read at view time); the transactions delete trigger goes (the
--      legs' FK cascade removes them).
--   6. private.pnl_lines_ledger: the same 19 columns, in pnl_lines' order, from item legs + the
--      transactions header (direction, doc kind, dates, currency, line net, pnl_role, unpaid) +
--      categories (kind) + companies (overhead project) + allocations (unassigned), read at view
--      time so a header edit can never leave it stale. service_role only.
--   7. private.ledger_pnl_diff(company): pnl_lines_legacy EXCEPT ALL pnl_lines_ledger both ways,
--      over all 19 columns, kept-out rows included. Definer, service_role only.
--   8. Backfill every posted line set-based, then a gate: any company with a non-empty diff aborts
--      the migration, so nothing is applied unless the shadow equals the live P&L everywhere.
--
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. private.pnl_lines_legacy — the posting rules. Byte-for-byte the body of private.pnl_lines
--    (20261022093629_gross_up_contra_effect.sql) plus the trailing project_explicit column.
-- ---------------------------------------------------------------------------
create view private.pnl_lines_legacy
with (security_invoker = true) as
select
  t.company_id,
  t.id as transaction_id,
  t.project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and t.pnl_role = 'project' and t.project_id is not null
      and t.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    else t.pnl_role
  end as pnl_role,
  t.direction,
  t.doc_kind,
  t.doc_date,
  t.cash_date,
  coalesce(t.currency, 'ILS') as currency,
  s.category_id,
  s.part,
  case when t.direction = 'expense' then -s.amount_minor else s.amount_minor end as amount_net,
  t.amount_net as line_amount_net,
  -- By parts: a loan line, so its parts decide and the override does not apply.
  private.line_in_pnl(null, c.excluded_from_pnl, c.loan_part) as in_pnl,
  false as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then t.project_id is null
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind,
  private.line_unpaid(t.direction, t.doc_kind, t.cash_date) as unpaid,
  false as gross_up,
  -- FLOW-951: never an explicit project (the loan split keeps the line's).
  false as project_explicit
from public.transactions t
join public.loan_splits s on s.transaction_id = t.id
join lateral (
  select
    count(*) as parts,
    sum(x.amount_minor) as parts_minor,
    bool_or(x.needs_review) as flagged
  from public.loan_splits x
  where x.transaction_id = t.id
) sp on sp.parts in (3, 4) and not sp.flagged
  and sp.parts_minor = abs(t.amount_net)
left join public.categories c on c.id = s.category_id
left join public.companies co on co.id = t.company_id
where t.removed_at is null
  and t.line_status = 'posted'
  and t.vat_amount = 0
union all
select
  t.company_id,
  t.id as transaction_id,
  coalesce(s.project_id, t.project_id) as project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and s.project_id is not null
      and s.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    when coalesce(c.kind::text, t.direction::text) = 'expense' and s.project_id is not null
      then 'project'::public.pnl_role
    when coalesce(c.kind::text, t.direction::text) = 'expense' and t.pnl_role = 'project' and t.project_id is not null
      and t.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    else t.pnl_role
  end as pnl_role,
  t.direction,
  t.doc_kind,
  t.doc_date,
  t.cash_date,
  coalesce(t.currency, 'ILS') as currency,
  s.category_id,
  null::public.loan_split_part as part,
  -- A gross_up part is a real item of its category's kind, unless it is a CONTRA part (its
  -- category kind equals the line direction), which reduces its own category and so flips. A
  -- refund part (not gross_up) keeps the line's sign.
  case
    when s.gross_up then
      (case when coalesce(c.kind::text, t.direction::text) = 'expense' then -s.amount_minor else s.amount_minor end)
        * (case when coalesce(c.kind::text, t.direction::text) = t.direction::text then -1 else 1 end)
    else
      case when t.direction = 'expense' then -s.amount_minor else s.amount_minor end
  end as amount_net,
  t.amount_net as line_amount_net,
  private.line_in_pnl(t.in_pnl_override, c.excluded_from_pnl, c.loan_part) as in_pnl,
  false as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then coalesce(s.project_id, t.project_id) is null
    when s.project_id is not null then false
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind,
  private.line_unpaid(t.direction, t.doc_kind, t.cash_date) as unpaid,
  s.gross_up,
  -- FLOW-951: the part named its own project (drives project_id, pnl_role and unassigned).
  s.project_id is not null as project_explicit
from public.transactions t
join public.line_splits s on s.transaction_id = t.id
join lateral (
  select
    count(*) as parts,
    sum(case when x.gross_up then -x.amount_minor else x.amount_minor end) as parts_minor
  from public.line_splits x
  where x.transaction_id = t.id
) lp on lp.parts >= 2
  and lp.parts_minor = abs(t.amount_net)
left join public.categories c on c.id = s.category_id
left join public.companies co on co.id = t.company_id
where t.removed_at is null
  and t.line_status = 'posted'
  and not exists (select 1 from public.loan_splits ls where ls.transaction_id = t.id)
union all
select
  t.company_id,
  t.id as transaction_id,
  t.project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and t.pnl_role = 'project' and t.project_id is not null
      and t.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    else t.pnl_role
  end as pnl_role,
  t.direction,
  t.doc_kind,
  t.doc_date,
  t.cash_date,
  coalesce(t.currency, 'ILS') as currency,
  t.category_id,
  null::public.loan_split_part as part,
  t.amount_net,
  t.amount_net as line_amount_net,
  -- A line with a loan split stays fixed, even when it falls back to its own category.
  private.line_in_pnl(
    case when coalesce(sp.parts, 0) = 0 then t.in_pnl_override end,
    private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
    c.loan_part
  ) as in_pnl,
  coalesce(sp.parts, 0) > 0 as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then t.project_id is null
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind,
  private.line_unpaid(t.direction, t.doc_kind, t.cash_date) as unpaid,
  false as gross_up,
  false as project_explicit
from public.transactions t
left join public.categories c on c.id = t.category_id
left join public.companies co on co.id = t.company_id
left join (
  select x.company_id, x.transaction_id,
    count(*) as parts,
    sum(x.amount_minor) as parts_minor,
    bool_or(x.needs_review) as flagged
  from public.loan_splits x
  group by x.company_id, x.transaction_id
) sp on sp.company_id = t.company_id and sp.transaction_id = t.id
left join (
  select x.company_id, x.transaction_id,
    count(*) as parts,
    sum(case when x.gross_up then -x.amount_minor else x.amount_minor end) as parts_minor
  from public.line_splits x
  group by x.company_id, x.transaction_id
) lp on lp.company_id = t.company_id and lp.transaction_id = t.id
where t.removed_at is null
  and t.line_status = 'posted'
  and (
    coalesce(sp.parts, 0) = 0 or sp.parts not in (3, 4) or sp.flagged or t.vat_amount <> 0
    or sp.parts_minor <> abs(t.amount_net)
  )
  and (
    coalesce(sp.parts, 0) > 0 or coalesce(lp.parts, 0) < 2
    or lp.parts_minor <> abs(t.amount_net)
  );


comment on view private.pnl_lines_legacy is
  'FLOW-951 (decision 0209). The P&L posting rules: private.pnl_lines'' body plus project_explicit. '
  'private.rebuild_legs_many compiles the legs from it; private.ledger_pnl_diff compares it with '
  'private.pnl_lines_ledger. service_role only.';

revoke all on private.pnl_lines_legacy from public, anon, authenticated;
grant select on private.pnl_lines_legacy to service_role;

-- ---------------------------------------------------------------------------
-- 2. New leg columns (additive). Filled for every leg by the backfill below, then constrained.
-- ---------------------------------------------------------------------------
alter table public.legs
  add column leg_kind text,
  add column category_id uuid,
  add column part public.loan_split_part,
  add column gross_up boolean not null default false,
  add column loan_split_fallback boolean not null default false,
  add column project_explicit boolean not null default false;

-- The category the person sees, also on a kept-out leg. Deferred, so delete_category and
-- merge_category move the lines (and the triggers re-post them) before the check runs at commit.
alter table public.legs
  add constraint legs_company_id_category_id_fkey
  foreign key (company_id, category_id) references public.categories (company_id, id)
  deferrable initially deferred;

comment on column public.legs.leg_kind is
  'bank (the statement movement), vat (the VAT-control leg) or item (one per P&L posting row).';
comment on column public.legs.category_id is
  'The category the person sees for an item leg, kept even when the leg is routed to a kept-out account.';
comment on column public.legs.project_explicit is
  'The split part named its own project; otherwise the line''s project applies (read at view time).';

-- ---------------------------------------------------------------------------
-- 3. Kept-out routing.
-- ---------------------------------------------------------------------------
-- The system account a kept-out posting row goes to: by the category's loan part (principal -> Loan
-- principal, escrow -> Escrow), else Suspense. p_loan_part is the category's loan part; when null the
-- category is read. PR 3 (FLOW-953) widens this with a category's own ledger account.
create or replace function private.kept_out_account(p_company uuid, p_category uuid, p_loan_part public.loan_split_part)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select a.id
  from public.accounts a
  where a.company_id = p_company
    and a.category_id is null
    and a.name = case coalesce(p_loan_part,
                                (select c.loan_part from public.categories c
                                 where c.id = p_category and c.company_id = p_company))
                   when 'principal' then 'Loan principal'
                   when 'escrow' then 'Escrow'
                   else 'Suspense'
                 end;
$$;

revoke all on function private.kept_out_account(uuid, uuid, public.loan_split_part) from public, anon, authenticated;
grant execute on function private.kept_out_account(uuid, uuid, public.loan_split_part) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Posting: compile the legs of many lines of one company from the posting rules.
-- ---------------------------------------------------------------------------
-- One DELETE, then one INSERT for all the lines, so the deferred balance invariant only ever sees
-- complete, balanced sets. A pending or removed line (no posting rows) is left with no legs. One item
-- leg per pnl_lines_legacy row: in-P&L -> the category's bridge account (or Uncategorized income /
-- expense); kept out -> private.kept_out_account. The ordinal rule is FLOW-948's, so book_line's
-- undo fingerprint of an existing line does not move.
create or replace function private.rebuild_legs_many(p_company uuid, p_txns uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_company is null or coalesce(cardinality(p_txns), 0) = 0 then
    return;
  end if;

  delete from public.legs where company_id = p_company and transaction_id = any (p_txns);

  insert into public.legs (company_id, transaction_id, account_id, project_id, amount_minor, ordinal,
    leg_kind, category_id, part, gross_up, loan_split_fallback, project_explicit)
  with lines as (
    select t.id, t.amount_gross, t.vat_amount
    from public.transactions t
    where t.company_id = p_company and t.id = any (p_txns)
      and t.removed_at is null and t.line_status = 'posted'
  ),
  sys as (
    select
      (array_agg(id) filter (where name = 'Bank/Clearing'))[1] as bank,
      (array_agg(id) filter (where name = 'VAT control'))[1] as vat,
      (array_agg(id) filter (where name = 'Uncategorized income'))[1] as uinc,
      (array_agg(id) filter (where name = 'Uncategorized expense'))[1] as uexp
    from public.accounts
    where company_id = p_company and category_id is null
  ),
  entries as (
    select
      l.transaction_id,
      case
        when l.in_pnl and l.kind in ('income', 'expense') then
          case
            when l.category_id is not null then ba.id
            when l.kind = 'income' then sys.uinc
            else sys.uexp
          end
        else private.kept_out_account(p_company, l.category_id, c.loan_part)
      end as account_id,
      l.project_id,
      -l.amount_net as amount_minor,
      0 as grp,
      l.category_id as k1, l.project_id as k2, l.amount_net as k3,
      'item' as leg_kind, l.category_id, l.part, l.gross_up, l.loan_split_fallback, l.project_explicit
    from private.pnl_lines_legacy l
    left join public.categories c on c.id = l.category_id
    left join public.accounts ba on ba.company_id = p_company and ba.category_id = l.category_id
    cross join sys
    where l.company_id = p_company and l.transaction_id = any (p_txns)
    union all
    -- The bank leg: the signed statement movement = amount_gross.
    select x.id, sys.bank, null, x.amount_gross, 1, null, null, null,
      'bank', null, null, false, false, false
    from lines x cross join sys
    union all
    -- VAT is one more leg so the net + VAT legs balance the gross bank movement.
    select x.id, sys.vat, null, -x.vat_amount, 2, null, null, null,
      'vat', null, null, false, false, false
    from lines x cross join sys
    where coalesce(x.vat_amount, 0) <> 0
  )
  select p_company, e.transaction_id, e.account_id, e.project_id, e.amount_minor,
    (row_number() over (partition by e.transaction_id
                        order by e.grp, e.k1 nulls first, e.k2 nulls first, e.k3))::smallint,
    e.leg_kind, e.category_id, e.part, e.gross_up, e.loan_split_fallback, e.project_explicit
  from entries e;
end;
$$;

revoke all on function private.rebuild_legs_many(uuid, uuid[]) from public, anon, authenticated;
grant execute on function private.rebuild_legs_many(uuid, uuid[]) to service_role;

-- One line: the same posting.
create or replace function private.rebuild_legs(p_company uuid, p_txn uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.rebuild_legs_many(p_company, array[p_txn]);
$$;

revoke all on function private.rebuild_legs(uuid, uuid) from public, anon, authenticated;
grant execute on function private.rebuild_legs(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Triggers: post set-based, and only what changed.
-- ---------------------------------------------------------------------------
-- New lines (one statement may insert many, e.g. upsert_connector_lines): one posting per company.
create or replace function private.legs_sync_txn_new()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in select n.company_id, array_agg(distinct n.id) as txns from newtab n group by n.company_id loop
    perform private.rebuild_legs_many(r.company_id, r.txns);
  end loop;
  return null;
end;
$$;

-- Updated lines: only those whose posting columns changed. Everything else the shadow view reads from
-- the header at read time (doc kind, dates, currency, pnl_role, unpaid, cash override, description).
create or replace function private.legs_sync_txn_upd()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in
    select n.company_id, array_agg(distinct n.id) as txns
    from newtab n
    join oldtab o on o.id = n.id
    where (n.amount_net, n.amount_gross, n.vat_amount, n.direction, n.category_id, n.category_suggested,
           n.project_id, n.in_pnl_override, n.line_status, n.removed_at, n.company_id)
      is distinct from
          (o.amount_net, o.amount_gross, o.vat_amount, o.direction, o.category_id, o.category_suggested,
           o.project_id, o.in_pnl_override, o.line_status, o.removed_at, o.company_id)
    group by n.company_id
  loop
    perform private.rebuild_legs_many(r.company_id, r.txns);
  end loop;
  return null;
end;
$$;

-- Child tables (line_splits / loan_splits) carry transaction_id + company_id.
create or replace function private.legs_sync_child_new()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in select n.company_id, array_agg(distinct n.transaction_id) as txns from newtab n group by n.company_id loop
    perform private.rebuild_legs_many(r.company_id, r.txns);
  end loop;
  return null;
end;
$$;

create or replace function private.legs_sync_child_old()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  for r in select o.company_id, array_agg(distinct o.transaction_id) as txns from oldtab o group by o.company_id loop
    perform private.rebuild_legs_many(r.company_id, r.txns);
  end loop;
  return null;
end;
$$;

revoke all on function private.legs_sync_txn_upd() from public, anon, authenticated;

drop trigger legs_txn_upd on public.transactions;
create trigger legs_txn_upd after update on public.transactions
  referencing old table as oldtab new table as newtab
  for each statement execute function private.legs_sync_txn_upd();

-- The legs' FK to transactions cascades on delete, so a deleted line's legs already go with it.
drop trigger legs_txn_del on public.transactions;
drop function private.legs_sync_txn_old();

-- Allocations only decide pnl_lines.unassigned, which the shadow view reads at view time.
drop trigger legs_alloc_ins on public.allocations;
drop trigger legs_alloc_upd on public.allocations;
drop trigger legs_alloc_del on public.allocations;

-- FLOW-950's categories trigger, posting the category's lines in one call.
create or replace function private.legs_category_sync_tg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.accounts a
  set name = new.name,
      type = new.kind::text,
      loan_part = new.loan_part,
      excluded_from_pnl = coalesce(new.excluded_from_pnl, false)
  where a.company_id = new.company_id and a.category_id = new.id
    and (a.name, a.type, a.loan_part, a.excluded_from_pnl)
      is distinct from (new.name, new.kind::text, new.loan_part, coalesce(new.excluded_from_pnl, false));

  if new.kind is distinct from old.kind
    or new.excluded_from_pnl is distinct from old.excluded_from_pnl
    or new.loan_part is distinct from old.loan_part
  then
    perform private.rebuild_legs_many(new.company_id, array(
      select t.id from public.transactions t
      where t.company_id = new.company_id and t.category_id = new.id
      union
      select s.transaction_id from public.line_splits s
      where s.company_id = new.company_id and s.category_id = new.id
      union
      select s.transaction_id from public.loan_splits s
      where s.company_id = new.company_id and s.category_id = new.id
    ));
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Backfill: re-post every posted line (and any line that still has legs), set-based per company.
-- ---------------------------------------------------------------------------
select private.rebuild_legs_many(x.company_id, array_agg(x.txn))
from (
  select t.company_id, t.id as txn
  from public.transactions t
  where t.removed_at is null and t.line_status = 'posted'
  union
  select l.company_id, l.transaction_id
  from public.legs l
) x
group by x.company_id;

-- Run the deferred balance and category checks for the backfilled legs now (an ALTER TABLE cannot
-- run with trigger events pending); a failing check aborts the migration here.
set constraints all immediate;

alter table public.legs
  alter column leg_kind set not null,
  add constraint legs_leg_kind_check check (leg_kind in ('bank', 'vat', 'item')),
  add constraint legs_item_shape check (
    leg_kind = 'item' or (category_id is null and part is null and not gross_up
                          and not loan_split_fallback and not project_explicit));

-- A leg written without a kind (a direct insert, not the posting) takes it from its account: the bank
-- account is 'bank', VAT control 'vat', anything else 'item'. Posting always sets it, so the WHEN
-- clause keeps this off the posting path.
create or replace function private.legs_fill_kind_tg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select case when a.is_bank then 'bank' when a.category_id is null and a.name = 'VAT control' then 'vat' else 'item' end
  into new.leg_kind
  from public.accounts a
  where a.company_id = new.company_id and a.id = new.account_id;
  return new;
end;
$$;

revoke all on function private.legs_fill_kind_tg() from public, anon, authenticated;

create trigger legs_fill_kind
  before insert on public.legs
  for each row when (new.leg_kind is null) execute function private.legs_fill_kind_tg();

-- Indexes: the FK (decision 0195), the shadow view's item legs by line, and project prefilters.
create index legs_company_id_category_id_fk_idx
  on public.legs (company_id, category_id) where category_id is not null;
create index legs_item_txn_idx on public.legs (company_id, transaction_id) where leg_kind = 'item';
create index legs_item_project_idx on public.legs (company_id, project_id) where leg_kind = 'item';

-- ---------------------------------------------------------------------------
-- 7. private.pnl_lines_ledger — the shadow P&L: pnl_lines' 19 columns, in order, from the legs.
-- ---------------------------------------------------------------------------
-- Per item leg: amount_net = -amount_minor; in_pnl = the account is income/expense (kept-out legs
-- sit on asset/liability accounts); kind = the category's kind, else the line's direction; the
-- project is the part's own when project_explicit, else the line's; pnl_role and unassigned are
-- pnl_lines' three branches folded into one expression. The header, the category kind, the overhead
-- project and the allocations are read here, at view time.
create view private.pnl_lines_ledger
with (security_invoker = true) as
select
  l.company_id,
  l.transaction_id,
  case when l.project_explicit then l.project_id else t.project_id end as project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and l.project_explicit
      and l.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    when coalesce(c.kind::text, t.direction::text) = 'expense' and l.project_explicit
      then 'project'::public.pnl_role
    when coalesce(c.kind::text, t.direction::text) = 'expense' and t.pnl_role = 'project' and t.project_id is not null
      and t.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    else t.pnl_role
  end as pnl_role,
  t.direction,
  t.doc_kind,
  t.doc_date,
  t.cash_date,
  coalesce(t.currency, 'ILS') as currency,
  l.category_id,
  l.part,
  -l.amount_minor as amount_net,
  t.amount_net as line_amount_net,
  a.type in ('income', 'expense') as in_pnl,
  l.loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income'
      then (case when l.project_explicit then l.project_id else t.project_id end) is null
    when l.project_explicit then false
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations x where x.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind,
  private.line_unpaid(t.direction, t.doc_kind, t.cash_date) as unpaid,
  l.gross_up
from public.legs l
join public.transactions t on t.company_id = l.company_id and t.id = l.transaction_id
join public.accounts a on a.company_id = l.company_id and a.id = l.account_id
left join public.categories c on c.id = l.category_id
left join public.companies co on co.id = l.company_id
where l.leg_kind = 'item'
  and t.removed_at is null
  and t.line_status = 'posted';

comment on view private.pnl_lines_ledger is
  'FLOW-951 (decision 0209). The shadow P&L: private.pnl_lines'' 19 columns from the item legs and the '
  'transactions header. Must equal private.pnl_lines_legacy (private.ledger_pnl_diff). service_role only '
  'until FLOW-952 points private.pnl_lines at it.';

revoke all on private.pnl_lines_ledger from public, anon, authenticated;
grant select on private.pnl_lines_ledger to service_role;

-- ---------------------------------------------------------------------------
-- 8. The diff, both ways, over all 19 columns (kept-out rows included).
-- ---------------------------------------------------------------------------
create or replace function private.ledger_pnl_diff(p_company uuid)
returns table (
  side text,
  company_id uuid,
  transaction_id uuid,
  project_id uuid,
  pnl_role public.pnl_role,
  direction public.txn_direction,
  doc_kind public.doc_kind,
  doc_date date,
  cash_date date,
  currency text,
  category_id uuid,
  part public.loan_split_part,
  amount_net bigint,
  line_amount_net bigint,
  in_pnl boolean,
  loan_split_fallback boolean,
  unassigned boolean,
  kind text,
  unpaid boolean,
  gross_up boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with legacy as (
    select g.company_id, g.transaction_id, g.project_id, g.pnl_role, g.direction, g.doc_kind, g.doc_date,
      g.cash_date, g.currency, g.category_id, g.part, g.amount_net, g.line_amount_net, g.in_pnl,
      g.loan_split_fallback, g.unassigned, g.kind, g.unpaid, g.gross_up
    from private.pnl_lines_legacy g
    where g.company_id = p_company
  ),
  ledger as (
    select * from private.pnl_lines_ledger d where d.company_id = p_company
  )
  select 'legacy_only', x.* from (select * from legacy except all select * from ledger) x
  union all
  select 'ledger_only', y.* from (select * from ledger except all select * from legacy) y;
$$;

revoke all on function private.ledger_pnl_diff(uuid) from public, anon, authenticated;
grant execute on function private.ledger_pnl_diff(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 9. The gate: the shadow must equal the posting rules for every company, or nothing is applied.
-- ---------------------------------------------------------------------------
do $gate$
declare
  bad integer;
  rows_off bigint;
begin
  select count(distinct c.id), count(d.*) into bad, rows_off
  from public.companies c
  cross join lateral private.ledger_pnl_diff(c.id) d;
  if bad > 0 then
    raise exception 'FLOW-951 gate: pnl_lines_ledger differs from pnl_lines_legacy for % compan(y/ies), % row(s)',
      bad, rows_off;
  end if;
end
$gate$;

commit;
