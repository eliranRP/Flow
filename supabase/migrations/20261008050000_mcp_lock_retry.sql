-- FLOW-130 (#123 review follow-up).
-- The MCP write functions below sent lock_not_available (a lock timeout) to `when others`,
-- so the refusal was stored under the idempotency key and a retry with the same key replayed
-- it. A lock timeout now returns unavailable / retry like a deadlock and stores nothing, as
-- 20261008043000_loan_attach_lock_retry.sql did for mcp_attach_loan_payment and mcp_undo.
-- In the batch tools (create_categories, create_projects, set_lines_pnl, assign_expenses,
-- undo_batch) the timed-out row reads code unavailable, like a deadlocked row.
-- Each body is otherwise as in the migration named above it. Grants are kept by
-- create or replace.

begin;

set local lock_timeout = '5s';

-- mcp_add_loan: as in 20261007193000_loan_project.sql.
create or replace function public.mcp_add_loan(
  p_idempotency_key text,
  p_name text,
  p_principal_minor bigint,
  p_annual_rate_ppm integer,
  p_term_months integer,
  p_start_date date,
  p_payment_minor bigint,
  p_escrow_minor bigint,
  p_currency text,
  p_project_id uuid default null
)
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
    or p_principal_minor is null
    or p_annual_rate_ppm is null
    or p_term_months is null
    or p_start_date is null
    or p_payment_minor is null
    or p_escrow_minor is null
    or p_currency is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan|' || btrim(p_name) || '|' || p_principal_minor::text || '|' || p_annual_rate_ppm::text
    || '|' || p_term_months::text || '|' || p_start_date::text || '|' || p_payment_minor::text
    || '|' || p_escrow_minor::text || '|' || p_currency
    || case when p_project_id is null then '' else '|' || p_project_id::text end;
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
    if p_project_id is not null and not exists (
      select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
    ) then
      response := private.mcp_refused('project not found');
    else
      insert into public.loans (
        company_id, name, principal_minor, annual_rate_ppm, term_months,
        start_date, payment_minor, escrow_minor, currency, project_id
      )
      values (
        cid, btrim(p_name), p_principal_minor, p_annual_rate_ppm, p_term_months,
        p_start_date, p_payment_minor, p_escrow_minor, p_currency, p_project_id
      )
      returning id into rid;

      insert into private.mcp_writes (token_id, user_id, kind, loan_id)
      values (token, auth.uid(), 'loan', rid);

      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object('id', rid, 'project_id', p_project_id, 'undo_kind', 'loan')
      );
    end if;
  exception
    when check_violation then
      response := private.mcp_refused('invalid loan terms');
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

-- mcp_assign_expense: as in 20261006210000_income_review.sql.
create or replace function public.mcp_assign_expense(
  p_idempotency_key text,
  p_transaction_id uuid,
  p_project_id uuid,
  p_category_id uuid,
  p_remember boolean default false
)
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
  review uuid;
  outcome jsonb;
  undo_id uuid;
  response jsonb;
  locked boolean;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or p_category_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'assign|' || p_transaction_id::text || '|' || coalesce(p_project_id::text, '') || '|'
    || p_category_id::text || '|' || coalesce(p_remember, false)::text;
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
    -- Lock the line before the review so assign and category share one order.
    select true into locked
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
    else
      if p_project_id is null and not exists (
        select 1
        from public.categories c
        where c.id = p_category_id
          and c.company_id = cid
          and c.excluded_from_pnl
      ) then
        response := private.mcp_error('validation', 'validation');
      elsif p_project_id is not null and not exists (
        select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
      ) then
        response := private.mcp_refused('project or category not found');
      else
      select q.id into review
      from public.review_queue q
      where q.transaction_id = p_transaction_id
        and q.company_id = cid
        and q.status = 'open'
      order by q.created_at desc
      limit 1
      for update;

      if review is not null then
        outcome := public.approve_review_item(
          review,
          p_project_id,
          p_category_id,
          coalesce(p_remember, false),
          null,
          null,
          false
        );
        if outcome->>'ok' is distinct from 'true' then
          response := outcome;
        else
          response := private.mcp_record_write(token, p_transaction_id, review, null, 'review');
        end if;
      else
        undo_id := public.reassign_transaction(p_transaction_id, p_project_id, p_category_id);
        response := private.mcp_record_write(token, p_transaction_id, null, undo_id, 'reassign');
      end if;
      end if;
    end if;
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

-- mcp_assign_expense_split: as in 20261008033000_review_undo_followups.sql.
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
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$function$;

-- mcp_assign_expenses: as in 20261008033000_review_undo_followups.sql.
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
  if prior->>'state' = 'conflict' then
    -- A batch stored before FLOW-208 was hashed as sent; its identical retry still replays.
    prior := private.mcp_idempotency_lookup(token, p_idempotency_key, 'batch|' || md5(p_items::text));
  end if;
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
        when deadlock_detected or serialization_failure or lock_not_available then
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

-- mcp_create_categories: as in 20261008010000_mcp_bulk_setup.sql.
create or replace function public.mcp_create_categories(
  p_idempotency_key text,
  p_items jsonb
)
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
  batch_id uuid := gen_random_uuid();
  item jsonb;
  ord int := 0;
  row_key text;
  row_result jsonb;
  found_id uuid;
  results jsonb := '[]'::jsonb;
  row_writes jsonb := '[]'::jsonb;
  ok_count int := 0;
  error_count int := 0;
  response jsonb;
begin
  -- Row keys are key:ordinal, and mcp_create_category caps keys at 128.
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 124
    or p_items is null
    or jsonb_typeof(p_items) <> 'array'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    return private.mcp_error('validation', 'validation');
  end if;

  -- The same name twice in one batch is a client mistake, not a row to refuse.
  if exists (
    select 1
    from jsonb_array_elements(p_items) elem
    where jsonb_typeof(elem) = 'object' and jsonb_typeof(elem->'name') = 'string'
    group by coalesce(elem->>'kind', '') || '|' || btrim(elem->>'name')
    having count(*) > 1
  ) then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'categories_batch|' || md5(p_items::text);
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  for item in select value from jsonb_array_elements(p_items)
  loop
    ord := ord + 1;
    row_key := p_idempotency_key || ':' || ord::text;
    row_result := null;
    found_id := null;

    if jsonb_typeof(item) <> 'object' then
      row_result := private.mcp_error('validation', 'validation');
    elsif jsonb_typeof(item->'name') is distinct from 'string'
      or jsonb_typeof(item->'kind') is distinct from 'string'
      or item->>'kind' not in ('expense', 'income')
      or exists (select 1 from jsonb_object_keys(item) k where k not in ('name', 'kind'))
    then
      row_result := private.mcp_error('validation', 'validation');
    else
      begin
        row_result := public.mcp_create_category(row_key, item->>'name', item->>'kind');
      exception
        when deadlock_detected or serialization_failure or lock_not_available then
          row_result := private.mcp_error('unavailable', 'retry');
        when others then
          row_result := private.mcp_refused(sqlerrm);
      end;
    end if;

    if row_result->>'ok' = 'true' then
      ok_count := ok_count + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'name', btrim(item->>'name'),
        'kind', item->>'kind',
        'ok', true,
        'id', row_result->'data'->>'id',
        'undo_kind', 'category'
      ));
      row_writes := row_writes || jsonb_build_array(jsonb_build_object(
        'ordinal', ord,
        'name', btrim(item->>'name'),
        'kind', item->>'kind',
        'undo_kind', 'category',
        'undo_id', row_result->'data'->>'id'
      ));
    else
      error_count := error_count + 1;
      -- A name that is already taken returns that row's id, so a rerun of a setup can go on.
      if jsonb_typeof(item) = 'object' and jsonb_typeof(item->'name') = 'string' then
        select c.id into found_id
        from public.categories c
        where c.company_id = cid
          and c.kind::text = item->>'kind'
          and c.name = btrim(item->>'name')
        limit 1;
      end if;
      results := results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'name', case when jsonb_typeof(item) = 'object' and jsonb_typeof(item->'name') = 'string'
          then btrim(item->>'name') else '' end,
        'kind', case when jsonb_typeof(item) = 'object' then item->>'kind' end,
        'ok', false,
        'code', coalesce(row_result->'error'->>'code', 'refused'),
        'existing_id', found_id
      )));
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
  values (batch_id, token, auth.uid(), cid, p_idempotency_key, row_writes);

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

-- mcp_create_category: as in 20261006120000_mcp_cycle4.sql.
create or replace function public.mcp_create_category(
  p_idempotency_key text,
  p_name text,
  p_kind text
)
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
  hash := 'category_new|' || p_kind || '|' || btrim(p_name);
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  response := private.mcp_error('refused', 'The write was refused.');
  begin
    rid := public.create_category(p_name, p_kind);
    insert into private.mcp_writes (token_id, user_id, kind, category_id)
    values (token, auth.uid(), 'category', rid);
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object('id', rid, 'undo_kind', 'category')
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

-- mcp_create_project: as in 20261006120000_mcp_cycle4.sql.
create or replace function public.mcp_create_project(
  p_idempotency_key text,
  p_name text,
  p_status text default null
)
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
    or p_status is not null and p_status not in ('active', 'finished')
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'project|' || btrim(p_name) || '|' || coalesce(p_status, 'active');
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
    if exists (
      select 1
      from public.projects p
      where p.company_id = cid
        and p.name = btrim(p_name)
    ) then
      response := private.mcp_refused('project already exists');
    else
      rid := public.upsert_project(null, p_name, null, p_status);
      insert into private.mcp_writes (token_id, user_id, kind, project_id)
      values (token, auth.uid(), 'project', rid);
      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object('id', rid, 'undo_kind', 'project')
      );
    end if;
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

-- mcp_create_projects: as in 20261008010000_mcp_bulk_setup.sql.
create or replace function public.mcp_create_projects(
  p_idempotency_key text,
  p_items jsonb
)
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
  batch_id uuid := gen_random_uuid();
  item jsonb;
  ord int := 0;
  row_key text;
  row_result jsonb;
  found_id uuid;
  results jsonb := '[]'::jsonb;
  row_writes jsonb := '[]'::jsonb;
  ok_count int := 0;
  error_count int := 0;
  response jsonb;
begin
  -- Row keys are key:ordinal, and mcp_create_project caps keys at 128.
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 124
    or p_items is null
    or jsonb_typeof(p_items) <> 'array'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    return private.mcp_error('validation', 'validation');
  end if;

  -- The same name twice in one batch is a client mistake, not a row to refuse.
  if exists (
    select 1
    from jsonb_array_elements(p_items) elem
    where jsonb_typeof(elem) = 'object' and jsonb_typeof(elem->'name') = 'string'
    group by btrim(elem->>'name')
    having count(*) > 1
  ) then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'projects_batch|' || md5(p_items::text);
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  for item in select value from jsonb_array_elements(p_items)
  loop
    ord := ord + 1;
    row_key := p_idempotency_key || ':' || ord::text;
    row_result := null;
    found_id := null;

    if jsonb_typeof(item) <> 'object' then
      row_result := private.mcp_error('validation', 'validation');
    elsif jsonb_typeof(item->'name') is distinct from 'string'
      or item ? 'status' and (
        jsonb_typeof(item->'status') <> 'string' or item->>'status' not in ('active', 'finished')
      )
      or exists (select 1 from jsonb_object_keys(item) k where k not in ('name', 'status'))
    then
      row_result := private.mcp_error('validation', 'validation');
    else
      begin
        row_result := public.mcp_create_project(row_key, item->>'name', item->>'status');
      exception
        when deadlock_detected or serialization_failure or lock_not_available then
          row_result := private.mcp_error('unavailable', 'retry');
        when others then
          row_result := private.mcp_refused(sqlerrm);
      end;
    end if;

    if row_result->>'ok' = 'true' then
      ok_count := ok_count + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'name', btrim(item->>'name'),
        'ok', true,
        'id', row_result->'data'->>'id',
        'undo_kind', 'project'
      ));
      row_writes := row_writes || jsonb_build_array(jsonb_build_object(
        'ordinal', ord,
        'name', btrim(item->>'name'),
        'undo_kind', 'project',
        'undo_id', row_result->'data'->>'id'
      ));
    else
      error_count := error_count + 1;
      -- A name that is already taken returns that row's id, so a rerun of a setup can go on.
      if jsonb_typeof(item) = 'object' and jsonb_typeof(item->'name') = 'string' then
        select p.id into found_id
        from public.projects p
        where p.company_id = cid
          and p.name = btrim(item->>'name')
        limit 1;
      end if;
      results := results || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'name', case when jsonb_typeof(item) = 'object' and jsonb_typeof(item->'name') = 'string'
          then btrim(item->>'name') else '' end,
        'ok', false,
        'code', coalesce(row_result->'error'->>'code', 'refused'),
        'existing_id', found_id
      )));
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
  values (batch_id, token, auth.uid(), cid, p_idempotency_key, row_writes);

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

-- mcp_hide_category: as in 20261006120000_mcp_cycle4.sql.
create or replace function public.mcp_hide_category(
  p_idempotency_key text,
  p_category_id uuid
)
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
  was_hidden boolean;
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
  hash := 'category_hide|' || p_category_id::text;
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
    select c.hidden into was_hidden
    from public.categories c
    where c.id = p_category_id
      and c.company_id = cid
    for update;

    if not found then
      response := private.mcp_refused('category not found');
    else
      perform public.set_category_hidden(p_category_id, true);
      insert into private.mcp_writes (token_id, user_id, kind, category_id, prior_hidden)
      values (token, auth.uid(), 'category_hidden', p_category_id, was_hidden);
      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object('id', p_category_id, 'undo_kind', 'category_hidden')
      );
    end if;
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

-- mcp_rename_company: as in 20261008013000_company_name_rules.sql.
create or replace function public.mcp_rename_company(
  p_idempotency_key text,
  p_name text
)
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
  clean text;
  renamed jsonb;
  response jsonb;
begin
  clean := private.trim_name(p_name);
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or private.company_name_problem(clean) is not null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'company_name|' || md5(clean);
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
    renamed := public.rename_company(cid, clean);
    insert into private.mcp_writes (token_id, user_id, kind, company_id, prior)
    values (
      token,
      auth.uid(),
      'company',
      cid,
      jsonb_build_object('before', renamed->>'prior_name', 'after', renamed->>'name')
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'id', cid,
        'name', renamed->>'name',
        'prior_name', renamed->>'prior_name',
        'undo_kind', 'company'
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

-- mcp_set_category_pnl: as in 20261007120000_category_pnl.sql.
create or replace function public.mcp_set_category_pnl(
  p_idempotency_key text,
  p_category_id uuid,
  p_excluded boolean
)
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
  was_excluded boolean;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_category_id is null
    or p_excluded is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'category_pnl|' || p_category_id::text || '|' || p_excluded::text;
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
    select c.excluded_from_pnl into was_excluded
    from public.categories c
    where c.id = p_category_id
      and c.company_id = cid
    for update;

    if not found then
      response := private.mcp_refused('category not found');
    else
      perform public.set_category_excluded_from_pnl(p_category_id, p_excluded);
      insert into private.mcp_writes (token_id, user_id, kind, category_id, prior)
      values (
        token,
        auth.uid(),
        'category_pnl',
        p_category_id,
        jsonb_build_object('excluded_from_pnl', was_excluded, 'written', p_excluded)
      );
      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object('id', p_category_id, 'undo_kind', 'category_pnl')
      );
    end if;
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

-- mcp_set_expense_category: as in 20261003120000_mcp_cycle3a.sql.
create or replace function public.mcp_set_expense_category(
  p_idempotency_key text,
  p_transaction_id uuid,
  p_category_id uuid
)
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
  review uuid;
  current_project uuid;
  outcome jsonb;
  undo_id uuid;
  response jsonb;
  locked boolean;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or p_category_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'category|' || p_transaction_id::text || '|' || p_category_id::text;
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
    -- Lock the expense before the review so assign and category share one order.
    select t.project_id into current_project
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
    else
      select q.id into review
      from public.review_queue q
      where q.transaction_id = p_transaction_id
        and q.company_id = cid
        and q.status = 'open'
      order by q.created_at desc
      limit 1
      for update;

      if review is not null then
        outcome := public.approve_review_item(
          review,
          current_project,
          p_category_id,
          false,
          null,
          null,
          false
        );
        if outcome->>'ok' is distinct from 'true' then
          response := outcome;
        else
          response := private.mcp_record_write(token, p_transaction_id, review, null, 'review');
        end if;
      else
        undo_id := public.set_transaction_category(p_transaction_id, p_category_id, true);
        response := private.mcp_record_write(token, p_transaction_id, null, undo_id, 'reassign');
      end if;
    end if;
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

-- mcp_set_line_pnl: as in 20261007210000_line_pnl_override.sql.
create or replace function public.mcp_set_line_pnl(
  p_idempotency_key text,
  p_transaction_id uuid,
  p_in_pnl boolean
)
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
  before_override boolean;
  written jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'line_pnl|' || p_transaction_id::text || '|' || coalesce(p_in_pnl::text, 'null');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  begin
    select t.in_pnl_override into before_override
    from public.transactions t
    where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
    for update;

    if not found then
      if exists (
        select 1 from public.review_queue q
        where q.id = p_transaction_id and q.company_id = cid
      ) then
        response := private.mcp_error(
          'validation',
          'id is not a transaction; list_review.id is the review id'
        );
      else
        response := private.mcp_refused('transaction not found');
      end if;
    else
      written := public.set_transaction_pnl(p_transaction_id, p_in_pnl);
      -- clock_timestamp, so two writes to one line in one transaction still undo newest first.
      insert into private.mcp_writes (token_id, user_id, transaction_id, kind, prior, created_at)
      values (
        token, auth.uid(), p_transaction_id, 'line_pnl',
        jsonb_build_object('before', before_override, 'written', p_in_pnl),
        clock_timestamp()
      );
      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'transaction_id', p_transaction_id,
          'in_pnl_override', p_in_pnl,
          'in_pnl', written->'in_pnl',
          'undo_kind', 'line_pnl',
          'id', p_transaction_id
        )
      );
    end if;
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

-- mcp_set_lines_pnl: as in 20261007210000_line_pnl_override.sql.
create or replace function public.mcp_set_lines_pnl(
  p_idempotency_key text,
  p_items jsonb
)
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
  batch_id uuid := gen_random_uuid();
  item jsonb;
  ord int := 0;
  row_key text;
  row_result jsonb;
  results jsonb := '[]'::jsonb;
  row_writes jsonb := '[]'::jsonb;
  ok_count int := 0;
  error_count int := 0;
  response jsonb;
begin
  -- Row keys are key:ordinal, and mcp_set_line_pnl caps keys at 128.
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
      where jsonb_typeof(elem) = 'object' and elem->>'transaction_id' is not null
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
  hash := 'lines_pnl|' || md5(p_items::text);
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

    if jsonb_typeof(item) <> 'object'
      or item->>'transaction_id' is null
      or (item->>'transaction_id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or not item ? 'in_pnl'
      or jsonb_typeof(item->'in_pnl') not in ('boolean', 'null')
      or exists (select 1 from jsonb_object_keys(item) k where k not in ('transaction_id', 'in_pnl'))
    then
      row_result := private.mcp_error('validation', 'validation');
    else
      begin
        row_result := public.mcp_set_line_pnl(
          row_key,
          (item->>'transaction_id')::uuid,
          (item->>'in_pnl')::boolean
        );
      exception
        when deadlock_detected or serialization_failure or lock_not_available then
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
        'in_pnl', row_result->'data'->'in_pnl',
        'undo_kind', 'line_pnl'
      ));
      row_writes := row_writes || jsonb_build_array(jsonb_build_object(
        'ordinal', ord,
        'transaction_id', item->>'transaction_id',
        'undo_kind', 'line_pnl',
        'undo_id', row_result->'data'->>'id'
      ));
    else
      error_count := error_count + 1;
      results := results || jsonb_build_array(jsonb_build_object(
        'transaction_id', coalesce(
          case when jsonb_typeof(item) = 'object' then item->>'transaction_id' end,
          '00000000-0000-4000-8000-000000000000'
        ),
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
$$;

-- mcp_set_overhead_project: as in 20261007161020_unassigned_overhead_project.sql.
create or replace function public.mcp_set_overhead_project(
  p_idempotency_key text,
  p_project_id uuid
)
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
  was uuid;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'overhead_project|' || coalesce(p_project_id::text, 'none');
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
    select c.overhead_project_id into was
    from public.companies c
    where c.id = cid
    for update;

    if not found then
      response := private.mcp_refused('no company');
    else
      perform public.set_overhead_project(p_project_id);
      insert into private.mcp_writes (token_id, user_id, kind, project_id, prior)
      values (
        token,
        auth.uid(),
        'overhead_project',
        p_project_id,
        jsonb_build_object('company_id', cid, 'before', was, 'written', p_project_id)
      );
      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'id', cid,
          'overhead_project_id', p_project_id,
          'undo_kind', 'overhead_project'
        )
      );
    end if;
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

-- mcp_split_line: as in 20261007190000_line_splits.sql.
create or replace function public.mcp_split_line(
  p_idempotency_key text,
  p_transaction_id uuid,
  p_parts jsonb
)
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
  response jsonb;
  before_parts jsonb;
  written jsonb;
  prior_assigned boolean;
  prior_suggested boolean;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or p_parts is null
    or jsonb_typeof(p_parts) <> 'array'
    or jsonb_array_length(p_parts) = 1
    or jsonb_array_length(p_parts) > 50
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'line_split|' || p_transaction_id::text || '|' || md5(p_parts::text);
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  begin
    select t.user_assigned, t.category_suggested
    into prior_assigned, prior_suggested
    from public.transactions t
    where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
    for update;

    if not found then
      if exists (
        select 1 from public.review_queue q
        where q.id = p_transaction_id and q.company_id = cid
      ) then
        response := private.mcp_error(
          'validation',
          'id is not a transaction; list_review.id is the review id'
        );
      else
        response := private.mcp_refused('transaction not found');
      end if;
    else
      before_parts := private.line_split_parts(p_transaction_id);
      written := public.save_line_split(p_transaction_id, p_parts);
      -- clock_timestamp, so two splits of one line in one transaction still undo newest first.
      insert into private.mcp_writes (token_id, user_id, transaction_id, kind, prior, created_at)
      values (
        token, auth.uid(), p_transaction_id, 'line_split',
        jsonb_build_object(
          'before', before_parts,
          'written', written,
          'user_assigned', coalesce(prior_assigned, false),
          'category_suggested', coalesce(prior_suggested, false)
        ),
        clock_timestamp()
      );
      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'transaction_id', p_transaction_id,
          'parts', written,
          'undo_kind', 'line_split',
          'id', p_transaction_id
        )
      );
    end if;
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

-- mcp_undo_batch: as in 20261008010000_mcp_bulk_setup.sql.
create or replace function public.mcp_undo_batch(
  p_idempotency_key text,
  p_batch_key text
)
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
  batch_rec private.mcp_batches%rowtype;
  row jsonb;
  row_result jsonb;
  results jsonb := '[]'::jsonb;
  ok_count int := 0;
  error_count int := 0;
  response jsonb;
  undo_kind text;
  undo_id uuid;
  row_key text;
begin
  -- Row keys are key:ordinal, and mcp_undo caps keys at 128.
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 124
    or p_batch_key is null
    or p_batch_key !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'batch_undo|' || p_batch_key;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  select * into batch_rec
  from private.mcp_batches b
  where b.id = p_batch_key::uuid
    and b.user_id = auth.uid()
    and b.company_id = private.current_company_id();

  if not found then
    return private.mcp_error('not_found', 'not found');
  end if;

  for row in
    select value
    from jsonb_array_elements(batch_rec.row_writes)
    order by (value->>'ordinal')::int desc
  loop
    undo_kind := row->>'undo_kind';
    undo_id := (row->>'undo_id')::uuid;
    row_key := p_idempotency_key || ':' || (row->>'ordinal');
    begin
      row_result := public.mcp_undo(row_key, undo_kind, undo_id);
    exception
      when deadlock_detected or serialization_failure or lock_not_available then
        row_result := private.mcp_error('unavailable', 'retry');
      when others then
        row_result := private.mcp_refused(sqlerrm);
    end;

    if row_result->>'ok' = 'true' then
      ok_count := ok_count + 1;
      results := results || jsonb_build_array(private.mcp_batch_row_ref(row) || jsonb_build_object('ok', true));
    else
      error_count := error_count + 1;
      results := results || jsonb_build_array(private.mcp_batch_row_ref(row) || jsonb_build_object(
        'ok', false,
        'code', coalesce(row_result->'error'->>'code', 'refused')
      ));
    end if;
  end loop;

  response := jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'batch_key', p_batch_key,
      'ok_count', ok_count,
      'error_count', error_count,
      'results', results
    )
  );

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

-- mcp_update_loan: as in 20261007201111_loan_payment_checks.sql.
create or replace function public.mcp_update_loan(
  p_idempotency_key text,
  p_loan_id uuid,
  p_patch jsonb
)
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
  response jsonb;
  before jsonb;
  after jsonb;
  cur record;
  key text;
  allowed constant text[] := array[
    'name', 'principal_minor', 'annual_rate_ppm', 'term_months',
    'start_date', 'payment_minor', 'escrow_minor', 'project_id'
  ];
  new_project uuid;
  set_project boolean;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_loan_id is null
    or p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  for key in select jsonb_object_keys(p_patch)
  loop
    if key = 'currency' or not (key = any(allowed)) then
      return private.mcp_error('validation', 'validation');
    end if;
    -- An explicit null would keep the old value and still log an edit.
    -- project_id is the exception: null clears the link.
    if key <> 'project_id' and jsonb_typeof(p_patch->key) = 'null' then
      return private.mcp_error('validation', 'validation');
    end if;
  end loop;

  if p_patch = '{}'::jsonb then
    return private.mcp_error('validation', 'validation');
  end if;

  -- project_id is a uuid string, or JSON null to clear it. An absent key leaves it.
  set_project := p_patch ? 'project_id';
  if set_project then
    if jsonb_typeof(p_patch->'project_id') not in ('null', 'string')
      or (
        jsonb_typeof(p_patch->'project_id') = 'string'
        and p_patch->>'project_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
    then
      return private.mcp_error('validation', 'validation');
    end if;
    new_project := (p_patch->>'project_id')::uuid;
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_update|' || p_loan_id::text || '|' || p_patch::text;
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
    select l.name, l.principal_minor, l.annual_rate_ppm, l.term_months,
           l.start_date, l.payment_minor, l.escrow_minor, l.project_id
    into cur
    from public.loans l
    where l.id = p_loan_id
      and l.company_id = cid
    for update;

    if not found then
      response := private.mcp_refused('loan not found');
    elsif new_project is not null and not exists (
      select 1 from public.projects p where p.id = new_project and p.company_id = cid
    ) then
      response := private.mcp_refused('project not found');
    else
      before := jsonb_build_object(
        'name', cur.name,
        'principal_minor', cur.principal_minor,
        'annual_rate_ppm', cur.annual_rate_ppm,
        'term_months', cur.term_months,
        'start_date', cur.start_date,
        'payment_minor', cur.payment_minor,
        'escrow_minor', cur.escrow_minor,
        'project_id', cur.project_id
      );

      update public.loans l
      set
        name = coalesce(btrim(p_patch->>'name'), l.name),
        principal_minor = coalesce((p_patch->>'principal_minor')::bigint, l.principal_minor),
        annual_rate_ppm = coalesce((p_patch->>'annual_rate_ppm')::integer, l.annual_rate_ppm),
        term_months = coalesce((p_patch->>'term_months')::integer, l.term_months),
        start_date = coalesce((p_patch->>'start_date')::date, l.start_date),
        payment_minor = coalesce((p_patch->>'payment_minor')::bigint, l.payment_minor),
        escrow_minor = coalesce((p_patch->>'escrow_minor')::bigint, l.escrow_minor),
        project_id = case when set_project then new_project else l.project_id end
      where l.id = p_loan_id
        and l.company_id = cid;

      select l.name, l.principal_minor, l.annual_rate_ppm, l.term_months,
             l.start_date, l.payment_minor, l.escrow_minor, l.project_id
      into cur
      from public.loans l
      where l.id = p_loan_id;

      after := jsonb_build_object(
        'name', cur.name,
        'principal_minor', cur.principal_minor,
        'annual_rate_ppm', cur.annual_rate_ppm,
        'term_months', cur.term_months,
        'start_date', cur.start_date,
        'payment_minor', cur.payment_minor,
        'escrow_minor', cur.escrow_minor,
        'project_id', cur.project_id
      );

      insert into private.mcp_writes (token_id, user_id, kind, loan_id, prior, created_at)
      values (
        token, auth.uid(), 'loan_update', p_loan_id,
        jsonb_build_object('before', before, 'after', after), clock_timestamp()
      );

      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object('id', p_loan_id, 'project_id', cur.project_id, 'undo_kind', 'loan_update')
      );
    end if;
  exception
    when check_violation then
      if sqlerrm = 'loan_payment_below_interest' then
        response := private.mcp_refused('payment below interest');
      else
        response := private.mcp_refused('invalid loan terms');
      end if;
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

commit;
