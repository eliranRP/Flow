-- MCP: assign_expense_split write tool. Decision 0095.

begin;

create or replace function private.mcp_shares_for_save(p_shares jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  project uuid;
  share integer;
  total integer := 0;
  count_shares integer := 0;
  seen uuid[] := '{}'::uuid[];
  out jsonb := '[]'::jsonb;
begin
  if p_shares is null or jsonb_typeof(p_shares) <> 'array' then
    raise exception 'validation';
  end if;
  count_shares := jsonb_array_length(p_shares);
  if count_shares < 2 then
    raise exception 'validation';
  end if;
  for item in select value from jsonb_array_elements(p_shares)
  loop
    if jsonb_typeof(item) <> 'object'
      or item->>'project_id' is null
      or item->>'share' is null
      or jsonb_typeof(item->'share') <> 'number'
      or (item->>'share') !~ '^-?[0-9]+$'
    then
      raise exception 'validation';
    end if;
    project := (item->>'project_id')::uuid;
    share := (item->>'share')::integer;
    if share < 1 or share > 100 then
      raise exception 'validation';
    end if;
    if project = any(seen) then
      raise exception 'validation';
    end if;
    seen := seen || project;
    total := total + share;
    out := out || jsonb_build_array(jsonb_build_object(
      'project_id', project,
      'share_bp', share * 100
    ));
  end loop;
  if total <> 100 then
    raise exception 'validation';
  end if;
  return out;
end;
$$;

revoke all on function private.mcp_shares_for_save(jsonb) from public, anon, authenticated;

create or replace function public.mcp_assign_expense_split(
  p_idempotency_key text,
  p_transaction_id uuid,
  p_shares jsonb,
  p_category_id uuid default null
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
  locked boolean;
  direction public.txn_direction;
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_suggested boolean;
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
    || '|' || md5(p_shares::text);
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
    select t.direction, t.project_id, t.category_id, t.pnl_role, t.user_assigned, t.category_suggested
    into direction, prior_project, prior_category, prior_role, prior_assigned, prior_suggested
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
              closed_review := true;
              response := private.mcp_record_write(token, p_transaction_id, review_id, null, 'review');
            exception
              when others then
                insert into public.reassign_undo (
                  company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
                  prior_user_assigned, prior_category_suggested, prior_allocations, prior_review_id
                ) values (
                  cid, p_transaction_id, prior_project, prior_category, prior_role,
                  coalesce(prior_assigned, false), prior_suggested, prior_shares, review_id
                )
                returning id into undo_id;
                response := private.mcp_record_write(token, p_transaction_id, null, undo_id, 'reassign');
            end;
          else
            insert into public.reassign_undo (
              company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
              prior_user_assigned, prior_category_suggested, prior_allocations, prior_review_id
            ) values (
              cid, p_transaction_id, prior_project, prior_category, prior_role,
              coalesce(prior_assigned, false), prior_suggested, prior_shares, review_id
            )
            returning id into undo_id;
            response := private.mcp_record_write(token, p_transaction_id, null, undo_id, 'reassign');
            if review_id is not null then
              closed_review := false;
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
$$;

revoke all on function public.mcp_assign_expense_split(text, uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_assign_expense_split(text, uuid, jsonb, uuid) to authenticated;

commit;
