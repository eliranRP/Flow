-- FLOW-1166 part 5, the last (decision 0266; the owner's decisions of 2026-11-10 and 2026-11-13): a
-- prepaid schedule whose payment line is removed is ended, and says why; a loan inserted closed runs
-- the close check; the tagging setting's switch and mode can no longer disagree; a Jev reservation
-- its run never settles stops counting after a bounded time, and a later success clears a line's
-- failure rows. Nothing valid today is refused: each item lists the writers it was traced against.
--
-- A. prepaid_schedules: "End it and tell me" (2026-11-13).
--    How a schedule ties to its payment: prepaid_schedules.transaction_id (one schedule per line).
--    How a schedule ends today: only mcp_end_prepaid_schedule (owner or editor, the assistant
--    included): the planned rows from from_month on are dropped, `expense` adds one end row that is
--    posted as a journal entry, `keep` leaves the rest on the Prepaid account and writes nothing to
--    the ledger; status ended, ended_on and end_mode set (prepaid_schedules_ended_chk, part 1). The
--    daily job (flow-prepaid-post, private.prepaid_post_due) posts no row of a schedule whose payment
--    line is removed, so until now such a schedule stayed active and posted nothing, and its due rows
--    blocked set_books_closed_through ('post the due prepaid rows first').
--    How the payment line goes away: only by removed_at becoming non-null, written by the sync and
--    nothing else. upsert_connector_lines (a bank void, a SUMIT removal by the sweep, a held void or
--    removal replayed once its month is open again) and replace_sumit_connection (a SUMIT company
--    switch). A person cannot remove or delete a held line (transactions_prepaid_held[_delete],
--    'the line is in a prepaid schedule'); a company wipe cascades the schedule away. A void or a
--    removal held in a closed month (part 2b) leaves removed_at null: it has not happened, and the
--    schedule stays active until the replay writes it.
--    What this adds:
--    - prepaid_schedules.ended_by: why the schedule ended. person (end_prepaid_schedule) or
--      payment_removed (below); null while the schedule is not ended, and on the schedules ended
--      before this file (not guessed). prepaid_schedules_ended_by_chk.
--    - private.prepaid_end_removed: the automatic end. It does only what cannot fail: it drops the
--      planned rows and marks the schedule ended with end_mode keep, ended_on the first month that
--      will not post, ended_by payment_removed. It never posts or removes an entry (the `expense`
--      end would post through post_journal_entry, which can refuse a closed period or a missing
--      account), so the posted months stay as they are and what is left stays on the Prepaid
--      account, as `keep` does. It takes the schedule and its planned rows with SKIP LOCKED and
--      waits for no lock: when a prepaid write or the daily job holds one of them, it does nothing
--      and the daily job ends the schedule on its next run (prepaid_end_removed_all, called first by
--      prepaid_post_due for all schedules). So it raises nothing a sync could fail on, and it catches
--      nothing.
--    - The trigger transactions_prepaid_removed (after update of removed_at, null to non-null) ends
--      the line's active schedule in the sync's own statement.
--    - A line that comes back (a swept SUMIT document sent again clears removed_at) leaves the
--      schedule ended: its planned rows are gone, so nothing posts. The owner deletes the ended
--      schedule (delete_prepaid_schedule) and makes a new one if the payment is real again.
--    - prepaid_apply (every prepaid undo) restores ended_by with the rest and, when the schedule it
--      puts back is active on a removed line, ends it the same way. prepaid_snapshot leaves ended_by
--      out while it is null, so the undo tickets written before this file still compare equal.
--    - prepaid_json (list_prepaid_schedules, get_prepaid_schedule) returns ended_by.
--    - The schedules already active on a removed line are ended here, by the same function. Count,
--      read-only: select count(*) from public.prepaid_schedules s join public.transactions t
--        on t.company_id = s.company_id and t.id = s.transaction_id
--        where s.status = 'active' and t.removed_at is not null;
--
-- B. loans: loans_close_check fires on INSERT too, so a loan inserted closed or paid off runs the same
--    check as a close. Writers that insert a loan: the app's two new-loan forms (loans-host.tsx:193,
--    setup/loan-entry.tsx:48; no status, so open), mcp_add_loan (open), private.loan_restore (the
--    loan as it was, closed included, before its parts come back). legs.loan_id references loans
--    (not deferred), so a loan has no part when it is inserted and the check passes for every one of
--    them; it guards the rule if that ever changes. paid_off and closed stay the same (2026-11-10).
--    The app's direct writes to loans, each covered by the table's own checks and triggers (the move
--    to RPCs is its own task): insert (the two forms: loans_closed_chk, loans_refinance_chk,
--    loans_part_categories_check, loans_payment_covers_interest, loans_refinance_pair,
--    loans_close_check, clean_row_name); update by the loan page (loan-detail-store.ts:150: status,
--    closed_on, refinanced_into_id, project, part categories, kind, months, payment, escrow:
--    loans_close_check, loans_refinance_pair, loans_part_categories_check_update,
--    loans_payment_covers_interest and the CHECKs); update of fees_category_id by the loan match
--    (loan-match-api.tsx:156: loans_part_categories_check_update).
--
-- C. company_integrations: company_integrations_on_chk, enabled only with a mode that is not off.
--    The readers all treat the integration as on only when both say so: private.jev_has_work and
--    jev_reserve_calls (enabled and mode in shadow, auto), mcp_jev_status (the same, for `enabled`),
--    the jev-tag job (connectorDisabled: enabled is not true or mode is not shadow/auto), the app
--    (jevConnectorOn, jevSwitchOn, the setup facts: enabled and mode not off). So enabled with mode
--    off reads as off everywhere, exactly as enabled false with mode off. The card's remembered mode
--    (enabled false with shadow or auto) stays allowed. The card never writes enabled with off (its
--    switch turns off into shadow). Writers normalised here: set_company_integration (the card and
--    MCP set_jev_mode) stores enabled false when the mode it stores is off, and mcp_undo jev_mode
--    puts back a `before` the same way and compares an older `after` normalised. create_company
--    stores enabled with auto. The stored rows with enabled and mode off are set to enabled false,
--    the direction no reader can tell apart (mode stays off, so the card's switch-on still picks
--    shadow). Count, read-only:
--      select count(*) from public.company_integrations where enabled and mode = 'off';
--
-- D. jev_usage and jev_line_failures.
--    (1) private.jev_calls_today (read by jev_reserve_calls, jev_has_work and mcp_jev_status) counts
--    a reservation with no finish only for 15 minutes after its started_at (the time the run
--    reserved). The jev-tag run is an Edge Function: the platform stops it at its wall-clock limit,
--    150 seconds (JEV_TAG_LEASE_SECONDS' comment, jev_tag_plan.ts) and at most 400 seconds on a paid
--    plan; the run starts no Jev call after 100 of its 120-second budget (JEV_TAG_BUDGET_MS,
--    JEV_TAG_RESERVE_MS). 15 minutes is more than twice the longest a run can live, so a live run
--    always keeps its reservation. A late finish of a run past it still records its real calls
--    (jev_finish_usage writes any unfinished row), so nothing is counted twice. The calls a killed
--    run made before it died are not known; they stop counting with the reservation (the cap is a
--    daily cost guard, and the next day's cap would have released them anyway).
--    (2) jev_finish_usage deletes the company's jev_line_failures rows of lines that now have a
--    suggestion of the same model version. Readers of jev_line_failures: the run's work list and
--    jev_has_work (skip a failed line until retry_after; neither reads a line that has a suggestion)
--    and jev_mark_failed (attempts: 6 hours, then 24 hours from the third). A line whose call or save
--    fails gets no suggestion, and one whose fill fails has its suggestion deleted before it is
--    marked failed, so a line that keeps failing keeps its rows and its backoff; a line that
--    succeeded starts afresh if its suggestion is later removed.
--
-- Signatures do not change; the patched functions keep their grants, restated below.
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
-- A. A prepaid schedule whose payment line is removed
-- ---------------------------------------------------------------------------------------------

alter table public.prepaid_schedules add column ended_by text;
alter table public.prepaid_schedules
  add constraint prepaid_schedules_ended_by_chk
  check (ended_by is null or (status = 'ended' and ended_by in ('person', 'payment_removed')));
comment on column public.prepaid_schedules.ended_by is
  'FLOW-1166: why the schedule ended: person (end_prepaid_schedule) or payment_removed (its payment line '
  'was removed, private.prepaid_end_removed); null while not ended, and for schedules ended before 2026-11-13.';

-- Ends one active schedule whose payment line is removed, without waiting for a lock: its planned
-- rows are dropped and it is marked ended (keep, payment_removed). Posted months and the ledger are
-- not touched. Returns false, changing nothing, when the schedule is not such a schedule or a lock on
-- it or on one of its planned rows is held elsewhere (the daily job ends it later).
create function private.prepaid_end_removed(p_company uuid, p_schedule uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.prepaid_schedules%rowtype;
  planned uuid[];
  waiting integer;
  from_month date;
begin
  select x.* into s
  from public.prepaid_schedules x
  where x.company_id = p_company and x.id = p_schedule and x.status = 'active'
    and exists (
      select 1 from public.transactions t
      where t.company_id = x.company_id and t.id = x.transaction_id and t.removed_at is not null)
  for update of x skip locked;
  if not found then
    return false;
  end if;
  select coalesce(array_agg(r.id), '{}'), min(date_trunc('month', r.due_date))::date
  into planned, from_month
  from (
    select x.id, x.due_date from public.prepaid_rows x
    where x.company_id = p_company and x.schedule_id = s.id and x.entry_id is null
    for update skip locked
  ) r;
  select count(*)::integer into waiting from public.prepaid_rows x
  where x.company_id = p_company and x.schedule_id = s.id and x.entry_id is null;
  if waiting <> cardinality(planned) then
    -- A planned row is being posted by another session right now.
    return false;
  end if;
  -- The first month that will not post: the first planned one, else the month after the last posted.
  from_month := coalesce(from_month,
    (select (max(date_trunc('month', x.due_date)) + interval '1 month')::date from public.prepaid_rows x
     where x.company_id = p_company and x.schedule_id = s.id),
    s.start_month);
  delete from public.prepaid_rows x where x.company_id = p_company and x.id = any (planned);
  update public.prepaid_schedules x
  set status = 'ended', ended_on = from_month, end_mode = 'keep', ended_by = 'payment_removed'
  where x.company_id = p_company and x.id = s.id;
  return true;
end;
$$;

comment on function private.prepaid_end_removed(uuid, uuid) is
  'FLOW-1166: ends an active prepaid schedule whose payment line is removed (planned rows dropped, posted '
  'months kept, end_mode keep, ended_by payment_removed). Takes no lock it would wait for; false when it did nothing.';

-- Every active schedule whose payment line is removed: the daily job's catch-up and this file's
-- clean-up. Returns the number ended.
create function private.prepaid_end_removed_all()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  ended integer := 0;
begin
  for r in
    select s.company_id, s.id
    from public.prepaid_schedules s
    join public.transactions t on t.company_id = s.company_id and t.id = s.transaction_id
    where s.status = 'active' and t.removed_at is not null
    order by s.company_id, s.id
  loop
    if private.prepaid_end_removed(r.company_id, r.id) then
      ended := ended + 1;
    end if;
  end loop;
  return ended;
end;
$$;

-- The line's removal ends its schedule in the same statement. A line that comes back later (removed_at
-- cleared) leaves the schedule ended: this fires only on null to non-null, and nothing reopens it.
create function private.prepaid_line_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.prepaid_end_removed(s.company_id, s.id)
  from public.prepaid_schedules s
  where s.company_id = new.company_id and s.transaction_id = new.id and s.status = 'active';
  return null;
end;
$$;

create trigger transactions_prepaid_removed
  after update of removed_at on public.transactions
  for each row
  when (old.removed_at is null and new.removed_at is not null)
  execute function private.prepaid_line_removed();

revoke all on function private.prepaid_end_removed(uuid, uuid) from public, anon, authenticated;
revoke all on function private.prepaid_end_removed_all() from public, anon, authenticated;
revoke all on function private.prepaid_line_removed() from public, anon, authenticated;

-- The owner's (or the assistant's) end says so.
select pg_temp.patch('public.mcp_end_prepaid_schedule(text,uuid,text,text)',
  array[$a$set status = 'ended', ended_on = from_month, end_mode = p_remaining$a$],
  array[$n$set status = 'ended', ended_on = from_month, end_mode = p_remaining, ended_by = 'person'$n$]);
revoke all on function public.mcp_end_prepaid_schedule(text, uuid, text, text) from public, anon;
grant execute on function public.mcp_end_prepaid_schedule(text, uuid, text, text) to authenticated, service_role;

-- The tools show why.
select pg_temp.patch('private.prepaid_json(uuid,uuid)',
  array[$a$    'end_mode', s.end_mode,$a$],
  array[$n$    'end_mode', s.end_mode,
    'ended_by', s.ended_by,$n$]);
revoke all on function private.prepaid_json(uuid, uuid) from public, anon, authenticated;

-- An undo ticket's snapshot names ended_by only when it is set, so the tickets written before this
-- file (no such key) still read as their write left the schedule.
select pg_temp.patch('private.prepaid_snapshot(uuid,uuid,uuid[])',
  array[$a$      select to_jsonb(s) || jsonb_build_object($a$],
  array[$n$      select (case when s.ended_by is null then to_jsonb(s) - 'ended_by' else to_jsonb(s) end) || jsonb_build_object($n$]);
revoke all on function private.prepaid_snapshot(uuid, uuid, uuid[]) from public, anon, authenticated;

-- An undo puts ended_by back with the rest; a schedule it puts back active on a removed line is ended.
select pg_temp.patch('private.prepaid_apply(uuid,uuid,jsonb)',
  array[$a$      end_mode = excluded.end_mode,$a$,
    $a$    perform private.prepaid_settle_status(p_company, p_schedule);
  end if;$a$],
  array[$n$      end_mode = excluded.end_mode,
      ended_by = excluded.ended_by,$n$,
    $n$    perform private.prepaid_settle_status(p_company, p_schedule);
    -- FLOW-1166 part 5: a schedule put back active on a removed payment line ends as the removal does.
    perform private.prepaid_end_removed(p_company, p_schedule);
  end if;$n$]);
revoke all on function private.prepaid_apply(uuid, uuid, jsonb) from public, anon, authenticated;

-- The daily job first ends what a removal could not end at once (a lock was held elsewhere).
select pg_temp.patch('private.prepaid_post_due(date,uuid)',
  array[$a$begin
  for r in$a$],
  array[$n$begin
  -- FLOW-1166 part 5: a schedule whose payment line is removed ends (private.prepaid_end_removed).
  if p_schedule is null then
    perform private.prepaid_end_removed_all();
  end if;
  for r in$n$]);
revoke all on function private.prepaid_post_due(date, uuid) from public, anon, authenticated;

-- The schedules already active on a removed payment line.
do $clean$
declare
  n integer;
begin
  n := private.prepaid_end_removed_all();
  raise notice 'FLOW-1166 part 5: % prepaid schedule(s) ended because their payment line was removed', n;
end
$clean$;

-- ---------------------------------------------------------------------------------------------
-- B. loans: an insert runs the close check
-- ---------------------------------------------------------------------------------------------

select pg_temp.patch('private.loans_close_check()',
  array[$a$       old.status is distinct from new.status$a$],
  array[$n$       tg_op = 'INSERT'
       or old.status is distinct from new.status$n$]);
revoke all on function private.loans_close_check() from public, anon, authenticated;

drop trigger loans_close_check on public.loans;
create trigger loans_close_check
  before insert or update of status, closed_on on public.loans
  for each row execute function private.loans_close_check();

-- ---------------------------------------------------------------------------------------------
-- C. company_integrations: enabled only with a mode that is not off
-- ---------------------------------------------------------------------------------------------

select pg_temp.patch('public.set_company_integration(boolean,text,numeric,text)',
  array[$a$  values (cid, p_provider, p_enabled, next_mode, next_threshold)$a$],
  array[$n$  -- FLOW-1166 part 5: mode off is off; enabled is stored only with a mode that is on.
  values (cid, p_provider, p_enabled and next_mode <> 'off', next_mode, next_threshold)$n$]);
revoke all on function public.set_company_integration(boolean, text, numeric, text) from public, anon;
grant execute on function public.set_company_integration(boolean, text, numeric, text) to authenticated, service_role;

select pg_temp.patch('public.mcp_undo(text,text,uuid)',
  array[$a$        elsif jsonb_build_object('enabled', jev_row.enabled, 'mode', jev_row.mode, 'threshold', jev_row.threshold)
            is distinct from rec.prior->'after' then$a$,
    $a$            set enabled = (rec.prior->'before'->>'enabled')::boolean,$a$],
  array[$n$        -- FLOW-1166 part 5: a ticket written before 2026-11-13 may name enabled with mode off,
        -- which is stored as enabled false since.
        elsif jsonb_build_object('enabled', jev_row.enabled, 'mode', jev_row.mode, 'threshold', jev_row.threshold)
            is distinct from rec.prior->'after' || jsonb_build_object('enabled',
              (rec.prior->'after'->>'enabled')::boolean and rec.prior->'after'->>'mode' <> 'off') then$n$,
    $n$            set enabled = (rec.prior->'before'->>'enabled')::boolean and rec.prior->'before'->>'mode' <> 'off',$n$]);
revoke all on function public.mcp_undo(text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_undo(text, text, uuid) to authenticated;

update public.company_integrations set enabled = false where enabled and mode = 'off';

alter table public.company_integrations
  add constraint company_integrations_on_chk check (not enabled or mode <> 'off');
comment on constraint company_integrations_on_chk on public.company_integrations is
  'FLOW-1166: enabled only with mode shadow or auto (every reader needs both to treat Jev as on); '
  'enabled false may keep a remembered mode.';

-- ---------------------------------------------------------------------------------------------
-- D. jev_usage and jev_line_failures
-- ---------------------------------------------------------------------------------------------

select pg_temp.patch('private.jev_calls_today(uuid)',
  array[$a$case when u.finished_at is null then u.reserved else u.calls end$a$],
  array[$n$case
    when u.finished_at is not null then u.calls
    -- FLOW-1166 part 5: a reservation its run never settled stops counting 15 minutes after it was
    -- made, more than twice the longest an Edge run lives; a late finish still records its calls.
    when u.started_at > pg_catalog.now() - interval '15 minutes' then u.reserved
    else 0
  end$n$]);
revoke all on function private.jev_calls_today(uuid) from public, anon, authenticated;

select pg_temp.patch('public.jev_finish_usage(uuid,uuid,integer,bigint,bigint,integer,integer)',
  array[$a$    and finished_at is null;
end;$a$],
  array[$n$    and finished_at is null;
  -- FLOW-1166 part 5: a line that has a suggestion now succeeded; its earlier failures go. A line
  -- whose fill failed this run lost its suggestion before it was marked failed, so it keeps them.
  delete from public.jev_line_failures f
  where f.company_id = p_company
    and exists (
      select 1 from public.tag_suggestions s
      where s.company_id = f.company_id and s.transaction_id = f.transaction_id
        and s.model_version = f.model_version);
end;$n$]);
revoke all on function public.jev_finish_usage(uuid, uuid, integer, bigint, bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.jev_finish_usage(uuid, uuid, integer, bigint, bigint, integer, integer) to service_role;

commit;
