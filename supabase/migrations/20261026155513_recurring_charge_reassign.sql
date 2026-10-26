-- FLOW-963: the charge page's פרויקט and קטגוריה pickers (owner, 2026-10-26). A pick changes every payment
-- of the recurring charge, the earlier ones too, and one undo takes all of it back.
--
-- A charge is a party's lines in one direction and currency (a party answered "the same" counts as the
-- recurring one, FLOW-430), for one project (decision 0185). The server decides which: when the party's
-- stream lines in that direction and currency reach two projects or more, the party is split and the
-- charge is its project's lines (filed there, at any date) plus the unfiled lines the stream joins to it;
-- otherwise the charge is every line of the party, at any date. Each line changes through the app's own
-- writes, reassign_transaction for a project and set_transaction_category for a category, so the review
-- queue, the allocations and the undo rows follow the rules those writes keep. A shared cost (split
-- across projects, or waiting for its split) and a line split into parts keep their parts: they are
-- skipped and counted. The undo row keeps what the pick wrote, so an undo after another change to the
-- line is a conflict.

-- What a charge pick wrote on the line, so its undo can tell when the line changed since.
alter table public.reassign_undo
  add column charge_pick boolean not null default false,
  add column after_project_id uuid,
  add column after_category_id uuid,
  add column after_pnl_role public.pnl_role;

-- At most this many payments change in one pick, the undo's own cap.
create or replace function private.charge_pick_cap()
returns int
language sql
immutable
set search_path = ''
as $function$ select 5000 $function$;

revoke all on function private.charge_pick_cap() from public, anon, authenticated;

-- Every posted line of a party in one direction and currency, at any date.
create or replace function private.recurring_party_lines(p_company uuid, p_direction public.txn_direction, p_party uuid, p_currency text)
returns table(id uuid, project_id uuid)
language sql
stable
security definer
set search_path = ''
as $function$
  select t.id, t.project_id
  from public.transactions t
  left join public.recurring_matches mm
    on mm.company_id = t.company_id and mm.direction = t.direction and mm.same
    and mm.match_party_id = coalesce(t.supplier_id, t.customer_id)
  where t.company_id = p_company
    and t.direction = p_direction
    and t.currency = p_currency
    and coalesce(mm.party_id, t.supplier_id, t.customer_id) = p_party
    and t.removed_at is null
    and t.line_status = 'posted'
    and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'));
$function$;

revoke all on function private.recurring_party_lines(uuid, public.txn_direction, uuid, text) from public, anon, authenticated;

-- The charge's lines, and whether the party is split by project. A split party needs p_charge_project to
-- be one of its charges' projects; a party with one charge takes its project or none (validation otherwise).
create or replace function private.recurring_charge_lines(
  p_company uuid,
  p_direction public.txn_direction,
  p_party uuid,
  p_currency text,
  p_charge_project uuid
)
returns table(id uuid, split boolean)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  streams uuid[];
begin
  select coalesce(array_agg(distinct sl.stream_project) filter (where sl.stream_project is not null), '{}')
  into streams
  from private.recurring_stream_lines(p_company, private.flow_today()) sl
  where sl.direction = p_direction and sl.party_id = p_party and sl.currency = p_currency;

  if cardinality(streams) > 1 then
    if p_charge_project is null or not p_charge_project = any(streams) then
      raise exception 'validation';
    end if;
    return query
      select l.id, true
      from private.recurring_party_lines(p_company, p_direction, p_party, p_currency) l
      where l.project_id = p_charge_project
      union
      select sl.id, true
      from private.recurring_stream_lines(p_company, private.flow_today()) sl
      where sl.direction = p_direction and sl.party_id = p_party and sl.currency = p_currency
        and sl.project_id is null and sl.stream_project = p_charge_project;
    return;
  end if;
  if p_charge_project is not null and cardinality(streams) = 1 and p_charge_project <> streams[1] then
    raise exception 'validation';
  end if;
  return query
    select l.id, false
    from private.recurring_party_lines(p_company, p_direction, p_party, p_currency) l;
end;
$function$;

revoke all on function private.recurring_charge_lines(uuid, public.txn_direction, uuid, text, uuid) from public, anon, authenticated;

-- One line of the charge: its undo id, or null when it is skipped (already so, shared, split into parts,
-- or a project pick on a line with no category to keep). The undo row keeps what the pick wrote.
create or replace function private.reassign_charge_line(p_company uuid, p_id uuid, p_project uuid, p_category uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  line record;
  undo_id uuid;
begin
  select t.project_id, t.category_id, t.pnl_role into line
  from public.transactions t
  where t.id = p_id and t.company_id = p_company and t.removed_at is null
  for update;
  if not found then
    return null;
  end if;
  if line.pnl_role = 'shared'
    or exists (
      select 1 from public.review_queue q
      where q.transaction_id = p_id and q.company_id = p_company
        and q.status = 'open' and q.reason = 'unallocated_shared'
    )
    or exists (select 1 from public.line_splits s where s.transaction_id = p_id and s.company_id = p_company)
  then
    return null;
  end if;
  if p_project is not null then
    if line.project_id is not distinct from p_project
      and (p_category is null or line.category_id is not distinct from p_category)
    then
      return null;
    end if;
    if coalesce(p_category, line.category_id) is null then
      return null;
    end if;
    undo_id := public.reassign_transaction(p_id, p_project, coalesce(p_category, line.category_id));
  else
    if line.category_id is not distinct from p_category then
      return null;
    end if;
    undo_id := public.set_transaction_category(p_id, p_category, true);
  end if;
  update public.reassign_undo u
  set charge_pick = true, after_project_id = t.project_id, after_category_id = t.category_id, after_pnl_role = t.pnl_role
  from public.transactions t
  where u.id = undo_id and u.company_id = p_company and t.id = p_id and t.company_id = p_company;
  return undo_id;
end;
$function$;

revoke all on function private.reassign_charge_line(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- Checks a pick before any line changes; raises the refusal, or returns the company.
create or replace function private.recurring_charge_pick(
  p_direction text,
  p_charge_project_id uuid,
  p_project_id uuid,
  p_category_id uuid
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  cid uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_direction is null or p_direction not in ('income', 'expense') or (p_project_id is null and p_category_id is null) then
    raise exception 'validation';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
  ) then
    raise exception 'project not found';
  end if;
  if p_charge_project_id is not null and not exists (
    select 1 from public.projects p where p.id = p_charge_project_id and p.company_id = cid
  ) then
    raise exception 'project not found';
  end if;
  -- The charge's own kind: an expense charge takes an expense category, an income charge an income one.
  if p_category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = p_category_id and c.company_id = cid and c.kind::text = p_direction
  ) then
    raise exception 'category not found';
  end if;
  return cid;
end;
$function$;

revoke all on function private.recurring_charge_pick(text, uuid, uuid, uuid) from public, anon, authenticated;

-- The charge's lines for a pick, in id order, within the cap.
create or replace function private.recurring_charge_pick_lines(
  p_company uuid,
  p_direction text,
  p_party uuid,
  p_currency text,
  p_charge_project uuid
)
returns table(ids uuid[], split boolean)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  select coalesce(array_agg(l.id order by l.id), '{}'), coalesce(bool_or(l.split), false)
  into ids, split
  from private.recurring_charge_lines(p_company, p_direction::public.txn_direction, p_party, p_currency, p_charge_project) l;
  if cardinality(ids) > private.charge_pick_cap() then
    raise exception 'too many payments: at most 5000 in one pick';
  end if;
  return next;
end;
$function$;

revoke all on function private.recurring_charge_pick_lines(uuid, text, uuid, text, uuid) from public, anon, authenticated;

-- The app's write: { changed, skipped, split, undo_ids }. undo_reassign_recurring_charge takes the ids back.
create or replace function public.reassign_recurring_charge(
  p_direction text,
  p_party_id uuid,
  p_currency text,
  p_charge_project_id uuid,
  p_project_id uuid,
  p_category_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  cid uuid;
  lines record;
  line_id uuid;
  undo_id uuid;
  undo_ids uuid[] := '{}';
  skipped int := 0;
begin
  cid := private.recurring_charge_pick(p_direction, p_charge_project_id, p_project_id, p_category_id);
  select * into lines from private.recurring_charge_pick_lines(cid, p_direction, p_party_id, p_currency, p_charge_project_id);
  foreach line_id in array lines.ids
  loop
    undo_id := private.reassign_charge_line(cid, line_id, p_project_id, p_category_id);
    if undo_id is null then
      skipped := skipped + 1;
    else
      undo_ids := undo_ids || undo_id;
    end if;
  end loop;
  return jsonb_build_object('changed', cardinality(undo_ids), 'skipped', skipped, 'split', lines.split, 'undo_ids', to_jsonb(undo_ids));
end;
$function$;

revoke all on function public.reassign_recurring_charge(text, uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.reassign_recurring_charge(text, uuid, text, uuid, uuid, uuid) to authenticated;

-- Undoes a charge pick: each line back as it was, newest write first, all or none. A line changed since
-- the pick (its project, category or role is no longer what the pick wrote) is a conflict.
create or replace function public.undo_reassign_recurring_charge(p_undo_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  cid uuid;
  undo_id uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_undo_ids is null or cardinality(p_undo_ids) < 1 or cardinality(p_undo_ids) > private.charge_pick_cap() then
    raise exception 'validation';
  end if;
  for undo_id in select u from unnest(p_undo_ids) with ordinality x(u, pos) order by pos desc
  loop
    if exists (
      select 1
      from public.reassign_undo u
      join public.transactions t on t.id = u.transaction_id and t.company_id = u.company_id
      where u.id = undo_id and u.company_id = cid and u.charge_pick and u.undone_at is null
        and (t.project_id is distinct from u.after_project_id
          or t.category_id is distinct from u.after_category_id
          or t.pnl_role is distinct from u.after_pnl_role)
    ) then
      raise exception 'conflict';
    end if;
    perform public.undo_reassign(undo_id);
  end loop;
end;
$function$;

revoke all on function public.undo_reassign_recurring_charge(uuid[]) from public, anon, authenticated;
grant execute on function public.undo_reassign_recurring_charge(uuid[]) to authenticated;

-- flow-mcp's reassign_recurring_charge: the same write as a batch, one row per changed line (kind reassign),
-- so undo_batch with the returned batch_key takes it back.
create or replace function public.mcp_reassign_recurring_charge(
  p_idempotency_key text,
  p_direction text,
  p_party_id uuid,
  p_currency text,
  p_charge_project_id uuid,
  p_project_id uuid,
  p_category_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  lines record;
  batch_id uuid := gen_random_uuid();
  line_id uuid;
  undo_id uuid;
  ord int := 0;
  skipped int := 0;
  row_writes jsonb := '[]'::jsonb;
  results jsonb := '[]'::jsonb;
  response jsonb;
begin
  -- Row keys are key:ordinal, as in mcp_assign_expenses.
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 124
    or p_party_id is null
    or p_currency is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'charge|' || coalesce(p_direction, '') || '|' || p_party_id::text || '|' || p_currency || '|'
    || coalesce(p_charge_project_id::text, '') || '|' || coalesce(p_project_id::text, '') || '|' || coalesce(p_category_id::text, '');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    cid := private.recurring_charge_pick(p_direction, p_charge_project_id, p_project_id, p_category_id);
    select * into lines from private.recurring_charge_pick_lines(cid, p_direction, p_party_id, p_currency, p_charge_project_id);
    foreach line_id in array lines.ids
    loop
      undo_id := private.reassign_charge_line(cid, line_id, p_project_id, p_category_id);
      if undo_id is null then
        skipped := skipped + 1;
      else
        ord := ord + 1;
        perform private.mcp_record_write(token, line_id, null, undo_id, 'reassign');
        row_writes := row_writes || jsonb_build_array(jsonb_build_object(
          'ordinal', ord, 'transaction_id', line_id, 'undo_kind', 'reassign', 'undo_id', undo_id));
        results := results || jsonb_build_array(jsonb_build_object(
          'transaction_id', line_id, 'ok', true, 'undo_kind', 'reassign'));
      end if;
    end loop;
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm = 'validation' then
        return private.mcp_error('validation', 'validation');
      end if;
      if sqlerrm like 'too many payments%' then
        return private.mcp_error('validation', sqlerrm);
      end if;
      response := private.mcp_refused(sqlerrm);
      perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
      return response;
  end;

  insert into private.mcp_batches (id, token_id, user_id, company_id, idempotency_key, row_writes)
  values (batch_id, token, auth.uid(), cid, p_idempotency_key, row_writes);
  response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'batch_key', batch_id,
    'changed', ord,
    'skipped', skipped,
    'split', lines.split,
    'results', results
  ));
  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

revoke all on function public.mcp_reassign_recurring_charge(text, text, uuid, text, uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_reassign_recurring_charge(text, text, uuid, text, uuid, uuid, uuid) to authenticated;
