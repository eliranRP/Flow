-- The project next-month forecast (ProfitNext*) becomes editable: the user changes a row's amount,
-- takes a row out, or adds a line of a category, for one month or on a pace from that month.
-- - public.project_forecast_edits: one row per edit of one project's forecast. A row never edits a
--   recurring charge, a transaction or a category; the forecast is computed on the client and the
--   edits are applied on top (app/src/project-next-month.ts).
--   kind change: row_key (the computed row's key, `rec:<direction>:<party>` or `avg:<category|none>`,
--   or `add:<edit id>` for an added line) and amount_minor. kind remove: row_key, for one month.
--   kind add: category_id, direction and amount_minor; its row key is `add:<id>`.
--   pace once applies to start_month only; month, 2months, quarter and year from start_month on.
--   No direct table access: reads and writes go through the functions below, scoped to the
--   caller's company, and writes need an owner or an editor.
-- - public.project_forecast_edits_for(project, month): the edits that apply to that month.
--   A line may take only a category the app offers: not hidden, not out of the profit, never the loan
--   principal. A reset with a month drops the edits made for that month; with none, every edit.
-- - public.set_project_forecast_edit, remove_project_forecast_row, restore_project_forecast_row,
--   reset_project_forecast: the app's writes. Each returns `undo` ({drop, put}), which
--   public.undo_project_forecast takes back.
-- - public.mcp_set_project_forecast_edit, mcp_remove_project_forecast_row,
--   mcp_restore_project_forecast_row, mcp_reset_project_forecast: the MCP writes (idempotency key,
--   undo kind project_forecast). mcp_undo gets the kind.

begin;

set local lock_timeout = '5s';

create table public.project_forecast_edits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  kind text not null check (kind in ('change', 'remove', 'add')),
  row_key text check (row_key is null or char_length(row_key) between 1 and 200),
  category_id uuid references public.categories (id) on delete cascade,
  direction text check (direction is null or direction in ('income', 'expense')),
  amount_minor bigint check (amount_minor is null or amount_minor between 0 and 9007199254740991),
  pace text not null default 'once' check (pace in ('once', 'month', '2months', 'quarter', 'year')),
  start_month text not null check (start_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (
    (kind = 'change' and row_key is not null and amount_minor is not null and category_id is null and direction is null)
    or (kind = 'remove' and row_key is not null and amount_minor is null and category_id is null and direction is null and pace = 'once')
    or (kind = 'add' and row_key is null and category_id is not null and direction is not null and amount_minor is not null)
  )
);

comment on table public.project_forecast_edits is
  'The user''s edits of a project''s next-month forecast: a changed amount, a removed row or an added line, once or on a pace from start_month. Read and written only through the project forecast functions.';

-- One change and one removal per row and start month; a second write replaces the first.
create unique index project_forecast_edits_row
  on public.project_forecast_edits (project_id, kind, row_key, start_month)
  where kind <> 'add';
create index project_forecast_edits_project on public.project_forecast_edits (project_id, start_month);
create index project_forecast_edits_company on public.project_forecast_edits (company_id);
create index project_forecast_edits_category on public.project_forecast_edits (category_id);

alter table public.project_forecast_edits enable row level security;
revoke all on public.project_forecast_edits from public, anon, authenticated;
grant select, insert, update, delete on public.project_forecast_edits to service_role;

-- yyyy-mm as a count of months, so a pace is a remainder.
create function private.pfe_month_index(p_month text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select substr(p_month, 1, 4)::integer * 12 + substr(p_month, 6, 2)::integer - 1;
$$;

-- Whether an edit that starts in p_start on p_pace applies to p_month.
create function private.pfe_hits(p_start text, p_pace text, p_month text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select gap >= 0 and case p_pace
    when 'once' then gap = 0
    when 'month' then true
    when '2months' then gap % 2 = 0
    when 'quarter' then gap % 3 = 0
    when 'year' then gap % 12 = 0
    else false
  end
  from (select private.pfe_month_index(p_month) - private.pfe_month_index(p_start) as gap) g;
$$;

-- One edit as JSON: what the list returns, what an undo puts back, and what an MCP undo compares.
create function private.pfe_json(e public.project_forecast_edits)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id,
    'kind', e.kind,
    'row_key', e.row_key,
    'category_id', e.category_id,
    'direction', e.direction,
    'amount_minor', e.amount_minor,
    'pace', e.pace,
    'start_month', e.start_month
  );
$$;

-- The caller's company, for a write to one of its projects: owner or editor only.
create function private.pfe_writer(p_project uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  cid uuid := private.current_company_id();
begin
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_project is null or not exists (select 1 from public.projects p where p.id = p_project and p.company_id = cid) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;
  return cid;
end;
$$;

-- A month a write may start in: yyyy-mm, this month (Israel time) or later.
create function private.pfe_check_month(p_month text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'validation' using errcode = '22023';
  end if;
  if p_month < to_char(private.flow_today(), 'YYYY-MM') then
    raise exception 'month ended' using errcode = '22023';
  end if;
end;
$$;

-- A row key the forecast makes: rec:<direction>:<party uuid>, avg:<category uuid>, avg:none or add:<edit uuid>.
create function private.pfe_check_row_key(p_row_key text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_row_key is null or p_row_key !~ (
    '^(rec:(income|expense):|avg:|add:)[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  ) and p_row_key <> 'avg:none' then
    raise exception 'validation' using errcode = '22023';
  end if;
end;
$$;

-- A category a forecast line may take, as the app's category sheet offers them: the company's own, not
-- hidden, not kept out of the profit, and never the loan principal (principal is not a profit line).
create function private.pfe_category_ok(p_company uuid, p_category uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.categories c
    where c.id = p_category and c.company_id = p_company
      and not c.hidden and not c.excluded_from_pnl and c.loan_part is distinct from 'principal'
  );
$$;

-- A change of a row (row_key) or an added line (category_id, direction), with its amount and pace.
-- Returns the edit, its undo and the rows it wrote.
create function private.pfe_set(p_company uuid, p_project uuid, p_month text, p_edit jsonb)
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

-- Takes a row out of one month's forecast. A line the user added that starts this month goes outright
-- (its undo puts it back); one that started earlier, on a pace, is taken out of this month only. A row
-- already out stays out (an empty undo), also when two removals race.
create function private.pfe_remove(p_company uuid, p_project uuid, p_month text, p_row_key text)
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
  insert into public.project_forecast_edits (company_id, project_id, kind, row_key, pace, start_month, created_by)
  values (p_company, p_project, 'remove', p_row_key, 'once', p_month, auth.uid())
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

-- Brings a removed row back into the month's forecast.
create function private.pfe_restore(p_company uuid, p_project uuid, p_month text, p_row_key text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  gone jsonb;
begin
  perform private.pfe_check_month(p_month);
  perform private.pfe_check_row_key(p_row_key);
  with d as (
    delete from public.project_forecast_edits e
    where e.project_id = p_project and e.company_id = p_company and e.kind = 'remove' and e.row_key = p_row_key
      and private.pfe_hits(e.start_month, e.pace, p_month)
    returning private.pfe_json(e) as j
  )
  select coalesce(jsonb_agg(d.j), '[]'::jsonb) into gone from d;
  return jsonb_build_object('removed', jsonb_array_length(gone), 'undo', jsonb_build_object('drop', '[]'::jsonb, 'put', gone), 'after', '[]'::jsonb);
end;
$$;

-- Drops the project's edits made for one month (start_month, its removals included), or every edit of the
-- project (month null). The undo leaves out a past month's once edit: it applies to no month to come.
create function private.pfe_reset(p_company uuid, p_project uuid, p_month text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  gone jsonb;
begin
  if p_month is not null then
    perform private.pfe_check_month(p_month);
  end if;
  with d as (
    delete from public.project_forecast_edits e
    where e.project_id = p_project and e.company_id = p_company
      and (p_month is null or e.start_month = p_month)
    returning private.pfe_json(e) as j
  )
  select coalesce(jsonb_agg(d.j), '[]'::jsonb) into gone from d;
  return jsonb_build_object('removed', jsonb_array_length(gone), 'after', '[]'::jsonb, 'undo', jsonb_build_object('drop', '[]'::jsonb, 'put', (
    select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(gone) x
    where x->>'pace' <> 'once' or x->>'start_month' >= to_char(private.flow_today(), 'YYYY-MM')
  )));
end;
$$;

-- An undo: drops the edits a write made and puts back the ones it replaced or deleted. Rows of
-- another project or company are never touched. Returns how many rows it dropped and put back.
create function private.pfe_undo(p_company uuid, p_project uuid, p_undo jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
  dropped integer;
  put integer := 0;
  touched integer;
begin
  if p_undo is null or jsonb_typeof(p_undo) <> 'object'
    or exists (select 1 from jsonb_object_keys(p_undo) k where k not in ('drop', 'put'))
    or jsonb_typeof(coalesce(p_undo->'drop', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_undo->'put', '[]'::jsonb)) <> 'array'
    or exists (
      select 1 from jsonb_array_elements(coalesce(p_undo->'drop', '[]'::jsonb)) x
      where jsonb_typeof(x) <> 'string' or x #>> '{}' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    )
    or exists (
      select 1 from jsonb_array_elements(coalesce(p_undo->'put', '[]'::jsonb)) x
      where jsonb_typeof(x) <> 'object'
        or x->>'id' is null or x->>'id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        or (x->>'category_id' is not null and x->>'category_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
        or (x->'amount_minor' is not null and jsonb_typeof(x->'amount_minor') not in ('number', 'null'))
    )
  then
    raise exception 'validation' using errcode = '22023';
  end if;
  if p_project is null or not exists (select 1 from public.projects p where p.id = p_project and p.company_id = p_company) then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  delete from public.project_forecast_edits e
  where e.project_id = p_project and e.company_id = p_company
    and e.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p_undo->'drop', '[]'::jsonb)) x);
  get diagnostics dropped = row_count;

  for item in select x from jsonb_array_elements(coalesce(p_undo->'put', '[]'::jsonb)) x loop
    -- What a write could make: a key the forecast makes, a category a line may take, and a month to come
    -- (a paced edit may start earlier: a reset of it puts it back as it was).
    if item->>'row_key' is not null then
      perform private.pfe_check_row_key(item->>'row_key');
    end if;
    if item->>'start_month' is null or item->>'start_month' !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      or (coalesce(item->>'pace', 'once') = 'once' and item->>'start_month' < to_char(private.flow_today(), 'YYYY-MM'))
    then
      raise exception 'validation' using errcode = '22023';
    end if;
    if item->>'category_id' is not null and not private.pfe_category_ok(p_company, (item->>'category_id')::uuid) then
      raise exception 'category not found' using errcode = 'P0002';
    end if;
    insert into public.project_forecast_edits as e
      (id, company_id, project_id, kind, row_key, category_id, direction, amount_minor, pace, start_month, created_by)
    values (
      (item->>'id')::uuid, p_company, p_project, item->>'kind', item->>'row_key', (item->>'category_id')::uuid,
      item->>'direction', (item->>'amount_minor')::bigint, coalesce(item->>'pace', 'once'), item->>'start_month', auth.uid()
    )
    on conflict (id) do update
    set kind = excluded.kind, row_key = excluded.row_key, category_id = excluded.category_id,
        direction = excluded.direction, amount_minor = excluded.amount_minor, pace = excluded.pace,
        start_month = excluded.start_month, created_by = excluded.created_by
    where e.project_id = p_project and e.company_id = p_company;
    get diagnostics touched = row_count;
    put := put + touched;
  end loop;
  return jsonb_build_object('dropped', dropped, 'put', put);
end;
$$;

-- Whether every row an MCP write left is still as it left it (else its undo is a conflict).
create function private.pfe_unchanged(p_company uuid, p_after jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not exists (
    select 1 from jsonb_array_elements(coalesce(p_after, '[]'::jsonb)) x
    where not exists (
      select 1 from public.project_forecast_edits e
      where e.id = (x->>'id')::uuid and e.company_id = p_company and private.pfe_json(e.*) = x
    )
  );
$$;

revoke all on function private.pfe_month_index(text) from public, anon, authenticated;
revoke all on function private.pfe_hits(text, text, text) from public, anon, authenticated;
revoke all on function private.pfe_json(public.project_forecast_edits) from public, anon, authenticated;
revoke all on function private.pfe_writer(uuid) from public, anon, authenticated;
revoke all on function private.pfe_check_month(text) from public, anon, authenticated;
revoke all on function private.pfe_check_row_key(text) from public, anon, authenticated;
revoke all on function private.pfe_category_ok(uuid, uuid) from public, anon, authenticated;
revoke all on function private.pfe_set(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.pfe_remove(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function private.pfe_restore(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function private.pfe_reset(uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.pfe_undo(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.pfe_unchanged(uuid, jsonb) from public, anon, authenticated;

-- The edits that apply to one month of a project of the caller's company (viewers included), with
-- an added line's category name. Another company's project reads as no edits.
create function public.project_forecast_edits_for(p_project_id uuid, p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'validation' using errcode = '22023';
  end if;
  return (
    select coalesce(jsonb_agg(private.pfe_json(e.*) || jsonb_build_object('category_name', c.name) order by e.created_at, e.id), '[]'::jsonb)
    from public.project_forecast_edits e
    left join public.categories c on c.id = e.category_id
    where e.company_id = private.readable_company_id()
      and e.project_id = p_project_id
      and private.pfe_hits(e.start_month, e.pace, p_month)
  );
end;
$$;

revoke all on function public.project_forecast_edits_for(uuid, text) from public, anon;
grant execute on function public.project_forecast_edits_for(uuid, text) to authenticated, service_role;

-- The app's writes (owner or editor). Each returns the edit (or what went) and its undo.
create function public.set_project_forecast_edit(p_project_id uuid, p_month text, p_edit jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.pfe_set(private.pfe_writer(p_project_id), p_project_id, p_month, p_edit) - 'after';
end;
$$;

create function public.remove_project_forecast_row(p_project_id uuid, p_month text, p_row_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.pfe_remove(private.pfe_writer(p_project_id), p_project_id, p_month, p_row_key) - 'after';
end;
$$;

create function public.restore_project_forecast_row(p_project_id uuid, p_month text, p_row_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.pfe_restore(private.pfe_writer(p_project_id), p_project_id, p_month, p_row_key) - 'after';
end;
$$;

create function public.reset_project_forecast(p_project_id uuid, p_month text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.pfe_reset(private.pfe_writer(p_project_id), p_project_id, p_month) - 'after';
end;
$$;

create function public.undo_project_forecast(p_project_id uuid, p_undo jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.pfe_undo(private.pfe_writer(p_project_id), p_project_id, p_undo);
end;
$$;

revoke all on function public.set_project_forecast_edit(uuid, text, jsonb) from public, anon;
revoke all on function public.remove_project_forecast_row(uuid, text, text) from public, anon;
revoke all on function public.restore_project_forecast_row(uuid, text, text) from public, anon;
revoke all on function public.reset_project_forecast(uuid, text) from public, anon;
revoke all on function public.undo_project_forecast(uuid, jsonb) from public, anon;
grant execute on function public.set_project_forecast_edit(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.remove_project_forecast_row(uuid, text, text) to authenticated, service_role;
grant execute on function public.restore_project_forecast_row(uuid, text, text) to authenticated, service_role;
grant execute on function public.reset_project_forecast(uuid, text) to authenticated, service_role;
grant execute on function public.undo_project_forecast(uuid, jsonb) to authenticated, service_role;

-- The MCP writes share one body: the gate, the idempotency key, one write row (kind
-- project_forecast, its undo and the rows it left) and a stored response.
create function private.pfe_mcp(p_idempotency_key text, p_op text, p_project uuid, p_month text, p_arg jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  result jsonb;
  wid uuid;
  response jsonb;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 1 or char_length(p_idempotency_key) > 128
    or p_project is null or (p_op <> 'reset' and p_month is null)
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'project_forecast|' || p_op || '|' || p_project::text || '|' || coalesce(p_month, '') || '|' || coalesce(p_arg::text, '');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  response := private.mcp_error('refused', 'The write was refused.');
  begin
    cid := private.pfe_writer(p_project);
    result := case p_op
      when 'set' then private.pfe_set(cid, p_project, p_month, p_arg)
      when 'remove' then private.pfe_remove(cid, p_project, p_month, p_arg #>> '{}')
      when 'restore' then private.pfe_restore(cid, p_project, p_month, p_arg #>> '{}')
      when 'reset' then private.pfe_reset(cid, p_project, p_month)
    end;
    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior, created_at)
    values (
      token, auth.uid(), cid, 'project_forecast',
      jsonb_build_object('project_id', p_project, 'undo', result->'undo', 'after', result->'after'),
      clock_timestamp()
    )
    returning id into wid;
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'id', wid,
        'project_id', p_project,
        'month', p_month,
        'edit', result->'edit',
        'removed', result->'removed',
        'undo_kind', 'project_forecast'
      ) - (case when result ? 'edit' then 'removed' else 'edit' end)
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm = 'validation' then
        response := private.mcp_error('validation', 'validation');
      elsif sqlerrm = 'month ended' then
        response := private.mcp_error('refused', 'month ended');
      elsif sqlerrm in ('project not found', 'category not found') then
        response := private.mcp_error('not_found', sqlerrm);
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function private.pfe_mcp(text, text, uuid, text, jsonb) from public, anon, authenticated;

create function public.mcp_set_project_forecast_edit(p_idempotency_key text, p_project_id uuid, p_month text, p_edit jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.pfe_mcp(p_idempotency_key, 'set', p_project_id, p_month, p_edit); $$;

create function public.mcp_remove_project_forecast_row(p_idempotency_key text, p_project_id uuid, p_month text, p_row_key text)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.pfe_mcp(p_idempotency_key, 'remove', p_project_id, p_month, to_jsonb(p_row_key)); $$;

create function public.mcp_restore_project_forecast_row(p_idempotency_key text, p_project_id uuid, p_month text, p_row_key text)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.pfe_mcp(p_idempotency_key, 'restore', p_project_id, p_month, to_jsonb(p_row_key)); $$;

create function public.mcp_reset_project_forecast(p_idempotency_key text, p_project_id uuid, p_month text default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.pfe_mcp(p_idempotency_key, 'reset', p_project_id, p_month, null); $$;

revoke all on function public.mcp_set_project_forecast_edit(text, uuid, text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.mcp_remove_project_forecast_row(text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.mcp_restore_project_forecast_row(text, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.mcp_reset_project_forecast(text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_project_forecast_edit(text, uuid, text, jsonb) to authenticated;
grant execute on function public.mcp_remove_project_forecast_row(text, uuid, text, text) to authenticated;
grant execute on function public.mcp_restore_project_forecast_row(text, uuid, text, text) to authenticated;
grant execute on function public.mcp_reset_project_forecast(text, uuid, text) to authenticated;

-- private.mcp_writes: the kind and the fields its undo reads (anchors checked: each must occur
-- once in the live definition, as in 20261016221417_forecast_overrides.sql).
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $kinds$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'forecast_reset'::text]$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, $n$'forecast_reset'::text, 'project_forecast'::text]$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' or pg_temp.anchor_count(def, $a$(kind = 'forecast_reset'::text)$a$) <> 1 then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'project_forecast'::text) AND (company_id IS NOT NULL) AND (prior ? 'project_id'::text) AND (prior ? 'undo'::text) AND (prior ? 'after'::text))))$n$;
end
$kinds$;

-- public.mcp_undo: the kind, looked up by the write's id, and its branch (in front of
-- forecast_item's).
do $undo$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);

  anchor := $a$'forecast_item', 'forecast_reset', 'invoice_link'$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, $n$'forecast_item', 'forecast_reset', 'project_forecast', 'invoice_link'$n$);

  anchor := $a$        or (p_kind in ('forecast_item', 'forecast_reset') and w.kind = p_kind and w.id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'project_forecast' and w.kind = p_kind and w.id = p_id and w.company_id = cid)$n$);

  anchor := $a$    elsif p_kind = 'forecast_item' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo forecast_item branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'project_forecast' then
      -- The project's forecast goes back to before the write, when the rows it left are unchanged.
      if not private.pfe_unchanged(cid, rec.prior->'after') then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          perform private.pfe_undo(cid, (rec.prior->>'project_id')::uuid, rec.prior->'undo');
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
        exception
          when sqlstate '23505' or sqlstate '23514' or sqlstate '22023' or sqlstate 'P0002' then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
$n$ || anchor);

  execute def;
end
$undo$;

drop function pg_temp.anchor_count(text, text);

commit;
