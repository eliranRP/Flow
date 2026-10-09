-- FLOW-406 server 2 (decision 0164): project groups, one level.
-- public.project_groups holds a company's groups; projects.group_id puts a project in at most
-- one. Deleting a group keeps its projects and their lines, with no group.
-- company_pnl adds groups[] (each group's figures summed from its projects' rows, so a line
-- still counts once) and group_id on each project row. get_project_group is the drill-in.
-- App RPCs: upsert_project_group, delete_project_group, set_project_group, list_project_groups.
-- MCP: mcp_create_project_group (undo kind project_group) and mcp_set_project_group (undo kind
-- project_group_member). Every number comes from SQL (decision 0084).

begin;
set local lock_timeout = '5s';

create table public.project_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name),
  unique (company_id, id)
);

comment on table public.project_groups is
  'FLOW-406: a group of projects, one level. Its figures are the sum of its projects. Decision 0164.';

create trigger project_groups_touch
  before update on public.project_groups
  for each row execute function private.touch_updated_at();
create trigger project_groups_audit
  after insert or update or delete on public.project_groups
  for each row execute function private.audit_row();
create trigger project_groups_clean_name
  before insert on public.project_groups
  for each row
  execute function private.clean_row_name();
create trigger project_groups_clean_name_update
  before update of name on public.project_groups
  for each row
  when (new.name is distinct from old.name)
  execute function private.clean_row_name();

-- As projects: viewers read, the owner writes.
alter table public.project_groups enable row level security;
create policy project_groups_select on public.project_groups
  for select to authenticated
  using (company_id = (select private.readable_company_id()));
create policy project_groups_insert on public.project_groups
  for insert to authenticated
  with check (company_id = (select private.current_company_id()));
create policy project_groups_update on public.project_groups
  for update to authenticated
  using (company_id = (select private.current_company_id()))
  with check (company_id = (select private.current_company_id()));
create policy project_groups_delete on public.project_groups
  for delete to authenticated
  using (company_id = (select private.current_company_id()));
revoke all on public.project_groups from public, anon;
grant select, insert, update, delete on public.project_groups to authenticated, service_role;

alter table public.projects add column group_id uuid;
alter table public.projects
  add constraint projects_group_fkey foreign key (company_id, group_id)
  references public.project_groups (company_id, id) on delete set null (group_id);
create index projects_group_idx on public.projects (company_id, group_id) where group_id is not null;

comment on column public.projects.group_id is
  'FLOW-406: the project''s group (one at most). Decision 0164.';

-- Create (p_id null) or rename a group (owner only). Names follow the project and category rules.
create function public.upsert_project_group(p_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  clean text;
  next_sort integer;
  rid uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers w where w.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  clean := private.trim_name(p_name);
  if char_length(clean) < 2 then
    raise exception 'group name is too short';
  end if;
  if char_length(clean) > 120 then
    raise exception 'group name is too long';
  end if;
  if exists (
    select 1 from public.project_groups g
    where g.company_id = cid and g.name = clean and g.id is distinct from p_id
  ) then
    raise exception 'project group already exists';
  end if;
  if p_id is null then
    select coalesce(max(g.sort_order), 0) + 1 into next_sort
    from public.project_groups g
    where g.company_id = cid;
    insert into public.project_groups (company_id, name, sort_order)
    values (cid, clean, next_sort)
    returning id into rid;
    return rid;
  end if;
  update public.project_groups g
  set name = clean
  where g.id = p_id and g.company_id = cid
  returning g.id into rid;
  if rid is null then
    raise exception 'group not found';
  end if;
  return rid;
end;
$$;

revoke all on function public.upsert_project_group(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.upsert_project_group(uuid, text) to authenticated;

-- Delete a group (owner only). Its projects keep their lines and lose the group. Returns the
-- group's name and its projects, so the app can put it back.
create function public.delete_project_group(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  gname text;
  members jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers w where w.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  select g.name into gname
  from public.project_groups g
  where g.id = p_id and g.company_id = cid
  for update;
  if not found then
    raise exception 'group not found';
  end if;
  select coalesce(jsonb_agg(p.id order by p.name), '[]'::jsonb) into members
  from public.projects p
  where p.company_id = cid and p.group_id = p_id;
  delete from public.project_groups g where g.id = p_id and g.company_id = cid;
  return jsonb_build_object('id', p_id, 'name', gname, 'project_ids', members);
end;
$$;

revoke all on function public.delete_project_group(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_project_group(uuid) to authenticated;

-- Put a project in a group, or take it out with null (owner only). Returns the group ids before
-- and after.
create function public.set_project_group(p_project_id uuid, p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  before uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers w where w.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_project_id is null then
    raise exception 'validation';
  end if;
  select p.group_id into before
  from public.projects p
  where p.id = p_project_id and p.company_id = cid
  for update;
  if not found then
    raise exception 'project not found';
  end if;
  if p_group_id is not null
     and not exists (select 1 from public.project_groups g where g.id = p_group_id and g.company_id = cid) then
    raise exception 'group not found';
  end if;
  update public.projects p
  set group_id = p_group_id
  where p.id = p_project_id and p.company_id = cid and p.group_id is distinct from p_group_id;
  return jsonb_build_object('before', before, 'after', p_group_id);
end;
$$;

revoke all on function public.set_project_group(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_project_group(uuid, uuid) to authenticated;

-- The company's groups, in order, with how many projects each holds (owner and viewers).
create function public.list_project_groups()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'sort_order', g.sort_order,
    'project_count', (
      select count(*)::integer from public.projects p
      where p.company_id = g.company_id and p.group_id = g.id
    )
  ) order by g.sort_order, g.name), '[]'::jsonb)
  from public.project_groups g
  where g.company_id = (select private.readable_company_id());
$$;

revoke all on function public.list_project_groups() from public, anon, authenticated, service_role;
grant execute on function public.list_project_groups() to authenticated, service_role;

-- company_pnl's groups[]: each group of the company summed from the project rows it already
-- built, so a group adds up to its projects and a line still counts once. Called only from
-- company_pnl (security definer), so nobody else may call it.
create function private.company_pnl_groups(p_projects jsonb, p_company uuid, p_base text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with rows as (
    select r.value as r
    from jsonb_array_elements(coalesce(p_projects, '[]'::jsonb)) r
    where r.value->>'group_id' is not null
  ),
  sums as (
    select
      (x.r->>'group_id')::uuid as group_id,
      count(*)::integer as project_count,
      sum((x.r->>'income_agorot')::bigint)::bigint as income,
      sum((x.r->>'direct_agorot')::bigint)::bigint as direct,
      sum((x.r->>'shared_agorot')::bigint)::bigint as shared,
      sum((x.r->>'profit_before_shared_agorot')::bigint)::bigint as before_shared,
      sum((x.r->>'profit_agorot')::bigint)::bigint as profit
    from rows x
    group by 1
  ),
  cur as (
    select
      (x.r->>'group_id')::uuid as group_id,
      b.value->>'currency' as currency,
      sum((b.value->>'income_minor')::bigint)::bigint as income,
      sum((b.value->>'direct_minor')::bigint)::bigint as direct,
      sum((b.value->>'shared_minor')::bigint)::bigint as shared,
      sum((b.value->>'profit_minor')::bigint)::bigint as profit
    from rows x
    cross join lateral jsonb_array_elements(coalesce(x.r->'by_currency', '[]'::jsonb)) b
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'sort_order', g.sort_order,
    'project_count', coalesce(s.project_count, 0),
    'income_agorot', coalesce(s.income, 0),
    'direct_agorot', coalesce(s.direct, 0),
    'shared_agorot', coalesce(s.shared, 0),
    'profit_before_shared_agorot', coalesce(s.before_shared, 0),
    'profit_agorot', coalesce(s.profit, 0),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', c.currency,
        'income_minor', c.income,
        'direct_minor', c.direct,
        'shared_minor', c.shared,
        'profit_minor', c.profit
      ) order by c.currency is distinct from p_base, c.currency)
      from cur c
      where c.group_id = g.id
    ), '[]'::jsonb)
  ) order by g.sort_order, g.name), '[]'::jsonb)
  from public.project_groups g
  left join sums s on s.group_id = g.id
  where g.company_id = p_company;
$$;

revoke all on function private.company_pnl_groups(jsonb, uuid, text) from public, anon, authenticated, service_role;

-- One group's figures and its projects (the company_pnl rows with this group, in the same
-- order), for the drill-in. null for an unknown group or another company's.
create function public.get_project_group(
  p_id uuid,
  p_basis text default 'cash',
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  pnl jsonb;
  grp jsonb;
begin
  cid := private.readable_company_id();
  if cid is null or p_id is null then
    return null;
  end if;
  if not exists (select 1 from public.project_groups g where g.id = p_id and g.company_id = cid) then
    return null;
  end if;
  pnl := public.company_pnl(cid, p_from, p_to, p_basis);
  select x.value into grp
  from jsonb_array_elements(pnl->'groups') x
  where x.value->>'id' = p_id::text;
  return grp || jsonb_build_object(
    'basis', pnl->'basis',
    'from', p_from,
    'to', p_to,
    'base_currency', pnl->'base_currency',
    'projects', coalesce((
      select jsonb_agg(x.value order by x.ordinality)
      from jsonb_array_elements(pnl->'projects') with ordinality x
      where x.value->>'group_id' = p_id::text
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_project_group(uuid, text, date, date) from public, anon, authenticated, service_role;
grant execute on function public.get_project_group(uuid, text, date, date) to authenticated, service_role;

-- MCP create_project_group. Undo (kind project_group, the group id) deletes it while it holds
-- no project.
create function public.mcp_create_project_group(p_idempotency_key text, p_name text)
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
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'project_group|' || private.trim_name(p_name);
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
    rid := public.upsert_project_group(null, p_name);
    insert into private.mcp_writes (token_id, user_id, kind, company_id, prior)
    values (token, auth.uid(), 'project_group', cid, jsonb_build_object('group_id', rid));
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'id', rid,
        'name', (select g.name from public.project_groups g where g.id = rid),
        'undo_kind', 'project_group'
      )
    );
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

revoke all on function public.mcp_create_project_group(text, text) from public, anon, authenticated, service_role;
grant execute on function public.mcp_create_project_group(text, text) to authenticated;

-- MCP set_project_group. Undo (kind project_group_member, the project id) puts the group back
-- while the project is still in the group this write set.
create function public.mcp_set_project_group(p_idempotency_key text, p_project_id uuid, p_group_id uuid)
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
  written jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_project_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'project_group_member|' || p_project_id::text || '|' || coalesce(p_group_id::text, '');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    written := public.set_project_group(p_project_id, p_group_id);
    insert into private.mcp_writes (token_id, user_id, project_id, kind, prior, created_at)
    values (token, auth.uid(), p_project_id, 'project_group_member', written, clock_timestamp());
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'project_id', p_project_id,
        'group_id', written->'after',
        'prior', written->'before',
        'undo_kind', 'project_group_member',
        'id', p_project_id
      )
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm = 'validation' then
        response := private.mcp_error('validation', 'validation');
      elsif sqlerrm = 'project not found' or sqlerrm = 'group not found' then
        response := private.mcp_error('not_found', sqlerrm);
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_set_project_group(text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_project_group(text, uuid, uuid) to authenticated;

-- or replace: an earlier migration may leave its copy in the session.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
  anchor text;
begin
  -- MCP refusals name the group rules, as they name the project and category ones.
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  anchor := $a$        'category already exists',
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$        'project group already exists',
        'group name is too short',
        'group name is too long',
$n$);

  -- company_pnl: group_id on each project row, and groups[] from those rows.
  def := pg_get_functiondef('public.company_pnl(uuid,date,date,text)'::regprocedure);
  anchor := $a$      p.sumit_budget_section_id,
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'company_pnl project_rows is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$      p.group_id,
$n$);
  anchor := $a$          'sumit_budget_section_id', r.sumit_budget_section_id,
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'company_pnl projects is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$          'group_id', r.group_id,
$n$);
  anchor := $a$  return result;
end;$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'company_pnl return is not the expected definition';
  end if;
  def := replace(def, anchor, $n$  if result is not null then
    result := result || jsonb_build_object(
      'groups', private.company_pnl_groups(result->'projects', p_company_id, result->>'base_currency')
    );
  end if;
$n$ || anchor);
  execute def;

  -- get_dashboard with no company: an empty groups[] too.
  def := pg_get_functiondef('public.get_dashboard(date,date,text)'::regprocedure);
  anchor := $a$      'projects', '[]'::jsonb
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'get_dashboard is not the expected definition';
  end if;
  execute replace(def, anchor, $n$      'projects', '[]'::jsonb,
      'groups', '[]'::jsonb
$n$);

  -- private.mcp_writes: the project_group and project_group_member kinds.
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'category_parent'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'project_group'::text, 'project_group_member'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'category_parent'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'project_group'::text) AND (prior ? 'group_id'::text)) OR ((kind = 'project_group_member'::text) AND (project_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'after'::text))))$n$;

  -- public.mcp_undo: the two kinds.
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$'category_parent', 'category_name'$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, $n$'category_parent', 'project_group', 'project_group_member', 'category_name'$n$);

  anchor := $a$        or (p_kind = 'category_parent' and w.kind = 'category_parent' and w.category_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'project_group' and w.kind = 'project_group' and w.prior->>'group_id' = p_id::text)
        or (p_kind = 'project_group_member' and w.kind = 'project_group_member' and w.project_id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'category_parent' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo category_parent branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'project_group' then
      perform 1 from public.project_groups g
      where g.id = p_id and g.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif exists (
        select 1 from public.projects p
        where p.company_id = cid and p.group_id = p_id
      ) or exists (
        -- An open set_project_group write would put a project back in this group.
        select 1 from private.mcp_writes w
        where w.user_id = auth.uid()
          and w.kind = 'project_group_member'
          and w.undone_at is null
          and w.prior->>'before' = p_id::text
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.project_groups g
        where g.id = p_id and g.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'project_group_member' then
      perform 1 from public.projects p
      where p.id = p_id and p.company_id = cid
        and coalesce(to_jsonb(p.group_id), 'null'::jsonb) = rec.prior->'after'
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          update public.projects p
          set group_id = (rec.prior->>'before')::uuid
          where p.id = p_id and p.company_id = cid;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        exception
          when sqlstate '23503' then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
$n$ || anchor);
  execute def;
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
