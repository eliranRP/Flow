-- FLOW-963: the charge page's פרויקט and קטגוריה pickers (owner, 2026-10-26). A pick changes every payment
-- of the recurring charge, the earlier ones too, and one undo takes all of it back.
--
-- A charge is a party's lines in one direction and currency (a party answered "the same" counts as the
-- recurring one, FLOW-430); a party split by project (decision 0185) has one charge per project, its
-- stream lines. Each line changes through the app's own writes, reassign_transaction for a project and
-- set_transaction_category for a category, so the review queue, the allocations and the undo rows
-- follow the rules those writes keep. A shared cost (split across projects, or waiting for its split)
-- and a line split into parts keep their parts: they are skipped and counted.

-- The lines of a charge. p_charge_project is null for a party with one charge, else that charge's project.
create or replace function private.recurring_charge_line_ids(
  p_company uuid,
  p_direction public.txn_direction,
  p_party uuid,
  p_currency text,
  p_charge_project uuid
)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select t.id
  from public.transactions t
  left join public.recurring_matches mm
    on mm.company_id = t.company_id and mm.direction = t.direction and mm.same
    and mm.match_party_id = coalesce(t.supplier_id, t.customer_id)
  where p_charge_project is null
    and t.company_id = p_company
    and t.direction = p_direction
    and t.currency = p_currency
    and coalesce(mm.party_id, t.supplier_id, t.customer_id) = p_party
    and t.removed_at is null
    and t.line_status = 'posted'
    and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
  union
  select sl.id
  from private.recurring_stream_lines(p_company, private.flow_today()) sl
  where p_charge_project is not null
    and sl.direction = p_direction
    and sl.party_id = p_party
    and sl.currency = p_currency
    and sl.stream_project = p_charge_project;
$function$;

revoke all on function private.recurring_charge_line_ids(uuid, public.txn_direction, uuid, text, uuid) from public, anon, authenticated;

-- One line of the charge: its undo id, or null when it is skipped (already so, shared, split into parts,
-- or a project pick on a line with no category to keep).
create or replace function private.reassign_charge_line(p_company uuid, p_id uuid, p_project uuid, p_category uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  line record;
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
    return public.reassign_transaction(p_id, p_project, coalesce(p_category, line.category_id));
  end if;
  if line.category_id is not distinct from p_category then
    return null;
  end if;
  return public.set_transaction_category(p_id, p_category, true);
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

-- The app's write: { changed, skipped, undo_ids }. undo_reassign_recurring_charge takes the ids back.
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
  line_id uuid;
  undo_id uuid;
  undo_ids uuid[] := '{}';
  skipped int := 0;
begin
  cid := private.recurring_charge_pick(p_direction, p_charge_project_id, p_project_id, p_category_id);
  for line_id in
    select l.id
    from private.recurring_charge_line_ids(cid, p_direction::public.txn_direction, p_party_id, p_currency, p_charge_project_id) l(id)
    order by l.id
  loop
    undo_id := private.reassign_charge_line(cid, line_id, p_project_id, p_category_id);
    if undo_id is null then
      skipped := skipped + 1;
    else
      undo_ids := undo_ids || undo_id;
    end if;
  end loop;
  return jsonb_build_object('changed', cardinality(undo_ids), 'skipped', skipped, 'undo_ids', to_jsonb(undo_ids));
end;
$function$;

revoke all on function public.reassign_recurring_charge(text, uuid, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.reassign_recurring_charge(text, uuid, text, uuid, uuid, uuid) to authenticated;

-- Undoes a charge pick: each line back as it was, newest write first, all or none.
create or replace function public.undo_reassign_recurring_charge(p_undo_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  undo_id uuid;
begin
  if private.current_company_id() is null then
    if private.is_read_only() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_undo_ids is null or cardinality(p_undo_ids) < 1 or cardinality(p_undo_ids) > 5000 then
    raise exception 'validation';
  end if;
  for undo_id in select u from unnest(p_undo_ids) with ordinality x(u, pos) order by pos desc
  loop
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
  batch_id uuid := gen_random_uuid();
  line_id uuid;
  undo_id uuid;
  ord int := 0;
  skipped int := 0;
  row_writes jsonb := '[]'::jsonb;
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
    for line_id in
      select l.id
      from private.recurring_charge_line_ids(cid, p_direction::public.txn_direction, p_party_id, p_currency, p_charge_project_id) l(id)
      order by l.id
    loop
      undo_id := private.reassign_charge_line(cid, line_id, p_project_id, p_category_id);
      if undo_id is null then
        skipped := skipped + 1;
      else
        ord := ord + 1;
        perform private.mcp_record_write(token, line_id, null, undo_id, 'reassign');
        row_writes := row_writes || jsonb_build_array(jsonb_build_object(
          'ordinal', ord, 'transaction_id', line_id, 'undo_kind', 'reassign', 'undo_id', undo_id));
      end if;
    end loop;
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm = 'validation' then
        return private.mcp_error('validation', 'validation');
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
    'transaction_ids', coalesce((select jsonb_agg(w->'transaction_id') from jsonb_array_elements(row_writes) w), '[]'::jsonb)
  ));
  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

revoke all on function public.mcp_reassign_recurring_charge(text, text, uuid, text, uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_reassign_recurring_charge(text, text, uuid, text, uuid, uuid, uuid) to authenticated;
