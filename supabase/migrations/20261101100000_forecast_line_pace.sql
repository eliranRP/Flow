-- FLOW-1010 (owner, 2026-11-01: "I want to be able to add it as a recurring income", on a line they added to a
-- project's forecast, from the תזרים צפוי item page). set_project_forecast_edit with row_key add:<id>, in the
-- month the line starts, now edits the line itself (its amount and its pace) instead of adding a change on top,
-- so the line can be made to repeat (decision 0243). In a later month it is still a change of that month. The
-- rest of private.pfe_set is as 20261018191737_project_forecast_edits.sql wrote it.
begin;
set local lock_timeout = '5s';

create or replace function private.pfe_set(p_company uuid, p_project uuid, p_month text, p_edit jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_amount bigint;
  v_pace text;
  v_row_key text;
  cat uuid;
  dir text;
  cat_kind text;
  prior public.project_forecast_edits%rowtype;
  added public.project_forecast_edits%rowtype;
  gone jsonb;
  written public.project_forecast_edits%rowtype;
  undo jsonb;
begin
  perform private.pfe_check_month(p_month);
  if p_edit is null or jsonb_typeof(p_edit) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_edit) k where k not in ('row_key', 'category_id', 'direction', 'amount_minor', 'pace'))
    or jsonb_typeof(p_edit->'amount_minor') is distinct from 'number'
    or (p_edit->>'amount_minor')::numeric < 0
    or (p_edit->>'amount_minor')::numeric > 9007199254740991
    or (p_edit->>'amount_minor')::numeric <> trunc((p_edit->>'amount_minor')::numeric)
    or (p_edit ? 'pace' and coalesce(p_edit->>'pace', '') not in ('once', 'month', '2months', 'quarter', 'year'))
    or (p_edit ? 'row_key' and jsonb_typeof(p_edit->'row_key') <> 'string')
    or (p_edit ? 'row_key' and (p_edit ? 'category_id' or p_edit ? 'direction'))
    or (not p_edit ? 'row_key' and jsonb_typeof(p_edit->'category_id') is distinct from 'string')
    or (p_edit ? 'direction' and coalesce(p_edit->>'direction', '') not in ('income', 'expense'))
  then
    raise exception 'validation' using errcode = '22023';
  end if;
  v_amount := (p_edit->>'amount_minor')::bigint;
  v_pace := coalesce(p_edit->>'pace', 'once');

  if p_edit ? 'row_key' then
    v_row_key := p_edit->>'row_key';
    perform private.pfe_check_row_key(v_row_key);
    -- FLOW-1010: a line the owner added, edited in the month it starts, is the line itself: its amount and its
    -- pace change, so כל כמה זמן makes it repeat. Its undo puts the line back as it was. A later month's edit
    -- of it stays a change of that month.
    if v_row_key like 'add:%' then
      select * into added from public.project_forecast_edits e
      where e.id = substr(v_row_key, 5)::uuid and e.project_id = p_project and e.company_id = p_company and e.kind = 'add'
      for update;
      if found and added.start_month = p_month then
        -- A change of the line made for this month before (the old path) would still set its amount: it goes,
        -- and the undo puts it back with the line.
        with d as (
          delete from public.project_forecast_edits e
          where e.project_id = p_project and e.company_id = p_company and e.kind = 'change' and e.row_key = v_row_key
            and e.start_month = p_month
          returning private.pfe_json(e) as j
        )
        select coalesce(jsonb_agg(d.j), '[]'::jsonb) into gone from d;
        update public.project_forecast_edits e
        set amount_minor = v_amount, pace = v_pace, created_by = auth.uid(), created_at = now()
        where e.id = added.id
        returning * into written;
        return jsonb_build_object('edit', private.pfe_json(written),
          'undo', jsonb_build_object('drop', '[]'::jsonb, 'put', jsonb_build_array(private.pfe_json(added)) || gone),
          'after', jsonb_build_array(private.pfe_json(written)));
      end if;
    end if;
    select * into prior from public.project_forecast_edits e
    where e.project_id = p_project and e.kind = 'change' and e.row_key = v_row_key and e.start_month = p_month
    for update;
    if found then
      update public.project_forecast_edits e
      set amount_minor = v_amount, pace = v_pace, created_by = auth.uid(), created_at = now()
      where e.id = prior.id
      returning * into written;
      undo := jsonb_build_object('drop', '[]'::jsonb, 'put', jsonb_build_array(private.pfe_json(prior)));
    else
      insert into public.project_forecast_edits (company_id, project_id, kind, row_key, amount_minor, pace, start_month, created_by)
      values (p_company, p_project, 'change', v_row_key, v_amount, v_pace, p_month, auth.uid())
      returning * into written;
      undo := jsonb_build_object('drop', jsonb_build_array(written.id), 'put', '[]'::jsonb);
    end if;
  else
    if p_edit->>'category_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'validation' using errcode = '22023';
    end if;
    cat := (p_edit->>'category_id')::uuid;
    if not private.pfe_category_ok(p_company, cat) then
      raise exception 'category not found' using errcode = 'P0002';
    end if;
    select c.kind::text into cat_kind from public.categories c where c.id = cat and c.company_id = p_company;
    dir := coalesce(p_edit->>'direction', cat_kind);
    insert into public.project_forecast_edits (company_id, project_id, kind, category_id, direction, amount_minor, pace, start_month, created_by)
    values (p_company, p_project, 'add', cat, dir, v_amount, v_pace, p_month, auth.uid())
    returning * into written;
    undo := jsonb_build_object('drop', jsonb_build_array(written.id), 'put', '[]'::jsonb);
  end if;
  return jsonb_build_object('edit', private.pfe_json(written), 'undo', undo, 'after', jsonb_build_array(private.pfe_json(written)));
end;
$$;

revoke all on function private.pfe_set(uuid, uuid, text, jsonb) from public, anon, authenticated;

commit;
