-- FLOW-309 (review queue follow-ups), server part.
-- 1. A pending income line that posted left its open review row with a null reason. The row
--    now takes the reason the income insert gives (missing_category, missing_project or
--    suggested), or is removed when the posted line needs no review. A settled row only drops
--    the pending_income label, as before.
-- 2. A row the owner resolved as changed was queued again for income and pending income;
--    changed now counts like approved there. Open income rows the old code queued next to a
--    changed row are dropped once, at the end of this file.
-- 3. An open income row with a null reason (a settled row reopened after its line posted)
--    takes the same reason as in 1.
-- sync_review_queue is otherwise as in 20261008001000_kept_out_review_followups.sql. Grants
-- are kept by create or replace.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function public.sync_review_queue(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted integer;
  income_inserted integer := 0;
  pending_inserted integer := 0;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into public.review_queue (company_id, transaction_id, status, reason)
  select
    t.company_id,
    t.id,
    'open',
    case
      when t.pnl_role = 'shared'
        and not exists (
          select 1 from public.allocations a where a.transaction_id = t.id
        )
        then 'unallocated_shared'
      when t.category_id is null then 'missing_category'
      when coalesce(t.pnl_role, 'project') = 'project' and t.project_id is null then 'missing_project'
      else 'suggested'
    end
  from public.transactions t
  where t.company_id = p_company_id
    and private.is_connector_source(t.source)
    and t.removed_at is null
    and t.direction = 'expense'
    and (
      (
        t.pnl_role = 'shared'
        and not exists (
          select 1 from public.allocations a where a.transaction_id = t.id
        )
      )
      or t.category_id is null
      or (
        coalesce(t.pnl_role, 'project') = 'project'
        and t.project_id is null
      )
      or (t.category_suggested and not t.user_assigned)
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status = 'open'
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id
        and q.status = 'skipped'
        and q.doc_fingerprint = private.doc_fingerprint(
          t.direction::text, t.doc_kind::text, t.amount_gross, t.doc_date, t.description, t.external_id
        )
        and not exists (
          select 1 from public.review_queue newer
          where newer.transaction_id = t.id
            and newer.created_at > q.created_at
        )
    );
  get diagnostics inserted = row_count;


  insert into public.review_queue (company_id, transaction_id, status, reason)
  select
    t.company_id,
    t.id,
    'open',
    case
      when t.category_id is null then 'missing_category'
      when t.project_id is null then 'missing_project'
      else 'suggested'
    end
  from public.transactions t
  left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
  where t.company_id = p_company_id
    and private.is_connector_source(t.source)
    and t.removed_at is null
    and t.direction = 'income'
    and t.line_status = 'posted'
    and (
      -- FLOW-121: a guessed kept-out category counts, so the line waits for review like any
      -- other unfiled income until the guess is confirmed.
      (t.project_id is null
        and (t.category_id is null
          or not private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part)))
      -- FLOW-126: income that already has a project but only a guess of a kept-out category
      -- counts until the guess is confirmed, so it waits for review too. A guessed loan
      -- category is already out (line_category_out), so it is not queued (FLOW-127).
      -- user_assigned / category_assigned stay next to category_suggested: not every owner
      -- write clears category_suggested (assign_expense sets user_assigned only), and the
      -- closing update below keys on the same pair.
      or (t.project_id is not null
        and t.category_suggested
        and not t.user_assigned
        and not t.category_assigned
        and coalesce(c.excluded_from_pnl, false)
        and not private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part))
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status = 'open'
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id
        and q.status = 'skipped'
        and q.doc_fingerprint = private.doc_fingerprint(
          t.direction::text, t.doc_kind::text, t.amount_gross, t.doc_date, t.description, t.external_id
        )
        and not exists (
          select 1 from public.review_queue newer
          where newer.transaction_id = t.id
            and newer.created_at > q.created_at
        )
    )
    and not exists (
      -- A row the owner approved or changed is settled; it is not queued again (FLOW-309).
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status in ('approved', 'changed')
    );
  get diagnostics income_inserted = row_count;


  insert into public.review_queue (company_id, transaction_id, status, reason)
  select t.company_id, t.id, 'open', 'pending_income'
  from public.transactions t
  where t.company_id = p_company_id
    and private.is_connector_source(t.source)
    and t.removed_at is null
    and t.direction = 'income'
    and t.line_status = 'pending'
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status = 'open'
    )
    and not exists (
      select 1 from public.review_queue q
      where q.transaction_id = t.id
        and q.status = 'skipped'
        and q.doc_fingerprint = private.doc_fingerprint(
          t.direction::text, t.doc_kind::text, t.amount_gross, t.doc_date, t.description, t.external_id
        )
        and not exists (
          select 1 from public.review_queue newer
          where newer.transaction_id = t.id
            and newer.created_at > q.created_at
        )
    )
    and not exists (
      -- A row the owner approved or changed is settled; it is not queued again (FLOW-309).
      select 1 from public.review_queue q
      where q.transaction_id = t.id and q.status in ('approved', 'changed')
    );
  get diagnostics pending_inserted = row_count;

  -- FLOW-309: an open pending_income row whose line has posted takes the reason the income
  -- insert above would give it, or is removed when the posted line needs no review. A settled
  -- row only drops the pending label, as before. An open income row with a null reason (a
  -- settled row reopened after its line posted) takes the same reason; it is never removed.
  update public.review_queue q
  set reason = case
      when t.category_id is null then 'missing_category'
      when t.project_id is null then 'missing_project'
      else 'suggested'
    end
  from public.transactions t
  left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
    and (q.reason = 'pending_income' or q.reason is null)
    and private.is_connector_source(t.source)
    and t.direction = 'income'
    and t.line_status = 'posted'
    and t.removed_at is null
    -- Same as the income insert: a line with a settled row is not queued, so an open row
    -- the old code queued after a changed row is removed below, not relabelled.
    and not exists (
      select 1 from public.review_queue s
      where s.transaction_id = t.id and s.status in ('approved', 'changed')
    )
    and (
      (t.project_id is null
        and (t.category_id is null
          or not private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part)))
      or (t.project_id is not null
        and t.category_suggested
        and not t.user_assigned
        and not t.category_assigned
        and coalesce(c.excluded_from_pnl, false)
        and not private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part))
    );

  delete from public.review_queue q
  using public.transactions t
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
    and q.reason = 'pending_income'
    and t.line_status = 'posted'
    and t.removed_at is null;

  update public.review_queue q
  set reason = null
  from public.transactions t
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status <> 'open'
    and q.reason = 'pending_income'
    and t.line_status = 'posted'
    and t.removed_at is null;

  delete from public.review_queue q
  using public.transactions t
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
    and (t.line_status = 'void' or t.removed_at is not null);

  update public.transactions t
  set category_suggested = true
  from public.review_queue q
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
    and t.company_id = p_company_id
    and t.direction = 'income'
    and not t.user_assigned
    and not t.category_assigned;

  return inserted + income_inserted + pending_inserted;
end;
$$;


-- The old code queued settled connector income again after a changed row. Drop those open
-- rows now; a later sync no longer adds them. Only reasons the income sync gives, and only
-- rows newer than the settled row: a split_mismatch or unallocated_shared row may sit next
-- to a settled row on purpose, and an undo or reopen moves the settled row itself to open.
-- A line the old code already left with two settled rows can lose one the owner reopened
-- before this ran; only lines the old re-queue touched can reach that.
delete from public.review_queue q
using public.transactions t
where q.transaction_id = t.id
  and q.status = 'open'
  and (q.reason is null
    or q.reason in ('pending_income', 'missing_category', 'missing_project', 'suggested'))
  and private.is_connector_source(t.source)
  and t.direction = 'income'
  and exists (
    select 1 from public.review_queue s
    where s.transaction_id = q.transaction_id
      and s.status in ('approved', 'changed')
      and s.created_at < q.created_at
  );

commit;
