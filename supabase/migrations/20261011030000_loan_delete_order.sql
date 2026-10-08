-- FLOW-110, server part (the owner chose "unmatch with undo"). Decision 0141.
-- 1. public.delete_loan(loan): the owner deletes a loan in one call. Its split parts and rate
--    rows go with it, so its matched payments count whole again under their own categories.
--    What it removed is kept in private.loan_deletions, so public.restore_loan(loan) (the
--    app's undo) and MCP undo can put it back.
-- 2. public.reorder_loans(ids): the owner saves the order of the loans list (loans.sort_order).
--    mcp_list_loans lists by it; a loan with no place yet (a new one) goes last, by name.
-- 3. MCP delete_loan (undo kind loan_delete) and reorder_loans (undo kind loan_order), with
--    the usual idempotency key and write rate limit.
-- 4. The loans delete policy goes: a delete takes the loan and line locks through delete_loan.
-- mcp_undo, mcp_refused, the mcp_writes checks and mcp_list_loans are patched from their
-- current definitions, with counted anchors, so changes merged since stay.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- How many times an anchor appears in a text (each patch below needs an exact count).
create function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- The order of the loans list. Today's order is by name; null (a new loan) goes last.
alter table public.loans add column sort_order integer;
update public.loans l
set sort_order = o.place
from (
  select id, row_number() over (partition by company_id order by name, id)::integer as place
  from public.loans
) o
where o.id = l.id;

drop policy loans_delete on public.loans;

-- What delete_loan removed: the loan row, its rate rows and its split parts.
create table private.loan_deletions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  loan_id uuid not null,
  user_id uuid not null,
  snapshot jsonb not null,
  deleted_at timestamptz not null default clock_timestamp(),
  restored_at timestamptz
);
create index loan_deletions_loan_idx on private.loan_deletions (company_id, loan_id, deleted_at desc);
revoke all on table private.loan_deletions from public, anon, authenticated, service_role;

-- Puts a deleted loan back from its snapshot: the loan row, its rates, then its parts, each
-- line checked as save_loan_split checks it. Raises check_violation ('loan cannot be
-- restored') when it no longer fits: the loan id is taken again, a line is gone or matched
-- again, or the parts no longer fit the line. A removed line keeps its parts, as it did
-- before the delete. A project or loan category deleted since is left empty, as its
-- on delete set null would have left it. The caller holds no locks; this takes the lines in
-- id order (the loan does not exist yet, so nothing else can take its lock).
create function private.loan_restore(p_company_id uuid, p_snapshot jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  loan_row public.loans;
  lines uuid[];
  locked integer;
  line uuid;
begin
  loan_row := jsonb_populate_record(null::public.loans, p_snapshot->'loan');
  if loan_row.id is null or loan_row.company_id is distinct from p_company_id then
    raise exception 'loan cannot be restored' using errcode = '23514';
  end if;
  if not exists (select 1 from public.projects p where p.id = loan_row.project_id and p.company_id = p_company_id) then
    loan_row.project_id := null;
  end if;
  if not exists (select 1 from public.categories c where c.id = loan_row.interest_category_id and c.company_id = p_company_id) then
    loan_row.interest_category_id := null;
  end if;
  if not exists (select 1 from public.categories c where c.id = loan_row.escrow_category_id and c.company_id = p_company_id) then
    loan_row.escrow_category_id := null;
  end if;
  if not exists (select 1 from public.categories c where c.id = loan_row.principal_category_id and c.company_id = p_company_id) then
    loan_row.principal_category_id := null;
  end if;
  if not exists (select 1 from public.categories c where c.id = loan_row.fees_category_id and c.company_id = p_company_id) then
    loan_row.fees_category_id := null;
  end if;

  select coalesce(array_agg(distinct (e.value->>'transaction_id')::uuid), '{}')
  into lines
  from jsonb_array_elements(coalesce(p_snapshot->'parts', '[]'::jsonb)) e;

  select count(*) into locked
  from (
    select t.id
    from public.transactions t
    where t.company_id = p_company_id
      and t.id = any (lines)
    order by t.id
    for update
  ) l;
  if locked <> cardinality(lines)
     or exists (select 1 from public.loans l where l.id = loan_row.id)
     or exists (
       select 1 from public.loan_splits s
       where s.company_id = p_company_id and s.transaction_id = any (lines)
     )
  then
    raise exception 'loan cannot be restored' using errcode = '23514';
  end if;

  insert into public.loans select (loan_row).*;
  insert into public.loan_rates (id, company_id, loan_id, effective_date, annual_rate_ppm, created_at, updated_at)
  select r.id, r.company_id, r.loan_id, r.effective_date, r.annual_rate_ppm, r.created_at, r.updated_at
  from jsonb_populate_recordset(null::public.loan_rates, coalesce(p_snapshot->'rates', '[]'::jsonb)) r;
  insert into public.loan_splits (
    company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review
  )
  select p_company_id, loan_row.id, (e.value->>'transaction_id')::uuid,
    (e.value->>'part')::public.loan_split_part, (e.value->>'amount_minor')::bigint,
    (e.value->>'scheduled_minor')::bigint, (e.value->>'category_id')::uuid,
    coalesce((e.value->>'needs_review')::boolean, false)
  from jsonb_array_elements(coalesce(p_snapshot->'parts', '[]'::jsonb)) e;
  foreach line in array lines loop
    perform private.loan_splits_check(line);
  end loop;
exception
  when check_violation or foreign_key_violation or unique_violation or not_null_violation then
    raise exception 'loan cannot be restored' using errcode = '23514';
end;
$$;

revoke all on function private.loan_restore(uuid, jsonb) from public, anon, authenticated, service_role;

create function public.delete_loan(p_loan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  loan_row public.loans;
  rates jsonb;
  parts jsonb;
  payments integer;
  deletion uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers v where v.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_loan_id is null then
    raise exception 'validation';
  end if;

  -- The loan first, then its lines: the order every loan split write takes (no deadlock).
  select * into loan_row
  from public.loans l
  where l.id = p_loan_id and l.company_id = cid
  for update;
  if not found then
    raise exception 'loan not found';
  end if;
  perform 1
  from public.transactions t
  where t.company_id = cid
    and t.id in (select s.transaction_id from public.loan_splits s where s.loan_id = p_loan_id and s.company_id = cid)
  order by t.id
  for update;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.effective_date), '[]'::jsonb)
  into rates
  from public.loan_rates r
  where r.loan_id = p_loan_id and r.company_id = cid;
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'transaction_id', s.transaction_id,
      'part', s.part,
      'amount_minor', s.amount_minor,
      'scheduled_minor', s.scheduled_minor,
      'category_id', s.category_id,
      'needs_review', s.needs_review
    ) order by s.transaction_id, s.part), '[]'::jsonb),
    count(distinct s.transaction_id) filter (where t.removed_at is null)::integer
  into parts, payments
  from public.loan_splits s
  join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
  where s.loan_id = p_loan_id and s.company_id = cid;

  -- The parts and rates go with the loan (on delete cascade).
  delete from public.loans l where l.id = p_loan_id and l.company_id = cid;

  insert into private.loan_deletions (company_id, loan_id, user_id, snapshot)
  values (cid, p_loan_id, auth.uid(),
    jsonb_build_object('loan', to_jsonb(loan_row), 'rates', rates, 'parts', parts))
  returning id into deletion;

  return jsonb_build_object(
    'loan_id', p_loan_id,
    'name', loan_row.name,
    'payments', payments,
    'deletion_id', deletion
  );
end;
$$;

revoke all on function public.delete_loan(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_loan(uuid) to authenticated;
comment on function public.delete_loan(uuid) is
  'Deletes a loan with its rates and split parts (owner only); its payments count whole again. restore_loan undoes it. Decision 0141.';

-- The app's undo: puts back the latest delete of this loan.
create function public.restore_loan(p_loan_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  deletion private.loan_deletions;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers v where v.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_loan_id is null then
    raise exception 'validation';
  end if;

  select * into deletion
  from private.loan_deletions d
  where d.company_id = cid and d.loan_id = p_loan_id and d.restored_at is null
  order by d.deleted_at desc
  limit 1
  for update;
  if not found then
    raise exception 'loan not found';
  end if;

  perform private.loan_restore(cid, deletion.snapshot);
  update private.loan_deletions set restored_at = clock_timestamp() where id = deletion.id;
  return jsonb_build_object(
    'loan_id', p_loan_id,
    'payments', (
      select count(distinct e.value->>'transaction_id')::integer
      from jsonb_array_elements(deletion.snapshot->'parts') e
    )
  );
end;
$$;

revoke all on function public.restore_loan(uuid) from public, anon, authenticated, service_role;
grant execute on function public.restore_loan(uuid) to authenticated;
comment on function public.restore_loan(uuid) is
  'Puts back the latest deleted copy of a loan (owner only); loan cannot be restored when a payment changed since. Decision 0141.';

-- The loans list order, newest call wins. p_loan_ids names every loan of the company once.
create function private.loan_order(p_company_id uuid)
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(l.id order by l.sort_order nulls last, l.name, l.id), '{}')
  from public.loans l
  where l.company_id = p_company_id;
$$;

revoke all on function private.loan_order(uuid) from public, anon, authenticated, service_role;

create function public.reorder_loans(p_loan_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  before uuid[];
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (select 1 from public.company_viewers v where v.user_id = (select auth.uid())) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_loan_ids is null or array_position(p_loan_ids, null) is not null then
    raise exception 'validation';
  end if;

  perform 1 from public.loans l where l.company_id = cid order by l.id for update;
  before := private.loan_order(cid);
  -- Every loan once, nothing else: a list made before a loan was added or deleted is stale.
  if cardinality(p_loan_ids) <> cardinality(before)
     or (select count(distinct x) from unnest(p_loan_ids) x) <> cardinality(before)
     or not (p_loan_ids <@ before)
  then
    raise exception 'validation';
  end if;

  update public.loans l
  set sort_order = o.place::integer
  from unnest(p_loan_ids) with ordinality as o(id, place)
  where l.id = o.id and l.company_id = cid and l.sort_order is distinct from o.place::integer;

  return jsonb_build_object('before', to_jsonb(before), 'after', to_jsonb(p_loan_ids));
end;
$$;

revoke all on function public.reorder_loans(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.reorder_loans(uuid[]) to authenticated;
comment on function public.reorder_loans(uuid[]) is
  'Saves the loans list order (owner only); every loan of the company once. Decision 0141.';

create function public.mcp_delete_loan(p_idempotency_key text, p_loan_id uuid)
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
    or p_loan_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_delete|' || p_loan_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    deleted := public.delete_loan(p_loan_id);
    insert into private.mcp_writes (token_id, user_id, loan_id, kind, prior, created_at)
    values (
      token, auth.uid(), p_loan_id, 'loan_delete',
      jsonb_build_object('deletion_id', deleted->'deletion_id'),
      clock_timestamp()
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'loan_id', p_loan_id,
        'name', deleted->'name',
        'payments', deleted->'payments',
        'undo_kind', 'loan_delete',
        'id', p_loan_id
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

revoke all on function public.mcp_delete_loan(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_delete_loan(text, uuid) to authenticated;

create function public.mcp_reorder_loans(p_idempotency_key text, p_loan_ids uuid[])
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
  ordered jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_loan_ids is null
    or cardinality(p_loan_ids) > 200
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_order|' || array_to_string(p_loan_ids, ',');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  begin
    ordered := public.reorder_loans(p_loan_ids);
    insert into private.mcp_writes (token_id, user_id, company_id, kind, prior, created_at)
    values (token, auth.uid(), cid, 'loan_order', ordered, clock_timestamp());
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'loan_ids', ordered->'after',
        'undo_kind', 'loan_order',
        'id', cid
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

revoke all on function public.mcp_reorder_loans(text, uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.mcp_reorder_loans(text, uuid[]) to authenticated;

do $patch$
declare
  def text;
  anchor text;
begin
  -- private.mcp_writes: the loan_delete and loan_order kinds.
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'loan_detach'::text$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, anchor || $n$, 'loan_delete'::text, 'loan_order'::text$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'loan_detach'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'loan_delete'::text) AND (loan_id IS NOT NULL) AND (prior ? 'deletion_id'::text)) OR ((kind = 'loan_order'::text) AND (company_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'after'::text))))$n$;

  -- private.mcp_refused: the restore refusal.
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  anchor := $a$'line has no loan split'$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$,
        -- FLOW-110 (decision 0141).
        'loan cannot be restored'$n$);

  -- public.mcp_undo: loan_delete puts the loan back; loan_order puts the old order back.
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  anchor := $a$'loan_detach'
    )$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, $n$'loan_detach', 'loan_delete', 'loan_order'
    )$n$);

  anchor := $a$or (p_kind = 'loan_detach' and w.kind = 'loan_detach' and w.transaction_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind = 'loan_delete' and w.kind = 'loan_delete' and w.loan_id = p_id)
        or (p_kind = 'loan_order' and w.kind = 'loan_order' and w.company_id = p_id)$n$);

  anchor := $a$    elsif p_kind = 'loan_detach' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo loan_detach branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'loan_delete' then
      -- The delete this write made, if the app has not put the loan back since.
      select d.snapshot into written
      from private.loan_deletions d
      where d.id = (rec.prior->>'deletion_id')::uuid
        and d.company_id = cid
        and d.restored_at is null
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      else
        begin
          perform private.loan_restore(cid, written);
          update private.loan_deletions
          set restored_at = clock_timestamp()
          where id = (rec.prior->>'deletion_id')::uuid;
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
    elsif p_kind = 'loan_order' then
      if p_id is distinct from cid then
        response := private.mcp_error('not_found', 'not found');
      else
        perform 1 from public.loans l where l.company_id = cid order by l.id for update;
        -- Only while the order is still the one this write set, and no loan came or went.
        if to_jsonb(private.loan_order(cid)) is distinct from rec.prior->'after' then
          response := private.mcp_error('conflict', 'conflict');
        else
          update public.loans l
          set sort_order = o.place::integer
          from jsonb_array_elements_text(rec.prior->'before') with ordinality as o(id, place)
          where l.id = o.id::uuid and l.company_id = cid;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
      end if;
$n$ || anchor);
  execute def;

  -- mcp_list_loans: the saved order, then the name.
  def := pg_get_functiondef('public.mcp_list_loans()'::regprocedure);
  anchor := $a$) order by l.name), '[]'::jsonb)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_list_loans is not the expected definition';
  end if;
  execute replace(def, anchor, $n$) order by l.sort_order nulls last, l.name, l.id), '[]'::jsonb)$n$);
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
