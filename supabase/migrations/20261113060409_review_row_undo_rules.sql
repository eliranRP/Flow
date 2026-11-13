-- FLOW-1166 part 4 (decision 0266; the owner's decisions of 2026-11-13): one open review row per line,
-- what closed a skipped row, a late undo of a filing refused once the line changed, and the invitee's
-- undo of a decline refused once the invite expired.
--
-- A. One open review row per line ("Keep the newer card"). Every statement that inserts into
--    review_queue or sets status = 'open' was traced in the schema as it stands after part 3:
--    - Reopen with no check for another open row (the two paths part 3 found): reopen_review (a skip
--      and an approval or change alike) and undo_reassign (a 'changed' row). Both now reopen only when
--      no other row of the line is open; otherwise the undo still succeeds (the filing comes back) and
--      the newer row is the card shown. A skip stays skipped. An approved or changed row whose filing
--      came back is deleted (private.review_undone_row): kept, sync_review_queue's income insert would
--      read it as settled and never queue the unfiled line again once the newer row went. An invoice's
--      paired receipts go back first (private.unfollow_invoice_row), as review_receipt_pairing does
--      when the row reopens instead. An open split_mismatch row gives way,
--      as it did before: the trigger review_queue_line_split_review deleted it after such a reopen, and
--      line_split_review_sync queues it again whenever the line has no other open row. That deletion
--      now runs before the reopen (private.review_may_reopen), and the trigger's branch, which the
--      index below makes unreachable, goes. The results keep their shape: both return void, and
--      mcp_undo's data still names the write's id.
--    - Reopen with a check: private.transfer_restore_line (now one row, the newest the match set
--      aside: several rows listed could no longer all reopen) and private.undo_held_change_left.
--    - Insert guarded by "no open row" in the same statement: sync_review_queue (three inserts),
--      private.forecast_line_sync, private.line_split_review_sync, delete_category,
--      private.undo_held_change_left. Two runs at once could each pass the guard, so each insert is
--      now ON CONFLICT DO NOTHING against the new index: a sync never fails on it.
--    - Insert after closing the line's one open row: set_transaction_category (unallocated_shared,
--      missing_project). Both can fire in one call for a shared income line, so both are ON CONFLICT
--      DO NOTHING too (the first one queued is the card).
--    - Insert closed (never open): follow_invoice. Status moves to approved / changed / skipped, and
--      follow_invoice's moves between approved and changed, never make a row open. No flow-mcp
--      function writes review_queue: its undo calls reopen_review and undo_reassign (mcp_undo).
--    The index is UNIQUE (transaction_id) WHERE status = 'open'. company_id is implied by the line
--    (review_queue_company_id_transaction_id_fkey points at transactions (company_id, id), and id is
--    the key of transactions). It replaces review_queue_open_idx (company_id) WHERE status = 'open':
--    the reads by company and status are served by review_queue_company_idx (company_id, status).
--    Production has no line with two open rows (counted read-only on 2026-11-13):
--      select transaction_id from public.review_queue where status = 'open' and transaction_id is not
--      null group by 1 having count(*) > 1;
--    and the table has under 3,000 rows, so the index is built plainly. The file's ALTER TABLE ...
--    ADD COLUMN (B) already takes ACCESS EXCLUSIVE on review_queue, and every lock is held to the
--    commit, so reads and writes of review_queue wait for the rest of the file (milliseconds on a
--    table this size); lock_timeout stops the file rather than queue behind a long sync.
--
-- B. skipped_by: what closed a skipped row. The writers that set status = 'skipped':
--    - resolve_review with 'skipped': 'person' (the queue's דלג, by the owner or an editor, or the
--      assistant acting for them).
--    - replace_sumit_connection: 'sumit_switch' (the open rows of the old SUMIT company's lines).
--    - private.transfer_mark_line (answer_transfer_match): 'transfer' (a confirmed transfer pair).
--    Null when the row is not skipped (review_queue_skipped_by_chk), and null for the rows skipped
--    before this file (unknown; not guessed). The two reopen paths of a skipped row clear it.
--    Read where it removes a guess: transfer_restore_line (the undo of a transfer match) reopens a
--    row a transfer skipped, or one from before (null); a row a person skipped again since stays.
--    The other readers of a skip need no change: sync_review_queue's "do not queue again" keys on
--    the document fingerprint, which a person's skip and a transfer set and the SUMIT switch does
--    not (its lines are removed); invoice_waits and reopen_review behave the same for every kind,
--    and the app's lists are unchanged.
--
-- C. reassign_undo.written_line: the line as the filing left it, in exactly the columns undo_reassign
--    restores: on transactions project_id, category_id, pnl_role, user_assigned, category_suggested,
--    category_assigned; the line's allocations (project, share, amount); whether it has an overhead
--    row; and the parts the undo would leave on the line, its split by category and a loan payment's
--    parts (private.reassign_line_state), so a split saved or a loan payment attached since refuses
--    the undo (undo_utility_refile already refuses a refile's undo on a split). No writer writes
--    parts; a line's parts from before the filing are in the snapshot, so its undo runs at once.
--    A BEFORE INSERT trigger fills it: every writer of the table
--    (reassign_transaction, set_transaction_category, collapse_split, mcp_assign_expense_split) inserts
--    the undo row after its last write to the line, and after the review row's close, whose triggers
--    (follow_invoice on a paired receipt) have run by then; follow_invoice writes the receipts, never
--    the filed line's own columns after that. undo_reassign takes the line's lock, and when the line no
--    longer reads as written it raises 'line changed since' (the message undo_utility_refile, the Jev
--    undo and the app already use for the same cause) and restores nothing. A sync's update of other
--    columns (description, provider metadata, dates) does not block it; one that changes a restored
--    column does (an amount change moves the allocation's amount). A filing leaves the line the
--    owner's (user_assigned or category_assigned), so the sync keeps its category and does not
--    re-derive it; if anything did, the undo would be refused, since category_id is restored.
--    Undo rows written before this file have no written_line and keep today's behaviour.
--    Callers: the app (undo_reassign), undo_reassign_recurring_charge, undo_utility_refile, and
--    mcp_undo ('reassign' after its own check of private.mcp_writes, and a loan attach's project).
--    mcp_undo gives the refusal word for word as a conflict; the loan attach's undo leaves the line's
--    project as it is (project_restored false), as it already does for a line changed since. The
--    loan attach (mcp_attach_loan_payment) is the one filing that leaves parts it wrote itself: it
--    writes them before reassign_transaction, so its undo now puts the filing back before it
--    removes them (the reverse order).
--
-- D. reopen_invite: an invite whose expiry has passed is not put back to pending ('invite is not
--    declined', the function's own refusal).
--
-- Grants: each function re-created or patched below has its grants restated as its last migration
-- left them. The new private functions are closed to clients.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- Replaces each anchor (found exactly once) in a function's definition and runs the result.
create function pg_temp.patch(p_fn text, p_from text[], p_to text[])
returns void
language plpgsql
as $$
declare
  def text := pg_get_functiondef(p_fn::regprocedure);
  i integer;
begin
  for i in 1 .. cardinality(p_from) loop
    if pg_temp.anchor_count(def, p_from[i]) <> 1 then
      raise exception '% is not the expected definition (anchor %)', p_fn, i;
    end if;
    def := replace(def, p_from[i], p_to[i]);
  end loop;
  execute def;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- B. review_queue.skipped_by
-- ---------------------------------------------------------------------------------------------

alter table public.review_queue add column skipped_by text;
alter table public.review_queue
  add constraint review_queue_skipped_by_chk
  check (skipped_by is null or (status = 'skipped'::public.review_status
    and skipped_by in ('person', 'sumit_switch', 'transfer')));
comment on column public.review_queue.skipped_by is
  'FLOW-1166: what closed a skipped row: person (resolve_review), sumit_switch (replace_sumit_connection), '
  'transfer (transfer_mark_line); null when the row is not skipped, or was skipped before 2026-11-13.';

select pg_temp.patch('public.resolve_review(uuid,text,uuid,uuid,boolean,boolean)',
  array[$a$  set status = next_status,
      resolved_at = now(),$a$],
  array[$n$  set status = next_status,
      resolved_at = now(),
      skipped_by = case when next_status = 'skipped' then 'person' end,$n$]);

select pg_temp.patch('public.replace_sumit_connection(uuid,bigint,text,text,text,text,text,text,boolean)',
  array[$a$    set status = 'skipped',
        resolved_at = pg_catalog.now()$a$],
  array[$n$    set status = 'skipped',
        resolved_at = pg_catalog.now(),
        skipped_by = 'sumit_switch'$n$]);

select pg_temp.patch('private.transfer_mark_line(uuid,uuid)',
  array[$a$  set status = 'skipped',
      resolved_at = now(),$a$],
  array[$n$  set status = 'skipped',
      resolved_at = now(),
      skipped_by = 'transfer',$n$]);

-- The undo of a transfer match: the newest row the match set aside comes back, when a transfer
-- skipped it (or it was skipped before skipped_by; null) and no other row of the line is open.
create or replace function private.transfer_restore_line(p_company uuid, p jsonb)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  txn uuid := (p->>'id')::uuid;
  cat_back boolean;
begin
  select coalesce((p->>'set_category')::boolean, false)
    and t.category_id is not distinct from (p->>'written_category_id')::uuid
    and (p->>'category_id' is null or exists (
      select 1 from public.categories c where c.id = (p->>'category_id')::uuid and c.company_id = p_company))
  into cat_back
  from public.transactions t
  where t.id = txn and t.company_id = p_company
  for update;
  if not found then
    return;
  end if;
  update public.transactions t
  set category_id = case when cat_back then (p->>'category_id')::uuid else t.category_id end,
      category_suggested = case when cat_back then coalesce((p->>'category_suggested')::boolean, false) else t.category_suggested end,
      category_assigned = case when cat_back then coalesce((p->>'category_assigned')::boolean, false) else t.category_assigned end,
      user_assigned = case when cat_back then coalesce((p->>'user_assigned')::boolean, false) else t.user_assigned end,
      in_pnl_override = case when t.in_pnl_override is false then (p->>'in_pnl_override')::boolean else t.in_pnl_override end,
      in_cash_override = case when t.in_cash_override is false then (p->>'in_cash_override')::boolean else t.in_cash_override end
  where t.id = txn and t.company_id = p_company;
  -- FLOW-1166 part 4: one open row per line, so one row comes back (the newest the match set aside),
  -- and only one a transfer skipped: a row a person skipped again since stays skipped.
  update public.review_queue q
  set status = 'open',
      resolved_at = null,
      skipped_by = null
  where q.company_id = p_company
    and q.id = (
      select s.id
      from public.review_queue s
      where s.company_id = p_company
        and s.transaction_id = txn
        and s.status = 'skipped'
        and (s.skipped_by = 'transfer' or s.skipped_by is null)
        and s.id in (
          select e::uuid from jsonb_array_elements_text(
            case when jsonb_typeof(p->'reviews') = 'array' then p->'reviews' else '[]'::jsonb end) e
        )
      order by s.created_at desc, s.id desc
      limit 1
    )
    and not exists (
      select 1 from public.review_queue o
      where o.company_id = p_company and o.transaction_id = txn and o.status = 'open'
    );
end;
$function$;

revoke all on function private.transfer_restore_line(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.transfer_mark_line(uuid, uuid) from public, anon, authenticated;
revoke all on function public.resolve_review(uuid, text, uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.resolve_review(uuid, text, uuid, uuid, boolean, boolean) to authenticated, service_role;
revoke all on function public.replace_sumit_connection(uuid, bigint, text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.replace_sumit_connection(uuid, bigint, text, text, text, text, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------
-- A. One open row per line
-- ---------------------------------------------------------------------------------------------

-- Whether row p_row of the line may reopen: no other row of the line is open. An open split_mismatch
-- row gives way first, as review_queue_line_split_review did after such a reopen (it comes back when
-- the line next has no other open row). The caller holds the line's lock.
create function private.review_may_reopen(p_company uuid, p_txn uuid, p_row uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.review_queue q
  where q.company_id = p_company
    and q.transaction_id = p_txn
    and q.status = 'open'
    and q.reason = 'split_mismatch'
    and q.id <> p_row
    and not exists (
      select 1 from public.review_queue o
      where o.company_id = p_company and o.transaction_id = p_txn and o.status = 'open'
        and o.reason is distinct from 'split_mismatch' and o.id <> p_row
    );
  return not exists (
    select 1 from public.review_queue o
    where o.company_id = p_company and o.transaction_id = p_txn and o.status = 'open' and o.id <> p_row
  );
end;
$$;

revoke all on function private.review_may_reopen(uuid, uuid, uuid) from public, anon, authenticated;

-- An approved or changed row p_row whose filing was just undone while a newer row of the line is
-- open (so it does not reopen). It goes: kept, sync_review_queue would read it as settled and never
-- queue the unfiled line again once the newer row went. An invoice's paired receipts go back first,
-- as review_receipt_pairing does when such a row reopens. The caller holds the line's lock.
create function private.review_undone_row(p_company uuid, p_txn uuid, p_row uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice boolean;
begin
  select t.direction = 'income'::public.txn_direction and t.doc_kind = 'invoice'
  into invoice
  from public.transactions t
  where t.id = p_txn and t.company_id = p_company;
  if invoice then
    perform private.unfollow_invoice_row(p_row);
  end if;
  delete from public.review_queue q
  where q.id = p_row and q.company_id = p_company and q.status in ('approved', 'changed');
  if invoice then
    perform private.follow_invoice(p_txn);
  end if;
end;
$$;

revoke all on function private.review_undone_row(uuid, uuid, uuid) from public, anon, authenticated;

-- The trigger's branch for a review that came back is now the helper above: with the index, a reopen
-- beside an open split_mismatch row would fail before the trigger ran.
select pg_temp.patch('private.review_queue_line_split_review()',
  array[$a$  elsif tg_op = 'UPDATE'
    and new.status = 'open'
    and old.status is distinct from 'open'
    and new.reason is distinct from 'split_mismatch'
  then
    -- Another review came back (undo of a skip): it holds the line again, one open review.
    delete from public.review_queue q
    where q.transaction_id = new.transaction_id
      and q.company_id = new.company_id
      and q.status = 'open'
      and q.reason = 'split_mismatch';
  end if;$a$],
  array[$n$  end if;$n$]);
revoke all on function private.review_queue_line_split_review() from public, anon, authenticated;

create or replace function public.reopen_review(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  cid uuid;
  txn uuid;
  item_status public.review_status;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_cat_assigned boolean;
  prior_shares jsonb;
  prior_remembered uuid;
  written uuid;
  supplier uuid;
  item jsonb;
  updated int;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;

  select q.transaction_id
  into txn
  from public.review_queue q
  where q.id = p_id
    and q.company_id = cid;
  if txn is null then
    raise exception 'review item not found';
  end if;

  select t.supplier_id
  into supplier
  from public.transactions t
  where t.id = txn and t.company_id = cid
  for update;
  if not found then
    raise exception 'review item not found';
  end if;

  select q.prior_project_id, q.prior_category_id, q.prior_pnl_role,
         q.prior_user_assigned, q.prior_category_suggested, q.prior_allocations,
         q.prior_remembered_category_id, q.written_remembered_category_id, q.status, q.prior_category_assigned
  into prior_project, prior_category, prior_role, prior_assigned, prior_suggested, prior_shares,
       prior_remembered, written, item_status, prior_cat_assigned
  from public.review_queue q
  where q.id = p_id
    and q.company_id = cid
  for update;
  if item_status is null or item_status not in ('approved', 'skipped', 'changed') then
    raise exception 'review item not found';
  end if;

  -- FLOW-309: a skip changed nothing on the line, so reopening it only puts the card back.
  -- Restoring the skip-time snapshot would undo edits the owner made since (the skipped list
  -- can reopen a card long after the skip).
  -- FLOW-1166 part 4: one open row per line. While a newer row of the line is open, the skip
  -- stays and the newer row is the card.
  if item_status = 'skipped' then
    if private.review_may_reopen(cid, txn, p_id) then
      update public.review_queue
      set status = 'open',
          resolved_at = null,
          skipped_by = null
      where id = p_id and company_id = cid;
    end if;
    return;
  end if;

  update public.transactions
  set project_id = prior_project,
      category_id = prior_category,
      pnl_role = prior_role,
      user_assigned = coalesce(prior_assigned, false),
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
    raise exception 'review item not found';
  end if;

  delete from public.allocations where transaction_id = txn and company_id = cid;
  if prior_shares is not null and jsonb_typeof(prior_shares) = 'array' then
    for item in select value from jsonb_array_elements(prior_shares)
    loop
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      values (
        cid,
        txn,
        (item->>'project_id')::uuid,
        (item->>'share_bp')::integer,
        (item->>'amount_net')::bigint
      );
    end loop;
  end if;

  delete from public.overhead where transaction_id = txn and company_id = cid;
  if prior_role = 'overhead' then
    insert into public.overhead (company_id, transaction_id) values (cid, txn);
  end if;

  if supplier is not null and written is not null then
    update public.suppliers
    set remembered_category_id = prior_remembered
    where id = supplier
      and company_id = cid
      and remembered_category_id is not distinct from written;
  end if;

  -- FLOW-309: as in undo_reassign, the missing_project row set_transaction_category queued
  -- for income goes with the category it followed (before the reopen since FLOW-1166 part 4).
  if exists (
    select 1
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id and t.company_id = q.company_id
    where q.id = p_id and q.company_id = cid
      and q.reason = 'missing_category'
      and t.direction = 'income'::public.txn_direction
  ) then
    delete from public.review_queue q
    where q.id = (
      select q2.id
      from public.review_queue q2
      where q2.company_id = cid
        and q2.transaction_id = txn
        and q2.id <> p_id
        and q2.status = 'open'
        and q2.reason = 'missing_project'
      order by q2.created_at desc
      limit 1
    );
  end if;

  -- FLOW-1166 part 4: the filing comes back either way; the row reopens only when no newer row of
  -- the line is open, which then stays the card, and the undone row goes.
  if private.review_may_reopen(cid, txn, p_id) then
    update public.review_queue
    set status = 'open',
        resolved_at = null
    where id = p_id and company_id = cid;
  else
    perform private.review_undone_row(cid, txn, p_id);
  end if;
end;
$function$;

revoke all on function public.reopen_review(uuid) from public, anon;
grant execute on function public.reopen_review(uuid) to authenticated, service_role;

-- The guarded inserts: a second run at the same time does nothing instead of raising.
select pg_temp.patch('public.sync_review_queue(uuid)',
  array[
    $a$      select 1 from public.review_queue q where q.transaction_id = h.transaction_id and q.status = 'open'
    );$a$,
    $a$    );
  get diagnostics inserted = row_count;$a$,
    $a$    );
  get diagnostics income_inserted = row_count;$a$],
  array[
    $n$      select 1 from public.review_queue q where q.transaction_id = h.transaction_id and q.status = 'open'
    )
  on conflict (transaction_id) where status = 'open' do nothing;$n$,
    $n$    )
  on conflict (transaction_id) where status = 'open' do nothing;
  get diagnostics inserted = row_count;$n$,
    $n$    )
  on conflict (transaction_id) where status = 'open' do nothing;
  get diagnostics income_inserted = row_count;$n$]);
revoke all on function public.sync_review_queue(uuid) from public, anon, authenticated;
grant execute on function public.sync_review_queue(uuid) to service_role;

select pg_temp.patch('private.forecast_line_sync(uuid,uuid[])',
  array[$a$      where not exists (select 1 from public.review_queue q where q.transaction_id = line.id and q.status = 'open');$a$],
  array[$n$      where not exists (select 1 from public.review_queue q where q.transaction_id = line.id and q.status = 'open')
      on conflict (transaction_id) where status = 'open' do nothing;$n$]);
revoke all on function private.forecast_line_sync(uuid, uuid[]) from public, anon, authenticated;

select pg_temp.patch('private.line_split_review_sync(uuid)',
  array[$a$    where not exists (
      select 1 from public.review_queue q
      where q.transaction_id = p_transaction_id and q.status = 'open'
    );$a$],
  array[$n$    where not exists (
      select 1 from public.review_queue q
      where q.transaction_id = p_transaction_id and q.status = 'open'
    )
    on conflict (transaction_id) where status = 'open' do nothing;$n$]);
revoke all on function private.line_split_review_sync(uuid) from public, anon, authenticated;

select pg_temp.patch('private.undo_held_change_left(uuid,private.mcp_writes)',
  array[$a$    values (cid, rec.transaction_id, 'open', 'closed_month_change');$a$],
  array[$n$    values (cid, rec.transaction_id, 'open', 'closed_month_change')
    on conflict (transaction_id) where status = 'open' do nothing;$n$]);
revoke all on function private.undo_held_change_left(uuid, private.mcp_writes) from public, anon, authenticated, service_role;

select pg_temp.patch('public.delete_category(uuid)',
  array[$a$        select 1 from public.review_queue q where q.transaction_id = t.id and q.status = 'open'
      )
    returning id$a$],
  array[$n$        select 1 from public.review_queue q where q.transaction_id = t.id and q.status = 'open'
      )
    on conflict (transaction_id) where status = 'open' do nothing
    returning id$n$]);
revoke all on function public.delete_category(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_category(uuid) to authenticated;

select pg_temp.patch('public.set_transaction_category(uuid,uuid,boolean)',
  array[
    $a$      values (cid, p_id, 'open', 'unallocated_shared');$a$,
    $a$      values (cid, p_id, 'open', 'missing_project');$a$],
  array[
    $n$      values (cid, p_id, 'open', 'unallocated_shared')
      on conflict (transaction_id) where status = 'open' do nothing;$n$,
    $n$      values (cid, p_id, 'open', 'missing_project')
      on conflict (transaction_id) where status = 'open' do nothing;$n$]);
revoke all on function public.set_transaction_category(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_transaction_category(uuid, uuid, boolean) to authenticated, service_role;

drop index public.review_queue_open_idx;
create unique index review_queue_open_line_key on public.review_queue (transaction_id)
  where status = 'open'::public.review_status;

-- ---------------------------------------------------------------------------------------------
-- C. reassign_undo.written_line, and undo_reassign's check
-- ---------------------------------------------------------------------------------------------

-- The line in the columns undo_reassign restores, and the parts it would leave behind: the split by
-- category (private.line_split_parts, the form undo_utility_refile compares) and a loan payment's
-- parts, in a stable order. Null for a line that is not the company's.
create function private.reassign_line_state(p_company uuid, p_txn uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'project_id', t.project_id,
    'category_id', t.category_id,
    'pnl_role', t.pnl_role,
    'user_assigned', t.user_assigned,
    'category_suggested', t.category_suggested,
    'category_assigned', t.category_assigned,
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object('project_id', a.project_id, 'share_bp', a.share_bp,
        'amount_net', a.amount_net) order by a.project_id, a.share_bp, a.amount_net)
      from public.allocations a
      where a.transaction_id = t.id and a.company_id = t.company_id
    ), '[]'::jsonb),
    'overhead', exists (
      select 1 from public.overhead o where o.transaction_id = t.id and o.company_id = t.company_id
    ),
    'split_parts', private.line_split_parts(t.id),
    'loan_parts', coalesce((
      select jsonb_agg(jsonb_build_object('loan_id', s.loan_id, 'part', s.part, 'category_id', s.category_id,
        'amount_minor', s.amount_minor) order by s.loan_id, s.part)
      from private.loan_parts s
      where s.transaction_id = t.id and s.company_id = t.company_id
    ), '[]'::jsonb)
  )
  from public.transactions t
  where t.id = p_txn and t.company_id = p_company;
$$;

revoke all on function private.reassign_line_state(uuid, uuid) from public, anon, authenticated;

alter table public.reassign_undo add column written_line jsonb;
comment on column public.reassign_undo.written_line is
  'FLOW-1166: the line as the filing left it (private.reassign_line_state); undo_reassign refuses once it '
  'reads otherwise. Null for undo rows written before 2026-11-13, which keep the old behaviour.';

-- Every writer inserts the undo row after its last write to the line.
create function private.reassign_undo_written()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.written_line := private.reassign_line_state(new.company_id, new.transaction_id);
  return new;
end;
$$;

revoke all on function private.reassign_undo_written() from public, anon, authenticated;

create trigger reassign_undo_written
before insert on public.reassign_undo
for each row execute function private.reassign_undo_written();

create or replace function public.undo_reassign(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
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
  written jsonb;
  item jsonb;
  updated int;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select u.transaction_id, u.prior_project_id, u.prior_category_id, u.prior_pnl_role,
         u.prior_user_assigned, u.prior_category_suggested, u.prior_allocations, u.prior_review_id,
         u.prior_category_assigned, u.written_line
  into txn, prior_project, prior_category, prior_role, prior_assigned, prior_suggested, prior_shares, review_id,
       prior_cat_assigned, written
  from public.reassign_undo u
  where u.id = p_id and u.company_id = cid and u.undone_at is null
  for update;
  if txn is null then
    raise exception 'undo not found';
  end if;

  -- FLOW-1166 part 4: under the line's lock, the line must still read as the filing left it; a later
  -- edit (the owner's, the assistant's or a sync's change to these columns) stays, and nothing is
  -- restored. An undo row from before has no written_line and is not checked.
  perform 1 from public.transactions t where t.id = txn and t.company_id = cid for update;
  if not found then
    raise exception 'transaction not found';
  end if;
  if written is not null and private.reassign_line_state(cid, txn) is distinct from written then
    raise exception 'line changed since';
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
    -- The rows the filing queued itself go with it, before the reopen (FLOW-1166 part 4): the
    -- unallocated_shared row of a shared line whose category was the question, and (FLOW-309) the
    -- missing_project row set_transaction_category queued for income.
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

    if exists (
      select 1
      from public.review_queue q
      join public.transactions t on t.id = q.transaction_id and t.company_id = q.company_id
      where q.id = review_id and q.company_id = cid and q.status in ('open', 'changed')
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

    -- FLOW-1166 part 4: the row reopens only when no newer row of the line is open, which then
    -- stays the card, and the undone row goes; the filing comes back either way.
    if exists (
      select 1 from public.review_queue q
      where q.id = review_id and q.company_id = cid and q.status = 'changed'
    ) then
      if private.review_may_reopen(cid, txn, review_id) then
        update public.review_queue
        set status = 'open',
            resolved_at = null
        where id = review_id and company_id = cid and status = 'changed';
      else
        perform private.review_undone_row(cid, txn, review_id);
      end if;
    end if;
  end if;

  if review_id is null then
    update public.review_queue q
    set reason = 'missing_category'
    from public.transactions t
    where q.company_id = cid
      and q.transaction_id = txn
      and q.status = 'open'
      and q.reason = 'missing_project'
      and t.id = txn
      and t.company_id = cid
      and t.direction = 'income'::public.txn_direction
      and t.project_id is null
      and (t.category_id is null or (not t.user_assigned and not t.category_assigned));
  end if;

  update public.reassign_undo
  set undone_at = now()
  where id = p_id and company_id = cid;
end;
$function$;

revoke all on function public.undo_reassign(uuid) from public, anon;
grant execute on function public.undo_reassign(uuid) to authenticated, service_role;

-- flow-mcp: the refusal word for word, as a conflict; a loan attach's undo leaves a changed line's
-- project as it is. The attach wrote its parts before its filing, whose snapshot holds them, so its
-- undo puts the filing back first and then removes the parts.
select pg_temp.patch('public.mcp_undo(text,text,uuid)',
  array[
    $a$        perform private.set_loan_parts(cid, p_id, rec.loan_id, null);
        -- Give the line back$a$,
    $a$        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', case when attach_reassign is not null$a$,
    $a$            perform public.undo_reassign(attach_reassign);
            restored := true;$a$,
    $a$      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;$a$],
  array[
    $n$        -- Give the line back$n$,
    $n$        -- FLOW-1166 part 4: the parts go after the filing's undo, whose snapshot holds them.
        perform private.set_loan_parts(cid, p_id, rec.loan_id, null);
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', case when attach_reassign is not null$n$,
    $n$            -- FLOW-1166 part 4: undo_reassign also reads the line's flags and shares; a line
            -- changed there keeps its project too.
            begin
              perform public.undo_reassign(attach_reassign);
              restored := true;
            exception
              when raise_exception then
                if sqlerrm <> 'line changed since' then
                  raise;
                end if;
            end;$n$,
    $n$      return private.mcp_error('unavailable', 'retry');
    -- FLOW-1166 part 4: undo_reassign's refusal of a line changed since the filing.
    when raise_exception then
      if sqlerrm = 'line changed since' then
        response := private.mcp_error('conflict', 'line changed since');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
    when others then
      response := private.mcp_refused(sqlerrm);
  end;$n$]);
revoke all on function public.mcp_undo(text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_undo(text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- D. reopen_invite: not after the invite's expiry
-- ---------------------------------------------------------------------------------------------

select pg_temp.patch('public.reopen_invite(uuid)',
  array[$a$    or inv.decided_at < now() - interval '10 minutes'
  then$a$],
  array[$n$    or inv.decided_at < now() - interval '10 minutes'
    -- FLOW-1166 part 4: an invite past its expiry is not put back to pending.
    or inv.expires_at <= now()
  then$n$]);
revoke all on function public.reopen_invite(uuid) from public, anon;
grant execute on function public.reopen_invite(uuid) to authenticated, service_role;

commit;
