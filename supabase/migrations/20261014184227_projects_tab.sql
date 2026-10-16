-- FLOW-445 server (the Projects tab): the list, the project page's figures, the type text and
-- the finish date, delete, and the MCP tools update_project and delete_project.
-- - projects.finished_on: set when a project finishes, cleared on reactivation.
-- - upsert_project takes the type text (p_type, at most 40 characters). It is stored in the
--   existing state_label column (open question 6 of the brief). The status word is derived in
--   the app, not stored.
-- - public.projects_cash_month(p_month, p_today, p_project): one month's cash per project,
--   the overhead project's included, and the unassigned bucket. Projects + unassigned add up to
--   cash_months' net for the same month (the test in supabase/tests/database/projects_tab.test.sql).
-- - public.delete_project(p_id): refused with 'in use' unless the project is empty.
-- - MCP: mcp_create_project takes type and budget_minor; mcp_update_project (undo kind
--   project_update) and mcp_delete_project (undo kind project_delete). Decision 0080 rules
--   apply: idempotency key, write rate limit (in the handler), undo.

begin;

set local lock_timeout = '5s';

alter table public.projects add column finished_on date;

comment on column public.projects.finished_on is
  'FLOW-445: the day the project was finished (status finished). Cleared when it is made active again. Null for projects finished before this column.';

-- True when nothing refers to the project: no line (filed, shared or split, removed or not), no
-- loan, no supplier that remembers it. Invoices and review rows are lines, so they count too.
-- The same rule as the project undo of create (20261010121500), now shared by delete and the list.
create function private.project_is_empty(p_company uuid, p_project uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1 from public.transactions t
    where t.company_id = p_company and t.project_id = p_project
  ) and not exists (
    select 1 from public.allocations a
    where a.company_id = p_company and a.project_id = p_project
  ) and not exists (
    select 1 from public.line_splits s
    where s.company_id = p_company and s.project_id = p_project
  ) and not exists (
    select 1 from public.split_rule_targets r
    where r.company_id = p_company and r.project_id = p_project
  ) and not exists (
    select 1 from public.suppliers sup
    where sup.company_id = p_company and sup.remembered_project_id = p_project
  ) and not exists (
    select 1 from public.loans l
    where l.company_id = p_company and l.project_id = p_project
  );
$$;

revoke all on function private.project_is_empty(uuid, uuid) from public, anon, authenticated;

-- upsert_project with the type. The old four-argument version goes; the five-argument one
-- keeps every four-argument call working (p_type defaults to null: an update keeps the stored
-- type, so a finish or a rename does not clear it).
drop function public.upsert_project(uuid, text, bigint, text);

create function public.upsert_project(
  p_id uuid default null,
  p_name text default null,
  p_budget_agorot bigint default null,
  p_status text default null,
  p_type text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  clean text;
  clean_type text;
  next_status public.project_status;
  today date := private.flow_today();
  rid uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  clean := private.trim_name(p_name);
  if char_length(clean) < 2 then
    raise exception 'project name is too short';
  end if;
  clean_type := nullif(private.trim_name(coalesce(p_type, '')), '');
  if clean_type is not null then
    if char_length(clean_type) > 40 then
      raise exception 'project type is too long';
    end if;
    if private.name_has_hidden_char(clean_type) then
      raise exception 'type has an invisible or control character' using errcode = '23514';
    end if;
  end if;
  next_status := case when p_status = 'finished' then 'finished'::public.project_status else 'active'::public.project_status end;
  if p_id is null then
    insert into public.projects (company_id, name, budget_agorot, status, state_label, finished_on)
    values (
      cid, clean, p_budget_agorot, next_status, clean_type,
      case when next_status = 'finished' then today end
    )
    returning id into rid;
    return rid;
  end if;
  update public.projects p
  set name = clean,
      budget_agorot = p_budget_agorot,
      status = next_status,
      -- A null p_type keeps the stored type (finish and rename callers do not send one); '' clears it.
      state_label = case when p_type is null then p.state_label else clean_type end,
      finished_on = case when next_status = 'finished' then coalesce(p.finished_on, today) end
  where p.id = p_id and p.company_id = cid
  returning p.id into rid;
  if rid is null then
    raise exception 'project not found';
  end if;
  return rid;
end;
$$;

revoke all on function public.upsert_project(uuid, text, bigint, text, text) from public, anon;
grant execute on function public.upsert_project(uuid, text, bigint, text, text) to authenticated, service_role;

-- Delete a project (owner or editor). Refused with 'in use' while anything refers to it. Returns
-- the deleted row, so an undo can put it back with the same id.
create function public.delete_project(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  snapshot jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  select to_jsonb(p) into snapshot
  from public.projects p
  where p.id = p_id and p.company_id = cid
  for update;
  if snapshot is null then
    raise exception 'project not found';
  end if;
  if exists (select 1 from public.companies c where c.id = cid and c.overhead_project_id = p_id) then
    raise exception 'the overhead project cannot be deleted' using errcode = '23514';
  end if;
  if not private.project_is_empty(cid, p_id) then
    raise exception 'in use';
  end if;
  delete from public.projects p
  where p.id = p_id and p.company_id = cid;
  return snapshot;
end;
$$;

revoke all on function public.delete_project(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_project(uuid) to authenticated;

-- One month's cash per project. The same parts as cash_months (private.cash_parts, in-cash
-- parts only, so a line the view leaves out is in neither). A part filed or split to a project
-- counts whole, the overhead project's included. A shared part splits by its allocations: the
-- rounding goes to the largest share, and a part no allocation covers is unassigned. Every
-- company line lands in one bucket, so the projects, plus unassigned, add up to cash_months'
-- net for the month.
create function public.projects_cash_month(
  p_month date default null,
  p_today date default null,
  p_project uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  month_start date;
  month_end date;
  basis text;
  base text;
  overhead_id uuid;
  month_pnl jsonb;
  all_pnl jsonb;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_project is not null and not exists (
    select 1 from public.projects p where p.id = p_project and p.company_id = cid
  ) then
    return null;
  end if;
  select c.cash_basis, c.base_currency, c.overhead_project_id
  into basis, base, overhead_id
  from public.companies c
  where c.id = cid;
  month_start := date_trunc('month', coalesce(p_month, today))::date;
  month_end := (month_start + interval '1 month' - interval '1 day')::date;
  month_pnl := public.company_pnl(cid, month_start, month_end, basis);
  all_pnl := public.company_pnl(cid, null, null, basis);

  with parts as (
    select * from private.cash_parts(cid, basis, month_start, month_end)
    where in_cash
  ),
  direct_parts as (
    select p.transaction_id, p.currency, p.kind, p.project_id as owner_id, p.amount_minor
    from parts p
    where p.pnl_role is distinct from 'shared' and p.project_id is not null
  ),
  unfiled_parts as (
    select p.transaction_id, p.currency, p.kind, null::uuid as owner_id, p.amount_minor
    from parts p
    where p.pnl_role is distinct from 'shared' and p.project_id is null
  ),
  shared_parts as (
    select
      p.transaction_id, p.part, p.category_id, p.currency, p.kind, p.amount_minor,
      least(coalesce(sum(a.share_bp), 0), 10000) as total_bp
    from parts p
    left join public.allocations a on a.transaction_id = p.transaction_id and a.company_id = cid
    where p.pnl_role = 'shared'
    group by p.transaction_id, p.part, p.category_id, p.currency, p.kind, p.amount_minor
  ),
  shared_alloc as (
    select
      sp.transaction_id, sp.part, sp.category_id, sp.currency, sp.kind, sp.amount_minor,
      a.project_id,
      a.share_bp,
      private.div_half_even(sp.amount_minor::numeric * a.share_bp, 10000::numeric) as share_minor,
      private.div_half_even(sp.amount_minor::numeric * sp.total_bp, 10000::numeric) as alloc_total
    from shared_parts sp
    join public.allocations a on a.transaction_id = sp.transaction_id and a.company_id = cid
  ),
  shared_owned as (
    select
      x.transaction_id, x.currency, x.kind, x.project_id as owner_id,
      (x.share_minor + case
        when row_number() over (partition by x.transaction_id, x.part, x.category_id order by x.share_bp desc, x.project_id) = 1
          then x.alloc_total - sum(x.share_minor) over (partition by x.transaction_id, x.part, x.category_id)
        else 0
      end)::bigint as amount_minor
    from shared_alloc x
  ),
  shared_unassigned as (
    select
      sp.transaction_id, sp.currency, sp.kind, null::uuid as owner_id,
      (sp.amount_minor - private.div_half_even(sp.amount_minor::numeric * sp.total_bp, 10000::numeric))::bigint as amount_minor
    from shared_parts sp
  ),
  attributed as (
    select * from direct_parts
    union all select * from unfiled_parts
    union all select * from shared_owned
    union all select * from shared_unassigned
  ),
  project_cash as (
    select
      a.owner_id, a.currency,
      coalesce(sum(a.amount_minor) filter (where a.kind = 'income'), 0)::bigint as in_minor,
      coalesce(sum(-a.amount_minor) filter (where a.kind = 'expense'), 0)::bigint as out_minor
    from attributed a
    where a.owner_id is not null
    group by a.owner_id, a.currency
  ),
  unassigned_cash as (
    select
      a.currency,
      coalesce(sum(a.amount_minor) filter (where a.kind = 'income'), 0)::bigint as in_minor,
      coalesce(sum(-a.amount_minor) filter (where a.kind = 'expense'), 0)::bigint as out_minor
    from attributed a
    where a.owner_id is null
    group by a.currency
  ),
  unassigned_lines as (
    select count(distinct a.transaction_id)::integer as n
    from attributed a
    where a.owner_id is null and a.amount_minor <> 0
  ),
  month_rows as (
    select
      (x->>'id')::uuid as id,
      bc->>'currency' as currency,
      (bc->>'profit_minor')::bigint as profit_minor
    from jsonb_array_elements(coalesce(month_pnl->'projects', '[]'::jsonb)) x
    cross join lateral jsonb_array_elements(coalesce(x->'by_currency', '[]'::jsonb)) bc
  ),
  all_rows as (
    select
      (x->>'id')::uuid as id,
      bc->>'currency' as currency,
      (bc->>'profit_minor')::bigint as profit_minor,
      (bc->>'direct_minor')::bigint + (bc->>'shared_minor')::bigint as spent_minor
    from jsonb_array_elements(coalesce(all_pnl->'projects', '[]'::jsonb)) x
    cross join lateral jsonb_array_elements(coalesce(x->'by_currency', '[]'::jsonb)) bc
  ),
  project_rows as (
    select
      p.id,
      p.name,
      p.state_label as type,
      p.status::text as status,
      p.id is not distinct from overhead_id as is_overhead,
      p.group_id,
      p.created_at,
      p.finished_on,
      p.budget_agorot as budget_minor,
      coalesce((select r.spent_minor from all_rows r where r.id = p.id and r.currency = base), 0) as spent_minor,
      coalesce((select r.profit_minor from month_rows r where r.id = p.id and r.currency = base), 0) as profit_month_minor,
      coalesce((select r.profit_minor from all_rows r where r.id = p.id and r.currency = base), 0) as profit_all_minor,
      (
        select to_char(date_trunc('month', min(l.doc_date)), 'YYYY-MM-DD')
        from private.pnl_lines l
        where l.company_id = cid
          and l.transaction_id = any(private.project_line_ids(cid, p.id))
      ) as first_month,
      jsonb_array_length(public.project_waiting(p.id)) as pending_count,
      private.project_is_empty(cid, p.id) as deletable,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', pc.currency,
          'in_minor', pc.in_minor,
          'out_minor', pc.out_minor,
          'net_minor', pc.in_minor - pc.out_minor
        ) order by pc.currency is distinct from base, pc.currency)
        from project_cash pc
        where pc.owner_id = p.id
      ), '[]'::jsonb) as cash
    from public.projects p
    where p.company_id = cid
      and (p_project is null or p.id = p_project)
  )
  select jsonb_build_object(
    'month', to_char(month_start, 'YYYY-MM-DD'),
    'base_currency', base,
    'basis', basis,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'type', r.type,
        'status', r.status,
        'is_overhead', r.is_overhead,
        'group_id', r.group_id,
        'created_at', r.created_at,
        'finished_on', r.finished_on,
        'budget_minor', r.budget_minor,
        'spent_minor', r.spent_minor,
        'cash', r.cash,
        'profit_month_minor', r.profit_month_minor,
        'profit_all_minor', r.profit_all_minor,
        'first_month', r.first_month,
        'pending_count', r.pending_count,
        'deletable', r.deletable
      ) order by r.name)
      from project_rows r
    ), '[]'::jsonb),
    'unassigned', jsonb_build_object(
      'count', (select n from unassigned_lines),
      'cash', coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', uc.currency,
          'in_minor', uc.in_minor,
          'out_minor', uc.out_minor,
          'net_minor', uc.in_minor - uc.out_minor
        ) order by uc.currency is distinct from base, uc.currency)
        from unassigned_cash uc
      ), '[]'::jsonb)
    )
  )
  into result;

  return result;
end;
$$;

revoke all on function public.projects_cash_month(date, date, uuid) from public, anon;
grant execute on function public.projects_cash_month(date, date, uuid) to authenticated, service_role;

comment on function public.projects_cash_month(date, date, uuid) is
  'FLOW-445: one month''s cash per project (overhead project included) and the unassigned bucket. Projects + unassigned = cash_months'' net for the month.';

-- MCP create_project: type and budget_minor (the budget in the company currency's minor units,
-- stored as the project budget). The three-argument version goes; the five-argument one has
-- defaults, so mcp_create_projects' three-argument call still works.
drop function public.mcp_create_project(text, text, text);

create function public.mcp_create_project(
  p_idempotency_key text,
  p_name text,
  p_status text default null,
  p_type text default null,
  p_budget_minor bigint default null
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
  rid uuid;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_name is null
    or p_status is not null and p_status not in ('active', 'finished')
    or p_budget_minor is not null and p_budget_minor < 0
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'project|' || btrim(p_name) || '|' || coalesce(p_status, 'active')
    || case when p_type is null and p_budget_minor is null then ''
      else '|' || coalesce(p_type, '') || '|' || coalesce(p_budget_minor::text, '') end;
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
    if exists (
      select 1
      from public.projects p
      where p.company_id = cid
        and p.name = btrim(p_name)
    ) then
      response := private.mcp_refused('project already exists');
    else
      rid := public.upsert_project(null, p_name, p_budget_minor, p_status, p_type);
      insert into private.mcp_writes (token_id, user_id, kind, project_id)
      values (token, auth.uid(), 'project', rid);
      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object('id', rid, 'undo_kind', 'project')
      );
    end if;
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

revoke all on function public.mcp_create_project(text, text, text, text, bigint) from public, anon, authenticated, service_role;
grant execute on function public.mcp_create_project(text, text, text, text, bigint) to authenticated;

-- MCP update_project. p_patch holds only the fields to change: name, type (null clears it),
-- budget_minor (null clears it), status. Undo (kind project_update, the project id) puts the
-- before values back while the project still has the after values this write set.
create function public.mcp_update_project(p_idempotency_key text, p_id uuid, p_patch jsonb)
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
  cur public.projects%rowtype;
  before_state jsonb;
  after_state jsonb;
  new_name text;
  new_type text;
  new_budget bigint;
  new_status text;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_id is null
    or p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
    or p_patch = '{}'::jsonb
    or exists (
      select 1 from jsonb_object_keys(p_patch) k
      where k not in ('name', 'type', 'budget_minor', 'status')
    )
    or (p_patch ? 'status' and coalesce(p_patch->>'status', '') not in ('active', 'finished'))
    or (p_patch ? 'budget_minor' and jsonb_typeof(p_patch->'budget_minor') not in ('number', 'null'))
    or (p_patch ? 'budget_minor' and p_patch->>'budget_minor' is not null and (p_patch->>'budget_minor')::numeric < 0)
    or (p_patch ? 'name' and jsonb_typeof(p_patch->'name') <> 'string')
    or (p_patch ? 'type' and jsonb_typeof(p_patch->'type') not in ('string', 'null'))
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'project_update|' || p_id::text || '|' || p_patch::text;
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
    select p.* into cur
    from public.projects p
    where p.id = p_id and p.company_id = cid
    for update;
    if not found then
      response := private.mcp_error('not_found', 'not found');
    else
      new_name := case when p_patch ? 'name' then p_patch->>'name' else cur.name end;
      -- An empty type clears it (a null type in the patch means no type, which upsert_project reads as keep).
      new_type := case when p_patch ? 'type' then coalesce(p_patch->>'type', '') else cur.state_label end;
      new_budget := case when p_patch ? 'budget_minor' then (p_patch->>'budget_minor')::bigint else cur.budget_agorot end;
      new_status := case when p_patch ? 'status' then p_patch->>'status' else cur.status::text end;
      before_state := jsonb_build_object(
        'name', cur.name, 'type', cur.state_label, 'budget_minor', cur.budget_agorot,
        'status', cur.status::text, 'finished_on', cur.finished_on
      );
      perform public.upsert_project(p_id, new_name, new_budget, new_status, new_type);
      select jsonb_build_object(
        'name', p.name, 'type', p.state_label, 'budget_minor', p.budget_agorot,
        'status', p.status::text, 'finished_on', p.finished_on
      ) into after_state
      from public.projects p
      where p.id = p_id;
      insert into private.mcp_writes (token_id, user_id, project_id, kind, prior, created_at)
      values (
        token, auth.uid(), p_id, 'project_update',
        jsonb_build_object('before', before_state, 'after', after_state),
        clock_timestamp()
      );
      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'id', p_id,
          'name', after_state->>'name',
          'type', after_state->>'type',
          'budget_minor', after_state->'budget_minor',
          'status', after_state->>'status',
          'undo_kind', 'project_update'
        )
      );
    end if;
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm in ('project name is too short', 'project type is too long')
        or sqlerrm like 'type has an invisible%' or sqlerrm like 'name has an invisible%'
      then
        response := private.mcp_error('validation', 'validation');
      elsif sqlerrm = 'project not found' then
        response := private.mcp_error('not_found', 'not found');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_update_project(text, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.mcp_update_project(text, uuid, jsonb) to authenticated;

-- MCP delete_project. Undo (kind project_delete, the project id) puts the row back with its id.
create function public.mcp_delete_project(p_idempotency_key text, p_id uuid)
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
  removed jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'project_delete|' || p_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  response := private.mcp_error('refused', 'The write was refused.');
  begin
    removed := public.delete_project(p_id);
    insert into private.mcp_writes (token_id, user_id, project_id, kind, prior, created_at)
    values (token, auth.uid(), p_id, 'project_delete', jsonb_build_object('row', removed), clock_timestamp());
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'id', p_id,
        'name', removed->>'name',
        'undo_kind', 'project_delete'
      )
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm = 'project not found' then
        response := private.mcp_error('not_found', 'not found');
      elsif sqlstate = '23514' then
        response := private.mcp_error('validation', sqlerrm);
      elsif sqlerrm = 'in use' then
        response := private.mcp_error('refused', 'in use');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_delete_project(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_delete_project(text, uuid) to authenticated;

-- private.mcp_writes: the two kinds, with the fields their undo reads.
do $kinds$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'index_rate'::text]$a$;
  if position(anchor in def) = 0 or position(anchor in substr(def, position(anchor in def) + 1)) > 0 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, $n$'index_rate'::text, 'project_update'::text, 'project_delete'::text]$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' or position($a$(kind = 'recurring_match'::text)$a$ in def) = 0 then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'project_update'::text) AND (project_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'after'::text)) OR ((kind = 'project_delete'::text) AND (project_id IS NOT NULL) AND (prior ? 'row'::text))))$n$;
end
$kinds$;

-- public.mcp_undo: the two kinds, looked up by project id, and their branches. The branches go
-- in front of recurring_match's, as the latest kind (anchors checked: each must occur once).
create function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $undo$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);

  anchor := $a$'loan_index', 'index_rate'$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, $n$'loan_index', 'index_rate', 'project_update', 'project_delete'$n$);

  anchor := $a$        or (p_kind = 'recurring_match' and w.kind = 'recurring_match' and w.prior->>'match_party_id' = p_id::text)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind in ('project_update', 'project_delete') and w.kind = p_kind and w.project_id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'recurring_match' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo recurring_match branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'project_update' then
      select p.* into cur_project_row
      from public.projects p
      where p.id = p_id and p.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif (
        select jsonb_build_object(
          'name', cur_project_row.name, 'type', cur_project_row.state_label,
          'budget_minor', cur_project_row.budget_agorot, 'status', cur_project_row.status::text,
          'finished_on', cur_project_row.finished_on
        )
      ) is distinct from rec.prior->'after' then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          update public.projects p
          set name = rec.prior->'before'->>'name',
              state_label = rec.prior->'before'->>'type',
              budget_agorot = (rec.prior->'before'->>'budget_minor')::bigint,
              status = (rec.prior->'before'->>'status')::public.project_status,
              finished_on = (rec.prior->'before'->>'finished_on')::date
          where p.id = p_id and p.company_id = cid;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        exception
          when sqlstate '23505' or sqlstate '23514' then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'project_delete' then
      if exists (select 1 from public.projects p where p.id = p_id and p.company_id = private.current_company_id())
        or (rec.prior->'row'->>'company_id')::uuid is distinct from private.current_company_id()
      then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          insert into public.projects
          select * from jsonb_populate_record(null::public.projects, rec.prior->'row');
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        exception
          when sqlstate '23505' or sqlstate '23503' or sqlstate '23514' then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
$n$ || anchor);

  -- The branch above reads cur_project_row, so the function declares it.
  anchor := $a$  cur_found boolean;
begin$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo declarations are not the expected definition';
  end if;
  def := replace(def, anchor, $n$  cur_found boolean;
  cur_project_row public.projects%rowtype;
begin$n$);

  execute def;
end
$undo$;

drop function pg_temp.anchor_count(text, text);

commit;
