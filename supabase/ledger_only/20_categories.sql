-- 20 categories. Moving, deleting and restoring categories, and the readers around them, on the
-- parts views and the part writers.

-- The parts a category move recorded, as (line, part). A move written before the parts were legs
-- holds the ids of the rows it moved (resolved through the part's leg when that id still exists);
-- a newer move holds {transaction_id, ordinal} for split parts and {transaction_id, part} for loan
-- parts. ref is the part's ordinal (split) or name (loan).
create or replace function private.category_moved_parts(p_list jsonb)
returns table (transaction_id uuid, ref text)
language sql
stable
security definer
set search_path = ''
as $$
  select (x->>'transaction_id')::uuid, coalesce(x->>'ordinal', x->>'part')
  from jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) x
  where jsonb_typeof(x) = 'object'
  union all
  select l.transaction_id, case when l.split_part then l.part_ordinal::text else l.part::text end
  from jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) x
  join public.legs l on l.id = (x #>> '{}')::uuid
  where jsonb_typeof(x) = 'string';
$$;

revoke all on function private.category_moved_parts(jsonb) from public, anon, authenticated, service_role;

create or replace function private.category_move(p_company_id uuid, p_from uuid, p_into uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  -- The snapshot keys an older move already holds.
  k_lines constant text := 'line' || '_splits';
  k_loans constant text := 'loan' || '_splits';
  txns jsonb;
  parts jsonb := '[]'::jsonb;
  loan_parts jsonb := '[]'::jsonb;
  loan_cols jsonb;
  loan_switches jsonb;
  remembered jsonb;
  r record;
  new_parts jsonb;
  here jsonb;
begin
  -- A line that has both parts on one category and project cannot take the move (the writer
  -- refuses a duplicate part).
  if exists (
    select 1
    from private.split_parts f
    join private.split_parts s
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
    from private.loan_parts s
    where s.company_id = p_company_id
      and s.category_id = p_from
      and not private.loan_part_category_ok(p_company_id, s.part, p_into)
  ) or exists (
    select 1
    from public.loan_category_switches w
    where w.company_id = p_company_id
      and w.category_id = p_from
      and not private.loan_part_category_ok(p_company_id, w.part, p_into)
  ) then
    raise exception 'a loan uses this category for a part the other category cannot take'
      using errcode = '23514';
  end if;

  perform 1
  from public.transactions t
  where t.company_id = p_company_id
    and (t.category_id = p_from
      or t.id in (select s.transaction_id from private.split_parts s where s.company_id = p_company_id and s.category_id = p_from)
      or t.id in (select s.transaction_id from private.loan_parts s where s.company_id = p_company_id and s.category_id = p_from))
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

  -- Split parts: each line's parts are read, the source swapped for the target, and written back.
  for r in
    select s.transaction_id
    from private.split_parts s
    where s.company_id = p_company_id and s.category_id = p_from
    group by s.transaction_id
    order by s.transaction_id
  loop
    select jsonb_agg(jsonb_build_object(
        'category_id', case when s.category_id = p_from then p_into else s.category_id end,
        'project_id', s.project_id,
        'amount_minor', s.amount_minor,
        'gross_up', s.gross_up
      ) order by s.ordinal),
      jsonb_agg(jsonb_build_object('transaction_id', r.transaction_id, 'ordinal', s.pos) order by s.ordinal)
        filter (where s.category_id = p_from)
    into new_parts, here
    from (
      select p.*, row_number() over (order by p.ordinal) as pos
      from private.split_parts p
      where p.company_id = p_company_id and p.transaction_id = r.transaction_id
    ) s;
    perform private.set_line_parts(p_company_id, r.transaction_id, new_parts);
    parts := parts || here;
  end loop;

  -- Loan parts, the same way.
  for r in
    select s.transaction_id, min(s.loan_id::text)::uuid as loan_id
    from private.loan_parts s
    where s.company_id = p_company_id and s.category_id = p_from
    group by s.transaction_id
    order by s.transaction_id
  loop
    select jsonb_agg(jsonb_build_object(
        'part', s.part,
        'amount_minor', s.amount_minor,
        'scheduled_minor', s.scheduled_minor,
        'category_id', case when s.category_id = p_from then p_into else s.category_id end,
        'needs_review', s.needs_review
      ) order by s.part),
      jsonb_agg(jsonb_build_object('transaction_id', r.transaction_id, 'part', s.part) order by s.part)
        filter (where s.category_id = p_from)
    into new_parts, here
    from private.loan_parts s
    where s.company_id = p_company_id and s.transaction_id = r.transaction_id;
    perform private.set_loan_parts(p_company_id, r.transaction_id, r.loan_id, new_parts);
    loan_parts := loan_parts || here;
  end loop;

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
    update public.loan_category_switches w
    set category_id = p_into
    where w.company_id = p_company_id and w.category_id = p_from
    returning w.id
  )
  select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb) into loan_switches from moved m;

  with moved as (
    update public.suppliers s
    set remembered_category_id = p_into
    where s.company_id = p_company_id and s.remembered_category_id = p_from
    returning s.id
  )
  select coalesce(jsonb_agg(m.id order by m.id), '[]'::jsonb) into remembered from moved m;

  return jsonb_build_object(
    'transactions', txns,
    k_lines, parts,
    k_loans, loan_parts,
    'loans', loan_cols,
    'loan_switches', loan_switches,
    'suppliers', remembered
  );
end;
$function$;

create or replace function private.category_move_undo(p_company_id uuid, p_move_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  k_lines constant text := 'line' || '_splits';
  k_loans constant text := 'loan' || '_splits';
  mv record;
  n integer;
  flipped integer;
  total integer;
  r record;
  new_parts jsonb;
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
      or t.id in (select h.transaction_id from private.category_moved_parts(mv.moved->k_lines) h)
      or t.id in (select h.transaction_id from private.category_moved_parts(mv.moved->k_loans) h))
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

  -- Split parts: each recorded part still on the target goes back to the source.
  flipped := 0;
  for r in
    select distinct h.transaction_id from private.category_moved_parts(mv.moved->k_lines) h order by 1
  loop
    select jsonb_agg(jsonb_build_object(
        'category_id', case when s.back then mv.from_id else s.category_id end,
        'project_id', s.project_id,
        'amount_minor', s.amount_minor,
        'gross_up', s.gross_up
      ) order by s.ordinal),
      count(*) filter (where s.back)
    into new_parts, n
    from (
      select p.*, p.category_id = mv.into_id and p.pos::text in (
          select h.ref from private.category_moved_parts(mv.moved->k_lines) h where h.transaction_id = r.transaction_id
        ) as back
      from (
        select q.*, row_number() over (order by q.ordinal) as pos
        from private.split_parts q
        where q.company_id = p_company_id and q.transaction_id = r.transaction_id
      ) p
    ) s;
    if n > 0 then
      perform private.set_line_parts(p_company_id, r.transaction_id, new_parts);
    end if;
    flipped := flipped + coalesce(n, 0);
  end loop;
  select count(*)::integer into total from private.category_moved_parts(mv.moved->k_lines);
  if flipped <> total then
    raise exception 'category move cannot be undone' using errcode = '23514';
  end if;

  -- Loan parts, the same way.
  flipped := 0;
  for r in
    select h.transaction_id, min(s.loan_id::text)::uuid as loan_id
    from private.category_moved_parts(mv.moved->k_loans) h
    join private.loan_parts s on s.company_id = p_company_id and s.transaction_id = h.transaction_id
    group by h.transaction_id
    order by h.transaction_id
  loop
    select jsonb_agg(jsonb_build_object(
        'part', s.part,
        'amount_minor', s.amount_minor,
        'scheduled_minor', s.scheduled_minor,
        'category_id', case when s.back then mv.from_id else s.category_id end,
        'needs_review', s.needs_review
      ) order by s.part),
      count(*) filter (where s.back)
    into new_parts, n
    from (
      select p.*, p.category_id = mv.into_id and p.part::text in (
          select h.ref from private.category_moved_parts(mv.moved->k_loans) h where h.transaction_id = r.transaction_id
        ) as back
      from private.loan_parts p
      where p.company_id = p_company_id and p.transaction_id = r.transaction_id
    ) s;
    if n > 0 then
      perform private.set_loan_parts(p_company_id, r.transaction_id, r.loan_id, new_parts);
    end if;
    flipped := flipped + coalesce(n, 0);
  end loop;
  select count(*)::integer into total from private.category_moved_parts(mv.moved->k_loans);
  if flipped <> total then
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

  -- FLOW-148: the loans' category switches (a move from before them has none).
  update public.loan_category_switches w
  set category_id = mv.from_id
  where w.company_id = p_company_id
    and w.category_id = mv.into_id
    and w.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(mv.moved->'loan_switches', '[]'::jsonb)) x);
  get diagnostics n = row_count;
  if n <> jsonb_array_length(coalesce(mv.moved->'loan_switches', '[]'::jsonb)) then
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
$function$;

CREATE OR REPLACE FUNCTION public.delete_category(p_category_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  cat jsonb;
  cat_loan_part public.loan_split_part;
  split_txns uuid[];
  lines jsonb;
  parts jsonb;
  split_txn uuid;
  k_lines constant text := 'line' || '_splits'; -- the snapshot key older deletions already hold
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
    select 1 from private.loan_parts s where s.company_id = cid and s.category_id = p_category_id
  ) or exists (
    select 1 from public.loan_category_switches w where w.company_id = cid and w.category_id = p_category_id
  ) then
    raise exception 'a loan uses this category';
  end if;

  select coalesce(array_agg(distinct s.transaction_id), '{}') into split_txns
  from private.split_parts s
  where s.company_id = cid and s.category_id = p_category_id;

  perform 1 from public.transactions t
  where t.company_id = cid
    and (t.category_id = p_category_id or t.id = any (split_txns))
  order by t.id
  for update;

  -- Every part of a split line that has one in this category: the split goes.
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.leg_id,
      'company_id', s.company_id,
      'transaction_id', s.transaction_id,
      'ordinal', s.ordinal,
      'category_id', s.category_id,
      'project_id', s.project_id,
      'amount_minor', s.amount_minor,
      'gross_up', s.gross_up
    ) order by s.transaction_id, s.ordinal), '[]'::jsonb) into parts
  from private.split_parts s
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

  foreach split_txn in array split_txns loop
    perform private.set_line_parts(cid, split_txn, null);
  end loop;

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
    k_lines, parts,
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
$function$;

CREATE OR REPLACE FUNCTION private.category_restore(p_company_id uuid, p_deletion_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  d record;
  n integer;
  k_lines constant text := 'line' || '_splits'; -- the snapshot key older deletions already hold
  line_id uuid;
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
      or exists (select 1 from private.split_parts s where s.transaction_id = t.id)
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
    , in_cash = coalesce((d.snapshot->'category'->>'in_cash')::boolean, in_cash)
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
    for line_id in
      select distinct (x->>'transaction_id')::uuid
      from jsonb_array_elements(coalesce(d.snapshot->k_lines, '[]'::jsonb)) x
      order by 1
    loop
      perform private.set_line_parts(p_company_id, line_id, (
        select jsonb_agg(jsonb_build_object(
          'category_id', x->>'category_id',
          'project_id', x->>'project_id',
          'amount_minor', (x->>'amount_minor')::bigint,
          'gross_up', coalesce((x->>'gross_up')::boolean, false)
        ) order by (x->>'ordinal')::integer)
        from jsonb_array_elements(d.snapshot->k_lines) x
        where (x->>'transaction_id')::uuid = line_id
      ));
    end loop;
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
$function$;

CREATE OR REPLACE FUNCTION public.move_category_lines(p_from uuid, p_into uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
                  or t.id in (select h.transaction_id from private.category_moved_parts(moved->('line' || '_splits')) h)))
  );
end;
$function$;

CREATE OR REPLACE FUNCTION private.categories_loan_pnl_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.excluded_from_pnl is distinct from old.excluded_from_pnl
     and (
       exists (
         select 1 from private.loan_parts s
         where s.company_id = new.company_id
           and s.category_id = new.id
           and (
             new.loan_part is not null
             or (s.part = 'principal'::public.loan_split_part and not new.excluded_from_pnl)
           )
       )
       or exists (
         select 1 from public.loan_category_switches w
         where w.company_id = new.company_id
           and w.category_id = new.id
           and (
             new.loan_part is not null
             or (w.part = 'principal'::public.loan_split_part and not new.excluded_from_pnl)
           )
       )
       or exists (
         select 1 from public.loans l
         where l.company_id = new.company_id
           and (
             (l.principal_category_id = new.id and not new.excluded_from_pnl)
             or (
               new.loan_part is not null
               and new.id in (l.interest_category_id, l.escrow_category_id, l.principal_category_id)
             )
           )
       )
     )
  then
    raise exception 'loan category is fixed' using errcode = '23514';
  end if;
  return new;
end;
$function$

;

CREATE OR REPLACE FUNCTION private.dedupe_loan_money_categories()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  removed integer;
begin
  create temporary table loan_money_dupes on commit drop as
  select s.company_id, s.id
  from public.categories s
  where s.kind = 'income'
    and s.is_default
    and s.name = 'כסף שהתקבל מהלוואות'
    and exists (
      select 1 from public.categories o
      where o.company_id = s.company_id
        and o.id <> s.id
        and private.loan_money_category(o.kind, o.excluded_from_pnl, o.name)
    );

  -- Nothing may point at a duplicate that goes: no line, part, loan, supplier, sub-category,
  -- review row, undo row, Jev row or MCP write. A duplicate that is used stays as it is.
  delete from loan_money_dupes d
  where exists (select 1 from public.transactions t where t.company_id = d.company_id and t.category_id = d.id)
    or exists (select 1 from private.split_parts s where s.company_id = d.company_id and s.category_id = d.id)
    or exists (select 1 from private.loan_parts s where s.company_id = d.company_id and s.category_id = d.id)
    or exists (
      select 1 from public.loans l
      where l.company_id = d.company_id
        and d.id in (l.interest_category_id, l.escrow_category_id, l.principal_category_id, l.fees_category_id)
    )
    or exists (select 1 from public.suppliers s where s.company_id = d.company_id and s.remembered_category_id = d.id)
    or exists (select 1 from public.categories c where c.company_id = d.company_id and c.parent_id = d.id)
    or exists (
      select 1 from public.review_queue q
      where q.company_id = d.company_id
        and d.id in (q.prior_category_id, q.paired_category_id, q.prior_remembered_category_id, q.written_remembered_category_id)
    )
    or exists (select 1 from public.reassign_undo r where r.prior_category_id = d.id)
    or exists (select 1 from public.jev_outcomes j where d.id in (j.final_category_id, j.suggested_category_id))
    or exists (select 1 from public.jev_prefills j where d.id in (j.category_id, j.prior_category_id))
    or exists (select 1 from private.mcp_writes w where w.category_id = d.id)
    or exists (select 1 from private.category_deletions x where x.category_id = d.id);

  -- FLOW-436: the company's own loan money category keeps whether it counts in cash; the
  -- owner switches it with set_category_cash.
  delete from public.categories c
  using loan_money_dupes d
  where c.company_id = d.company_id
    and c.id = d.id;
  get diagnostics removed = row_count;

  drop table loan_money_dupes;
  return removed;
end;
$function$

;

CREATE OR REPLACE FUNCTION private.remember_line_category(p_company uuid, p_id uuid, p_category_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  line record;
  cat record;
  prior uuid;
  supplier_name text;
begin
  select t.direction, t.supplier_id, t.category_id, t.pnl_role into line
  from public.transactions t
  where t.id = p_id and t.company_id = p_company and t.removed_at is null;
  if not found then
    raise exception 'transaction not found';
  end if;
  if line.direction <> 'expense' or line.supplier_id is null then
    raise exception 'the line has no supplier';
  end if;
  if line.category_id is null then
    raise exception 'the line has no category';
  end if;
  if line.category_id is distinct from p_category_id then
    raise exception 'conflict';
  end if;
  if line.pnl_role = 'shared'
    or exists (select 1 from private.split_parts s where s.transaction_id = p_id)
  then
    raise exception 'a split line is not remembered';
  end if;

  select c.id, c.name, c.kind, c.loan_part into cat
  from public.categories c
  where c.id = line.category_id and c.company_id = p_company;
  if not found or cat.kind::text <> 'expense' then
    raise exception 'category not found';
  end if;
  if cat.loan_part is not null then
    raise exception 'a loan category is not remembered';
  end if;

  select s.remembered_category_id, s.name into prior, supplier_name
  from public.suppliers s
  where s.id = line.supplier_id and s.company_id = p_company
  for no key update;

  update public.suppliers s
  set remembered_category_id = cat.id
  where s.id = line.supplier_id and s.company_id = p_company;

  return jsonb_build_object(
    'supplier_id', line.supplier_id,
    'supplier_name', supplier_name,
    'category_id', cat.id,
    'category_name', cat.name,
    'prior_category_id', prior
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.get_setup_suggestions(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  cur text;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select c.base_currency into cur from public.companies c where c.id = cid;

  return jsonb_build_object(
    'projects', '[]'::jsonb,
    'lenders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'name', s.name,
          'monthly_agorot', -r.typical_amount_minor,
          'since', f.first_doc_date
        )
        order by s.name, s.id
      )
      -- One lender per supplier: a servicer paying several loans has one charge per project (decision
      -- 0185), and its monthly amount is their sum.
      from (
        select rp.direction, rp.party_id, rp.currency, sum(rp.typical_amount_minor)::bigint as typical_amount_minor,
          max(rp.months_seen) as months_seen
        from private.recurring_parties(cid, today) rp
        where rp.months_seen >= 3
        group by rp.direction, rp.party_id, rp.currency
      ) r
      join public.suppliers s on s.company_id = cid and s.id = r.party_id
      join lateral (
        select min(t.doc_date) as first_doc_date
        from public.transactions t
        where t.company_id = cid
          and t.supplier_id = r.party_id
          and t.removed_at is null
          and t.line_status = 'posted'
      ) f on true
      where r.direction = 'expense'
        and r.currency = cur
        and r.months_seen >= 3
        and not exists (
          select 1 from public.loans l
          where l.company_id = cid
            and lower(btrim(l.name)) = lower(btrim(s.name))
        )
        and not exists (
          select 1
          from private.loan_parts ls
          join public.transactions lt on lt.company_id = cid and lt.id = ls.transaction_id
          where ls.company_id = cid
            and lt.supplier_id = r.party_id
        )
    ), '[]'::jsonb)
  );
end;
$function$

;

CREATE OR REPLACE FUNCTION public.list_categories()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with co as (
    select private.readable_company_id() as id
  ),
  tagged as (
    select t.category_id, t.id as transaction_id
    from public.transactions t
    where t.company_id = (select id from co)
      and t.category_id is not null
      and t.removed_at is null
      and t.line_status = 'posted'::public.line_status
    union
    select s.category_id, s.transaction_id
    from private.split_parts s
    join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
    where s.company_id = (select id from co)
      and t.removed_at is null
      and t.line_status = 'posted'::public.line_status
  ),
  counted as (
    select
      g.category_id,
      count(*)::integer as lines,
      count(*) filter (where exists (
        select 1 from private.split_parts s
        where s.transaction_id = g.transaction_id and s.category_id = g.category_id
      ))::integer as split_lines
    from tagged g
    group by g.category_id
  ),
  loan_used as (
    select v.category_id
    from public.loans l
    cross join lateral (values
      (l.interest_category_id), (l.escrow_category_id), (l.principal_category_id), (l.fees_category_id)
    ) v(category_id)
    where l.company_id = (select id from co) and v.category_id is not null
    union
    select s.category_id
    from private.loan_parts s
    where s.company_id = (select id from co) and s.category_id is not null
    union
    select w.category_id
    from public.loan_category_switches w
    where w.company_id = (select id from co)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'kind', c.kind,
    'hidden', c.hidden,
    'is_default', c.is_default,
    'excluded_from_pnl', c.excluded_from_pnl,
    'in_cash', c.in_cash,
    'loan_part', c.loan_part,
    'group_name', c.group_name,
    'parent_id', c.parent_id,
    'children_count', (select count(*)::integer from public.categories k where k.parent_id = c.id),
    'rollup_lines', coalesce(n.lines, 0) + coalesce((
      select sum(m.lines)::integer from counted m
      join public.categories k on k.id = m.category_id
      where k.parent_id = c.id
    ), 0),
    'rehab', c.rehab,
    'in_rehab', private.category_in_rehab(c.rehab, c.excluded_from_pnl, c.loan_part),
    'lines', coalesce(n.lines, 0),
    'split_lines', coalesce(n.split_lines, 0),
    'loan_used', lu.category_id is not null
  ) order by c.kind, c.sort_order, c.name), '[]'::jsonb)
  from public.categories c
  left join counted n on n.category_id = c.id
  left join loan_used lu on lu.category_id = c.id
  where c.company_id = (select id from co);
$function$

;

