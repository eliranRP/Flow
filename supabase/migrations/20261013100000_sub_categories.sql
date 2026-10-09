-- FLOW-406 server 1a (decision 0164): one level of sub-categories.
-- categories.parent_id points at a parent of the same kind; a parent has no parent; loan-part
-- categories are neither. A parent keeps its own lines. Off-P&L and rehab stay per category.
-- group_name (0149) becomes the parent: it is backfilled here and then kept in step with
-- parent_id by a trigger for one release, so an older app build that writes group_name, and the
-- undo of an older category_group write, still move the parent.
-- public.set_category_parent and MCP set_category_parent (undo kind category_parent) set it;
-- create_category takes an optional parent. A category with sub-categories can't be deleted or
-- merged away. list_categories returns parent_id, children_count and rollup_lines.
-- One transaction: begin is first, commit is last.

begin;

set local lock_timeout = '5s';

alter table public.categories
  add column parent_id uuid,
  add constraint categories_parent_fkey foreign key (company_id, parent_id)
    references public.categories (company_id, id) on delete restrict,
  add constraint categories_parent_not_self check (parent_id is distinct from id);

-- group_name now mirrors the parent's name, which can be longer than the 40 letters a typed group had.
alter table public.categories drop constraint categories_group_name_check;
alter table public.categories add constraint categories_group_name_check
  check (group_name is null or (group_name = btrim(group_name) and char_length(group_name) between 1 and 120));

create index categories_parent_idx on public.categories (company_id, parent_id) where parent_id is not null;

comment on column public.categories.parent_id is
  'FLOW-406: the parent category (one level, same kind, no loan parts). Decision 0164.';

-- Resolve a group name to a parent of the same kind, making the parent when none has that name.
create function private.category_parent_by_name(p_company uuid, p_kind public.category_kind, p_name text, p_self uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pid uuid;
  next_sort integer;
begin
  if p_name is null then
    return null;
  end if;
  select c.id into pid
  from public.categories c
  where c.company_id = p_company and c.kind = p_kind and c.name = p_name;
  if pid = p_self then
    return null;
  end if;
  if pid is null then
    select coalesce(max(c.sort_order), 0) + 1 into next_sort
    from public.categories c
    where c.company_id = p_company and c.kind = p_kind;
    insert into public.categories (company_id, name, kind, sort_order, is_default, rehab)
    values (p_company, p_name, p_kind, next_sort, false, false)
    returning id into pid;
  end if;
  return pid;
end;
$$;

-- Keep parent_id and group_name in step. A parent_id change wins; a group_name-only change
-- (older app builds, the undo of a category_group write) resolves the name to a parent.
create function private.categories_parent_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.parent_id is not null
       and not exists (select 1 from public.categories c where c.id = new.parent_id and c.company_id = new.company_id) then
      -- A restored snapshot whose parent is gone comes back without one.
      new.parent_id := null;
    elsif new.parent_id is null and new.group_name is not null then
      -- An older snapshot's label joins a parent of that name only when one exists; an insert
      -- never makes a parent, so a restore can't bring back a deleted one as a new category.
      select c.id into new.parent_id
      from public.categories c
      where c.company_id = new.company_id and c.kind = new.kind and c.name = new.group_name
        and c.id <> new.id;
    end if;
  elsif new.parent_id is distinct from old.parent_id then
    null;
  elsif new.group_name is distinct from old.group_name then
    new.parent_id := private.category_parent_by_name(new.company_id, new.kind, new.group_name, new.id);
  end if;
  new.group_name := (select c.name from public.categories c where c.id = new.parent_id);
  return new;
end;
$$;

-- The rules. The parent row is locked, so two writes can't build two levels between them.
create function private.categories_parent_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent record;
begin
  if new.parent_id is not null then
    select c.parent_id, c.kind, c.loan_part into parent
    from public.categories c
    where c.id = new.parent_id and c.company_id = new.company_id
    for update;
    if not found then
      raise exception 'parent not found';
    end if;
    if parent.parent_id is not null then
      raise exception 'category_parent_nested' using errcode = '23514';
    end if;
    if parent.kind <> new.kind then
      raise exception 'category_parent_kind' using errcode = '23514';
    end if;
    if parent.loan_part is not null or new.loan_part is not null then
      raise exception 'category_parent_loan_part' using errcode = '23514';
    end if;
    if exists (select 1 from public.categories c where c.parent_id = new.id and c.company_id = new.company_id) then
      raise exception 'category_parent_nested' using errcode = '23514';
    end if;
  elsif tg_op = 'UPDATE'
     and (new.kind is distinct from old.kind or (new.loan_part is not null and old.loan_part is null))
     and exists (select 1 from public.categories c where c.parent_id = new.id and c.company_id = new.company_id) then
    raise exception 'category_has_children' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- A renamed parent renames its children's group label.
create function private.categories_parent_renamed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.categories c
  set group_name = new.name
  where c.company_id = new.company_id and c.parent_id = new.id and c.group_name is distinct from new.name;
  return null;
end;
$$;

-- delete_category and merge_category take a category away: refuse while it has sub-categories.
create function private.categories_children_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A company delete (or its owner's) cascades here with the company row already gone.
  if not exists (select 1 from public.companies co where co.id = old.company_id) then
    return old;
  end if;
  if exists (select 1 from public.categories c where c.parent_id = old.id and c.company_id = old.company_id) then
    raise exception 'category_has_children' using errcode = '23514';
  end if;
  return old;
end;
$$;

revoke all on function private.category_parent_by_name(uuid, public.category_kind, text, uuid) from public, anon, authenticated;
revoke all on function private.categories_parent_sync() from public, anon, authenticated;
revoke all on function private.categories_parent_check() from public, anon, authenticated;
revoke all on function private.categories_parent_renamed() from public, anon, authenticated;
revoke all on function private.categories_children_guard() from public, anon, authenticated;

-- Backfill (decision 0164): each group name becomes a parent, before the triggers exist. A
-- function so pgTAP can run it on made-up groups (with the triggers off) and check the totals.
create function private.backfill_category_parents()
returns void
language plpgsql
security definer
set search_path = ''
as $backfill$
declare
  g record;
  pid uuid;
  next_sort integer;
begin
  for g in
    select distinct c.company_id, c.kind, c.group_name
    from public.categories c
    where c.group_name is not null
    order by c.company_id, c.kind, c.group_name
  loop
    select c.id into pid
    from public.categories c
    where c.company_id = g.company_id and c.kind = g.kind and c.name = g.group_name;
    if pid is null then
      select coalesce(max(c.sort_order), 0) + 1 into next_sort
      from public.categories c
      where c.company_id = g.company_id and c.kind = g.kind;
      insert into public.categories (company_id, name, kind, sort_order, is_default, rehab)
      values (g.company_id, g.group_name, g.kind, next_sort, false, false)
      returning id into pid;
    elsif exists (select 1 from public.categories c where c.id = pid and c.loan_part is not null) then
      -- A loan part can't be a parent: the group stays a label until the owner regroups it.
      raise notice 'FLOW-406 backfill: group % names a loan category; left ungrouped', g.group_name;
      update public.categories c set group_name = null
      where c.company_id = g.company_id and c.kind = g.kind and c.group_name = g.group_name;
      continue;
    end if;
    -- The parent leaves its own group, and its own children if an earlier group made it one.
    update public.categories c set group_name = null, parent_id = null where c.id = pid;
    update public.categories c set parent_id = null, group_name = null
    where c.company_id = g.company_id and c.parent_id = pid;
    update public.categories c set parent_id = pid
    where c.company_id = g.company_id and c.kind = g.kind and c.group_name = g.group_name
      and c.id <> pid and c.loan_part is null
      and not exists (select 1 from public.categories k where k.parent_id = c.id);
  end loop;
  -- Loan parts and members that already lead a group keep no parent.
  update public.categories c set group_name = null
  where c.group_name is not null and c.parent_id is null;
  update public.categories c set group_name = p.name
  from public.categories p
  where p.id = c.parent_id and c.group_name is distinct from p.name;
end
$backfill$;

revoke all on function private.backfill_category_parents() from public, anon, authenticated, service_role;
select private.backfill_category_parents();

create trigger categories_parent_a_sync
  before insert or update of parent_id, group_name on public.categories
  for each row execute function private.categories_parent_sync();
-- No column list: a group_name-only write moves parent_id in _a_sync, which a column trigger
-- would not see.
create trigger categories_parent_b_check
  before insert or update on public.categories
  for each row execute function private.categories_parent_check();
create trigger categories_parent_renamed
  after update of name on public.categories
  for each row when (new.name is distinct from old.name)
  execute function private.categories_parent_renamed();
create trigger categories_children_guard
  before delete on public.categories
  for each row execute function private.categories_children_guard();

-- Set or clear a category's parent (owner only). Returns the parent ids before and after.
create function public.set_category_parent(p_category_id uuid, p_parent_id uuid)
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
  if p_category_id is null then
    raise exception 'validation';
  end if;
  select c.parent_id into before
  from public.categories c
  where c.id = p_category_id and c.company_id = cid
  for update;
  if not found then
    raise exception 'category not found';
  end if;
  if p_parent_id is not null
     and not exists (select 1 from public.categories c where c.id = p_parent_id and c.company_id = cid) then
    raise exception 'parent not found';
  end if;
  update public.categories c
  set parent_id = p_parent_id
  where c.id = p_category_id and c.company_id = cid and c.parent_id is distinct from p_parent_id;
  return jsonb_build_object('before', before, 'after', p_parent_id);
end;
$$;

revoke all on function public.set_category_parent(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_category_parent(uuid, uuid) to authenticated;

-- Create a category under a parent (owner only).
create function public.create_category(p_name text, p_kind text, p_parent_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid uuid;
begin
  rid := public.create_category(p_name, p_kind);
  if p_parent_id is not null then
    perform public.set_category_parent(rid, p_parent_id);
  end if;
  return rid;
end;
$$;

revoke all on function public.create_category(text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_category(text, text, uuid) to authenticated;

create function public.mcp_set_category_parent(p_idempotency_key text, p_category_id uuid, p_parent_id uuid)
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
    or p_category_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'category_parent|' || p_category_id::text || '|' || coalesce(p_parent_id::text, '');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    written := public.set_category_parent(p_category_id, p_parent_id);
    insert into private.mcp_writes (token_id, user_id, category_id, kind, prior, created_at)
    values (token, auth.uid(), p_category_id, 'category_parent', written, clock_timestamp());
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'category_id', p_category_id,
        'parent_id', written->'after',
        'prior', written->'before',
        'undo_kind', 'category_parent',
        'id', p_category_id
      )
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm = 'validation' then
        response := private.mcp_error('validation', 'validation');
      elsif sqlerrm = 'category not found' or sqlerrm = 'parent not found' then
        response := private.mcp_error('not_found', sqlerrm);
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_set_category_parent(text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_category_parent(text, uuid, uuid) to authenticated;

-- MCP create_category with a parent: the category under its parent in one write. Without a
-- parent it is the 3-argument tool, hash and all; with one, the parent is in the hash.
create function public.mcp_create_category(p_idempotency_key text, p_name text, p_kind text, p_parent_id uuid)
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
  rid uuid;
  response jsonb;
begin
  if p_parent_id is null then
    return public.mcp_create_category(p_idempotency_key, p_name, p_kind);
  end if;
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_name is null
    or p_kind is null
    or p_kind not in ('expense', 'income')
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'category_new|' || p_kind || '|' || btrim(p_name) || '|' || p_parent_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  response := private.mcp_error('refused', 'The write was refused.');
  begin
    rid := public.create_category(p_name, p_kind, p_parent_id);
    insert into private.mcp_writes (token_id, user_id, kind, category_id)
    values (token, auth.uid(), 'category', rid);
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object('id', rid, 'parent_id', p_parent_id, 'undo_kind', 'category')
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm = 'parent not found' then
        response := private.mcp_error('not_found', sqlerrm);
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_create_category(text, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_create_category(text, text, text, uuid) to authenticated;

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
  -- private.mcp_writes: the category_parent kind. prior holds before and after (null for none).
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'category_group'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'category_parent'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'category_group'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'category_parent'::text) AND (category_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'after'::text))))$n$;

  -- public.mcp_undo: put the parent back, only while the write still stands.
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$, 'category_group'$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$, 'category_parent'$n$);

  anchor := $a$        or (p_kind = 'category_group' and w.kind = 'category_group' and w.category_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'category_parent' and w.kind = 'category_parent' and w.category_id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'category_group' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo category_group branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'category_parent' then
      perform 1 from public.categories c
      where c.id = p_id and c.company_id = cid
        and coalesce(to_jsonb(c.parent_id), 'null'::jsonb) = rec.prior->'after'
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          update public.categories c
          set parent_id = (rec.prior->>'before')::uuid
          where c.id = p_id and c.company_id = cid;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        exception
          when sqlstate '23514' or sqlstate '23503' or raise_exception then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
$n$ || anchor);
  execute def;

  -- MCP create_categories: a row may name its parent_id.
  def := pg_get_functiondef('public.mcp_create_categories(text,jsonb)'::regprocedure);
  anchor := $a$      or exists (select 1 from jsonb_object_keys(item) k where k not in ('name', 'kind'))$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_create_categories keys are not the expected definition';
  end if;
  def := replace(def, anchor, $n$      or exists (select 1 from jsonb_object_keys(item) k where k not in ('name', 'kind', 'parent_id'))
      or (item ? 'parent_id' and jsonb_typeof(item->'parent_id') not in ('string', 'null'))
      or (jsonb_typeof(item->'parent_id') = 'string'
          and item->>'parent_id' !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')$n$);
  anchor := $a$        row_result := public.mcp_create_category(row_key, item->>'name', item->>'kind');$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_create_categories call is not the expected definition';
  end if;
  def := replace(def, anchor, $n$        row_result := public.mcp_create_category(row_key, item->>'name', item->>'kind', (item->>'parent_id')::uuid);$n$);
  execute def;

  -- merge_category hides the category it empties: refuse a parent with sub-categories.
  def := pg_get_functiondef('public.merge_category(uuid,uuid)'::regprocedure);
  anchor := $a$  perform private.category_move_check(cid, p_from, p_into);$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'merge_category is not the expected definition';
  end if;
  execute replace(def, anchor, $n$  if exists (select 1 from public.categories c where c.parent_id = p_from and c.company_id = cid) then
    raise exception 'category_has_children' using errcode = '23514';
  end if;
$n$ || anchor);

  -- list_categories: the parent, how many sub-categories, and lines with theirs.
  def := pg_get_functiondef('public.list_categories()'::regprocedure);
  anchor := $a$    'group_name', c.group_name,$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'list_categories is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
    'parent_id', c.parent_id,
    'children_count', (select count(*)::integer from public.categories k where k.parent_id = c.id),
    'rollup_lines', coalesce(n.lines, 0) + coalesce((
      select sum(m.lines)::integer from counted m
      join public.categories k on k.id = m.category_id
      where k.parent_id = c.id
    ), 0),$n$);
  execute def;
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
