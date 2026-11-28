-- FLOW-865: the rest of FLOW-859. Marking a charge recurring clears an end date that has passed
-- (private.write_recurring_override, FLOW-1266); FLOW-859 made the MCP undo of a line's switch put it back.
--
-- 1. recurring_overrides.ends_on_set_at: when the charge's end date was last written or cleared (set_payment_end,
--    set_line_end_date and the undos that write it). The row's set_at moves with every field (a pace, an
--    amount), so it cannot tell the owner's end-date word apart. Null: not written since this column came.
--    write_recurring_override stamps it with the clock, for the field ends_on only.
-- 2. mcp_undo, kind line_recurring: the cleared end date goes back only when the charge has no end date now and
--    its end date was not written or cleared after the write (the owner's newer word stays). The check runs
--    before the switch goes back, since writing the switch can remove the row.
-- 3. answer_recurring_handover: a yes marks the new payee's charge recurring, which clears an end date that has
--    passed. recurring_handovers.to_ends_on_prior keeps that date (a repeated yes keeps the first one's), and
--    taking the yes back (the app's or the MCP's undo, which calls it) puts it back under the same rule as 2,
--    against the answer's set_at. Putting back the old charge's own "recurring" keeps its end date.
--
-- The app's ביטול of a mark-recurring (pace-write.ts) puts the cleared end date back with set_payment_end, which
-- it already calls; no function is added and no grant changes.
--
-- Functions and two new columns; no rows are rewritten. Signatures do not change; the patched functions keep
-- their grants, restated below as they are. CLI 2.118.0 runs each statement on its own. This file is one
-- transaction.

begin;

set local lock_timeout = '5s';

alter table public.recurring_overrides add column ends_on_set_at timestamptz;
comment on column public.recurring_overrides.ends_on_set_at is
  'FLOW-865. When ends_on was last written or cleared as its own field (the owner''s end-date word); an undo leaves an end date written after its write. Null: not since FLOW-865.';

alter table public.recurring_handovers add column to_ends_on_prior date;
comment on column public.recurring_handovers.to_ends_on_prior is
  'FLOW-865. For a yes: the passed end date that marking the new charge recurring cleared, which taking the yes back puts back. Null: none.';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (length(p_def) - length(replace(p_def, p_anchor, ''))) / nullif(length(p_anchor), 0);
$$;

-- Replaces each anchor (found exactly once) in a function's definition and runs the result.
create or replace function pg_temp.patch(p_fn text, p_from text[], p_to text[])
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

-- 1. write_recurring_override: a write or clear of the field ends_on stamps ends_on_set_at.
select pg_temp.patch('private.write_recurring_override(uuid,public.txn_direction,uuid,text,uuid,text,jsonb)',
  array[
    $a$      (company_id, direction, party_id, currency, project_id, recurring, pace, typical_amount_minor, ends_on,
        set_by, set_at)
$a$,
    $a$      case when p_field = 'ends_on' then (p_value #>> '{}')::date end,
      auth.uid(), now())
$a$,
    $a$      set_by = excluded.set_by, set_at = excluded.set_at;
$a$,
    $a$      ends_on = case when p_field = 'ends_on' then null else o.ends_on end,
      set_by = auth.uid(), set_at = now()
$a$],
  array[
    $n$      (company_id, direction, party_id, currency, project_id, recurring, pace, typical_amount_minor, ends_on,
        ends_on_set_at, set_by, set_at)
$n$,
    $n$      case when p_field = 'ends_on' then (p_value #>> '{}')::date end,
      -- FLOW-865: the clock, so a write later in the same transaction as an MCP write still reads as later.
      case when p_field = 'ends_on' then clock_timestamp() end,
      auth.uid(), now())
$n$,
    $n$      ends_on_set_at = case when p_field = 'ends_on' then excluded.ends_on_set_at else o.ends_on_set_at end,
      set_by = excluded.set_by, set_at = excluded.set_at;
$n$,
    $n$      ends_on = case when p_field = 'ends_on' then null else o.ends_on end,
      ends_on_set_at = case when p_field = 'ends_on' then clock_timestamp() else o.ends_on_set_at end,
      set_by = auth.uid(), set_at = now()
$n$]);

revoke all on function private.write_recurring_override(uuid, public.txn_direction, uuid, text, uuid, text, jsonb)
  from public, anon, authenticated;

-- 2. mcp_undo, line_recurring: the end date the owner wrote or cleared after the write stays.
select pg_temp.patch('public.mcp_undo(text,text,uuid)',
  array[
    $a$            perform private.write_recurring_override(cid, party.direction, party.party_id, party.currency,
              (rec.prior->>'project')::uuid, 'recurring', rec.prior->'before');
            -- FLOW-859: the write cleared an end date that had passed; it goes back, unless the charge has an
            -- end date again (the owner's newer word).
            if rec.prior->>'ends_on_before' is not null and not exists (
              select 1 from public.recurring_overrides o
              where o.company_id = cid and o.direction = party.direction
                and o.party_id = party.party_id and o.currency = party.currency
                and o.project_id is not distinct from (rec.prior->>'project')::uuid
                and o.ends_on is not null
            ) then
              perform private.write_recurring_override(cid, party.direction, party.party_id, party.currency,
                (rec.prior->>'project')::uuid, 'ends_on', rec.prior->'ends_on_before');
            end if;
$a$],
  array[
    $n$            -- FLOW-859: the write cleared an end date that had passed; it goes back after the switch, unless the
            -- owner's word on the end date came since: an end date now, or one written or cleared after the write
            -- (FLOW-865). Read before the switch goes back, since writing it can remove the row.
            if rec.prior->>'ends_on_before' is not null and not exists (
              select 1 from public.recurring_overrides o
              where o.company_id = cid and o.direction = party.direction
                and o.party_id = party.party_id and o.currency = party.currency
                and o.project_id is not distinct from (rec.prior->>'project')::uuid
                and (o.ends_on is not null or o.ends_on_set_at > rec.created_at)
            ) then
              perform private.write_recurring_override(cid, party.direction, party.party_id, party.currency,
                (rec.prior->>'project')::uuid, 'recurring', rec.prior->'before');
              perform private.write_recurring_override(cid, party.direction, party.party_id, party.currency,
                (rec.prior->>'project')::uuid, 'ends_on', rec.prior->'ends_on_before');
            else
              perform private.write_recurring_override(cid, party.direction, party.party_id, party.currency,
                (rec.prior->>'project')::uuid, 'recurring', rec.prior->'before');
            end if;
$n$]);

revoke all on function public.mcp_undo(text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_undo(text, text, uuid) to authenticated;

-- 3. answer_recurring_handover: the yes keeps the end date it cleared, and taking the yes back puts it back.
select pg_temp.patch('public.answer_recurring_handover(text,uuid,text,uuid,uuid,boolean,date)',
  array[
    $a$  answer_at timestamptz;
begin
$a$,
    $a$  select o.recurring into cur_from
$a$,
    $a$  select o.recurring, o.pace into cur_to, cur_to_pace
$a$,
    $a$  if found_held and held.same and p_same is not true then
$a$,
    $a$    if held.pace_set then
      perform private.write_recurring_override(cid, dir, p_to_party_id, p_currency, p_project_id,
        'pace', to_jsonb(held.to_pace_prior));
    end if;
  end if;
$a$,
    $a$      perform private.write_recurring_override(cid, dir, p_to_party_id, p_currency, p_project_id,
        'recurring', 'true'::jsonb);
    end if;
$a$,
    $a$       pace_set, to_pace_prior, set_by, set_at)
$a$,
    $a$      case when p_same and old_pace is not null and old_pace <> 'month' then cur_to_pace end,
      auth.uid(), clock_timestamp())
$a$,
    $a$        else excluded.to_pace_prior end,
$a$],
  array[
    $n$  answer_at timestamptz;
  -- FLOW-865: the two charges' end dates before this call, the one the yes cleared, and whether it goes back.
  cur_from_ends date;
  cur_to_ends date;
  to_cleared date;
  restore_to boolean;
begin
$n$,
    $n$  select o.recurring, o.ends_on into cur_from, cur_from_ends
$n$,
    $n$  select o.recurring, o.pace, o.ends_on into cur_to, cur_to_pace, cur_to_ends
$n$,
    $n$  if found_held and held.same and p_same is not true then
    -- FLOW-865: the new charge's end date the yes cleared goes back, unless the owner's word on it came since (an
    -- end date now, or one written or cleared after the answer). Read before the overrides go back, since
    -- writing them can remove the row.
    restore_to := held.to_ends_on_prior is not null and not exists (
      select 1 from public.recurring_overrides o
      where o.company_id = cid and o.direction = dir and o.party_id = p_to_party_id and o.currency = p_currency
        and o.project_id = p_project_id
        and (o.ends_on is not null or o.ends_on_set_at > held.set_at)
    );
$n$,
    $n$    if held.pace_set then
      perform private.write_recurring_override(cid, dir, p_to_party_id, p_currency, p_project_id,
        'pace', to_jsonb(held.to_pace_prior));
    end if;
    if restore_to then
      perform private.write_recurring_override(cid, dir, p_to_party_id, p_currency, p_project_id,
        'ends_on', to_jsonb(held.to_ends_on_prior));
    end if;
    -- Putting back the old charge's own "recurring" clears an end date that has passed; the old charge keeps it.
    if cur_from_ends is not null and not exists (
      select 1 from public.recurring_overrides o
      where o.company_id = cid and o.direction = dir and o.party_id = p_party_id and o.currency = p_currency
        and o.project_id = p_project_id and o.ends_on = cur_from_ends
    ) then
      perform private.write_recurring_override(cid, dir, p_party_id, p_currency, p_project_id,
        'ends_on', to_jsonb(cur_from_ends));
    end if;
  end if;
$n$,
    $n$      perform private.write_recurring_override(cid, dir, p_to_party_id, p_currency, p_project_id,
        'recurring', 'true'::jsonb);
      -- FLOW-865: marking the new charge recurring clears an end date that has passed; the answer keeps it.
      if cur_to_ends is not null and not exists (
        select 1 from public.recurring_overrides o
        where o.company_id = cid and o.direction = dir and o.party_id = p_to_party_id and o.currency = p_currency
          and o.project_id = p_project_id and o.ends_on = cur_to_ends
      ) then
        to_cleared := cur_to_ends;
      end if;
    end if;
$n$,
    $n$       pace_set, to_pace_prior, to_ends_on_prior, set_by, set_at)
$n$,
    $n$      case when p_same and old_pace is not null and old_pace <> 'month' then cur_to_pace end,
      case when p_same then to_cleared end,
      auth.uid(), clock_timestamp())
$n$,
    $n$        else excluded.to_pace_prior end,
      -- FLOW-865: a repeated yes keeps the end date the first one cleared.
      to_ends_on_prior = case when h.same and excluded.same then coalesce(h.to_ends_on_prior, excluded.to_ends_on_prior)
        else excluded.to_ends_on_prior end,
$n$]);

revoke all on function public.answer_recurring_handover(text, uuid, text, uuid, uuid, boolean, date) from public, anon;
grant execute on function public.answer_recurring_handover(text, uuid, text, uuid, uuid, boolean, date)
  to authenticated, service_role;

-- The helpers are session-wide: a later migration in the same session can make its own.
drop function pg_temp.patch(text, text[], text[]);
drop function pg_temp.anchor_count(text, text);

commit;
