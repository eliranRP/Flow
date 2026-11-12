-- FLOW-1166 part 2b (decision 0266; the owner's decisions of 2026-11-10, 2026-11-11 and 2026-11-12 in
-- the task): a sync no longer changes a line in a closed period. Its change is held aside, shown in the
-- review queue with the reason closed_month_change, and applied by the first sync after the owner moves
-- the closed date back. Part 2a (20261111080447_books_closed_lock.sql) defines what "closed" means:
-- private.books_closed_hit is used as it is, never redefined.
--
-- 1. private.closed_line_holds: one held change per line (the latest replaces the earlier one), kind
--    update (the canonical line as the sync sent it, so a replay is exact), void (the line was in the
--    sync's removed ids) or remove (the SUMIT sweep found the document gone). state held | left, tied to
--    left_at by one CHECK. fingerprint names the change, so the same change is recognised later.
-- 2. upsert_connector_lines, patched in place with counted anchors:
--    - Replay first, inside the advisory lock: a held void or removal whose line is no longer closed is
--      applied as the bulk statements below would apply it; each held update goes through the per-line
--      path ahead of the fetched lines, and is applied there when it is no longer a hit (otherwise it is
--      left as it is). An applied hold is deleted. The fetched lines come after and win.
--    - An existing line: the incoming provider facts (direction, doc_kind, the amounts, VAT, currency,
--      the dates, line_status and removed_at as the update would write them) are laid over the stored
--      row. When that is a hit under private.books_closed_hit, the line, its allocations and its
--      overhead are not touched: the change is held and the run goes on. When it is not a hit but the
--      line is (or stays) in a closed period, the update runs with the stored category, project, role,
--      supplier and customer (the filing the sync re-derives from a supplier rule, a SUMIT section or a
--      hint) and the parts are left as they are; the other columns update as before. A line that is
--      not closed is written as before. A new line is inserted as before, whatever its date (decided).
--    - The removed ids' void and the SUMIT sweep's removal leave closed lines out and hold them.
--    - A line written normally drops its hold (the provider's latest word replaces the held one).
--    - The forecast line match skips closed lines (it re-derives filing).
--    - The result gains a held count (the lines held in this run; a held line is not counted as
--      updated). The edge functions read inserted, updated and removed; an extra key is ignored.
-- 3. The row triggers of part 2a stay person-only. Widening them to every writer would refuse
--    replace_sumit_connection (a SUMIT company switch removes every SUMIT line), the sync's own cascades
--    (follow_invoice through line_receipt_pairing, sync_review_queue's category_suggested) and other
--    service-role writers that were not all traced; the sync diverts its own writes above instead.
--    The sync's cascades: follow_invoice keeps a closed receipt's stored filing for every writer (part
--    2a: only a person), unless the receipt was inserted in this transaction; its "invoice waits" rule
--    keeps a held change's row.
-- 4. jev_prefill is not refused (the triggers are not widened); it leaves a line with a held change
--    alone (skipped: closed), since the held change's open row would otherwise let Jev file it.
-- 5. sync_review_queue: one open row with the reason closed_month_change per held change (an open row
--    the line already has takes that reason; no second open row); the row of a hold that was applied
--    or dropped is deleted in the same run, before the other reasons are queued again. The delete of
--    rows whose line is void, pending or removed, and category_suggested on open income rows, leave
--    these rows alone; a left change's approved row does not settle the line for income review.
--    review_row_items and list_review_page show such a row whatever its line's state, and the item
--    carries held: {kind, amount_minor, currency, doc_date, cash_date, line_status, provider}.
--    A person cannot close such a row while its change is held (review_queue_held_change), so an
--    app that does not know the reason is refused cleanly.
-- 6. leave_held_change (app, owner or editor) and mcp_leave_held_change (flow-mcp, undo kind
--    held_change_left): the hold becomes left and its row approved. The same change does not reopen
--    it; a different one does. The undo puts the hold back to held and reopens the row.
-- 7. mcp_set_books_closed_through refuses a close while a line the new date would close has an open
--    review row (any reason but closed_month_change): `approve the open review lines first`. Moving the
--    date back or clearing it is never refused by this.
--
-- Rows: a new table, empty; no row is rewritten. With books_closed_through null for every company
-- nothing is held. Signatures do not change; new functions are listed in the privilege allowlist.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- ---------------------------------------------------------------------------
-- 1. The held changes.
-- ---------------------------------------------------------------------------
create table private.closed_line_holds (
  transaction_id uuid primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  provider public.connector_provider not null,
  kind text not null,
  line jsonb,
  state text not null default 'held',
  held_at timestamptz not null default now(),
  left_at timestamptz,
  fingerprint text not null,
  constraint closed_line_holds_line_fk foreign key (company_id, transaction_id)
    references public.transactions (company_id, id) on delete cascade,
  constraint closed_line_holds_kind_chk check (kind in ('update', 'void', 'remove')),
  constraint closed_line_holds_line_chk check ((kind = 'update') = (line is not null)),
  constraint closed_line_holds_state_chk check (
    (state = 'held' and left_at is null) or (state = 'left' and left_at is not null))
);

create index closed_line_holds_company_idx on private.closed_line_holds (company_id, transaction_id);

alter table private.closed_line_holds enable row level security;
revoke all on table private.closed_line_holds from public, anon, authenticated;

comment on table private.closed_line_holds is
  'FLOW-1166: a sync change to a line in a closed period, held until the period reopens (decision 0266: state held | left with left_at).';

-- The latest change for a line replaces the earlier one. The same change (fingerprint) keeps its state
-- and time; a different one is held again.
create function private.closed_line_hold(p_company uuid, p_txn uuid, p_provider public.connector_provider,
  p_kind text, p_line jsonb, p_fingerprint text)
returns void
language sql
set search_path = ''
as $$
  insert into private.closed_line_holds as h
    (company_id, transaction_id, provider, kind, line, state, held_at, left_at, fingerprint)
  values (p_company, p_txn, p_provider, p_kind, p_line, 'held', pg_catalog.now(), null, p_fingerprint)
  on conflict (transaction_id) do update
  set provider = excluded.provider,
      kind = excluded.kind,
      line = excluded.line,
      state = case when h.fingerprint = excluded.fingerprint then h.state else 'held' end,
      left_at = case when h.fingerprint = excluded.fingerprint then h.left_at else null end,
      held_at = case when h.fingerprint = excluded.fingerprint then h.held_at else excluded.held_at end,
      fingerprint = excluded.fingerprint;
$$;

alter type public.connector_upsert_result add attribute held integer;

-- ---------------------------------------------------------------------------
-- 2. upsert_connector_lines.
-- ---------------------------------------------------------------------------
do $upsert$
declare
  def text;
  a_declare constant text := $a$  removed_now integer;
begin
$a$;
  a_start constant text := $a$  result.skipped := 0;
$a$;
  a_loop constant text := $a$  for line in select value from jsonb_array_elements(p_lines->'lines')
  loop
$a$;
  a_insert constant text := $a$    if existing_id is null then
      insert into public.transactions ($a$;
  a_update constant text := $a$    else
      update public.transactions t
      set direction = direction,
$a$;
  a_party constant text := $a$          customer_id = customer,
          supplier_id = supplier,
$a$;
  a_project constant text := $a$          project_id = case
            when existing_user or existing_project_assigned then t.project_id
$a$;
  a_category constant text := $a$            when existing_user or existing_category_assigned then t.category_id
$a$;
  a_role constant text := $a$          pnl_role = case
            when existing_user or existing_project_assigned then t.pnl_role
$a$;
  a_parts constant text := $a$    seen_ids := array_append(seen_ids, ext);

    if assigned then
$a$;
  a_void constant text := $a$    update public.transactions t
    set line_status = 'void',
        removed_at = coalesce(t.removed_at, pg_catalog.now())
    where t.company_id = p_company
      and t.source = source_value
      and t.external_id = any (removed_ids)
      and t.line_status is distinct from 'void';
    get diagnostics removed_now = row_count;
$a$;
  a_sweep constant text := $a$      update public.transactions t
      set removed_at = pg_catalog.now()
      where t.company_id = p_company
        and t.source = source_value
        and t.removed_at is null
        and (import_from is null or t.doc_date >= import_from)
        and not (t.external_id = any (seen_ids));
      get diagnostics removed_now = row_count;
$a$;
  a_forecast constant text := $a$      and t.external_id = any (seen_ids)
  ));
$a$;
begin
  def := pg_get_functiondef(
    'public.upsert_connector_lines(uuid,public.connector_provider,jsonb,text,text,smallint)'::regprocedure);
  if pg_temp.anchor_count(def, a_declare) <> 1 or pg_temp.anchor_count(def, a_start) <> 1
    or pg_temp.anchor_count(def, a_loop) <> 1 or pg_temp.anchor_count(def, a_insert) <> 1
    or pg_temp.anchor_count(def, a_update) <> 1 or pg_temp.anchor_count(def, a_project) <> 1
    or pg_temp.anchor_count(def, a_category) <> 1 or pg_temp.anchor_count(def, a_role) <> 1
    or pg_temp.anchor_count(def, a_parts) <> 1 or pg_temp.anchor_count(def, a_void) <> 1
    or pg_temp.anchor_count(def, a_sweep) <> 1 or pg_temp.anchor_count(def, a_forecast) <> 1
    or pg_temp.anchor_count(def, a_party) <> 1
  then
    raise exception 'upsert_connector_lines is not the expected definition';
  end if;

  def := replace(def, a_declare, $n$  removed_now integer;
  -- FLOW-1166 part 2b.
  closed_through date;
  holds_exist boolean := false;
  is_replay boolean;
  keep_filing boolean := false;
  cur_row public.transactions;
  prov_row public.transactions;
  held_now integer;
  replayed_ext text[] := array[]::text[];
begin
$n$);

  def := replace(def, a_start, a_start || $n$  result.held := 0;

  -- FLOW-1166 part 2b: the closed date, read under the company's row lock taken above, and the held
  -- changes this provider's run replays. A held void or removal whose line is no longer closed is
  -- applied first, as the statements below apply them; held updates go through the line loop first.
  select c.books_closed_through into closed_through from public.companies c where c.id = p_company;
  holds_exist := exists (
    select 1 from private.closed_line_holds h where h.company_id = p_company and h.provider = p_provider
  );
  if holds_exist then
    with applied as (
      select h.transaction_id, h.kind
      from private.closed_line_holds h
      join public.transactions t on t.id = h.transaction_id and t.company_id = h.company_id
      where h.company_id = p_company
        and h.provider = p_provider
        and h.kind in ('void', 'remove')
        and (closed_through is null or not private.books_closed_hit(closed_through, t, null))
    ), voided as (
      update public.transactions t
      set line_status = 'void',
          removed_at = coalesce(t.removed_at, pg_catalog.now())
      from applied a
      where a.kind = 'void' and t.id = a.transaction_id and t.company_id = p_company
        and t.line_status is distinct from 'void'
      returning t.id
    ), swept as (
      update public.transactions t
      set removed_at = pg_catalog.now()
      from applied a
      where a.kind = 'remove' and t.id = a.transaction_id and t.company_id = p_company
        and t.removed_at is null
      returning t.id
    ), dropped as (
      delete from private.closed_line_holds h
      using applied a
      where h.transaction_id = a.transaction_id
    )
    select (select count(*) from voided)::integer + (select count(*) from swept)::integer into removed_now;
    result.removed := result.removed + removed_now;
  end if;
$n$);

  def := replace(def, a_loop, $n$  -- FLOW-1166 part 2b: the held updates first (oldest first), then the fetched lines in their order.
  for line, is_replay in
    select x.l, x.r
    from (
      select h.line as l, true as r, 0 as g,
             row_number() over (order by h.held_at, h.transaction_id) as n
      from private.closed_line_holds h
      where holds_exist and h.company_id = p_company and h.provider = p_provider and h.kind = 'update'
      union all
      select e.value, false, 1, e.n
      from jsonb_array_elements(p_lines->'lines') with ordinality as e(value, n)
    ) x
    order by x.g, x.n
  loop
$n$);

  def := replace(def, a_insert, $n$    keep_filing := false;
    -- A held update whose line cannot be found any more is not a new line.
    if is_replay and existing_id is null then
      continue;
    end if;
$n$ || a_insert);

  def := replace(def, a_update, $n$    else
      -- FLOW-1166 part 2b: the provider's facts laid over the stored row. A hit in a closed period
      -- is held, and the line, its allocations and its overhead stay as they are. A held update
      -- that is still a hit stays held as it is.
      if closed_through is not null then
        select * into cur_row from public.transactions t where t.id = existing_id;
        prov_row := cur_row;
        prov_row.direction := direction;
        prov_row.doc_kind := kind;
        prov_row.amount_gross := gross;
        prov_row.amount_net := net;
        prov_row.vat_amount := vat;
        prov_row.vat_status := (line #>> '{vat,status}')::public.vat_status;
        prov_row.currency := coalesce(nullif(line->>'currency', ''), cur_row.currency);
        prov_row.amount_original := original;
        prov_row.doc_date := (line->>'doc_date')::date;
        prov_row.cash_date := nullif(line->>'cash_date', '')::date;
        prov_row.line_status := case when existing_void then 'void'::public.line_status else line_status end;
        prov_row.removed_at := case
          when existing_void then existing_removed
          when line_status = 'void' then coalesce(existing_removed, pg_catalog.now())
          else null
        end;
        if private.books_closed_hit(closed_through, cur_row, prov_row) then
          if not is_replay then
            perform private.closed_line_hold(p_company, existing_id, p_provider, 'update', line,
              pg_catalog.md5(row(prov_row.direction, prov_row.doc_kind, prov_row.amount_gross, prov_row.amount_net,
                prov_row.vat_amount, prov_row.vat_status, prov_row.currency, prov_row.amount_original,
                prov_row.doc_date, prov_row.cash_date, prov_row.line_status, prov_row.removed_at is not null)::text));
            holds_exist := true;
            result.held := result.held + 1;
            seen_ids := array_append(seen_ids, ext);
          end if;
          continue;
        end if;
        -- Not a hit, but in a closed period: the stored filing stays and the parts are not rebuilt.
        keep_filing := private.books_closed_hit(closed_through, null, cur_row)
          or private.books_closed_hit(closed_through, null, prov_row);
      end if;
      -- Written as the provider sends it: a held change for the line is replaced by this one.
      if holds_exist then
        delete from private.closed_line_holds h where h.transaction_id = existing_id;
      end if;
      update public.transactions t
      set direction = direction,
$n$);

  def := replace(def, a_party, $n$          customer_id = case when keep_filing then t.customer_id else customer end,
          supplier_id = case when keep_filing then t.supplier_id else supplier end,
$n$);
  def := replace(def, a_project, $n$          project_id = case
            when keep_filing or existing_user or existing_project_assigned then t.project_id
$n$);
  def := replace(def, a_category, $n$            when keep_filing or existing_user or existing_category_assigned then t.category_id
$n$);
  def := replace(def, a_role, $n$          pnl_role = case
            when keep_filing or existing_user or existing_project_assigned then t.pnl_role
$n$);

  def := replace(def, a_parts, $n$    -- FLOW-1166 part 2b: a replayed line is not part of this run's fetch (the SUMIT sweep reads it).
    if is_replay then
      replayed_ext := array_append(replayed_ext, ext);
    else
      seen_ids := array_append(seen_ids, ext);
    end if;

    if keep_filing then
      -- FLOW-1166 part 2b: a line in a closed period keeps its allocations and overhead.
      null;
    elsif assigned then
$n$);

  def := replace(def, a_void, $n$    -- FLOW-1166 part 2b: a closed line is held, not voided; a voided line drops its held change.
    if closed_through is not null then
      perform private.closed_line_hold(p_company, t.id, p_provider, 'void', null, pg_catalog.md5('void'))
      from public.transactions t
      where t.company_id = p_company
        and t.source = source_value
        and t.external_id = any (removed_ids)
        and t.line_status is distinct from 'void'
        and private.books_closed_hit(closed_through, t, null);
      get diagnostics held_now = row_count;
      result.held := result.held + held_now;
    end if;
    with voided as (
      update public.transactions t
      set line_status = 'void',
          removed_at = coalesce(t.removed_at, pg_catalog.now())
      where t.company_id = p_company
        and t.source = source_value
        and t.external_id = any (removed_ids)
        and t.line_status is distinct from 'void'
        and (closed_through is null or not private.books_closed_hit(closed_through, t, null))
      returning t.id
    ), dropped as (
      delete from private.closed_line_holds h
      where holds_exist and h.transaction_id in (select v.id from voided v)
    )
    select count(*)::integer into removed_now from voided;
$n$);

  def := replace(def, a_sweep, $n$      -- FLOW-1166 part 2b: a closed line is held, not removed; a removed line drops its held change.
      if closed_through is not null then
        perform private.closed_line_hold(p_company, t.id, p_provider, 'remove', null, pg_catalog.md5('remove'))
        from public.transactions t
        where t.company_id = p_company
          and t.source = source_value
          and t.removed_at is null
          and (import_from is null or t.doc_date >= import_from)
          and not (t.external_id = any (seen_ids))
          and private.books_closed_hit(closed_through, t, null);
        get diagnostics held_now = row_count;
        result.held := result.held + held_now;
      end if;
      with swept as (
        update public.transactions t
        set removed_at = pg_catalog.now()
        where t.company_id = p_company
          and t.source = source_value
          and t.removed_at is null
          and (import_from is null or t.doc_date >= import_from)
          and not (t.external_id = any (seen_ids))
          and (closed_through is null or not private.books_closed_hit(closed_through, t, null))
        returning t.id
      ), dropped as (
        delete from private.closed_line_holds h
        where holds_exist and h.transaction_id in (select s.id from swept s)
      )
      select count(*)::integer into removed_now from swept;
$n$);

  def := replace(def, a_forecast, $n$      and (t.external_id = any (seen_ids) or t.external_id = any (replayed_ext))
      -- FLOW-1166 part 2b: a line in a closed period keeps its filing.
      and (closed_through is null or not private.books_closed_hit(closed_through, t, null))
  ));
$n$);

  execute def;
end
$upsert$;

-- ---------------------------------------------------------------------------
-- 5. The review queue.
-- ---------------------------------------------------------------------------
do $sync$
declare
  def text;
  a_start constant text := $a$    raise exception 'forbidden';
  end if;
  insert into public.review_queue (company_id, transaction_id, status, reason)
$a$;
  a_gone constant text := $a$    -- 0184: a line still pending at the bank waits in no review until it posts.
    and (t.line_status in ('void', 'pending') or t.removed_at is not null);$a$;
  a_suggested constant text := $a$  set category_suggested = true
  from public.review_queue q
  where q.company_id = p_company_id
    and q.transaction_id = t.id
    and q.status = 'open'
$a$;
  a_income constant text := $a$      where q.transaction_id = t.id and q.status in ('approved', 'changed')$a$;
  a_relabel constant text := $a$      where s.transaction_id = t.id and s.status in ('approved', 'changed')$a$;
begin
  def := pg_get_functiondef('public.sync_review_queue(uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_start) <> 1 or pg_temp.anchor_count(def, a_gone) <> 1
    or pg_temp.anchor_count(def, a_suggested) <> 1 or pg_temp.anchor_count(def, a_income) <> 1
    or pg_temp.anchor_count(def, a_relabel) <> 1
  then
    raise exception 'sync_review_queue is not the expected definition';
  end if;

  def := replace(def, a_start, $n$    raise exception 'forbidden';
  end if;

  -- FLOW-1166 part 2b, before the other reasons: the row of a change no longer held (applied, dropped
  -- or left) closes; an open row of a line with a held change takes the reason closed_month_change;
  -- a held change with no open row gets one.
  delete from public.review_queue q
  where q.company_id = p_company_id
    and q.status = 'open'
    and q.reason = 'closed_month_change'
    and not exists (
      select 1 from private.closed_line_holds h
      where h.company_id = p_company_id and h.transaction_id = q.transaction_id and h.state = 'held'
    );
  update public.review_queue q
  set reason = 'closed_month_change'
  where q.company_id = p_company_id
    and q.status = 'open'
    and q.reason is distinct from 'closed_month_change'
    and exists (
      select 1 from private.closed_line_holds h
      where h.company_id = p_company_id and h.transaction_id = q.transaction_id and h.state = 'held'
    );
  insert into public.review_queue (company_id, transaction_id, status, reason)
  select h.company_id, h.transaction_id, 'open', 'closed_month_change'
  from private.closed_line_holds h
  where h.company_id = p_company_id
    and h.state = 'held'
    and not exists (
      select 1 from public.review_queue q where q.transaction_id = h.transaction_id and q.status = 'open'
    );

  insert into public.review_queue (company_id, transaction_id, status, reason)
$n$);
  def := replace(def, a_gone, $n$    -- 0184: a line still pending at the bank waits in no review until it posts.
    and (t.line_status in ('void', 'pending') or t.removed_at is not null)
    -- FLOW-1166 part 2b: a held change shows whatever the stored line's state.
    and q.reason is distinct from 'closed_month_change';$n$);
  def := replace(def, a_suggested, a_suggested || $n$    -- FLOW-1166 part 2b: a held change's row does not touch its line.
    and q.reason is distinct from 'closed_month_change'
$n$);
  def := replace(def, a_income, a_income || $n$
        -- FLOW-1166 part 2b: a held change the owner left does not settle the line's review.
        and q.reason is distinct from 'closed_month_change'$n$);
  def := replace(def, a_relabel, a_relabel || $n$
        and s.reason is distinct from 'closed_month_change'$n$);
  execute def;
end
$sync$;

-- The sync's cascades. follow_invoice (run by the receipt and invoice pairing triggers, also when the
-- sync writes a line or queues a row) keeps a closed receipt's stored filing for every writer, not only
-- a person, unless the receipt is new in this transaction (a brand-new line enters as any other); its
-- rule 1 no longer deletes a held change's row. jev_prefill leaves a line with a held change alone.
do $cascades$
declare
  def text;
  a_who constant text := $a$    -- FLOW-1166: a receipt in a closed period keeps its stored filing when a person files.
    if auth.uid() is not null and exists ($a$;
  a_wait constant text := $a$      and q.reason is distinct from 'split_mismatch';
    return;$a$;
  a_jev constant text := $a$  if review is distinct from 'open' or line.user_assigned then$a$;
begin
  def := pg_get_functiondef('private.follow_invoice(uuid,boolean)'::regprocedure);
  if pg_temp.anchor_count(def, a_who) <> 1 or pg_temp.anchor_count(def, a_wait) <> 1 then
    raise exception 'follow_invoice is not the expected definition';
  end if;
  def := replace(def, a_who, $n$    -- FLOW-1166: a receipt in a closed period keeps its stored filing when a person files, and when
    -- a sync or a job does (part 2b), unless the receipt is new in this transaction.
    if (auth.uid() is not null or r.created_at < pg_catalog.now()) and exists ($n$);
  def := replace(def, a_wait, $n$      and q.reason is distinct from 'split_mismatch'
      -- FLOW-1166 part 2b: a held sync change's row stays.
      and q.reason is distinct from 'closed_month_change';
    return;$n$);
  execute def;

  def := pg_get_functiondef('public.jev_prefill(uuid,uuid,uuid,uuid,text,numeric)'::regprocedure);
  if pg_temp.anchor_count(def, a_jev) <> 1 then
    raise exception 'jev_prefill is not the expected definition';
  end if;
  def := replace(def, a_jev, $n$  -- FLOW-1166 part 2b: a line whose sync change is held keeps its filing.
  if review is distinct from 'open' or line.user_assigned or exists (
    select 1 from private.closed_line_holds h
    where h.company_id = p_company and h.transaction_id = p_transaction
  ) then$n$);
  execute def;
end
$cascades$;

-- The held change of each line, for review_row_items (an invoker function read by the app's role).
create function private.review_held_changes(p_ids uuid[])
returns table (transaction_id uuid, held jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select h.transaction_id, jsonb_build_object(
    'kind', h.kind,
    'amount_minor', (h.line->>'amount_original')::bigint,
    'currency', case when h.kind = 'update' then coalesce(nullif(h.line->>'currency', ''), t.currency) end,
    'doc_date', (h.line->>'doc_date')::date,
    'cash_date', nullif(h.line->>'cash_date', '')::date,
    'line_status', case when h.kind = 'update' then coalesce(nullif(h.line->>'line_status', ''), 'posted') end,
    'provider', h.provider
  )
  from private.closed_line_holds h
  join public.transactions t on t.id = h.transaction_id and t.company_id = h.company_id
  where h.transaction_id = any (p_ids)
    and h.company_id = (select private.readable_company_id());
$$;

do $items$
declare
  def text;
  a_item constant text := $a$    'forecast_match', fm.forecast_match
  )$a$;
  a_join constant text := $a$  left join private.review_forecast_matches((select picked.tx from picked)) fm on fm.transaction_id = q.transaction_id
$a$;
  a_where constant text := $a$    and t.removed_at is null
    and t.line_status <> 'pending';$a$;
begin
  def := pg_get_functiondef('private.review_row_items(uuid[])'::regprocedure);
  if pg_temp.anchor_count(def, a_item) <> 1 or pg_temp.anchor_count(def, a_join) <> 1
    or pg_temp.anchor_count(def, a_where) <> 1
  then
    raise exception 'review_row_items is not the expected definition';
  end if;
  def := replace(def, a_item, $n$    'forecast_match', fm.forecast_match,
    -- FLOW-1166 part 2b: the change a sync holds for a line in a closed period.
    'held', hc.held
  )$n$);
  def := replace(def, a_join, a_join || $n$  left join private.review_held_changes((select picked.tx from picked)) hc on hc.transaction_id = q.transaction_id
$n$);
  def := replace(def, a_where, $n$    and ((t.removed_at is null and t.line_status <> 'pending') or q.reason = 'closed_month_change');$n$);
  execute def;

  def := pg_get_functiondef('public.list_review_page(integer,date,timestamptz,uuid,uuid,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, $a$      and t.removed_at is null
      and t.line_status <> 'pending'
$a$) <> 1 then
    raise exception 'list_review_page is not the expected definition';
  end if;
  def := replace(def, $a$      and t.removed_at is null
      and t.line_status <> 'pending'
$a$, $n$      and ((t.removed_at is null and t.line_status <> 'pending') or q.reason = 'closed_month_change')
$n$);
  execute def;
end
$items$;

-- A person cannot close the row of a change that is still held: the owner leaves it with
-- leave_held_change, or takes it by moving the closed date back. An app that does not know the reason
-- gets the books-closed message it already shows.
create function private.review_held_change_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  closed date;
begin
  if auth.uid() is null
    or (new.status = 'open' and new.reason is not distinct from old.reason)
    or not exists (
      select 1 from private.closed_line_holds h
      where h.company_id = old.company_id and h.transaction_id = old.transaction_id and h.state = 'held'
    )
  then
    return new;
  end if;
  select c.books_closed_through into closed from public.companies c where c.id = old.company_id;
  if closed is not null then
    raise exception '%', private.prepaid_closed_reason(closed);
  end if;
  raise exception 'the line has a held change';
end;
$$;

create trigger review_queue_held_change
  before update of status, reason on public.review_queue
  for each row
  when (old.status = 'open' and old.reason = 'closed_month_change')
  execute function private.review_held_change_guard();

-- ---------------------------------------------------------------------------
-- 6. Leaving a held change.
-- ---------------------------------------------------------------------------
-- The hold of the line, held, becomes left and its open row approved. Returns the hold's fingerprint
-- and the row's id. The caller has checked the company.
create function private.leave_held(p_company uuid, p_txn uuid)
returns table (review_id uuid, fingerprint text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  fp text;
  rid uuid;
begin
  update private.closed_line_holds h
  set state = 'left', left_at = pg_catalog.now()
  where h.company_id = p_company and h.transaction_id = p_txn and h.state = 'held'
  returning h.fingerprint into fp;
  if fp is null then
    raise exception 'review item not found';
  end if;
  -- The row's snapshot is the line as it stands (leaving changes nothing on it), so a reopen of the
  -- approved row (reopen_review, undo_reassign) writes the same filing back instead of empty priors.
  with closed_rows as (
    update public.review_queue q
    set status = 'approved',
        resolved_at = pg_catalog.now(),
        prior_project_id = t.project_id,
        prior_category_id = t.category_id,
        prior_pnl_role = t.pnl_role,
        prior_user_assigned = t.user_assigned,
        prior_category_suggested = t.category_suggested,
        prior_category_assigned = t.category_assigned,
        prior_project_assigned = t.project_assigned,
        prior_allocations = (
          select coalesce(jsonb_agg(jsonb_build_object(
            'project_id', a.project_id, 'share_bp', a.share_bp, 'amount_net', a.amount_net)), '[]'::jsonb)
          from public.allocations a
          where a.transaction_id = t.id
        ),
        prior_remembered_category_id = null,
        written_remembered_category_id = null,
        doc_fingerprint = private.doc_fingerprint(t.direction::text, t.doc_kind::text, t.amount_gross, t.doc_date,
          t.description, t.external_id)
    from public.transactions t
    where q.company_id = p_company and q.transaction_id = p_txn
      and t.id = q.transaction_id and t.company_id = q.company_id
      and q.status = 'open' and q.reason = 'closed_month_change'
    returning q.id, q.created_at
  )
  select c.id into rid from closed_rows c order by c.created_at desc, c.id limit 1;
  return query select rid, fp;
end;
$$;

create function public.leave_held_change(p_review_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  txn uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select q.transaction_id into txn
  from public.review_queue q
  where q.id = p_review_id and q.company_id = cid and q.status = 'open' and q.reason = 'closed_month_change';
  if txn is null then
    raise exception 'review item not found';
  end if;
  perform 1 from public.transactions t where t.id = txn and t.company_id = cid for update;
  perform private.leave_held(cid, txn);
end;
$$;

comment on function public.leave_held_change(uuid) is
  'FLOW-1166: the owner or an editor leaves the line as it is: the held sync change becomes left and its review row approved. The same change does not reopen it.';

create function public.mcp_leave_held_change(p_idempotency_key text, p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  left_row record;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'held_change_left|' || p_transaction_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    if cid is null then
      raise exception 'no company';
    end if;
    perform 1 from public.transactions t where t.id = p_transaction_id and t.company_id = cid for update;
    if not found then
      raise exception 'review item not found';
    end if;
    select * into left_row from private.leave_held(cid, p_transaction_id);

    insert into private.mcp_writes (token_id, user_id, company_id, kind, transaction_id, prior)
    values (token, auth.uid(), cid, 'held_change_left', p_transaction_id, jsonb_build_object(
      'review_id', left_row.review_id, 'fingerprint', left_row.fingerprint));

    response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'transaction_id', p_transaction_id, 'review_id', left_row.review_id, 'state', 'left',
      'undo_kind', 'held_change_left'));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

comment on function public.mcp_leave_held_change(text, uuid) is
  'FLOW-1166: MCP leave_held_change. The held sync change of a line in a closed period is left and its review row approved. Undo kind held_change_left.';

-- The undo: the same change goes back to held and its row reopens, while the hold reads as left.
create function private.undo_held_change_left(p_company uuid, p_write private.mcp_writes)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := p_company;
  rec private.mcp_writes := p_write;
  reopened integer;
begin
  perform 1 from public.transactions t where t.id = rec.transaction_id and t.company_id = cid for update;
  update private.closed_line_holds h
  set state = 'held', left_at = null
  where h.company_id = cid and h.transaction_id = rec.transaction_id
    and h.state = 'left' and h.fingerprint = rec.prior->>'fingerprint';
  if not found then
    return private.mcp_error('conflict', 'conflict');
  end if;
  update public.review_queue q
  set status = 'open', resolved_at = null
  where q.company_id = cid and q.transaction_id = rec.transaction_id
    and q.id = (rec.prior->>'review_id')::uuid and q.status = 'approved'
    and not exists (
      select 1 from public.review_queue o where o.transaction_id = rec.transaction_id and o.status = 'open'
    );
  get diagnostics reopened = row_count;
  if reopened = 0 and not exists (
    select 1 from public.review_queue o where o.transaction_id = rec.transaction_id and o.status = 'open'
  ) then
    insert into public.review_queue (company_id, transaction_id, status, reason)
    values (cid, rec.transaction_id, 'open', 'closed_month_change');
  elsif reopened = 0 then
    update public.review_queue q set reason = 'closed_month_change'
    where q.transaction_id = rec.transaction_id and q.company_id = cid and q.status = 'open';
  end if;
  update private.mcp_writes set undone_at = clock_timestamp() where id = rec.id and undone_at is null;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'kind', rec.kind, 'id', rec.transaction_id, 'state', 'held'));
end;
$$;

-- The write kind: the check constraints, mcp_refused, mcp_undo.
do $kinds$
declare
  def text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  if pg_temp.anchor_count(def, ']))') <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, ']))', ', ''held_change_left''::text]))');

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 1) <> ')' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 1)
    || ' OR ((kind = ''held_change_left''::text) AND (transaction_id IS NOT NULL) AND (prior ? ''review_id''::text) AND (prior ? ''fingerprint''::text)))';
end
$kinds$;

do $refused$
declare
  def text;
  anchor constant text := $a$      when p_message = 'loan_closed' then 'loan closed'$a$;
begin
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  def := replace(def, anchor, $n$      -- FLOW-1166: held sync changes and the close with open review lines.
      when p_message in ('the line has a held change', 'approve the open review lines first') then p_message
$n$ || anchor);
  execute def;
end
$refused$;

do $undo$
declare
  def text;
  a_kinds constant text := $a$p_kind not in ($a$;
  a_lookup constant text := $a$(p_kind = 'supplier_category' and w.kind = 'supplier_category' and w.transaction_id = p_id)$a$;
  a_branch constant text := $a$    elsif p_kind = 'supplier_category' then$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_kinds) <> 1 or pg_temp.anchor_count(def, a_lookup) <> 1
    or pg_temp.anchor_count(def, a_branch) <> 1 then
    raise exception 'mcp_undo is not the expected definition';
  end if;
  def := replace(def, a_kinds, $n$p_kind not in ('held_change_left', $n$);
  def := replace(def, a_lookup, a_lookup || $n$
        or (p_kind = 'held_change_left' and w.kind = 'held_change_left' and w.transaction_id = p_id)$n$);
  def := replace(def, a_branch, $n$    elsif p_kind = 'held_change_left' then
      -- FLOW-1166: the held sync change is held again and its review row reopens.
      response := private.undo_held_change_left(cid, rec);
$n$ || a_branch);
  execute def;
end
$undo$;

-- ---------------------------------------------------------------------------
-- 7. No close while the period still has open review lines.
-- ---------------------------------------------------------------------------
do $close$
declare
  def text;
  anchor constant text := $a$      raise exception 'post the due prepaid rows first';
    end if;
    update public.companies c set books_closed_through = p_date where c.id = cid;
$a$;
begin
  def := pg_get_functiondef('public.mcp_set_books_closed_through(text,date)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_set_books_closed_through is not the expected definition';
  end if;
  def := replace(def, anchor, $n$      raise exception 'post the due prepaid rows first';
    end if;
    -- FLOW-1166 (the owner, 2026-11-12): a close waits for the open review lines it would lock. A held
    -- sync change's row does not count; moving the date back or clearing it is never refused here.
    if p_date is not null and (before is null or p_date > before) and exists (
      select 1
      from public.review_queue q
      join public.transactions t on t.id = q.transaction_id and t.company_id = q.company_id
      where q.company_id = cid
        and q.status = 'open'
        and q.reason is distinct from 'closed_month_change'
        and private.books_closed_hit(p_date, t, null)
    ) then
      raise exception 'approve the open review lines first';
    end if;
    update public.companies c set books_closed_through = p_date where c.id = cid;
$n$);
  execute def;
end
$close$;

-- ---------------------------------------------------------------------------
-- Privileges. The patched functions keep their grants, restated as they are.
-- ---------------------------------------------------------------------------
revoke all on function private.closed_line_hold(uuid, uuid, public.connector_provider, text, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function private.review_held_changes(uuid[]) from public, anon;
grant execute on function private.review_held_changes(uuid[]) to authenticated, service_role;
revoke all on function private.review_held_change_guard() from public, anon, authenticated, service_role;
revoke all on function private.leave_held(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.undo_held_change_left(uuid, private.mcp_writes) from public, anon, authenticated, service_role;

revoke all on function public.leave_held_change(uuid) from public, anon, authenticated, service_role;
grant execute on function public.leave_held_change(uuid) to authenticated;
revoke all on function public.mcp_leave_held_change(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_leave_held_change(text, uuid) to authenticated;

revoke all on function public.upsert_connector_lines(uuid, public.connector_provider, jsonb, text, text, smallint) from public, anon, authenticated;
grant execute on function public.upsert_connector_lines(uuid, public.connector_provider, jsonb, text, text, smallint) to service_role;
revoke all on function public.sync_review_queue(uuid) from public, anon, authenticated;
grant execute on function public.sync_review_queue(uuid) to service_role;
revoke all on function private.review_row_items(uuid[]) from public, anon;
grant execute on function private.review_row_items(uuid[]) to authenticated, service_role;
revoke all on function public.list_review_page(integer, date, timestamptz, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_review_page(integer, date, timestamptz, uuid, uuid, uuid) to authenticated, service_role;
revoke all on function private.mcp_refused(text) from public, anon, authenticated;
revoke all on function public.mcp_undo(text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_undo(text, text, uuid) to authenticated;
revoke all on function private.follow_invoice(uuid, boolean) from public, anon, authenticated;
grant execute on function private.follow_invoice(uuid, boolean) to service_role;
revoke all on function public.jev_prefill(uuid, uuid, uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.jev_prefill(uuid, uuid, uuid, uuid, text, numeric) to service_role;
revoke all on function public.mcp_set_books_closed_through(text, date) from public, anon, authenticated;
grant execute on function public.mcp_set_books_closed_through(text, date) to authenticated;

drop function pg_temp.anchor_count(text, text);

commit;
