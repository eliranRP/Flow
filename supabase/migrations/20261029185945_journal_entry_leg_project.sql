-- FLOW-176 (decision 0234): MCP set_journal_entry_leg_project sets one journal entry leg's project
-- without sending every leg. It reads the entry's legs on the books, changes the project of the leg
-- whose get_line_legs ordinal is p_leg_ordinal, and books the result through mcp_update_journal_entry
-- (its rules, refusals, version check, history and undo kind journal_entry_update), under its own
-- idempotency key with ':leg' after it. A leg it can't find is 'leg not found'.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

create function public.mcp_set_journal_entry_leg_project(
  p_idempotency_key text,
  p_journal_entry_id uuid,
  p_expected_version text,
  p_leg_ordinal integer,
  p_project_id uuid,
  p_reason text
)
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
  legs jsonb;
  has_leg boolean;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 124
    or p_journal_entry_id is null
    or p_leg_ordinal is null or p_leg_ordinal not between 1 and 50
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'journal_entry_leg_project|' || p_journal_entry_id::text || '|' || coalesce(p_expected_version, '')
    || '|' || p_leg_ordinal::text || '|' || coalesce(p_project_id::text, '') || '|' || coalesce(btrim(p_reason), '');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  -- The entry's legs as update_journal_entry takes them, the one at p_leg_ordinal on p_project_id. An
  -- entry that is not this company's journal entry goes to update_journal_entry as it is, which refuses it.
  select jsonb_agg(jsonb_build_object(
      'account_id', l.account_id,
      'amount_minor', l.amount_minor,
      'project_id', case when l.ordinal = p_leg_ordinal then p_project_id else l.project_id end
    ) order by l.ordinal),
    bool_or(l.ordinal = p_leg_ordinal)
  into legs, has_leg
  from (
    select l.account_id, l.amount_minor, l.project_id, l.ordinal
    from public.legs l
    where l.company_id = cid and l.transaction_id = p_journal_entry_id and not l.draft
      and l.leg_kind in ('item', 'journal') and l.amount_minor <> 0
      and exists (select 1 from public.journal_entries j where j.transaction_id = l.transaction_id and j.company_id = cid)
  ) l;

  if legs is not null and has_leg is distinct from true then
    response := private.mcp_refused('leg not found');
  else
    response := public.mcp_update_journal_entry(
      p_idempotency_key || ':leg', p_journal_entry_id, p_expected_version, p_reason,
      null, null, false, null, legs
    );
  end if;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_set_journal_entry_leg_project(text, uuid, text, integer, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_journal_entry_leg_project(text, uuid, text, integer, uuid, text) to authenticated;

comment on function public.mcp_set_journal_entry_leg_project(text, uuid, text, integer, uuid, text) is
  'FLOW-176: MCP set_journal_entry_leg_project. One journal entry leg''s project, booked through mcp_update_journal_entry (undo kind journal_entry_update). Decision 0234.';

do $refused$
declare
  def text;
  anchor constant text := $a$      when p_message in ('entry changed', 'not a journal entry') then p_message$a$;
begin
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  execute replace(def, anchor, $n$      when p_message in ('entry changed', 'not a journal entry', 'leg not found') then p_message$n$);
end
$refused$;

commit;
