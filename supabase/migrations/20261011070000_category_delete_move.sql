-- FLOW-405, server part (the owner chose "Server now"). Decision 0144, replacing 0008's
-- "delete only when empty".
-- 1. public.delete_category(category): the owner deletes a category even when it has lines.
--    Its lines lose the category and go back to לאישור (an open review row); a line split by
--    category loses its split; suppliers forget it as their remembered category. Refused for
--    a loan category and while a loan or a loan payment part uses it. What it changed is kept
--    in private.category_deletions, so public.restore_category(category) (the app's undo) and
--    MCP undo put it back.
-- 2. public.move_category_lines(from, into): moves every line, split part, loan payment part,
--    loan part category and remembered supplier category from one category to another of the
--    same kind, without hiding the source. What it moved is kept in private.category_moves, so
--    public.undo_category_move(move) and MCP undo move exactly those back.
-- 3. merge_category is that move plus hiding the source, so it also moves loan payment parts
--    and remembered supplier categories now.
-- 4. MCP delete_category (undo kind category_delete) and move_category_lines (undo kind
--    category_move), with the usual idempotency key and write rate limit.
-- mcp_undo, mcp_refused and the mcp_writes checks are patched from their current definitions,
-- with counted anchors, so changes merged since stay.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- What delete_category removed or changed, for restore.
create table private.category_deletions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  category_id uuid not null,
  snapshot jsonb not null,
  deleted_at timestamptz not null default clock_timestamp(),
  restored_at timestamptz
);

create index category_deletions_category_idx on private.category_deletions (company_id, category_id, deleted_at desc);
alter table private.category_deletions enable row level security;
revoke all on private.category_deletions from public, anon, authenticated, service_role;

-- What move_category_lines moved, for undo.
create table private.category_moves (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  from_id uuid not null,
  into_id uuid not null,
  moved jsonb not null,
  moved_at timestamptz not null default clock_timestamp(),
  undone_at timestamptz
);

create index category_moves_from_idx on private.category_moves (company_id, from_id, moved_at desc);
alter table private.category_moves enable row level security;
revoke all on private.category_moves from public, anon, authenticated, service_role;

-- The owner's company, or forbidden for a viewer, or 'no company'. A write check, so volatile:
-- viewer_reads keeps stable owner-only helpers out.
create function private.category_owner_company()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers w where w.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  return cid;
end;
$$;

revoke all on function private.category_owner_company() from public, anon, authenticated, service_role;

-- Moves everything filed under p_from to p_into, both locked by the caller and checked to be
-- the same kind. Returns what it moved, for undo.
create function private.category_move(p_company_id uuid, p_from uuid, p_into uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  txns jsonb;
  parts jsonb;
  loan_parts jsonb;
  loan_cols jsonb;
  remembered jsonb;
begin
  if exists (
    select 1
    from public.line_splits f
    join public.line_splits s
      on s.transaction_id = f.transaction_id
      and s.category_id = p_into
      and s.project_id is not distinct from f.project_id
    where f.company_id = p_company_id and f.category_id = p_from
  ) then
    raise exception 'a split line has both categories';
  end if;

  -- The loans that name the source, then the lines in id order, as loan writes take them.
  perform 1
  from public.loans l
  where l.company_id = p_company_id
    and p_from in (l.interest_category_id, l.escrow_category_id, l.principal_category_id, l.fees_category_id)
  order by l.id
  for no key update;
  if exists (
    select 1
    from public.loans l
    cross join lateral (values
      ('interest'::public.loan_split_part, l.interest_category_id),
      ('escrow'::public.loan_split_part, l.escrow_category_id),
      ('principal'::public.loan_split_part, l.principal_category_id),
      ('fees'::public.loan_split_part, l.fees_category_id)
    ) v(part, category_id)
    where l.company_id = p_company_id
      and v.category_id = p_from
      and not private.loan_part_category_ok(p_company_id, v.part, p_into)
  ) or exists (
    select 1
    from public.loan_splits s
    where s.company_id = p_company_id
      and s.category_id = p_from
      and not private.loan_part_category_ok(p_company_id, s.part, p_into)
  ) then
    raise exception 'a loan uses this category for a part the other category cannot take'
      using errcode = '23514';
  end if;

  perform 1
  from public.transactions t
  where t.company_id = p_company_id
    and (t.category_id = p_from
      or t.id in (select s.transaction_id from public.line_splits s where s.company_id = p_company_id and s.category_id = p_from)
      or t.id in (select s.transaction_id from public.loan_splits s where s.company_id = p_company_id and s.category_id = p_from))
  order by t.id
  for update;

  with moved as (
    update public.transactions t
    set category_id = p_into,
        user_assigned = true,
        category_assigned = true,
        category_suggested = false
    from public.transactions old
    where old.id = t.id
      and t.company_id = p_company_id
      and t.category_id = p_from
    returning t.id, old.user_assigned, old.category_suggested, old.category_assigned
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id,
      'user_assigned', m.user_assigned,
      'category_suggested', m.category_suggested,
      'category_assigned', m.category_assigned
    ) order by m.id), '[]'::jsonb)
  into txns
  from moved m;

  with moved as (
    update public.line_splits s
    set category_id = p_into
    where s.company_id = p_company_id and s.category_id = p_from
    returning s.id
  )
  select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb) into parts from moved m;

  with moved as (
    update public.loan_splits s
    set category_id = p_into
    where s.company_id = p_company_id and s.category_id = p_from
    returning s.id
  )
  select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb) into loan_parts from moved m;

  with moved as (
    update public.loans l
    set interest_category_id = case when l.interest_category_id = p_from then p_into else l.interest_category_id end,
        escrow_category_id = case when l.escrow_category_id = p_from then p_into else l.escrow_category_id end,
        principal_category_id = case when l.principal_category_id = p_from then p_into else l.principal_category_id end,
        fees_category_id = case when l.fees_category_id = p_from then p_into else l.fees_category_id end
    from public.loans old
    where old.id = l.id
      and l.company_id = p_company_id
      and p_from in (l.interest_category_id, l.escrow_category_id, l.principal_category_id, l.fees_category_id)
    returning l.id, jsonb_build_object(
      'interest', old.interest_category_id = p_from,
      'escrow', old.escrow_category_id = p_from,
      'principal', old.principal_category_id = p_from,
      'fees', old.fees_category_id = p_from
    ) as cols
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'cols', m.cols) order by m.id), '[]'::jsonb)
  into loan_cols
  from moved m;

  with moved as (
    update public.suppliers s
    set remembered_category_id = p_into
    where s.company_id = p_company_id and s.remembered_category_id = p_from
    returning s.id
  )
  select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb) into remembered from moved m;

  return jsonb_build_object(
    'transactions', txns,
    'line_splits', parts,
    'loan_splits', loan_parts,
    'loans', loan_cols,
    'suppliers', remembered
  );
end;
$$;

revoke all on function private.category_move(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Locks both categories and checks they fit a move. Returns nothing; raises the merge errors.
create function private.category_move_check(p_company_id uuid, p_from uuid, p_into uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  from_kind public.category_kind;
  into_kind public.category_kind;
begin
  if p_from is null or p_into is null then
    raise exception 'validation';
  end if;
  if p_from = p_into then
    raise exception 'pick a different category';
  end if;
  -- no key update: it keeps out a delete or another move, not a line being filed under either.
  perform 1 from public.categories c
  where c.company_id = p_company_id and c.id in (p_from, p_into)
  order by c.id
  for no key update;
  select c.kind into from_kind from public.categories c where c.company_id = p_company_id and c.id = p_from;
  select c.kind into into_kind from public.categories c where c.company_id = p_company_id and c.id = p_into and not c.hidden;
  if from_kind is null or into_kind is null then
    raise exception 'category not found';
  end if;
  if from_kind is distinct from into_kind then
    raise exception 'categories must be the same kind';
  end if;
end;
$$;

revoke all on function private.category_move_check(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- Moves every line of one category to another of the same kind (owner only). The source stays.
-- Returns the move id (for undo_category_move) and how many lines moved.
create function public.move_category_lines(p_from uuid, p_into uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  moved jsonb;
  move_id uuid;
begin
  cid := private.category_owner_company();
  perform private.category_move_check(cid, p_from, p_into);
  moved := private.category_move(cid, p_from, p_into);
  insert into private.category_moves (company_id, from_id, into_id, moved)
  values (cid, p_from, p_into, moved)
  returning id into move_id;
  -- The count, like delete_category's, is of lines on the books: not removed, not void.
  return jsonb_build_object(
    'move_id', move_id,
    'lines', (select count(*)::integer
              from public.transactions t
              where t.company_id = cid
                and t.removed_at is null
                and t.line_status is distinct from 'void'::public.line_status
                and (t.id in (select (x->>'id')::uuid from jsonb_array_elements(moved->'transactions') x)
                  or t.id in (select s.transaction_id from public.line_splits s
                              where s.id in (select (x #>> '{}')::uuid from jsonb_array_elements(moved->'line_splits') x))))
  );
end;
$$;

revoke all on function public.move_category_lines(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.move_category_lines(uuid, uuid) to authenticated;
comment on function public.move_category_lines(uuid, uuid) is
  'Moves every line, split part, loan part and remembered supplier category of one category to another of the same kind (owner only); the source stays. Decision 0144.';

-- Moves back what a move moved, if all of it is still where the move put it. Raises
-- check_violation ('category move cannot be undone') otherwise, and changes nothing.
create function private.category_move_undo(p_company_id uuid, p_move_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  mv record;
  n integer;
begin
  select m.* into mv
  from private.category_moves m
  where m.id = p_move_id and m.company_id = p_company_id and m.undone_at is null
  for update;
  if not found then
    raise exception 'move not found';
  end if;
  if not exists (select 1 from public.categories c where c.company_id = p_company_id and c.id = mv.from_id) then
    raise exception 'category move cannot be undone' using errcode = '23514';
  end if;

  perform 1 from public.categories c
  where c.company_id = p_company_id and c.id in (mv.from_id, mv.into_id)
  order by c.id
  for no key update;
  perform 1 from public.loans l
  where l.company_id = p_company_id
    and l.id in (select (x->>'id')::uuid from jsonb_array_elements(mv.moved->'loans') x)
  order by l.id
  for no key update;
  perform 1 from public.transactions t
  where t.company_id = p_company_id
    and (t.id in (select (x->>'id')::uuid from jsonb_array_elements(mv.moved->'transactions') x)
      or t.id in (select s.transaction_id from public.line_splits s
                  where s.id in (select (x #>> '{}')::uuid from jsonb_array_elements(mv.moved->'line_splits') x))
      or t.id in (select s.transaction_id from public.loan_splits s
                  where s.id in (select (x #>> '{}')::uuid from jsonb_array_elements(mv.moved->'loan_splits') x)))
  order by t.id
  for update;

  update public.transactions t
  set category_id = mv.from_id,
      user_assigned = (x->>'user_assigned')::boolean,
      category_assigned = (x->>'category_assigned')::boolean,
      category_suggested = (x->>'category_suggested')::boolean
  from jsonb_array_elements(mv.moved->'transactions') x
  where t.id = (x->>'id')::uuid and t.company_id = p_company_id and t.category_id = mv.into_id;
  get diagnostics n = row_count;
  if n <> jsonb_array_length(mv.moved->'transactions') then
    raise exception 'category move cannot be undone' using errcode = '23514';
  end if;

  update public.line_splits s
  set category_id = mv.from_id
  where s.company_id = p_company_id
    and s.category_id = mv.into_id
    and s.id in (select (x #>> '{}')::uuid from jsonb_array_elements(mv.moved->'line_splits') x);
  get diagnostics n = row_count;
  if n <> jsonb_array_length(mv.moved->'line_splits') then
    raise exception 'category move cannot be undone' using errcode = '23514';
  end if;

  update public.loan_splits s
  set category_id = mv.from_id
  where s.company_id = p_company_id
    and s.category_id = mv.into_id
    and s.id in (select (x #>> '{}')::uuid from jsonb_array_elements(mv.moved->'loan_splits') x);
  get diagnostics n = row_count;
  if n <> jsonb_array_length(mv.moved->'loan_splits') then
    raise exception 'category move cannot be undone' using errcode = '23514';
  end if;

  update public.loans l
  set interest_category_id = case when (x->'cols'->>'interest')::boolean then mv.from_id else l.interest_category_id end,
      escrow_category_id = case when (x->'cols'->>'escrow')::boolean then mv.from_id else l.escrow_category_id end,
      principal_category_id = case when (x->'cols'->>'principal')::boolean then mv.from_id else l.principal_category_id end,
      fees_category_id = case when (x->'cols'->>'fees')::boolean then mv.from_id else l.fees_category_id end
  from jsonb_array_elements(mv.moved->'loans') x
  where l.id = (x->>'id')::uuid
    and l.company_id = p_company_id
    and (not (x->'cols'->>'interest')::boolean or l.interest_category_id = mv.into_id)
    and (not (x->'cols'->>'escrow')::boolean or l.escrow_category_id = mv.into_id)
    and (not (x->'cols'->>'principal')::boolean or l.principal_category_id = mv.into_id)
    and (not (x->'cols'->>'fees')::boolean or l.fees_category_id = mv.into_id);
  get diagnostics n = row_count;
  if n <> jsonb_array_length(mv.moved->'loans') then
    raise exception 'category move cannot be undone' using errcode = '23514';
  end if;

  -- A remembered category the owner changed since stays as it is now.
  update public.suppliers s
  set remembered_category_id = mv.from_id
  where s.company_id = p_company_id
    and s.remembered_category_id = mv.into_id
    and s.id in (select (x #>> '{}')::uuid from jsonb_array_elements(mv.moved->'suppliers') x);

  update private.category_moves set undone_at = clock_timestamp() where id = p_move_id;
end;
$$;

revoke all on function private.category_move_undo(uuid, uuid) from public, anon, authenticated, service_role;

-- The app's undo of a move.
create function public.undo_category_move(p_move_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.category_move_undo(private.category_owner_company(), p_move_id);
end;
$$;

revoke all on function public.undo_category_move(uuid) from public, anon, authenticated, service_role;
grant execute on function public.undo_category_move(uuid) to authenticated;
comment on function public.undo_category_move(uuid) is
  'Moves back what move_category_lines moved, if all of it is still in the target (owner only). Decision 0144.';

-- Deletes a category (owner only), even with lines. Returns the deletion id and how many lines
-- went back to review.
create function public.delete_category(p_category_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  cat jsonb;
  cat_loan_part public.loan_split_part;
  split_txns uuid[];
  lines jsonb;
  parts jsonb;
  remembered jsonb;
  review_refs jsonb;
  reassign_refs jsonb;
  opened jsonb;
  deletion_id uuid;
begin
  cid := private.category_owner_company();
  if p_category_id is null then
    raise exception 'validation';
  end if;

  select to_jsonb(c.*), c.loan_part into cat, cat_loan_part
  from public.categories c
  where c.id = p_category_id and c.company_id = cid
  for update;
  if cat is null then
    raise exception 'category not found';
  end if;
  if cat_loan_part is not null then
    raise exception 'loan category is fixed';
  end if;
  if exists (
    select 1 from public.loans l
    where l.company_id = cid
      and p_category_id in (l.interest_category_id, l.escrow_category_id, l.principal_category_id, l.fees_category_id)
  ) or exists (
    select 1 from public.loan_splits s where s.company_id = cid and s.category_id = p_category_id
  ) then
    raise exception 'a loan uses this category';
  end if;

  select coalesce(array_agg(distinct s.transaction_id), '{}') into split_txns
  from public.line_splits s
  where s.company_id = cid and s.category_id = p_category_id;

  perform 1 from public.transactions t
  where t.company_id = cid
    and (t.category_id = p_category_id or t.id = any (split_txns))
  order by t.id
  for update;

  -- Every part of a split line that has one in this category: the split goes.
  select coalesce(jsonb_agg(to_jsonb(s.*) order by s.transaction_id, s.ordinal), '[]'::jsonb) into parts
  from public.line_splits s
  where s.company_id = cid and s.transaction_id = any (split_txns);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', t.id,
      'category_id', t.category_id,
      'category_assigned', t.category_assigned,
      'category_suggested', t.category_suggested
    ) order by t.id), '[]'::jsonb)
  into lines
  from public.transactions t
  where t.company_id = cid
    and (t.category_id = p_category_id or t.id = any (split_txns));

  -- A split mismatch review goes with the split (the split sync would close it at commit and
  -- leave the line out of review); the line gets a missing_category row below instead. Restore
  -- puts the split back, and the sync opens a mismatch review again if it still does not add up.
  delete from public.review_queue q
  where q.company_id = cid
    and q.status = 'open'
    and q.reason = 'split_mismatch'
    and q.transaction_id = any (split_txns);

  delete from public.line_splits s where s.company_id = cid and s.transaction_id = any (split_txns);

  -- category_assigned true: the owner left the line with no category, so nothing guesses one.
  update public.transactions t
  set category_id = null,
      category_assigned = true,
      category_suggested = false
  where t.company_id = cid
    and (t.category_id = p_category_id or t.id = any (split_txns));

  with changed as (
    update public.suppliers s
    set remembered_category_id = null
    where s.company_id = cid and s.remembered_category_id = p_category_id
    returning s.id
  )
  select coalesce(jsonb_agg(c.id order by c.id), '[]'::jsonb) into remembered from changed c;

  -- Earlier reviews and reassigns that would restore this category on undo restore none.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', q.id,
      'prior', q.prior_category_id = p_category_id,
      'prior_remembered', q.prior_remembered_category_id = p_category_id,
      'written_remembered', q.written_remembered_category_id = p_category_id
    ) order by q.id), '[]'::jsonb)
  into review_refs
  from public.review_queue q
  where q.company_id = cid
    and p_category_id in (q.prior_category_id, q.prior_remembered_category_id, q.written_remembered_category_id);
  update public.review_queue q
  set prior_category_id = nullif(q.prior_category_id, p_category_id),
      prior_remembered_category_id = nullif(q.prior_remembered_category_id, p_category_id),
      written_remembered_category_id = nullif(q.written_remembered_category_id, p_category_id)
  where q.company_id = cid
    and p_category_id in (q.prior_category_id, q.prior_remembered_category_id, q.written_remembered_category_id);

  with changed as (
    update public.reassign_undo r
    set prior_category_id = null
    where r.company_id = cid and r.prior_category_id = p_category_id
    returning r.id
  )
  select coalesce(jsonb_agg(c.id order by c.id), '[]'::jsonb) into reassign_refs from changed c;

  -- Back to לאישור: an open review for each line still on the books that has none.
  with opened_rows as (
    insert into public.review_queue (company_id, transaction_id, status, reason)
    select cid, t.id, 'open', 'missing_category'
    from public.transactions t
    where t.company_id = cid
      and t.id in (select (x->>'id')::uuid from jsonb_array_elements(lines) x)
      and t.removed_at is null
      and t.line_status is distinct from 'void'::public.line_status
      and not exists (
        select 1 from public.review_queue q where q.transaction_id = t.id and q.status = 'open'
      )
    returning id
  )
  select coalesce(jsonb_agg(o.id order by o.id), '[]'::jsonb) into opened from opened_rows o;

  delete from public.categories c where c.id = p_category_id and c.company_id = cid;

  insert into private.category_deletions (company_id, category_id, snapshot)
  values (cid, p_category_id, jsonb_build_object(
    'category', cat,
    'lines', lines,
    'line_splits', parts,
    'suppliers', remembered,
    'review_refs', review_refs,
    'reassign_refs', reassign_refs,
    'opened_reviews', opened
  ))
  returning id into deletion_id;

  return jsonb_build_object(
    'deletion_id', deletion_id,
    'name', cat->>'name',
    'lines', (select count(*)::integer from jsonb_array_elements(lines) x
              join public.transactions t on t.id = (x->>'id')::uuid
              where t.removed_at is null and t.line_status is distinct from 'void'::public.line_status)
  );
end;
$$;

revoke all on function public.delete_category(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_category(uuid) to authenticated;
comment on function public.delete_category(uuid) is
  'Deletes a category (owner only); its lines lose it and go back to review, a split line loses its split. Refused for a loan category or one a loan uses. Decision 0144.';

-- Puts a deleted category back from its snapshot. Raises check_violation ('category cannot be
-- restored') when it no longer fits: the name is taken again, or a line was re-tagged, split
-- or removed from review since. Changes nothing then.
create function private.category_restore(p_company_id uuid, p_deletion_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
  n integer;
begin
  select x.* into d
  from private.category_deletions x
  where x.id = p_deletion_id and x.company_id = p_company_id and x.restored_at is null
  for update;
  if not found then
    raise exception 'category not found';
  end if;

  perform 1 from public.transactions t
  where t.company_id = p_company_id
    and t.id in (select (x->>'id')::uuid from jsonb_array_elements(d.snapshot->'lines') x)
  order by t.id
  for update;

  -- Every line must still have no category and no split.
  if exists (
    select 1 from jsonb_array_elements(d.snapshot->'lines') x
    left join public.transactions t on t.id = (x->>'id')::uuid and t.company_id = p_company_id
    where t.id is null or t.category_id is not null
      or exists (select 1 from public.line_splits s where s.transaction_id = t.id)
  ) then
    raise exception 'category cannot be restored' using errcode = '23514';
  end if;

  begin
    insert into public.categories
    select * from jsonb_populate_record(null::public.categories, d.snapshot->'category');
  exception
    when unique_violation then
      raise exception 'category cannot be restored' using errcode = '23514';
  end;
  -- The insert trigger sets the P&L switch from the name; put back the owner's own setting.
  update public.categories
  set excluded_from_pnl = (d.snapshot->'category'->>'excluded_from_pnl')::boolean
  where id = (d.snapshot->'category'->>'id')::uuid;

  begin
    update public.transactions t
    set category_id = (x->>'category_id')::uuid,
        category_assigned = (x->>'category_assigned')::boolean,
        category_suggested = (x->>'category_suggested')::boolean
    from jsonb_array_elements(d.snapshot->'lines') x
    where t.id = (x->>'id')::uuid and t.company_id = p_company_id;
  exception
    when foreign_key_violation then
      raise exception 'category cannot be restored' using errcode = '23514';
  end;

  begin
    insert into public.line_splits
    select * from jsonb_populate_recordset(null::public.line_splits, d.snapshot->'line_splits');
  exception
    when unique_violation or check_violation or foreign_key_violation then
      raise exception 'category cannot be restored' using errcode = '23514';
  end;

  -- The reviews the delete opened go, unless they were resolved since.
  delete from public.review_queue q
  where q.company_id = p_company_id
    and q.status in ('open', 'skipped')
    and q.id in (select (x #>> '{}')::uuid from jsonb_array_elements(d.snapshot->'opened_reviews') x);

  update public.suppliers s
  set remembered_category_id = (d.snapshot->'category'->>'id')::uuid
  where s.company_id = p_company_id
    and s.remembered_category_id is null
    and s.id in (select (x #>> '{}')::uuid from jsonb_array_elements(d.snapshot->'suppliers') x);

  update public.review_queue q
  set prior_category_id = case when (x->>'prior')::boolean and q.prior_category_id is null
        then (d.snapshot->'category'->>'id')::uuid else q.prior_category_id end,
      prior_remembered_category_id = case when (x->>'prior_remembered')::boolean and q.prior_remembered_category_id is null
        then (d.snapshot->'category'->>'id')::uuid else q.prior_remembered_category_id end,
      written_remembered_category_id = case when (x->>'written_remembered')::boolean and q.written_remembered_category_id is null
        then (d.snapshot->'category'->>'id')::uuid else q.written_remembered_category_id end
  from jsonb_array_elements(d.snapshot->'review_refs') x
  where q.id = (x->>'id')::uuid and q.company_id = p_company_id;

  update public.reassign_undo r
  set prior_category_id = (d.snapshot->'category'->>'id')::uuid
  where r.company_id = p_company_id
    and r.prior_category_id is null
    and r.id in (select (x #>> '{}')::uuid from jsonb_array_elements(d.snapshot->'reassign_refs') x);

  update private.category_deletions set restored_at = clock_timestamp() where id = p_deletion_id;
end;
$$;

revoke all on function private.category_restore(uuid, uuid) from public, anon, authenticated, service_role;

-- The app's undo: puts back the latest delete of this category.
create function public.restore_category(p_category_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  deletion uuid;
begin
  cid := private.category_owner_company();
  select d.id into deletion
  from private.category_deletions d
  where d.company_id = cid and d.category_id = p_category_id and d.restored_at is null
  order by d.deleted_at desc
  limit 1;
  if deletion is null then
    raise exception 'category not found';
  end if;
  perform private.category_restore(cid, deletion);
  return jsonb_build_object('id', p_category_id);
end;
$$;

revoke all on function public.restore_category(uuid) from public, anon, authenticated, service_role;
grant execute on function public.restore_category(uuid) to authenticated;
comment on function public.restore_category(uuid) is
  'Puts back the latest delete_category of this category (owner only), if its lines are still untagged. Decision 0144.';

-- merge_category: the move, then the source hidden.
create or replace function public.merge_category(p_from uuid, p_into uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.category_owner_company();
  perform private.category_move_check(cid, p_from, p_into);
  perform private.category_move(cid, p_from, p_into);
  update public.categories
  set hidden = true
  where id = p_from and company_id = cid;
end;
$$;

create function public.mcp_delete_category(p_idempotency_key text, p_category_id uuid)
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
  deleted jsonb;
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
  hash := 'category_delete|' || p_category_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    deleted := public.delete_category(p_category_id);
    insert into private.mcp_writes (token_id, user_id, category_id, kind, prior, created_at)
    values (
      token, auth.uid(), p_category_id, 'category_delete',
      jsonb_build_object('deletion_id', deleted->'deletion_id'),
      clock_timestamp()
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'category_id', p_category_id,
        'name', deleted->'name',
        'lines', deleted->'lines',
        'undo_kind', 'category_delete',
        'id', p_category_id
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

revoke all on function public.mcp_delete_category(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_delete_category(text, uuid) to authenticated;

create function public.mcp_move_category_lines(p_idempotency_key text, p_from uuid, p_into uuid)
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
  moved jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_from is null
    or p_into is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'category_move|' || p_from::text || '|' || p_into::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    moved := public.move_category_lines(p_from, p_into);
    insert into private.mcp_writes (token_id, user_id, category_id, kind, prior, created_at)
    values (
      token, auth.uid(), p_from, 'category_move',
      jsonb_build_object('move_id', moved->'move_id'),
      clock_timestamp()
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'from', p_from,
        'into', p_into,
        'lines', moved->'lines',
        'undo_kind', 'category_move',
        'id', p_from
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

revoke all on function public.mcp_move_category_lines(text, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_move_category_lines(text, uuid, uuid) to authenticated;

do $patch$
declare
  def text;
  anchor text;
begin
  -- private.mcp_writes: the category_delete and category_move kinds.
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'category_rehab'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'category_delete'::text, 'category_move'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'category_rehab'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'category_delete'::text) AND (category_id IS NOT NULL) AND (prior ? 'deletion_id'::text)) OR ((kind = 'category_move'::text) AND (category_id IS NOT NULL) AND (prior ? 'move_id'::text))))$n$;

  -- private.mcp_refused: the new refusals.
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  anchor := $a$'loan cannot be restored'$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$,
        -- FLOW-405 (decision 0144).
        'a loan uses this category',
        'pick a different category',
        'categories must be the same kind',
        'a split line has both categories',
        'a loan uses this category for a part the other category cannot take'$n$);

  -- public.mcp_undo: category_delete puts the category back; category_move moves the lines back.
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$'category_rehab'
    )$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, $n$'category_rehab', 'category_delete', 'category_move'
    )$n$);

  anchor := $a$or (p_kind = 'category_rehab' and w.kind = 'category_rehab' and w.category_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'category_delete' and w.kind = 'category_delete' and w.category_id = p_id)
        or (p_kind = 'category_move' and w.kind = 'category_move' and w.category_id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'project_investment' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo project_investment branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'category_delete' then
      -- The delete this write made, if the app has not put the category back since.
      if not exists (
        select 1 from private.category_deletions d
        where d.id = (rec.prior->>'deletion_id')::uuid and d.company_id = cid and d.restored_at is null
      ) then
        response := private.mcp_error('not_found', 'not found');
      else
        begin
          perform private.category_restore(cid, (rec.prior->>'deletion_id')::uuid);
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        exception
          when check_violation then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'category_move' then
      if not exists (
        select 1 from private.category_moves m
        where m.id = (rec.prior->>'move_id')::uuid and m.company_id = cid and m.undone_at is null
      ) then
        response := private.mcp_error('not_found', 'not found');
      else
        begin
          perform private.category_move_undo(cid, (rec.prior->>'move_id')::uuid);
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        exception
          when check_violation then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
$n$ || anchor);
  execute def;
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
