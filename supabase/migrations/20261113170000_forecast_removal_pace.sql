-- FLOW-1184 (owner, 2026-11-13: "I want to be able to remove from a specific month and not delete for all future
-- terms"). A row taken out of a project's forecast can be out of that month only, or from it on (decision 0268,
-- amending 0239's "a removal is always from its month on").
-- - private.pfe_remove takes p_pace: 'month' (from this month on, as before) or 'once' (this month only).
--   'once' never deletes a line the owner added on a pace: it writes a removal for that month, so the line is
--   still expected in the months after. A line added for its month only ('once') is deleted outright, as before.
--   A row already out this month by a removal for this month only is taken out from it on when 'month' is asked
--   (its undo puts the one-month removal back).
-- - public.remove_project_forecast_row and public.mcp_remove_project_forecast_row take p_pace, default 'month', so
--   callers that send none keep today's answer. private.pfe_mcp reads the remove's argument as the row key, or as
--   {row_key, pace}.
begin;
set local lock_timeout = '5s';

create or replace function private.pfe_remove(p_company uuid, p_project uuid, p_month text, p_row_key text, p_pace text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  written public.project_forecast_edits%rowtype;
  added public.project_forecast_edits%rowtype;
begin
  perform private.pfe_check_month(p_month);
  perform private.pfe_check_row_key(p_row_key);
  if p_pace is null or p_pace not in ('once', 'month') then
    raise exception 'validation' using errcode = '22023';
  end if;
  if p_row_key like 'add:%' then
    select * into added from public.project_forecast_edits e
    where e.id = substr(p_row_key, 5)::uuid and e.project_id = p_project and e.company_id = p_company and e.kind = 'add'
    for update;
    -- A line that starts this month goes outright when it goes from this month on, or when it is this month's only.
    if found and added.start_month = p_month and (p_pace = 'month' or added.pace = 'once') then
      delete from public.project_forecast_edits e where e.id = added.id;
      return jsonb_build_object('edit', null, 'undo', jsonb_build_object('drop', '[]'::jsonb, 'put', jsonb_build_array(private.pfe_json(added))),
        'after', '[]'::jsonb);
    end if;
  end if;
  select * into written from public.project_forecast_edits e
  where e.project_id = p_project and e.company_id = p_company and e.kind = 'remove' and e.row_key = p_row_key
    and private.pfe_hits(e.start_month, e.pace, p_month)
  order by e.start_month desc
  limit 1
  for update;
  if found then
    -- Out for this month only, and now asked out from it on: the removal stays, from this month on.
    if p_pace = 'month' and written.pace = 'once' then
      update public.project_forecast_edits e set pace = 'month' where e.id = written.id;
      return jsonb_build_object(
        'edit', private.pfe_json(written) || jsonb_build_object('pace', 'month'),
        'undo', jsonb_build_object('drop', '[]'::jsonb, 'put', jsonb_build_array(private.pfe_json(written))),
        'after', jsonb_build_array(private.pfe_json(written) || jsonb_build_object('pace', 'month')));
    end if;
    return jsonb_build_object('edit', private.pfe_json(written), 'undo', jsonb_build_object('drop', '[]'::jsonb, 'put', '[]'::jsonb),
      'after', jsonb_build_array(private.pfe_json(written)));
  end if;
  insert into public.project_forecast_edits (company_id, project_id, kind, row_key, pace, start_month, created_by)
  values (p_company, p_project, 'remove', p_row_key, p_pace, p_month, auth.uid())
  on conflict (project_id, kind, row_key, start_month) where kind <> 'add' do nothing
  returning * into written;
  if found then
    return jsonb_build_object('edit', private.pfe_json(written), 'undo', jsonb_build_object('drop', jsonb_build_array(written.id), 'put', '[]'::jsonb),
      'after', jsonb_build_array(private.pfe_json(written)));
  end if;
  select * into written from public.project_forecast_edits e
  where e.project_id = p_project and e.kind = 'remove' and e.row_key = p_row_key and e.start_month = p_month;
  return jsonb_build_object('edit', private.pfe_json(written), 'undo', jsonb_build_object('drop', '[]'::jsonb, 'put', '[]'::jsonb),
    'after', jsonb_build_array(private.pfe_json(written)));
end;
$$;

revoke all on function private.pfe_remove(uuid, uuid, text, text, text) from public, anon, authenticated;

-- The four-argument form stays for any caller written before this change: from this month on.
create or replace function private.pfe_remove(p_company uuid, p_project uuid, p_month text, p_row_key text)
returns jsonb
language sql
set search_path = ''
as $$ select private.pfe_remove(p_company, p_project, p_month, p_row_key, 'month'); $$;

revoke all on function private.pfe_remove(uuid, uuid, text, text) from public, anon, authenticated;

drop function public.remove_project_forecast_row(uuid, text, text);

create function public.remove_project_forecast_row(p_project_id uuid, p_month text, p_row_key text, p_pace text default 'month')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.pfe_remove(private.pfe_writer(p_project_id), p_project_id, p_month, p_row_key, p_pace) - 'after';
end;
$$;

revoke all on function public.remove_project_forecast_row(uuid, text, text, text) from public, anon;
grant execute on function public.remove_project_forecast_row(uuid, text, text, text) to authenticated, service_role;

-- The MCP body: as before, with the remove's argument a row key or {row_key, pace}.
do $mcp$
declare
  def text;
  anchor constant text := 'when ''remove'' then private.pfe_remove(cid, p_project, p_month, p_arg #>> ''{}'')';
begin
  def := pg_get_functiondef('private.pfe_mcp(text, text, uuid, text, jsonb)'::regprocedure);
  if (length(def) - length(replace(def, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'private.pfe_mcp: the remove branch was not found';
  end if;
  execute replace(def, anchor,
    'when ''remove'' then (case when jsonb_typeof(p_arg) = ''object'' '
    || 'then private.pfe_remove(cid, p_project, p_month, p_arg->>''row_key'', coalesce(p_arg->>''pace'', ''month'')) '
    || 'else private.pfe_remove(cid, p_project, p_month, p_arg #>> ''{}'', ''month'') end)');
end
$mcp$;

revoke all on function private.pfe_mcp(text, text, uuid, text, jsonb) from public, anon, authenticated;

drop function public.mcp_remove_project_forecast_row(text, uuid, text, text);

-- The idempotency hash keeps a plain row key for 'month', so a retry sent before this change still replays.
create function public.mcp_remove_project_forecast_row(p_idempotency_key text, p_project_id uuid, p_month text, p_row_key text, p_pace text default 'month')
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.pfe_mcp(p_idempotency_key, 'remove', p_project_id, p_month,
    case when p_pace is distinct from 'month' then jsonb_build_object('row_key', p_row_key, 'pace', p_pace) else to_jsonb(p_row_key) end);
$$;

revoke all on function public.mcp_remove_project_forecast_row(text, uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.mcp_remove_project_forecast_row(text, uuid, text, text, text) to authenticated;

commit;
