-- FLOW-859: the undo of a line's recurring switch puts back an end date the switch cleared.
-- Since FLOW-1266 (20261123044637_flow_1266_recurring_end_date.sql), marking a charge recurring clears an end
-- date that has passed (private.write_recurring_override), so the charge comes back. The MCP undo of that write
-- (kind line_recurring) put back only the switch, so an ended charge came back active with no end date.
--
-- 1. public.set_payment_recurring reads the charge's end date before the write and returns prior_ends_on: the
--    end date the write cleared, or null when it cleared none. Its other keys are unchanged.
-- 2. public.mcp_set_line_recurring keeps that date in its undo record (prior.ends_on_before) and leaves it out
--    of its answer, which is unchanged.
-- 3. public.mcp_undo, kind line_recurring: after the switch goes back, the cleared end date goes back on the
--    same charge's row, unless the charge has an end date again (one set after the write is the owner's newer
--    word, and stays). A record written before this migration has no ends_on_before and undoes as before.
--
-- The app's undo (pace-write.ts) writes the switch back to false, and a charge marked not recurring is not
-- expected whatever its end date, so the app needs no change.
--
-- Functions only; no rows are rewritten. Signatures do not change; the patched functions keep their grants,
-- restated below as they are. CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

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

-- 1. set_payment_recurring: the end date the write cleared.
select pg_temp.patch('public.set_payment_recurring(uuid,boolean,uuid)',
  array[
    $a$  prior jsonb;
begin
$a$,
    $a$  prior := private.write_recurring_override(cid, party.direction, party.party_id, party.currency, stream,
    'recurring', to_jsonb(p_recurring));
$a$,
    $a$    || jsonb_build_object('prior_override', prior, 'override_project_id', stream);
$a$],
  array[
    $n$  prior jsonb;
  cleared date;
begin
$n$,
    $n$  -- FLOW-859: marking the charge recurring clears an end date that has passed; say which, for the undo.
  select o.ends_on into cleared
  from public.recurring_overrides o
  where o.company_id = cid and o.direction = party.direction and o.party_id = party.party_id
    and o.currency = party.currency and o.project_id is not distinct from stream;
  prior := private.write_recurring_override(cid, party.direction, party.party_id, party.currency, stream,
    'recurring', to_jsonb(p_recurring));
  if exists (
    select 1 from public.recurring_overrides o
    where o.company_id = cid and o.direction = party.direction and o.party_id = party.party_id
      and o.currency = party.currency and o.project_id is not distinct from stream
      and o.ends_on is not distinct from cleared
  ) then
    cleared := null;
  end if;
$n$,
    $n$    || jsonb_build_object('prior_override', prior, 'override_project_id', stream, 'prior_ends_on', cleared);
$n$]);

revoke all on function public.set_payment_recurring(uuid, boolean, uuid) from public, anon;
grant execute on function public.set_payment_recurring(uuid, boolean, uuid) to authenticated, service_role;

-- 2. mcp_set_line_recurring: the undo record keeps the cleared end date; the answer leaves it out.
select pg_temp.patch('public.mcp_set_line_recurring(text,uuid,boolean,uuid)',
  array[
    $a$jsonb_build_object('project', written->'override_project_id', 'before', written->'prior_override', 'written', to_jsonb(p_recurring)),
$a$,
    $a$(written - 'prior_override' - 'override_project_id')$a$],
  array[
    $n$jsonb_build_object('project', written->'override_project_id', 'before', written->'prior_override', 'written', to_jsonb(p_recurring),
          -- FLOW-859: the end date the write cleared (null: none), which the undo puts back.
          'ends_on_before', written->'prior_ends_on'),
$n$,
    $n$(written - 'prior_override' - 'override_project_id' - 'prior_ends_on')$n$]);

revoke all on function public.mcp_set_line_recurring(text, uuid, boolean, uuid) from public, anon;
grant execute on function public.mcp_set_line_recurring(text, uuid, boolean, uuid) to authenticated, service_role;

-- 3. mcp_undo, line_recurring: the cleared end date goes back after the switch.
select pg_temp.patch('public.mcp_undo(text,text,uuid)',
  array[
    $a$              (rec.prior->>'project')::uuid, 'recurring', rec.prior->'before');
$a$],
  array[
    $n$              (rec.prior->>'project')::uuid, 'recurring', rec.prior->'before');
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
$n$]);

revoke all on function public.mcp_undo(text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_undo(text, text, uuid) to authenticated;

-- The helpers are session-wide: a later migration in the same session can make its own.
drop function pg_temp.patch(text, text[], text[]);
drop function pg_temp.anchor_count(text, text);

commit;
