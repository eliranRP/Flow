-- FLOW-1166 part 1 (decision 0266, item 7): the columns that make a state are tied together by one
-- CHECK, for the tables whose writers already keep the rule. Nothing valid today is refused: each
-- rule below lists the writers it was checked against, and the few writers that could still leave a
-- meaningless row are patched here to keep it.
--
-- 1. loans: a refinance link only on a loan that is not open (loans_refinance_chk), and never two
--    loans that name each other (the trigger loans_refinance_pair, on the link's writes only). Until
--    now both rules lived only in mcp_set_loan_refinance, while the app writes loans directly.
--    Patched to keep them: mcp_undo (loan_update: an undo that leaves the loan open clears the link,
--    as a reopen does; loan_refinance: the link goes back only on a loan that is not open and not into
--    a pair, else conflict) and private.loan_restore (a restored open loan comes back with no link;
--    an open loan, or the loan the restored one names, is not relinked).
--    loans_close_check still fires on update only: a loan inserted already closed has no payment to
--    check, since legs.loan_id references loans (not deferred), so no part can exist before its loan.
-- 2. projects: finished_on is null while the project is active (projects_finished_chk). A finished
--    project may have no date: those finished before the column (20261014184227).
-- 3. prepaid_schedules: ended_on and end_mode are both set exactly when the schedule ended
--    (prepaid_schedules_ended_chk, replacing prepaid_schedules_ended, which let one of them stand alone
--    on an active or completed schedule).
-- 4. company_invites: a pending invite has no decision; a decided one has its time
--    (company_invites_decided_chk). decided_by may be null on a decided invite: on delete set null.
--    invite_member: an expired pending invite no longer blocks a new invite to the same address. It is
--    cancelled (by the inviting owner, now) and a new invite is made in the same call; before, the
--    expired row came back as `existing` with its old expiry until the owner cancelled it.
--
-- Not here: company_integrations. The settings card keeps enabled with a mode it remembers
-- (enabled = false with mode auto or shadow, on purpose), and set_company_integration /
-- MCP set_jev_mode store enabled = true with mode off when asked, so no CHECK holds for every writer.
--
-- Rows written before this file may break a new rule, so each CHECK is added NOT VALID: it guards
-- every new write (a later update of such a row is refused until the row is fixed), and is validated
-- once its count below is zero. The counts, read-only:
--   loans_refinance_chk:
--     select count(*) from public.loans where refinanced_into_id is not null and status = 'open';
--   loans_refinance_pair (not a CHECK; the pairs stored today, each counted twice):
--     select count(*) from public.loans a join public.loans b
--       on b.company_id = a.company_id and b.id = a.refinanced_into_id and b.refinanced_into_id = a.id;
--   projects_finished_chk:
--     select count(*) from public.projects where status = 'active' and finished_on is not null;
--   prepaid_schedules_ended_chk:
--     select count(*) from public.prepaid_schedules
--     where (status = 'ended') <> (ended_on is not null) or (status = 'ended') <> (end_mode is not null);
--   company_invites_decided_chk:
--     select count(*) from public.company_invites
--     where (status = 'pending') <> (decided_at is null) or (status = 'pending' and decided_by is not null);
--
-- Signatures and privileges do not change: the patched functions keep their grants, restated below
-- as they are. No client list changes.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- ---------------------------------------------------------------------------------------------
-- 1. loans
-- ---------------------------------------------------------------------------------------------

-- Writers checked (status, closed_on, refinanced_into_id):
--   mcp_set_loan_refinance: names a loan only on a loan that is not open
--     (20261026155947_loan_refinanced_into.sql:97-109).
--   mcp_update_loan: a reopen clears the link in the same update (20261026155947_loan_refinanced_into.sql:261).
--   mcp_add_loan: inserts an open loan with no link (status and the link are not among its columns).
--   private.loan_restore: patched below (20261028093217_ledger_only.sql:4004-4093).
--   mcp_undo loan_update and loan_refinance: patched below.
--   The app (grant and policy 20261004055306_loans_l1.sql:321,351): the close sheet writes status,
--   closed_on and the link together, the link only with `closed` (app/src/screens/loan-close-sheet.tsx:92);
--   the reopen writes status open, no date and no link in one update
--   (app/src/screens/loan-detail-screen.tsx:348); the link picker is offered only on a closed loan
--   (loan-detail-screen.tsx:407); the new-loan forms insert no status (loans-host.tsx:193,
--   app/src/setup/loan-entry.tsx:48).
--   on delete set null (refinanced_into_id) only clears.
-- A loan that is not open (paid_off or closed, decided the same 2026-11-10) may name the loan that
-- replaced it; an open loan names none.
alter table public.loans
  add constraint loans_refinance_chk
  check (refinanced_into_id is null or status <> 'open'::public.loan_status) not valid;

-- Two loans never name each other. Only a write that sets or changes the link is checked, so a stored
-- pair (count above) does not block the pair's other edits; mcp_update_loan writes the column on
-- every update, unchanged unless it reopens.
create function private.loans_refinance_pair()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.refinanced_into_id is not null
     and (tg_op = 'INSERT' or new.refinanced_into_id is distinct from old.refinanced_into_id)
  then
    -- The named loan's row is share-locked, so two writes that would each make half of a pair run
    -- one after the other (or one stops on a deadlock) and the second sees the first.
    perform 1
    from public.loans n
    where n.company_id = new.company_id
      and n.id = new.refinanced_into_id
    for share;
    if exists (
      select 1 from public.loans n
      where n.company_id = new.company_id
        and n.id = new.refinanced_into_id
        and n.refinanced_into_id = new.id
    ) then
      raise exception 'loan_refinance_pair' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.loans_refinance_pair() from public, anon, authenticated, service_role;

create trigger loans_refinance_pair
  before insert or update of refinanced_into_id on public.loans
  for each row execute function private.loans_refinance_pair();

-- mcp_undo, loan_update: an undo that leaves the loan open (the undo of a close) leaves it with no
-- link, as a reopen does. Before, a link named after the close stayed on the reopened loan.
do $undo_update$
declare
  def text;
  anchor constant text := $a$          refinanced_into_id = case
            when l.refinanced_into_id is null$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo loan_update is not the expected definition';
  end if;
  def := replace(def, anchor, $n$          refinanced_into_id = case
            -- FLOW-1166: an open loan names no new loan (loans_refinance_chk).
            when before ? 'status' and before->>'status' = 'open' then null
            when l.refinanced_into_id is null$n$);
  execute def;
end
$undo_update$;

-- mcp_undo, loan_refinance: the link goes back only on a loan that is not open, and not when the
-- loan it names now names this one. Either is a conflict, as a link changed since is.
do $undo_refinance$
declare
  def text;
  anchor constant text := $a$        else
          update public.loans l
          set refinanced_into_id = (rec.prior->'before'->>'refinanced_into_id')::uuid
          where l.id = p_id and l.company_id = cid;$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo loan_refinance is not the expected definition';
  end if;
  def := replace(def, anchor, $n$        elsif rec.prior->'before'->>'refinanced_into_id' is not null and (
          -- FLOW-1166: loans_refinance_chk and loans_refinance_pair.
          exists (
            select 1 from public.loans o
            where o.id = p_id and o.company_id = cid and o.status = 'open'::public.loan_status
          )
          or exists (
            select 1 from public.loans n
            where n.id = (rec.prior->'before'->>'refinanced_into_id')::uuid and n.company_id = cid
              and n.refinanced_into_id = p_id
          )
        ) then
          response := private.mcp_error('conflict', 'conflict');
$n$ || anchor);
  execute def;
end
$undo_refinance$;

revoke all on function public.mcp_undo(text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_undo(text, text, uuid) to authenticated;

-- private.loan_restore: a restored open loan comes back with no link; the loans that named the
-- restored one are relinked only while they are not open, and not the loan the restored one names.
do $restore$
declare
  def text;
  a_link constant text := $a$    loan_row.refinanced_into_id := null;
  end if;$a$;
  a_relink constant text := $a$    and l.refinanced_into_id is null
    and l.id <> loan_row.id$a$;
begin
  def := pg_get_functiondef('private.loan_restore(uuid,jsonb)'::regprocedure);
  if pg_temp.anchor_count(def, a_link) <> 1 or pg_temp.anchor_count(def, a_relink) <> 1 then
    raise exception 'loan_restore is not the expected definition';
  end if;
  def := replace(def, a_link, a_link || $n$
  -- FLOW-1166: an open loan names no new loan (loans_refinance_chk).
  if loan_row.status = 'open'::public.loan_status then
    loan_row.refinanced_into_id := null;
  end if;$n$);
  def := replace(def, a_relink, a_relink || $n$
    -- FLOW-1166: loans_refinance_chk and loans_refinance_pair.
    and l.status <> 'open'::public.loan_status
    and l.id is distinct from loan_row.refinanced_into_id$n$);
  execute def;
end
$restore$;

revoke all on function private.loan_restore(uuid, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. projects
-- ---------------------------------------------------------------------------------------------

-- Writers checked (status, finished_on); the clients have select only:
--   upsert_project: a new project gets a date only when finished; an update keeps or sets it when
--     finished and clears it when active (20261014184227_projects_tab.sql, the five-argument version).
--   mcp_create_project and mcp_update_project write through upsert_project.
--   mcp_undo project_update puts back the status and date it snapshotted together; project_delete puts
--     back the deleted row as it was.
--   upsert_connector_lines inserts a SUMIT budget section as an active project with no date.
--   set_after_overhead, set_project_group, set_project_investment, map_budget_section and
--   mcp_create_project_group write neither column.
-- An active project has no finish date; a finished one has one, or none when it finished before the
-- column existed.
alter table public.projects
  add constraint projects_finished_chk
  check (status = 'finished'::public.project_status or finished_on is null) not valid;

-- ---------------------------------------------------------------------------------------------
-- 3. prepaid_schedules
-- ---------------------------------------------------------------------------------------------

-- Writers checked (status, ended_on, end_mode); the clients have select only:
--   mcp_create_prepaid_schedule inserts an active schedule with neither column
--     (20261028102302_prepaid_schedules.sql).
--   mcp_end_prepaid_schedule sets status ended, ended_on and end_mode in one update.
--   private.prepaid_settle_status moves only a schedule that is not ended, between active and
--     completed, and writes neither column.
--   mcp_update_prepaid_schedule writes neither column.
--   private.prepaid_apply (undo and delete) puts back a snapshot of a stored row (private.prepaid_snapshot),
--     or deletes the schedule.
-- An ended schedule has its end month and what happened to the rest; an active or completed one has
-- neither.
alter table public.prepaid_schedules
  add constraint prepaid_schedules_ended_chk
  check (
    (status = 'ended') = (ended_on is not null)
    and (status = 'ended') = (end_mode is not null)
  ) not valid;

alter table public.prepaid_schedules drop constraint prepaid_schedules_ended;

-- ---------------------------------------------------------------------------------------------
-- 4. company_invites
-- ---------------------------------------------------------------------------------------------

-- Writers checked (status, decided_at, decided_by); the clients have no grant:
--   invite_member inserts a pending invite with neither (and, from this file, cancels an expired one
--     as cancel_invite does).
--   accept_invite, decline_invite and cancel_invite set the status with decided_by and decided_at
--     together; reopen_invite puts a decline back to pending and clears both.
--   claim_invite_email and mark_invite_seen write neither.
--   on delete set null (decided_by) clears only who decided.
-- A pending invite has no decision; an accepted, declined or cancelled one has the time it was decided.
alter table public.company_invites
  add constraint company_invites_decided_chk
  check (
    (status = 'pending') = (decided_at is null)
    and (status <> 'pending' or decided_by is null)
  ) not valid;

-- invite_member: an expired pending invite is cancelled and a new one is made, so an expired invite
-- no longer blocks the address until the owner cancels it. The caps below count the new invite as
-- any other; an invite_limit or a full list rolls the cancel back with it.
do $invite$
declare
  def text;
  anchor constant text := $a$  if found then
    if found_invite.role is distinct from p_role then$a$;
begin
  def := pg_get_functiondef('public.invite_member(text,text)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'invite_member is not the expected definition';
  end if;
  def := replace(def, anchor, $n$  if found and found_invite.expires_at <= now() then
    -- FLOW-1166: an expired invite no longer blocks a new one to the same address.
    update public.company_invites i
    set status = 'cancelled', decided_by = uid, decided_at = now()
    where i.id = found_invite.id;
  elsif found then
    if found_invite.role is distinct from p_role then$n$);
  execute def;
end
$invite$;

revoke all on function public.invite_member(text, text) from public, anon, authenticated;
grant execute on function public.invite_member(text, text) to authenticated, service_role;

drop function pg_temp.anchor_count(text, text);

commit;
