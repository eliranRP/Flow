-- FLOW-309, option A (owner's pick 2026-10-09): a connector invoice and its receipt are one
-- review card. Decision 0164.
--
-- Matching rule: a receipt pairs with an invoice when both are income lines from the same
-- connector, in the same company, neither is removed or void, and the receipt's
-- linked_external_id is the invoice's external_id (SUMIT's originalSumitId). One invoice can have
-- several receipts (part payments); a receipt has one invoice.
--
-- Status rules (private.follow_invoice):
-- 1. While the invoice waits in review (an open row, or a skip as its latest row while it is still
--    unfiled), its receipts get no card of their own: their open rows are removed (a split_mismatch
--    row, the receipt's own review, stays).
-- 2. When the invoice is settled and filed, each receipt takes its project, category and role.
--    A settled invoice row (approved or changed) gives the receipt a closed row of the same status
--    with paired_with naming that row and a snapshot of the receipt's own values. An invoice that
--    was filed without review (no settled row) moves its receipts the same way, with no row.
--    A receipt the owner filed on their own (user_assigned with no paired row, a settled row of
--    its own, a split by category, or a refiling after the joint approval, seen against
--    paired_project_id / paired_category_id) keeps its own filing and stops following. Outside the owner's approval or change of the invoice (a sync,
--    a line change, the pass below), a receipt a rule already filed keeps that filing too.
-- 3. Undo: when a settled invoice row opens again (reopen_review, undo_reassign, mcp_undo), each
--    receipt row paired with it puts the receipt back from its snapshot and is removed, so the
--    receipt waits with its invoice again. A receipt the owner refiled since is only unpaired.
-- Two triggers apply the rules, so every write path follows them: review_queue rows (insert, or a
-- status change) and the invoice and receipt lines themselves. sync_review_queue also skips a
-- receipt whose invoice waits, so a sync does not add and drop its row each time, and
-- filed_today_rows does not count such a receipt as filed automatically.
--
-- list_review: an income invoice's item carries its receipts (receipts, paid, paid_on), so the
-- card can show "✓ שולם · קבלה dd/mm" (UI lane 2 builds the card). MCP list_review echoes them.
--
-- Once: every existing pair follows the rules, so receipts already waiting for review either
-- join their invoice or take its filing.

begin;

set local lock_timeout = '5s';

alter table public.review_queue
  add column paired_with uuid references public.review_queue (id) on delete set null,
  add column prior_project_assigned boolean,
  add column paired_project_id uuid,
  add column paired_category_id uuid;

comment on column public.review_queue.paired_project_id is
  'FLOW-309. The project the pairing gave the receipt. A receipt the owner refiled since is theirs: it stops following. Decision 0164.';

comment on column public.review_queue.paired_with is
  'FLOW-309. On a receipt''s row: the invoice row it was settled with. Reopening that row undoes the receipt too. Decision 0164.';

create index review_queue_paired_with_idx on public.review_queue (paired_with)
  where paired_with is not null;

-- The receipts and credit notes of an invoice, by the invoice's external id.
create index transactions_linked_doc_idx on public.transactions (company_id, linked_external_id)
  where doc_kind in ('receipt', 'credit') and linked_external_id is not null;

-- The receipts paired with an invoice line (the matching rule above). None for any other line.
create or replace function private.invoice_receipts(p_invoice uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
  from public.transactions inv
  join public.transactions r
    on r.company_id = inv.company_id
   and r.source = inv.source
   and r.linked_external_id = inv.external_id
  where inv.id = p_invoice
    and inv.direction = 'income'
    and inv.doc_kind = 'invoice'
    and inv.external_id is not null
    and inv.removed_at is null
    and inv.line_status <> 'void'
    and private.is_connector_source(inv.source)
    and r.direction = 'income'
    and r.doc_kind = 'receipt'
    and r.removed_at is null
    and r.line_status <> 'void'
  order by r.doc_date, r.id;
$$;

-- The invoice a receipt line pairs with, or null.
create or replace function private.receipt_invoice(p_receipt uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select inv.id
  from public.transactions r
  join public.transactions inv
    on inv.company_id = r.company_id
   and inv.source = r.source
   and inv.external_id = r.linked_external_id
  where r.id = p_receipt
    and r.direction = 'income'
    and r.doc_kind = 'receipt'
    and r.linked_external_id is not null
    and r.removed_at is null
    and r.line_status <> 'void'
    and private.is_connector_source(r.source)
    and inv.direction = 'income'
    and inv.doc_kind = 'invoice'
    and inv.removed_at is null
    and inv.line_status <> 'void'
  limit 1;
$$;

-- Rule 1 for one invoice line: true while it waits in review, that is with an open row, or with
-- a skip as its latest row while it is still unfiled (a skipped invoice the owner filed another
-- way waits for nothing).
create or replace function private.invoice_waits(p_invoice uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.review_queue q
    where q.transaction_id = p_invoice and q.status = 'open'
  )
  or coalesce((
    select q.status = 'skipped'
      and t.project_id is null
      and (
        t.category_id is null
        or not private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part)
      )
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id and t.company_id = q.company_id
    left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
    where q.transaction_id = p_invoice
    order by q.created_at desc, q.id desc
    limit 1
  ), false);
$$;

-- Rule 1 for one receipt line: true while its invoice waits. sync_review_queue does not queue
-- such a receipt, and filed_today_rows does not count it.
create or replace function private.receipt_waits(p_receipt uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.invoice_waits(private.receipt_invoice(p_receipt)), false);
$$;

-- Rule 3: the receipt rows settled with an invoice row put their receipts back and go.
create or replace function private.unfollow_invoice_row(p_row uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rr record;
  item jsonb;
begin
  for rr in
    select q.*
    from public.review_queue q
    where q.paired_with = p_row
      and q.status in ('approved', 'changed')
    order by q.id
    for update
  loop
    -- A receipt the owner refiled after the joint approval is theirs: unpaired, not put back.
    if exists (
      select 1 from public.transactions t
      where t.id = rr.transaction_id and t.company_id = rr.company_id
        and (t.project_id is distinct from rr.paired_project_id
          or t.category_id is distinct from rr.paired_category_id)
    ) then
      update public.review_queue set paired_with = null where id = rr.id;
      continue;
    end if;

    perform 1 from public.transactions t
    where t.id = rr.transaction_id and t.company_id = rr.company_id
    for update;

    update public.transactions
    set project_id = rr.prior_project_id,
        category_id = rr.prior_category_id,
        pnl_role = rr.prior_pnl_role,
        user_assigned = coalesce(rr.prior_user_assigned, false),
        category_suggested = coalesce(rr.prior_category_suggested, false),
        category_assigned = coalesce(rr.prior_category_assigned, false),
        project_assigned = coalesce(rr.prior_project_assigned, false)
    where id = rr.transaction_id and company_id = rr.company_id;

    delete from public.allocations
    where transaction_id = rr.transaction_id and company_id = rr.company_id;
    if rr.prior_allocations is not null and jsonb_typeof(rr.prior_allocations) = 'array' then
      for item in select value from jsonb_array_elements(rr.prior_allocations)
      loop
        insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
        values (
          rr.company_id,
          rr.transaction_id,
          (item->>'project_id')::uuid,
          (item->>'share_bp')::integer,
          (item->>'amount_net')::bigint
        );
      end loop;
    end if;

    delete from public.review_queue where id = rr.id;
  end loop;
end;
$$;

-- Rules 1 and 2 for one invoice line. Safe to call any time; it does nothing for a line that is
-- not an invoice with receipts. p_owner is true when the owner has just approved or changed the
-- invoice in review: that approval covers every receipt they did not file themselves. Otherwise
-- (a sync, a line change, the one-time pass) only a receipt that waits for review, is still
-- unfiled, or already follows the invoice moves, so a receipt filed by a rule keeps its filing.
create or replace function private.follow_invoice(p_invoice uuid, p_owner boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv record;
  receipt_ids uuid[];
  waiting boolean;
  filed boolean;
  settled_id uuid;
  settled_status public.review_status;
  r record;
  own_row uuid;
  paired_row uuid;
  open_row uuid;
  prior_shares jsonb;
  want_shares jsonb;
  want_user boolean;
  want_suggested boolean;
  want_cat_assigned boolean;
  want_proj_assigned boolean;
  owner_filed boolean;
  receipt_filed boolean;
begin
  receipt_ids := array(select private.invoice_receipts(p_invoice));
  if cardinality(receipt_ids) = 0 then
    return;
  end if;

  select t.id, t.company_id, t.project_id, t.category_id, t.pnl_role, t.user_assigned,
         t.category_suggested, t.category_assigned, t.project_assigned,
         c.excluded_from_pnl, c.loan_part
  into inv
  from public.transactions t
  left join public.categories c on c.id = t.category_id and c.company_id = t.company_id
  where t.id = p_invoice;

  -- Rule 1: the invoice waits. A split_mismatch row is the receipt's own review and stays.
  waiting := private.invoice_waits(inv.id);
  if waiting then
    delete from public.review_queue q
    where q.company_id = inv.company_id
      and q.transaction_id = any(receipt_ids)
      and q.status = 'open'
      and q.reason is distinct from 'split_mismatch';
    return;
  end if;

  -- Rule 2 needs a filed invoice on one project or on none: a category, and a project unless
  -- the category keeps the line out of the P&L. A shared or overhead invoice, or one split by
  -- category, is left alone.
  filed := inv.category_id is not null
    and coalesce(inv.pnl_role, 'project') = 'project'
    and not exists (
      select 1 from public.line_splits sp
      where sp.transaction_id = inv.id and sp.company_id = inv.company_id
    )
    and (
      inv.project_id is not null
      or private.line_category_out(inv.excluded_from_pnl, inv.category_suggested, inv.loan_part)
    );
  if not filed then
    return;
  end if;

  select q.id, q.status into settled_id, settled_status
  from public.review_queue q
  where q.transaction_id = inv.id
    and q.company_id = inv.company_id
    and q.status in ('approved', 'changed')
  order by q.resolved_at desc nulls last, q.created_at desc, q.id desc
  limit 1;

  for r in
    select t.*
    from public.transactions t
    where t.id = any(receipt_ids) and t.company_id = inv.company_id
    order by t.doc_date, t.id
    -- A receipt another transaction holds (a sync writing it) is skipped rather than waited
    -- for, which could deadlock with a sync that holds the receipt and waits for the invoice.
    -- A skipped receipt that is still unfiled is queued by the next sync, and its row's insert
    -- pairs it then.
    for update skip locked
  loop
    select q.id into paired_row
    from public.review_queue q
    where q.transaction_id = r.id and q.company_id = r.company_id
      and q.paired_with is not null and q.status in ('approved', 'changed')
    order by q.created_at desc, q.id desc
    limit 1;

    select q.id into open_row
    from public.review_queue q
    where q.transaction_id = r.id and q.company_id = r.company_id and q.status = 'open'
    order by q.created_at desc, q.id desc
    limit 1;

    -- The owner filed this receipt on their own: it keeps that filing.
    select q.id into own_row
    from public.review_queue q
    where q.transaction_id = r.id and q.company_id = r.company_id
      and q.paired_with is null and q.status in ('approved', 'changed')
    limit 1;
    -- So is a receipt split by category, whose split this would lose.
    owner_filed := (paired_row is null and open_row is null and (own_row is not null or r.user_assigned))
      or exists (
        select 1 from public.line_splits sp
        where sp.transaction_id = r.id and sp.company_id = r.company_id
      );
    if owner_filed then
      continue;
    end if;
    -- A receipt the owner refiled after the joint approval is theirs too: it stops following.
    if paired_row is not null and exists (
      select 1 from public.review_queue q
      where q.id = paired_row
        and (r.project_id is distinct from q.paired_project_id
          or r.category_id is distinct from q.paired_category_id)
    ) then
      update public.review_queue set paired_with = null where id = paired_row;
      continue;
    end if;
    if not coalesce(p_owner, false) and paired_row is null and open_row is null then
      select r.category_id is not null and (
        r.project_id is not null
        or private.line_category_out(c.excluded_from_pnl, r.category_suggested, c.loan_part)
      )
      into receipt_filed
      from (select 1) one
      left join public.categories c on c.id = r.category_id and c.company_id = r.company_id;
      if receipt_filed then
        continue;
      end if;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', a.project_id,
      'share_bp', a.share_bp,
      'amount_net', a.amount_net
    )), '[]'::jsonb)
    into prior_shares
    from public.allocations a
    where a.transaction_id = r.id and a.company_id = r.company_id;

    want_user := case when settled_id is null then inv.user_assigned else true end;
    want_suggested := case when settled_id is null then inv.category_suggested else false end;
    want_cat_assigned := case when settled_id is null then inv.category_assigned else true end;
    want_proj_assigned := case when settled_id is null then inv.project_assigned else inv.project_id is not null end;
    want_shares := case
      when inv.pnl_role = 'project' and inv.project_id is not null then jsonb_build_array(jsonb_build_object(
        'project_id', inv.project_id,
        'share_bp', 10000,
        'amount_net', r.amount_net
      ))
      else '[]'::jsonb
    end;

    -- Only a real change writes, so a sync that touches the pair again adds no audit rows.
    if r.project_id is distinct from inv.project_id
      or r.category_id is distinct from inv.category_id
      or r.pnl_role is distinct from inv.pnl_role
      or r.user_assigned is distinct from want_user
      or r.category_suggested is distinct from want_suggested
      or r.category_assigned is distinct from want_cat_assigned
      or r.project_assigned is distinct from want_proj_assigned
    then
      update public.transactions
      set project_id = inv.project_id,
          category_id = inv.category_id,
          pnl_role = inv.pnl_role,
          user_assigned = want_user,
          category_suggested = want_suggested,
          category_assigned = want_cat_assigned,
          project_assigned = want_proj_assigned
      where id = r.id and company_id = r.company_id;
    end if;

    if prior_shares is distinct from want_shares then
      delete from public.allocations where transaction_id = r.id and company_id = r.company_id;
      if jsonb_array_length(want_shares) > 0 then
        insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
        values (r.company_id, r.id, inv.project_id, 10000, r.amount_net);
      end if;
    end if;

    if paired_row is not null then
      -- Already settled with the invoice: the snapshot from then stays.
      update public.review_queue
      set paired_with = coalesce(settled_id, paired_with),
          status = coalesce(settled_status, status),
          paired_project_id = inv.project_id,
          paired_category_id = inv.category_id
      where id = paired_row
        and (paired_with is distinct from coalesce(settled_id, paired_with)
          or status is distinct from coalesce(settled_status, status)
          or paired_project_id is distinct from inv.project_id
          or paired_category_id is distinct from inv.category_id);
    elsif settled_id is not null then
      if open_row is not null then
        delete from public.review_queue q
        where q.transaction_id = r.id and q.company_id = r.company_id
          and q.status = 'open' and q.id <> open_row;
        update public.review_queue
        set status = settled_status,
            resolved_at = now(),
            paired_with = settled_id,
            paired_project_id = inv.project_id,
            paired_category_id = inv.category_id,
            prior_project_id = r.project_id,
            prior_category_id = r.category_id,
            prior_pnl_role = r.pnl_role,
            prior_user_assigned = r.user_assigned,
            prior_category_suggested = r.category_suggested,
            prior_category_assigned = r.category_assigned,
            prior_project_assigned = r.project_assigned,
            prior_allocations = prior_shares,
            doc_fingerprint = private.doc_fingerprint(
              r.direction::text, r.doc_kind::text, r.amount_gross, r.doc_date, r.description, r.external_id
            )
        where id = open_row;
      else
        insert into public.review_queue (
          company_id, transaction_id, status, reason, resolved_at, paired_with,
          paired_project_id, paired_category_id, prior_project_id, prior_category_id, prior_pnl_role, prior_user_assigned,
          prior_category_suggested, prior_category_assigned, prior_project_assigned,
          prior_allocations, doc_fingerprint
        ) values (
          r.company_id, r.id, settled_status, null, now(), settled_id,
          inv.project_id, inv.category_id, r.project_id, r.category_id, r.pnl_role, r.user_assigned,
          r.category_suggested, r.category_assigned, r.project_assigned,
          prior_shares,
          private.doc_fingerprint(
            r.direction::text, r.doc_kind::text, r.amount_gross, r.doc_date, r.description, r.external_id
          )
        );
      end if;
    else
      -- Filed without review: the receipt is filed the same way and waits for nothing.
      delete from public.review_queue q
      where q.transaction_id = r.id and q.company_id = r.company_id and q.status = 'open';
    end if;
  end loop;
end;
$$;

revoke all on function private.invoice_receipts(uuid) from public, anon, authenticated;
revoke all on function private.receipt_invoice(uuid) from public, anon, authenticated;
revoke all on function private.invoice_waits(uuid) from public, anon, authenticated;
revoke all on function private.receipt_waits(uuid) from public, anon, authenticated;
revoke all on function private.unfollow_invoice_row(uuid) from public, anon, authenticated;
revoke all on function private.follow_invoice(uuid, boolean) from public, anon, authenticated;
grant execute on function private.invoice_receipts(uuid) to service_role;
grant execute on function private.receipt_invoice(uuid) to service_role;
grant execute on function private.invoice_waits(uuid) to service_role;
grant execute on function private.receipt_waits(uuid) to service_role;
grant execute on function private.unfollow_invoice_row(uuid) to service_role;
grant execute on function private.follow_invoice(uuid, boolean) to service_role;

-- A review row is added, or its status changes: an invoice's row moves its receipts (and a
-- settled row that opens again undoes them first); a receipt's open row joins its invoice.
create or replace function private.review_receipt_pairing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  line record;
  invoice uuid;
begin
  if new.transaction_id is null then
    return null;
  end if;
  select t.direction, t.doc_kind into line
  from public.transactions t
  where t.id = new.transaction_id and t.company_id = new.company_id;
  if line.direction is distinct from 'income' then
    return null;
  end if;

  if line.doc_kind = 'invoice' then
    if tg_op = 'UPDATE' and old.status in ('approved', 'changed') and new.status is distinct from old.status then
      perform private.unfollow_invoice_row(new.id);
    end if;
    perform private.follow_invoice(
      new.transaction_id,
      tg_op = 'UPDATE' and new.status in ('approved', 'changed') and old.status = 'open'
    );
  elsif line.doc_kind = 'receipt' and new.status = 'open' then
    invoice := private.receipt_invoice(new.transaction_id);
    if invoice is not null then
      perform private.follow_invoice(invoice);
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.review_receipt_pairing() from public, anon, authenticated;

create trigger review_queue_receipt_pairing
  after insert or update of status on public.review_queue
  for each row execute function private.review_receipt_pairing();

-- An invoice line arrives or its filing changes (a change from the transaction screen, an undo,
-- a removal): its receipts follow. A new receipt line, or one relinked, follows its invoice.
create or replace function private.line_receipt_pairing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  invoice uuid;
begin
  if new.direction is distinct from 'income' then
    return null;
  end if;
  if new.doc_kind = 'invoice' then
    perform private.follow_invoice(new.id);
  elsif new.doc_kind = 'receipt' and new.linked_external_id is not null then
    invoice := private.receipt_invoice(new.id);
    if invoice is not null then
      perform private.follow_invoice(invoice);
    end if;
  end if;
  return null;
end;
$$;

revoke all on function private.line_receipt_pairing() from public, anon, authenticated;

create trigger transactions_invoice_pairing_insert
  after insert on public.transactions
  for each row
  when (new.direction = 'income' and new.doc_kind = 'invoice')
  execute function private.line_receipt_pairing();

-- A sync's upsert lists these columns on every line, so only a real change fires.
create trigger transactions_invoice_pairing
  after update of project_id, category_id, pnl_role, removed_at, line_status on public.transactions
  for each row
  when (
    new.direction = 'income' and new.doc_kind = 'invoice'
    and (
      old.project_id is distinct from new.project_id
      or old.category_id is distinct from new.category_id
      or old.pnl_role is distinct from new.pnl_role
      or old.removed_at is distinct from new.removed_at
      or old.line_status is distinct from new.line_status
    )
  )
  execute function private.line_receipt_pairing();

create trigger transactions_receipt_pairing_insert
  after insert on public.transactions
  for each row
  when (new.direction = 'income' and new.doc_kind = 'receipt')
  execute function private.line_receipt_pairing();

create trigger transactions_receipt_pairing
  after update of linked_external_id, removed_at, line_status on public.transactions
  for each row
  when (
    new.direction = 'income' and new.doc_kind = 'receipt'
    and (
      old.linked_external_id is distinct from new.linked_external_id
      or old.removed_at is distinct from new.removed_at
      or old.line_status is distinct from new.line_status
    )
  )
  execute function private.line_receipt_pairing();

-- list_review: patched from the current definition with counted anchors, so changes merged since
-- stay. Each item adds the invoice's receipts: receipts lists each paired receipt (oldest first);
-- paid is true when they cover the invoice after its credit notes (list_unpaid's sum; a pair is
-- one source, and SUMIT lines are ILS only, so the amounts share a currency); paid_on is the latest
-- receipt's date. A line that is not an income invoice has [] / false / null.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
  field_anchor text;
  join_anchor text;
begin
  def := pg_get_functiondef('public.list_review()'::regprocedure);
  field_anchor := $a$    'assistant_filed_today', filed.assistant$a$;
  join_anchor := $a$  where q.company_id = (select private.readable_company_id())
    and q.status = 'open'$a$;
  if pg_temp.anchor_count(def, field_anchor) <> 1 or pg_temp.anchor_count(def, join_anchor) <> 1 then
    raise exception 'list_review is not the expected definition';
  end if;
  def := replace(def, field_anchor, field_anchor || $n$,
    'receipts', coalesce(pair.receipts, '[]'::jsonb),
    'paid', coalesce(
      pair.receipts is not null
        and t.amount_gross + pair.credit_gross - pair.receipt_gross <= 0,
      false
    ),
    'paid_on', pair.paid_on$n$);
  def := replace(def, join_anchor, $n$  -- FLOW-309: the invoice's receipts (the matching rule in private.invoice_receipts).
  left join lateral (
    select
      jsonb_agg(jsonb_build_object(
        'transaction_id', r.id,
        'doc_date', r.doc_date,
        'amount_gross', r.amount_gross,
        'currency', r.currency
      ) order by r.doc_date, r.id) as receipts,
      sum(r.amount_gross)::bigint as receipt_gross,
      max(r.doc_date) as paid_on,
      coalesce((
        select sum(cred.amount_gross)::bigint
        from public.transactions cred
        where cred.company_id = t.company_id
          and cred.removed_at is null
          and cred.doc_kind = 'credit'
          and cred.linked_external_id = t.external_id
      ), 0) as credit_gross
    from public.transactions r
    where t.direction = 'income'
      and t.doc_kind = 'invoice'
      and t.external_id is not null
      and private.is_connector_source(t.source)
      and r.company_id = t.company_id
      and r.source = t.source
      and r.linked_external_id = t.external_id
      and r.direction = 'income'
      and r.doc_kind = 'receipt'
      and r.removed_at is null
      and r.line_status <> 'void'
    having count(*) > 0
  ) pair on true
$n$ || join_anchor);
  execute def;
end
$patch$;

-- sync_review_queue: a receipt whose invoice waits is not queued (rule 1), so each sync does not
-- add and then drop its row. Patched with counted anchors, as above.
do $patch$
declare
  def text;
  posted_anchor text;
  pending_anchor text;
begin
  def := pg_get_functiondef('public.sync_review_queue(uuid)'::regprocedure);
  posted_anchor := $a$    and t.line_status = 'posted'
    and (
      -- FLOW-121$a$;
  pending_anchor := $a$    and t.line_status = 'pending'
    and not exists ($a$;
  if pg_temp.anchor_count(def, posted_anchor) <> 1 or pg_temp.anchor_count(def, pending_anchor) <> 1 then
    raise exception 'sync_review_queue is not the expected definition';
  end if;
  def := replace(def, posted_anchor, $n$    and t.line_status = 'posted'
    -- FLOW-309: a receipt waits with its invoice (decision 0164).
    and not (t.doc_kind = 'receipt' and t.linked_external_id is not null and private.receipt_waits(t.id))
    and (
      -- FLOW-121$n$);
  def := replace(def, pending_anchor, $n$    and t.line_status = 'pending'
    and not (t.doc_kind = 'receipt' and t.linked_external_id is not null and private.receipt_waits(t.id))
    and not exists ($n$);
  execute def;
end
$patch$;

-- filed_today_rows: a receipt waiting with its invoice is not filed, so it is not counted as
-- filed automatically today.
do $patch$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('private.filed_today_rows()'::regprocedure);
  anchor := $a$      and filed.created_at >= bounds.start_at$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'filed_today_rows is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$
      -- FLOW-309: a receipt that waits with its invoice (decision 0164).
      and not (
        filed.doc_kind = 'receipt' and filed.linked_external_id is not null
        and private.receipt_waits(filed.id)
      )$n$);
end
$patch$;

drop function pg_temp.anchor_count(text, text);

-- Once: every invoice that has receipts applies the rules, so a receipt already waiting for
-- review joins its invoice or takes its filing.
do $$
declare
  inv uuid;
begin
  for inv in
    select distinct i.id
    from public.transactions r
    join public.transactions i
      on i.company_id = r.company_id
     and i.source = r.source
     and i.external_id = r.linked_external_id
    where r.direction = 'income'
      and r.doc_kind = 'receipt'
      and r.linked_external_id is not null
      and r.removed_at is null
      and i.direction = 'income'
      and i.doc_kind = 'invoice'
      and i.removed_at is null
  loop
    perform private.follow_invoice(inv);
  end loop;
end;
$$;

commit;
