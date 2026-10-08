-- Rename a category (the owner's ask that every category name be in Hebrew). Decision 0148.
-- 1. public.rename_category(category, name), owner only, with create_category's name rules
--    (2 to 120 letters, trimmed, unique per kind). It keeps the id, so lines, splits, loans,
--    remembered suppliers, the group and flags stay. The loan categories can be renamed: they
--    are matched by loan_part. Connector hints that name a default category (Mercury's העברות
--    and הכנסה אחרת) match by name, so a renamed one stops getting them.
-- 2. MCP rename_category, with the idempotency key, the write rate limit and undo kind
--    category_name (a conflict once renamed again, or while another category has the old name).
-- New companies' default categories are already all Hebrew (private.seed_default_categories).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- or replace: 20261011210000 left its copy in the session.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- Renames a category (owner only), with create_category's name rules. Returns the name before
-- and after.
create function public.rename_category(p_category_id uuid, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  cat_kind public.category_kind;
  before text;
  clean text := private.trim_name(p_name);
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
  if char_length(clean) < 2 then
    raise exception 'category name is too short';
  end if;
  if char_length(clean) > 120 then
    raise exception 'category name is too long';
  end if;
  select c.name, c.kind into before, cat_kind
  from public.categories c
  where c.id = p_category_id and c.company_id = cid
  for update;
  if not found then
    raise exception 'category not found';
  end if;
  if exists (
    select 1 from public.categories c
    where c.company_id = cid and c.kind = cat_kind and c.name = clean and c.id <> p_category_id
  ) then
    raise exception 'category already exists';
  end if;
  update public.categories c
  set name = clean
  where c.id = p_category_id and c.company_id = cid and c.name is distinct from clean;
  return jsonb_build_object('id', p_category_id, 'name', clean, 'before', before, 'after', clean);
end;
$$;

revoke all on function public.rename_category(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.rename_category(uuid, text) to authenticated;
comment on function public.rename_category(uuid, text) is
  'Renames a category (owner only); the id, lines and links stay. Decision 0148.';

create function public.mcp_rename_category(p_idempotency_key text, p_category_id uuid, p_name text)
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
    or p_name is null
    or char_length(p_name) > 120
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'category_name|' || p_category_id::text || '|' || private.trim_name(p_name);
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    written := public.rename_category(p_category_id, p_name);
    insert into private.mcp_writes (token_id, user_id, category_id, kind, prior, created_at)
    values (token, auth.uid(), p_category_id, 'category_name', written, clock_timestamp());
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'category_id', p_category_id,
        'name', written->'after',
        'prior', written->'before',
        'undo_kind', 'category_name',
        'id', p_category_id
      )
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm = 'validation' then
        response := private.mcp_error('validation', 'validation');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_rename_category(text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mcp_rename_category(text, uuid, text) to authenticated;

do $patch$
declare
  def text;
  anchor text;
begin
  -- private.mcp_writes: the category_name kind.
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'company_currency'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'category_name'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'company_currency'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'category_name'::text) AND (category_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'after'::text))))$n$;

  -- public.mcp_undo: put the old name back, only while the rename still stands.
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$'category_move', 'company_currency'$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$, 'category_name'$n$);

  anchor := $a$        or (p_kind = 'company_currency' and w.kind = 'company_currency' and w.company_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'category_name' and w.kind = 'category_name' and w.category_id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'company_currency' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo company_currency branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'category_name' then
      -- Conflict once renamed again, or while another category of the kind has the old name.
      perform 1 from public.categories c
      where c.id = p_id and c.company_id = cid and c.name = rec.prior->>'after'
        and not exists (
          select 1 from public.categories o
          where o.company_id = cid and o.kind = c.kind and o.name = rec.prior->>'before' and o.id <> c.id
        )
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.categories c
        set name = rec.prior->>'before'
        where c.id = p_id and c.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
$n$ || anchor);
  execute def;
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
