-- FLOW-1005 (owner, 2026-11-01): the month-end forecast (תזרים צפוי, FLOW-141) counts the owner's project
-- forecast edits for its month, as each project's צפי page does: a line they added is expected, a recurring
-- charge they removed leaves, a changed amount is the one used (decision 0240).
-- - public.company_forecast_edits_for(p_month): every edit of the company's projects (active ones and the
--   overhead project, as company_next_month_inputs reads them) that applies to the month, each with its
--   project_id and category_name, and an added line's matched_transaction_id for that month (the bank line
--   that came as it, so the forecast no longer expects it). Also the company's overhead_project_id: the
--   general charges (no project) take that project's edits. Viewers read; another company reads nothing.
begin;
set local lock_timeout = '5s';

create function public.company_forecast_edits_for(p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  overhead uuid;
  edits jsonb;
begin
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'validation' using errcode = '22023';
  end if;
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select c.overhead_project_id into overhead from public.companies c where c.id = cid;
  select coalesce(jsonb_agg(
      private.pfe_json(e.*)
        || jsonb_build_object('project_id', e.project_id, 'category_name', c.name)
        || case when e.kind = 'add' then jsonb_build_object('matched_transaction_id', m.transaction_id) else '{}'::jsonb end
      order by e.created_at, e.id), '[]'::jsonb)
  into edits
  from public.project_forecast_edits e
  left join public.categories c on c.id = e.category_id
  left join public.forecast_line_matches m on m.edit_id = e.id and m.month = p_month and m.company_id = e.company_id
  join public.projects p on p.id = e.project_id
  where e.company_id = cid
    and (p.status = 'active' or p.id = overhead)
    and private.pfe_hits(e.start_month, e.pace, p_month);
  return jsonb_build_object('month', p_month, 'overhead_project_id', overhead, 'edits', edits);
end;
$$;

revoke all on function public.company_forecast_edits_for(text) from public, anon, authenticated;
grant execute on function public.company_forecast_edits_for(text) to authenticated, service_role;

commit;
