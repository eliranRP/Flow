-- FLOW-1003 (owner, 2026-11-01: "every month I need to remove the forecast items again"). A row taken out of
-- a project's forecast stays out from that month on, until it is brought back: a removal is now an edit on
-- pace 'month', not 'once' (decision 0239, amending 0186's "always once").
-- - The table check lets a removal be 'once' or 'month'. pfe_remove writes 'month'; 'once' stays allowed so an
--   undo taken before this change still puts its row back.
-- - The removals already made become 'month', so a row removed for an earlier month stays out of this
--   month's forecast and the next ones too.
-- - pfe_remove: a row already out (by a removal made for this month or an earlier one) stays out, with
--   nothing to undo. A line the user added for this month is still deleted outright.
-- - pfe_restore already deletes every removal of the row that applies to the month, so a restore brings
--   the row back from that month on. The reads (project_forecast_edits_for, the company's next month and
--   year, the forecast line match) all go by private.pfe_hits and need no change.
begin;
set local lock_timeout = '5s';

do $check$
declare
  v_name text;
begin
  select c.conname into v_name
  from pg_constraint c
  where c.conrelid = 'public.project_forecast_edits'::regclass and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%kind = ''remove''%';
  if v_name is null then
    raise exception 'project_forecast_edits: the kind check was not found';
  end if;
  execute format('alter table public.project_forecast_edits drop constraint %I', v_name);
end
$check$;

update public.project_forecast_edits e set pace = 'month' where e.kind = 'remove' and e.pace = 'once';

alter table public.project_forecast_edits add constraint project_forecast_edits_kind_check check (
  (kind = 'change' and row_key is not null and amount_minor is not null and category_id is null and direction is null)
  or (kind = 'remove' and row_key is not null and amount_minor is null and category_id is null and direction is null and pace in ('once', 'month'))
  or (kind = 'add' and row_key is null and category_id is not null and direction is not null and amount_minor is not null)
);

comment on table public.project_forecast_edits is
  'The user''s edits of a project''s next-month forecast: a changed amount or an added line, once or on a pace from start_month, or a removed row, out from start_month on until it is brought back. Read and written only through the project forecast functions.';

-- Takes a row out of the forecast from this month on. A line the user added that starts this month goes
-- outright (its undo puts it back); one that started earlier, on a pace, is taken out from this month on.
-- A row already out, by a removal made for this month or an earlier one, stays out (an empty undo), also
-- when two removals race.
create or replace function private.pfe_remove(p_company uuid, p_project uuid, p_month text, p_row_key text)
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
  if p_row_key like 'add:%' then
    select * into added from public.project_forecast_edits e
    where e.id = substr(p_row_key, 5)::uuid and e.project_id = p_project and e.company_id = p_company and e.kind = 'add'
    for update;
    if found and added.start_month = p_month then
      delete from public.project_forecast_edits e where e.id = added.id;
      return jsonb_build_object('edit', null, 'undo', jsonb_build_object('drop', '[]'::jsonb, 'put', jsonb_build_array(private.pfe_json(added))),
        'after', '[]'::jsonb);
    end if;
  end if;
  select * into written from public.project_forecast_edits e
  where e.project_id = p_project and e.company_id = p_company and e.kind = 'remove' and e.row_key = p_row_key
    and private.pfe_hits(e.start_month, e.pace, p_month)
  order by e.start_month desc
  limit 1;
  if found then
    return jsonb_build_object('edit', private.pfe_json(written), 'undo', jsonb_build_object('drop', '[]'::jsonb, 'put', '[]'::jsonb),
      'after', jsonb_build_array(private.pfe_json(written)));
  end if;
  insert into public.project_forecast_edits (company_id, project_id, kind, row_key, pace, start_month, created_by)
  values (p_company, p_project, 'remove', p_row_key, 'month', p_month, auth.uid())
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

revoke all on function private.pfe_remove(uuid, uuid, text, text) from public, anon, authenticated;

commit;
