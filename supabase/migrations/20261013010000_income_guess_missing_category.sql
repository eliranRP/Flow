-- FLOW-309 (review queue follow-ups), the income reason item.
-- 1. Connector income always reported missing_project, even when its category was only the
--    sync's guess: the guessed income category fills the line (category_suggested carries the
--    guess). A posted income line with no project whose category the owner has not picked
--    (neither user_assigned nor category_assigned, as the closing update in sync_review_queue
--    reads a guess) now opens as missing_category. The relabel of a posted pending_income row
--    gives the same reason. Open rows already queued that way are relabelled once below.
-- 2. With income able to show missing_category, set_transaction_category (default p_resolve)
--    resolves that row as changed while the project is still empty, and sync does not queue a
--    line with a settled row. It now queues missing_project then, unless the picked category
--    keeps the line out of the P&L; undo_reassign removes that row when it reopens the
--    missing_category one.
-- Functions are otherwise as in 20261009220000_review_queue_followups.sql (sync_review_queue)
-- and 20261008033000_review_undo_followups.sql (set_transaction_category, undo_reassign).
-- Grants are kept by create or replace.
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
      -- FLOW-309: a guessed category with no project still waits for its category.
      when t.project_id is null and not t.user_assigned and not t.category_assigned then 'missing_category'
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
      when t.project_id is null and not t.user_assigned and not t.category_assigned then 'missing_category'
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

create or replace function public.set_transaction_category(p_id uuid, p_category_id uuid, p_resolve boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  direction public.txn_direction;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_cat_assigned boolean;
  prior_shares jsonb;
  cat_kind text;
  prior_review uuid;
  undo_id uuid;
  prior_kind text;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select t.direction, t.project_id, t.category_id, t.pnl_role, t.user_assigned, t.category_suggested, t.category_assigned
  into direction, prior_project, prior_category, prior_role, prior_assigned, prior_suggested, prior_cat_assigned
  from public.transactions t
  where t.id = p_id and t.company_id = cid and t.removed_at is null
  for update;
  if direction is null then
    raise exception 'transaction not found';
  end if;
  select c.kind::text into cat_kind
  from public.categories c
  where c.id = p_category_id and c.company_id = cid;
  if cat_kind is null then
    raise exception 'category not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = p_id;

  prior_review := null;
  if p_resolve then
    select q.id into prior_review
    from public.review_queue q
    where q.transaction_id = p_id
      and q.company_id = cid
      and q.status = 'open'
      and q.reason = 'missing_category'
    order by q.created_at desc
    limit 1;
  end if;

  update public.transactions
  set category_id = p_category_id,
      category_assigned = case when p_resolve then category_assigned else true end,
      category_suggested = case when p_resolve then category_suggested else false end,
      user_assigned = case when p_resolve then true else user_assigned end
  where id = p_id and company_id = cid;

  -- Role follows the category kind, as in reassign_transaction, when the kind changes
  -- on a line filed to one project. Shared and overhead lines keep their role.
  select coalesce((
    select c.kind::text from public.categories c
    where c.id = prior_category and c.company_id = cid
  ), direction::text) into prior_kind;
  if cat_kind is distinct from prior_kind then
    if cat_kind = 'income' and prior_role = 'project' then
      update public.transactions set pnl_role = null where id = p_id and company_id = cid;
      delete from public.allocations where transaction_id = p_id and company_id = cid;
    elsif cat_kind = 'expense' and prior_role is null and prior_project is not null then
      update public.transactions set pnl_role = 'project' where id = p_id and company_id = cid;
      delete from public.allocations where transaction_id = p_id and company_id = cid;
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      select cid, p_id, prior_project, 10000, t.amount_net
      from public.transactions t where t.id = p_id and t.company_id = cid;
    end if;
  end if;

  if prior_review is not null then
    update public.review_queue
    set status = 'changed',
        resolved_at = now(),
        prior_project_id = prior_project,
        prior_category_id = prior_category,
        prior_pnl_role = prior_role,
        prior_user_assigned = prior_assigned,
        prior_category_suggested = prior_suggested,
        prior_category_assigned = prior_cat_assigned,
        prior_allocations = prior_shares
    where id = prior_review and company_id = cid;

    if prior_role = 'shared'
      and not exists (select 1 from public.allocations a where a.transaction_id = p_id)
    then
      insert into public.review_queue (company_id, transaction_id, status, reason)
      values (cid, p_id, 'open', 'unallocated_shared');
    end if;

    -- FLOW-309: income whose category was the open question still needs a project, unless
    -- the category keeps it out of the P&L. Queue that, since sync does not queue a line with a
    -- settled row.
    if direction = 'income'::public.txn_direction
      and exists (
        select 1
        from public.transactions t
        join public.categories c on c.id = t.category_id and c.company_id = t.company_id
        where t.id = p_id and t.company_id = cid
          and t.project_id is null
          and c.kind = 'income'::public.category_kind
          and not coalesce(c.excluded_from_pnl, false)
      )
    then
      insert into public.review_queue (company_id, transaction_id, status, reason)
      values (cid, p_id, 'open', 'missing_project');
    end if;
  end if;

  insert into public.reassign_undo (
    company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
    prior_user_assigned, prior_category_suggested, prior_category_assigned, prior_allocations, prior_review_id
  ) values (
    cid, p_id, prior_project, prior_category, prior_role,
    coalesce(prior_assigned, false), prior_suggested, prior_cat_assigned, prior_shares, prior_review
  )
  returning id into undo_id;
  return undo_id;
end;
$function$;

create or replace function public.undo_reassign(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  txn uuid;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_cat_assigned boolean;
  prior_shares jsonb;
  review_id uuid;
  item jsonb;
  updated int;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select u.transaction_id, u.prior_project_id, u.prior_category_id, u.prior_pnl_role,
         u.prior_user_assigned, u.prior_category_suggested, u.prior_allocations, u.prior_review_id,
         u.prior_category_assigned
  into txn, prior_project, prior_category, prior_role, prior_assigned, prior_suggested, prior_shares, review_id,
       prior_cat_assigned
  from public.reassign_undo u
  where u.id = p_id and u.company_id = cid and u.undone_at is null
  for update;
  if txn is null then
    raise exception 'undo not found';
  end if;

  update public.transactions
  set project_id = prior_project,
      category_id = prior_category,
      pnl_role = prior_role,
      user_assigned = prior_assigned,
      category_suggested = coalesce(prior_suggested, false),
      -- The flag from before the write (FLOW-208). Older snapshots have none: a suggested or
      -- empty category was not the owner's pick, so clear the flag a write set.
      category_assigned = case
        when prior_cat_assigned is not null then prior_cat_assigned
        when coalesce(prior_suggested, false) or prior_category is null then false
        else category_assigned
      end
  where id = txn and company_id = cid;
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'transaction not found';
  end if;

  delete from public.allocations where transaction_id = txn and company_id = cid;
  delete from public.overhead where transaction_id = txn and company_id = cid;
  if prior_shares is not null and jsonb_typeof(prior_shares) = 'array' then
    for item in select value from jsonb_array_elements(prior_shares)
    loop
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      values (
        cid, txn,
        (item->>'project_id')::uuid,
        (item->>'share_bp')::integer,
        (item->>'amount_net')::bigint
      );
    end loop;
  end if;
  if prior_role = 'overhead' then
    insert into public.overhead (company_id, transaction_id) values (cid, txn);
  end if;

  if review_id is not null then
    update public.review_queue
    set status = 'open',
        resolved_at = null
    where id = review_id and company_id = cid and status = 'changed';

    if prior_role = 'shared'
      and (prior_shares is null or prior_shares = '[]'::jsonb)
      and exists (
        select 1 from public.review_queue q
        where q.id = review_id and q.company_id = cid and q.reason = 'missing_category'
      )
    then
      delete from public.review_queue q
      where q.id = (
        select q2.id
        from public.review_queue q2
        where q2.company_id = cid
          and q2.transaction_id = txn
          and q2.status = 'open'
          and q2.reason = 'unallocated_shared'
        order by q2.created_at desc
        limit 1
      );
    end if;

    -- FLOW-309: the missing_project row set_transaction_category queued for income goes with
    -- the category it followed.
    if exists (
      select 1
      from public.review_queue q
      join public.transactions t on t.id = q.transaction_id and t.company_id = q.company_id
      where q.id = review_id and q.company_id = cid and q.status = 'open'
        and q.reason = 'missing_category'
        and t.direction = 'income'::public.txn_direction
    ) then
      delete from public.review_queue q
      where q.id = (
        select q2.id
        from public.review_queue q2
        where q2.company_id = cid
          and q2.transaction_id = txn
          and q2.id <> review_id
          and q2.status = 'open'
          and q2.reason = 'missing_project'
        order by q2.created_at desc
        limit 1
      );
    end if;
  end if;

  update public.reassign_undo
  set undone_at = now()
  where id = p_id and company_id = cid;
end;
$function$;

-- 1, for rows already open: connector income with no project and a guessed category waits
-- for its category, not its project. Idempotent.
update public.review_queue q
set reason = 'missing_category'
from public.transactions t
where q.transaction_id = t.id
  and q.company_id = t.company_id
  and q.status = 'open'
  and q.reason = 'missing_project'
  and private.is_connector_source(t.source)
  and t.direction = 'income'
  and t.removed_at is null
  and t.project_id is null
  and t.category_id is not null
  and not t.user_assigned
  and not t.category_assigned;

commit;
