-- FLOW-118 and FLOW-208 (#76 and #88 review follow-ups).
-- 1. approve_split_review refuses a category that is not the company's with 'category not
--    found', not 'category kind must match the direction' (FLOW-118). The mcp_refused
--    whitelist keeps that message: assign_expense_split and save_line_split still raise it.
-- 2. mcp_assign_expenses hashes a split row's shares in project order, so a retried batch
--    with the shares in another order replays instead of returning conflict (FLOW-208).
-- 3. Undo snapshots keep category_assigned (FLOW-208). reassign_undo and review_queue get
--    prior_category_assigned; every write that stores prior_category_suggested stores it
--    too, and undo_reassign and reopen_review restore it. A category from a supplier rule or
--    the provider (neither a suggestion nor confirmed) is no longer left confirmed by undo.
--    Snapshots taken before this migration have null and keep the old rule.
-- Function bodies as in their latest migrations otherwise.

begin;

alter table public.reassign_undo add column prior_category_assigned boolean;
alter table public.review_queue add column prior_category_assigned boolean;

comment on column public.reassign_undo.prior_category_assigned is
  'transactions.category_assigned before the write; null for snapshots taken before FLOW-208.';
comment on column public.review_queue.prior_category_assigned is
  'transactions.category_assigned before the review write; null for snapshots taken before FLOW-208.';

create or replace function public.approve_split_review(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  txn uuid;
  reason text;
  item_status public.review_status;
  direction public.txn_direction;
  kind public.doc_kind;
  role public.pnl_role;
  category uuid;
  project uuid;
  assigned boolean;
  suggested boolean;
  cat_assigned boolean;
  supplier uuid;
  net bigint;
  gross bigint;
  doc_date date;
  description text;
  external_id text;
  shares jsonb;
  share_count integer;
  prior_remembered uuid;
  cat_kind text;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;

  select q.transaction_id
  into txn
  from public.review_queue q
  where q.id = p_id and q.company_id = cid;
  if txn is null then
    raise exception 'review item not found';
  end if;

  select t.direction, t.doc_kind, t.pnl_role, t.category_id, t.project_id, t.user_assigned,
         t.category_suggested, t.supplier_id, t.amount_net, t.amount_gross, t.doc_date,
         t.description, t.external_id, t.category_assigned
  into direction, kind, role, category, project, assigned, suggested, supplier, net, gross,
       doc_date, description, external_id, cat_assigned
  from public.transactions t
  where t.id = txn and t.company_id = cid and t.removed_at is null
  for update;
  if direction is null then
    raise exception 'review item not found';
  end if;

  select q.reason, q.status
  into reason, item_status
  from public.review_queue q
  where q.id = p_id and q.company_id = cid
  for update;
  if item_status is distinct from 'open' then
    raise exception 'review item not found';
  end if;
  if direction = 'income' then
    raise exception 'income is not split';
  end if;
  if reason = 'unallocated_shared' then
    raise exception 'shared costs are split, not assigned to one project';
  end if;

  select count(*)::integer into share_count
  from public.allocations a
  where a.transaction_id = txn;
  if role is distinct from 'shared' and share_count <= 1 then
    raise exception 'transaction is not split';
  end if;
  if category is null then
    raise exception 'category is required';
  end if;
  select c.kind::text into cat_kind
  from public.categories c
  where c.id = category and c.company_id = cid;
  if cat_kind is null then
    raise exception 'category not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  ) order by a.project_id), '[]'::jsonb)
  into shares
  from public.allocations a
  where a.transaction_id = txn;

  prior_remembered := null;
  if supplier is not null then
    select s.remembered_category_id into prior_remembered
    from public.suppliers s
    where s.id = supplier and s.company_id = cid;
  end if;

  update public.review_queue q
  set status = 'approved',
      resolved_at = now(),
      prior_project_id = project,
      prior_category_id = category,
      prior_pnl_role = role,
      prior_user_assigned = assigned,
      prior_category_suggested = suggested,
      prior_category_assigned = cat_assigned,
      prior_allocations = shares,
      prior_remembered_category_id = prior_remembered,
      written_remembered_category_id = null,
      doc_fingerprint = private.doc_fingerprint(direction::text, kind::text, gross, doc_date, description, external_id)
  where q.id = p_id
    and q.company_id = cid
    and q.status = 'open'
    and exists (
      select 1
      from public.transactions t
      where t.id = q.transaction_id
        and t.company_id = q.company_id
        and t.removed_at is null
    );
  if not found then
    raise exception 'review item not found';
  end if;
end;
$function$;

create or replace function public.mcp_assign_expenses(p_idempotency_key text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  batch_id uuid := gen_random_uuid();
  item jsonb;
  ord int := 0;
  row_key text;
  txn uuid;
  project_id uuid;
  category_id uuid;
  remember boolean;
  row_result jsonb;
  results jsonb := '[]'::jsonb;
  row_writes jsonb := '[]'::jsonb;
  ok_count int := 0;
  error_count int := 0;
  response jsonb;
begin
  -- Row keys are key:ordinal, and every per-row wrapper caps keys at 128.
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 124
    or p_items is null
    or jsonb_typeof(p_items) <> 'array'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 200 then
    return private.mcp_error('validation', 'validation');
  end if;

  if exists (
    select 1
    from (
      select elem->>'transaction_id' as tid
      from jsonb_array_elements(p_items) elem
      where elem->>'transaction_id' is not null
    ) listed
    group by tid
    having count(*) > 1
  ) then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  -- A split row's shares are hashed in project order, as assign_expense_split does (FLOW-208),
  -- so a retry with the shares in another order replays. Other rows hash as sent.
  hash := 'batch|' || md5((
    select jsonb_agg(
      case
        when jsonb_typeof(elem) = 'object' and jsonb_typeof(elem->'shares') = 'array' then
          jsonb_set(elem, '{shares}', coalesce((
            select jsonb_agg(share order by share->>'project_id', share::text)
            from jsonb_array_elements(elem->'shares') share
          ), '[]'::jsonb))
        else elem
      end
      order by pos
    )
    from jsonb_array_elements(p_items) with ordinality x(elem, pos)
  )::text);
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    ord := ord + 1;
    row_key := p_idempotency_key || ':' || ord::text;
    row_result := null;

    if jsonb_typeof(item) <> 'object' then
      row_result := private.mcp_error('validation', 'validation');
    elsif item->>'transaction_id' is null
      or (item->>'transaction_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      row_result := private.mcp_error('validation', 'validation');
    elsif item ? 'shares' and (
      jsonb_typeof(item->'shares') <> 'array'
      or item ? 'project_id'
      or item ? 'remember'
    ) then
      -- A split row names its projects in shares[]; remember applies to one project only.
      row_result := private.mcp_error('validation', 'validation');
    elsif not item ? 'shares' and (item->>'project_id') is null and (item->>'category_id') is null then
      row_result := private.mcp_error('validation', 'validation');
    elsif (item->>'project_id') is not null
      and (item->>'project_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      row_result := private.mcp_error('validation', 'validation');
    elsif (item->>'category_id') is not null
      and (item->>'category_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then
      row_result := private.mcp_error('validation', 'validation');
    elsif (item->>'project_id') is not null and (item->>'category_id') is null then
      row_result := private.mcp_error('validation', 'validation');
    elsif item ? 'remember' and jsonb_typeof(item->'remember') <> 'boolean' then
      row_result := private.mcp_error('validation', 'validation');
    else
      txn := (item->>'transaction_id')::uuid;
      project_id := nullif(item->>'project_id', '')::uuid;
      category_id := nullif(item->>'category_id', '')::uuid;
      remember := coalesce((item->>'remember')::boolean, false);
      begin
        if item ? 'shares' then
          row_result := public.mcp_assign_expense_split(
            row_key,
            txn,
            item->'shares',
            category_id
          );
        elsif project_id is not null then
          row_result := public.mcp_assign_expense(
            row_key,
            txn,
            project_id,
            category_id,
            remember
          );
        else
          row_result := public.mcp_set_expense_category(
            row_key,
            txn,
            category_id
          );
        end if;
      exception
        when deadlock_detected or serialization_failure then
          row_result := private.mcp_error('unavailable', 'retry');
        when others then
          row_result := private.mcp_refused(sqlerrm);
      end;
    end if;

    if row_result->>'ok' = 'true' then
      ok_count := ok_count + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'transaction_id', item->>'transaction_id',
        'ok', true,
        'undo_kind', row_result->'data'->>'undo_kind'
      ) || case
        when item ? 'shares' then jsonb_build_object(
          'closed_review', coalesce((row_result->'data'->>'closed_review')::boolean, false)
        )
        else '{}'::jsonb
      end);
      row_writes := row_writes || jsonb_build_array(jsonb_build_object(
        'ordinal', ord,
        'transaction_id', item->>'transaction_id',
        'undo_kind', row_result->'data'->>'undo_kind',
        'undo_id', row_result->'data'->>'id'
      ));
    else
      error_count := error_count + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'transaction_id', coalesce(item->>'transaction_id', '00000000-0000-4000-8000-000000000000'),
        'ok', false,
        'code', coalesce(row_result->'error'->>'code', 'refused')
      ));
    end if;
  end loop;

  response := jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'batch_key', batch_id,
      'ok_count', ok_count,
      'error_count', error_count,
      'results', results
    )
  );

  insert into private.mcp_batches (id, token_id, user_id, company_id, idempotency_key, row_writes)
  values (batch_id, token, auth.uid(), private.current_company_id(), p_idempotency_key, row_writes);

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

create or replace function public.mcp_assign_expense_split(p_idempotency_key text, p_transaction_id uuid, p_shares jsonb, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  response jsonb;
  locked boolean;
  direction public.txn_direction;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_cat_assigned boolean;
  prior_shares jsonb;
  review_id uuid;
  review_reason text;
  shares_save jsonb;
  cat_kind text;
  undo_id uuid;
  closed_review boolean := false;
  blocked boolean := false;
  item jsonb;
  project uuid;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or p_shares is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  begin
    shares_save := private.mcp_shares_for_save(p_shares);
  exception
    when others then
      return private.mcp_error('validation', 'validation');
  end;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'split|' || p_transaction_id::text || '|' || coalesce(p_category_id::text, '')
    || '|' || md5((
      select jsonb_agg(e order by e->>'project_id')
      from jsonb_array_elements(shares_save) e
    )::text);
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
    select t.direction, t.project_id, t.category_id, t.pnl_role, t.user_assigned, t.category_suggested, t.category_assigned
    into direction, prior_project, prior_category, prior_role, prior_assigned, prior_suggested, prior_cat_assigned
    from public.transactions t
    where t.id = p_transaction_id
      and t.company_id = cid
      and t.removed_at is null
    for update;
    locked := found;

    if exists (
      select 1
      from public.review_queue q
      where q.id = p_transaction_id
        and q.company_id = cid
    ) and not locked then
      response := private.mcp_error(
        'validation',
        'id is not a transaction; list_review.id is the review id'
      );
    elsif not locked then
      response := private.mcp_refused('transaction not found');
    elsif direction = 'income' then
      response := private.mcp_error('validation', 'validation');
    else
      for item in select value from jsonb_array_elements(shares_save)
      loop
        project := (item->>'project_id')::uuid;
        if not exists (
          select 1 from public.projects p where p.id = project and p.company_id = cid
        ) then
          response := private.mcp_refused('project or category not found');
          blocked := true;
          exit;
        end if;
      end loop;

      if not blocked then
        select coalesce(jsonb_agg(jsonb_build_object(
          'project_id', a.project_id,
          'share_bp', a.share_bp,
          'amount_net', a.amount_net
        ) order by a.project_id), '[]'::jsonb)
        into prior_shares
        from public.allocations a
        where a.transaction_id = p_transaction_id;

        select q.id, q.reason
        into review_id, review_reason
        from public.review_queue q
        where q.transaction_id = p_transaction_id
          and q.company_id = cid
          and q.status = 'open'
        order by q.created_at desc
        limit 1
        for update;

        if p_category_id is not null then
          select c.kind::text into cat_kind
          from public.categories c
          where c.id = p_category_id and c.company_id = cid;
          if cat_kind is null then
            response := private.mcp_refused('category not found');
            blocked := true;
          elsif cat_kind is distinct from direction::text then
            response := private.mcp_refused('category kind must match the direction');
            blocked := true;
          else
            update public.transactions
            set category_id = p_category_id,
                category_assigned = true,
                category_suggested = false,
                user_assigned = true
            where id = p_transaction_id and company_id = cid;
          end if;
        end if;

        if not blocked then
          perform public.save_split(p_transaction_id, shares_save);

          if review_id is not null and review_reason is distinct from 'unallocated_shared' then
            begin
              perform public.approve_split_review(review_id);
              -- approve_split_review snapshots the line after this write; reopen_review must
              -- restore the line as it was before the split and category change.
              update public.review_queue
              set prior_project_id = prior_project,
                  prior_category_id = prior_category,
                  prior_pnl_role = prior_role,
                  prior_user_assigned = coalesce(prior_assigned, false),
                  prior_category_suggested = prior_suggested,
                  prior_category_assigned = prior_cat_assigned,
                  prior_allocations = prior_shares
              where id = review_id
                and company_id = cid;
              closed_review := true;
              response := private.mcp_record_write(token, p_transaction_id, review_id, null, 'review');
            exception
              when others then
                insert into public.reassign_undo (
                  company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
                  prior_user_assigned, prior_category_suggested, prior_category_assigned, prior_allocations, prior_review_id
                ) values (
                  cid, p_transaction_id, prior_project, prior_category, prior_role,
                  coalesce(prior_assigned, false), prior_suggested, prior_cat_assigned, prior_shares, review_id
                )
                returning id into undo_id;
                response := private.mcp_record_write(token, p_transaction_id, null, undo_id, 'reassign');
            end;
          else
            insert into public.reassign_undo (
              company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
              prior_user_assigned, prior_category_suggested, prior_category_assigned, prior_allocations, prior_review_id
            ) values (
              cid, p_transaction_id, prior_project, prior_category, prior_role,
              coalesce(prior_assigned, false), prior_suggested, prior_cat_assigned, prior_shares, review_id
            )
            returning id into undo_id;
            response := private.mcp_record_write(token, p_transaction_id, null, undo_id, 'reassign');
            if review_id is not null then
              -- save_split closes an unallocated_shared review itself, after the category write;
              -- store the line as it was before this call so reopen_review restores it.
              update public.review_queue
              set prior_project_id = prior_project,
                  prior_category_id = prior_category,
                  prior_pnl_role = prior_role,
                  prior_user_assigned = coalesce(prior_assigned, false),
                  prior_category_suggested = prior_suggested,
                  prior_category_assigned = prior_cat_assigned,
                  prior_allocations = prior_shares
              where id = review_id
                and company_id = cid
                and status = 'changed';
              closed_review := found;
            end if;
          end if;
          if response->'data' is not null then
            response := jsonb_set(
              response,
              '{data,closed_review}',
              to_jsonb(closed_review),
              true
            );
          end if;
        end if;
      end if;
    end if;
  exception
    when deadlock_detected or serialization_failure then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

create or replace function public.collapse_split(p_id uuid, p_project_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  direction public.txn_direction;
  net bigint;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_cat_assigned boolean;
  prior_shares jsonb;
  share_count integer;
  review_id uuid;
  undo_id uuid;
  target_status public.project_status;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select t.direction, t.amount_net, t.project_id, t.category_id, t.pnl_role, t.user_assigned, t.category_suggested, t.category_assigned
  into direction, net, prior_project, prior_category, prior_role, prior_assigned, prior_suggested, prior_cat_assigned
  from public.transactions t
  where t.id = p_id and t.company_id = cid and t.removed_at is null
  for update;
  if direction is null then
    raise exception 'transaction not found';
  end if;
  if direction <> 'expense' then
    raise exception 'income is not split';
  end if;
  select p.status into target_status
  from public.projects p
  where p.id = p_project_id and p.company_id = cid;
  if target_status is null then
    raise exception 'project not found';
  end if;
  if target_status <> 'active' then
    raise exception 'project is finished';
  end if;

  select count(*)::integer into share_count
  from public.allocations a
  where a.transaction_id = p_id;

  if prior_role is distinct from 'shared'
    and share_count <= 1
    and not exists (
      select 1
      from public.review_queue q
      where q.transaction_id = p_id
        and q.company_id = cid
        and q.status = 'open'
        and q.reason = 'unallocated_shared'
    )
  then
    raise exception 'transaction is not split';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = p_id;

  select q.id into review_id
  from public.review_queue q
  where q.transaction_id = p_id
    and q.company_id = cid
    and q.status = 'open'
    and q.reason = 'unallocated_shared'
  order by q.created_at desc
  limit 1;

  delete from public.allocations where transaction_id = p_id and company_id = cid;
  delete from public.overhead where transaction_id = p_id and company_id = cid;

  update public.transactions
  set project_id = p_project_id,
      pnl_role = 'project',
      user_assigned = true
  where id = p_id and company_id = cid;

  insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
  values (cid, p_id, p_project_id, 10000, net);

  if review_id is not null then
    update public.review_queue
    set status = 'changed',
        resolved_at = now(),
        prior_project_id = prior_project,
        prior_category_id = prior_category,
        prior_pnl_role = prior_role,
        prior_user_assigned = prior_assigned,
        prior_category_suggested = prior_suggested,
        prior_category_assigned = prior_cat_assigned,
        prior_allocations = prior_shares
    where id = review_id and company_id = cid;
  end if;

  insert into public.reassign_undo (
    company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
    prior_user_assigned, prior_category_suggested, prior_category_assigned, prior_allocations, prior_review_id
  ) values (
    cid, p_id, prior_project, prior_category, prior_role,
    coalesce(prior_assigned, false), prior_suggested, prior_cat_assigned, prior_shares, review_id
  )
  returning id into undo_id;
  return undo_id;
end;
$function$;

create or replace function public.reassign_transaction(p_id uuid, p_project_id uuid, p_category_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  direction public.txn_direction;
  net bigint;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_cat_assigned boolean;
  prior_shares jsonb;
  cat_kind text;
  review_id uuid;
  undo_id uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select t.direction, t.amount_net, t.project_id, t.category_id, t.pnl_role, t.user_assigned, t.category_suggested, t.category_assigned
  into direction, net, prior_project, prior_category, prior_role, prior_assigned, prior_suggested, prior_cat_assigned
  from public.transactions t
  where t.id = p_id and t.company_id = cid and t.removed_at is null
  for update;
  if direction is null then
    raise exception 'transaction not found';
  end if;
  select c.kind::text into cat_kind
  from public.categories c
  where c.id = p_category_id and c.company_id = cid;
  if cat_kind is null then
    raise exception 'category not found';
  end if;
  if prior_role = 'shared' or exists (
    select 1
    from public.review_queue q
    where q.transaction_id = p_id
      and q.company_id = cid
      and q.status = 'open'
      and q.reason = 'unallocated_shared'
  ) then
    raise exception 'shared costs are split, not assigned to one project';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = p_id;

  select q.id into review_id
  from public.review_queue q
  where q.transaction_id = p_id and q.company_id = cid and q.status = 'open'
  order by q.created_at desc
  limit 1;

  delete from public.allocations where transaction_id = p_id and company_id = cid;
  delete from public.overhead where transaction_id = p_id and company_id = cid;

  if cat_kind = 'income' then
    if not coalesce((
      select c.excluded_from_pnl
      from public.categories c
      where c.id = p_category_id and c.company_id = cid
    ), false) and p_project_id is null then
      raise exception 'project and category are required';
    end if;
    if p_project_id is not null and not exists (
      select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
    ) then
      raise exception 'project not found';
    end if;
    update public.transactions
    set project_id = p_project_id,
        category_id = p_category_id,
        pnl_role = null,
        user_assigned = true,
        project_assigned = p_project_id is not null
    where id = p_id and company_id = cid;
  else
    if p_project_id is null or not exists (
      select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
    ) then
      raise exception 'project not found';
    end if;
    update public.transactions
    set project_id = p_project_id,
        category_id = p_category_id,
        pnl_role = 'project',
        user_assigned = true
    where id = p_id and company_id = cid;
    insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
    values (cid, p_id, p_project_id, 10000, net);
  end if;

  if review_id is not null then
    update public.review_queue
    set status = 'changed',
        resolved_at = now(),
        prior_project_id = prior_project,
        prior_category_id = prior_category,
        prior_pnl_role = prior_role,
        prior_user_assigned = prior_assigned,
        prior_category_suggested = prior_suggested,
        prior_category_assigned = prior_cat_assigned,
        prior_allocations = prior_shares
    where id = review_id and company_id = cid;
  end if;

  insert into public.reassign_undo (
    company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
    prior_user_assigned, prior_category_suggested, prior_category_assigned, prior_allocations, prior_review_id
  ) values (
    cid, p_id, prior_project, prior_category, prior_role,
    coalesce(prior_assigned, false), prior_suggested, prior_cat_assigned, prior_shares, review_id
  )
  returning id into undo_id;
  return undo_id;
end;
$function$;

create or replace function public.resolve_review(p_id uuid, p_action text, p_project_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid, p_remember boolean DEFAULT true, p_resolve boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  txn uuid;
  next_status public.review_status;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_cat_assigned boolean;
  prior_shares jsonb;
  prior_remembered uuid;
  written uuid;
  supplier uuid;
  net bigint;
  direction public.txn_direction;
  kind public.doc_kind;
  gross bigint;
  doc_date date;
  description text;
  external_id text;
  reason text;
  cat_kind text;
  eff_kind text;
  share_count integer;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_action not in ('approved', 'skipped', 'changed') then
    raise exception 'unknown review action';
  end if;
  next_status := p_action::public.review_status;
  select q.transaction_id, q.reason into txn, reason
  from public.review_queue q
  where q.id = p_id and q.company_id = cid and q.status = 'open';
  if txn is null then
    raise exception 'review item not found';
  end if;

  select t.project_id, t.category_id, t.pnl_role, t.user_assigned, t.category_suggested, t.supplier_id, t.amount_net,
         t.direction, t.doc_kind, t.amount_gross, t.doc_date, t.description, t.external_id, t.category_assigned
  into prior_project, prior_category, prior_role, prior_assigned, prior_suggested, supplier, net,
       direction, kind, gross, doc_date, description, external_id, prior_cat_assigned
  from public.transactions t
  where t.id = txn and t.company_id = cid
  for update;

  select count(*)::integer into share_count
  from public.allocations a
  where a.transaction_id = txn;

  if not p_resolve then
    if p_action is distinct from 'changed' then
      raise exception 'unknown review action';
    end if;
    if direction is null then
      raise exception 'review item not found';
    end if;
    if p_category_id is null and p_project_id is null then
      raise exception 'project or category is required';
    end if;
    if reason = 'unallocated_shared'
      or (direction is distinct from 'income' and p_project_id is not null) then
      perform private.guard_review_assignment(
        cid,
        txn,
        reason,
        prior_role,
        share_count,
        direction is distinct from 'income' and p_project_id is not null
      );
    end if;
    if p_category_id is not null then
      select c.kind::text into cat_kind
      from public.categories c
      where c.id = p_category_id and c.company_id = cid;
      if cat_kind is null then
        raise exception 'project or category not found';
      end if;
      -- The category is the owner's, including a pick of the suggested id.
      -- user_assigned stays, so a project guess remains.
      update public.transactions
      set category_id = p_category_id,
          category_assigned = true,
          category_suggested = false
      where id = txn and company_id = cid;
    end if;
    if p_project_id is not null then
      if not exists (
        select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
      ) then
        raise exception 'project or category not found';
      end if;
      -- The category kind decides the role: the given category, else the line's own.
      eff_kind := cat_kind;
      if eff_kind is null and prior_category is not null then
        select c.kind::text into eff_kind
        from public.categories c
        where c.id = prior_category and c.company_id = cid;
      end if;
      eff_kind := coalesce(eff_kind, direction::text);
      if eff_kind = 'income' then
        update public.transactions
        set project_id = p_project_id,
            project_assigned = true,
            pnl_role = null
        where id = txn and company_id = cid;
      else
        update public.transactions
        set project_id = p_project_id,
            project_assigned = true,
            pnl_role = 'project'
        where id = txn and company_id = cid;
        delete from public.allocations where transaction_id = txn and company_id = cid;
        insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
        values (cid, txn, p_project_id, 10000, net);
      end if;
    end if;
    return;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = txn;

  prior_remembered := null;
  if supplier is not null then
    select s.remembered_category_id into prior_remembered
    from public.suppliers s
    where s.id = supplier and s.company_id = cid;
  end if;

  if next_status <> 'skipped' then
    perform private.guard_review_assignment(
      cid,
      txn,
      reason,
      prior_role,
      share_count,
      direction is distinct from 'income'
    );
  end if;

  written := null;
  if next_status <> 'skipped' then
    if p_category_id is null then
      raise exception 'category is required';
    end if;
    select c.kind::text into cat_kind
    from public.categories c
    where c.id = p_category_id and c.company_id = cid;
    if cat_kind is null then
      raise exception 'project or category not found';
    end if;

    delete from public.allocations where transaction_id = txn and company_id = cid;

    if cat_kind = 'income' then
      if not coalesce((
        select c.excluded_from_pnl
        from public.categories c
        where c.id = p_category_id and c.company_id = cid
      ), false) and p_project_id is null then
        raise exception 'project and category are required';
      end if;
      if p_project_id is not null and not exists (
        select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
      ) then
        raise exception 'project or category not found';
      end if;
      update public.transactions
      set project_id = p_project_id,
          category_id = p_category_id,
          pnl_role = null,
          user_assigned = true,
          project_assigned = p_project_id is not null
      where id = txn and company_id = cid;
    else
      if p_project_id is null then
        raise exception 'project and category are required';
      end if;
      if not exists (
        select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
      ) then
        raise exception 'project or category not found';
      end if;
      update public.transactions
      set project_id = p_project_id,
          category_id = p_category_id,
          pnl_role = 'project',
          user_assigned = true
      where id = txn and company_id = cid;
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      values (cid, txn, p_project_id, 10000, net);
      if coalesce(p_remember, true) and supplier is not null then
        update public.suppliers
        set remembered_category_id = p_category_id
        where id = supplier and company_id = cid;
        written := p_category_id;
      end if;
    end if;
  end if;

  update public.review_queue
  set status = next_status,
      resolved_at = now(),
      prior_project_id = prior_project,
      prior_category_id = prior_category,
      prior_pnl_role = prior_role,
      prior_user_assigned = prior_assigned,
      prior_category_suggested = prior_suggested,
      prior_category_assigned = prior_cat_assigned,
      prior_allocations = prior_shares,
      prior_remembered_category_id = prior_remembered,
      written_remembered_category_id = written,
      doc_fingerprint = private.doc_fingerprint(direction::text, kind::text, gross, doc_date, description, external_id)
  where id = p_id and company_id = cid;
end;
$function$;

create or replace function public.set_transaction_category(p_id uuid, p_category_id uuid, p_resolve boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  direction public.txn_direction;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_cat_assigned boolean;
  prior_shares jsonb;
  cat_kind text;
  prior_review uuid;
  undo_id uuid;
  prior_kind text;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select t.direction, t.project_id, t.category_id, t.pnl_role, t.user_assigned, t.category_suggested, t.category_assigned
  into direction, prior_project, prior_category, prior_role, prior_assigned, prior_suggested, prior_cat_assigned
  from public.transactions t
  where t.id = p_id and t.company_id = cid and t.removed_at is null
  for update;
  if direction is null then
    raise exception 'transaction not found';
  end if;
  select c.kind::text into cat_kind
  from public.categories c
  where c.id = p_category_id and c.company_id = cid;
  if cat_kind is null then
    raise exception 'category not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = p_id;

  prior_review := null;
  if p_resolve then
    select q.id into prior_review
    from public.review_queue q
    where q.transaction_id = p_id
      and q.company_id = cid
      and q.status = 'open'
      and q.reason = 'missing_category'
    order by q.created_at desc
    limit 1;
  end if;

  update public.transactions
  set category_id = p_category_id,
      category_assigned = case when p_resolve then category_assigned else true end,
      category_suggested = case when p_resolve then category_suggested else false end,
      user_assigned = case when p_resolve then true else user_assigned end
  where id = p_id and company_id = cid;

  -- Role follows the category kind, as in reassign_transaction, when the kind changes
  -- on a line filed to one project. Shared and overhead lines keep their role.
  select coalesce((
    select c.kind::text from public.categories c
    where c.id = prior_category and c.company_id = cid
  ), direction::text) into prior_kind;
  if cat_kind is distinct from prior_kind then
    if cat_kind = 'income' and prior_role = 'project' then
      update public.transactions set pnl_role = null where id = p_id and company_id = cid;
      delete from public.allocations where transaction_id = p_id and company_id = cid;
    elsif cat_kind = 'expense' and prior_role is null and prior_project is not null then
      update public.transactions set pnl_role = 'project' where id = p_id and company_id = cid;
      delete from public.allocations where transaction_id = p_id and company_id = cid;
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      select cid, p_id, prior_project, 10000, t.amount_net
      from public.transactions t where t.id = p_id and t.company_id = cid;
    end if;
  end if;

  if prior_review is not null then
    update public.review_queue
    set status = 'changed',
        resolved_at = now(),
        prior_project_id = prior_project,
        prior_category_id = prior_category,
        prior_pnl_role = prior_role,
        prior_user_assigned = prior_assigned,
        prior_category_suggested = prior_suggested,
        prior_category_assigned = prior_cat_assigned,
        prior_allocations = prior_shares
    where id = prior_review and company_id = cid;

    if prior_role = 'shared'
      and not exists (select 1 from public.allocations a where a.transaction_id = p_id)
    then
      insert into public.review_queue (company_id, transaction_id, status, reason)
      values (cid, p_id, 'open', 'unallocated_shared');
    end if;
  end if;

  insert into public.reassign_undo (
    company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
    prior_user_assigned, prior_category_suggested, prior_category_assigned, prior_allocations, prior_review_id
  ) values (
    cid, p_id, prior_project, prior_category, prior_role,
    coalesce(prior_assigned, false), prior_suggested, prior_cat_assigned, prior_shares, prior_review
  )
  returning id into undo_id;
  return undo_id;
end;
$function$;

create or replace function public.undo_reassign(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  txn uuid;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_cat_assigned boolean;
  prior_shares jsonb;
  review_id uuid;
  item jsonb;
  updated int;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select u.transaction_id, u.prior_project_id, u.prior_category_id, u.prior_pnl_role,
         u.prior_user_assigned, u.prior_category_suggested, u.prior_allocations, u.prior_review_id,
         u.prior_category_assigned
  into txn, prior_project, prior_category, prior_role, prior_assigned, prior_suggested, prior_shares, review_id,
       prior_cat_assigned
  from public.reassign_undo u
  where u.id = p_id and u.company_id = cid and u.undone_at is null
  for update;
  if txn is null then
    raise exception 'undo not found';
  end if;

  update public.transactions
  set project_id = prior_project,
      category_id = prior_category,
      pnl_role = prior_role,
      user_assigned = prior_assigned,
      category_suggested = coalesce(prior_suggested, false),
      -- The flag from before the write (FLOW-208). Older snapshots have none: a suggested or
      -- empty category was not the owner's pick, so clear the flag a write set.
      category_assigned = case
        when prior_cat_assigned is not null then prior_cat_assigned
        when coalesce(prior_suggested, false) or prior_category is null then false
        else category_assigned
      end
  where id = txn and company_id = cid;
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'transaction not found';
  end if;

  delete from public.allocations where transaction_id = txn and company_id = cid;
  delete from public.overhead where transaction_id = txn and company_id = cid;
  if prior_shares is not null and jsonb_typeof(prior_shares) = 'array' then
    for item in select value from jsonb_array_elements(prior_shares)
    loop
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      values (
        cid, txn,
        (item->>'project_id')::uuid,
        (item->>'share_bp')::integer,
        (item->>'amount_net')::bigint
      );
    end loop;
  end if;
  if prior_role = 'overhead' then
    insert into public.overhead (company_id, transaction_id) values (cid, txn);
  end if;

  if review_id is not null then
    update public.review_queue
    set status = 'open',
        resolved_at = null
    where id = review_id and company_id = cid and status = 'changed';

    if prior_role = 'shared'
      and (prior_shares is null or prior_shares = '[]'::jsonb)
      and exists (
        select 1 from public.review_queue q
        where q.id = review_id and q.company_id = cid and q.reason = 'missing_category'
      )
    then
      delete from public.review_queue q
      where q.id = (
        select q2.id
        from public.review_queue q2
        where q2.company_id = cid
          and q2.transaction_id = txn
          and q2.status = 'open'
          and q2.reason = 'unallocated_shared'
        order by q2.created_at desc
        limit 1
      );
    end if;
  end if;

  update public.reassign_undo
  set undone_at = now()
  where id = p_id and company_id = cid;
end;
$function$;

create or replace function public.reopen_review(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  txn uuid;
  item_status public.review_status;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
  prior_cat_assigned boolean;
  prior_shares jsonb;
  prior_remembered uuid;
  written uuid;
  supplier uuid;
  item jsonb;
  updated int;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;

  select q.transaction_id
  into txn
  from public.review_queue q
  where q.id = p_id
    and q.company_id = cid;
  if txn is null then
    raise exception 'review item not found';
  end if;

  select t.supplier_id
  into supplier
  from public.transactions t
  where t.id = txn and t.company_id = cid
  for update;
  if not found then
    raise exception 'review item not found';
  end if;

  select q.prior_project_id, q.prior_category_id, q.prior_pnl_role,
         q.prior_user_assigned, q.prior_category_suggested, q.prior_allocations,
         q.prior_remembered_category_id, q.written_remembered_category_id, q.status, q.prior_category_assigned
  into prior_project, prior_category, prior_role, prior_assigned, prior_suggested, prior_shares,
       prior_remembered, written, item_status, prior_cat_assigned
  from public.review_queue q
  where q.id = p_id
    and q.company_id = cid
  for update;
  if item_status is null or item_status not in ('approved', 'skipped', 'changed') then
    raise exception 'review item not found';
  end if;

  update public.transactions
  set project_id = prior_project,
      category_id = prior_category,
      pnl_role = prior_role,
      user_assigned = coalesce(prior_assigned, false),
      category_suggested = coalesce(prior_suggested, false),
      -- The flag from before the write (FLOW-208). Older snapshots have none: a suggested or
      -- empty category was not the owner's pick, so clear the flag a write set.
      category_assigned = case
        when prior_cat_assigned is not null then prior_cat_assigned
        when coalesce(prior_suggested, false) or prior_category is null then false
        else category_assigned
      end
  where id = txn and company_id = cid;
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'review item not found';
  end if;

  delete from public.allocations where transaction_id = txn and company_id = cid;
  if prior_shares is not null and jsonb_typeof(prior_shares) = 'array' then
    for item in select value from jsonb_array_elements(prior_shares)
    loop
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      values (
        cid,
        txn,
        (item->>'project_id')::uuid,
        (item->>'share_bp')::integer,
        (item->>'amount_net')::bigint
      );
    end loop;
  end if;

  delete from public.overhead where transaction_id = txn and company_id = cid;
  if prior_role = 'overhead' then
    insert into public.overhead (company_id, transaction_id) values (cid, txn);
  end if;

  if supplier is not null and written is not null then
    update public.suppliers
    set remembered_category_id = prior_remembered
    where id = supplier
      and company_id = cid
      and remembered_category_id is not distinct from written;
  end if;

  update public.review_queue
  set status = 'open',
      resolved_at = null
  where id = p_id and company_id = cid;
end;
$function$;

commit;
