-- FLOW-346: the split between projects takes exact amounts, like the split by categories.
-- save_split takes shares as {project_id, share_bp} (as before) or {project_id, amount_minor}.
-- Amount shares are stored to the cent in allocations.amount_net, which every P&L read
-- already uses; share_bp is derived (largest remainder, at least 1) for older readers.
-- MCP assign_expense_split shares take amount_minor in place of share the same way.

begin;

set local lock_timeout = '5s';

create or replace function public.save_split(p_transaction_id uuid, p_shares jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  txn_net bigint;
  line_minor bigint;
  total_share integer;
  item jsonb;
  share integer;
  project uuid;
  assigned bigint := 0;
  part bigint;
  first_project uuid;
  count_shares integer := 0;
  amount_count integer := 0;
  amount_total bigint := 0;
  seen uuid[] := '{}'::uuid[];
  prior_project uuid;
  prior_category uuid;
  prior_role public.pnl_role;
  prior_assigned boolean;
  prior_shares jsonb;
  bps integer[] := '{}';
  amounts bigint[] := '{}';
  projects uuid[] := '{}';
  pick record;
  leftover integer;
  i integer;
  biggest integer;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select t.amount_net, t.project_id, t.category_id, t.pnl_role, t.user_assigned
  into txn_net, prior_project, prior_category, prior_role, prior_assigned
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if txn_net is null then
    raise exception 'transaction not found';
  end if;
  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'at least one share is required';
  end if;
  if jsonb_array_length(p_shares) > 50 then
    raise exception 'validation';
  end if;

  -- Every share is one shape: all share_bp, or all amount_minor.
  for item in select value from jsonb_array_elements(p_shares)
  loop
    if jsonb_typeof(item) <> 'object'
      or ((item ? 'share_bp')::integer + (item ? 'amount_minor')::integer) <> 1
      or (item ? 'amount_minor' and (
        jsonb_typeof(item->'amount_minor') is distinct from 'number'
        or (item->>'amount_minor') !~ '^[0-9]{1,15}$'))
    then
      raise exception 'validation';
    end if;
    if item ? 'amount_minor' then
      amount_count := amount_count + 1;
    end if;
  end loop;
  if amount_count > 0 and amount_count <> jsonb_array_length(p_shares) then
    raise exception 'validation';
  end if;

  if amount_count > 0 then
    line_minor := abs(txn_net);
    if line_minor = 0 then
      raise exception 'line amount is zero';
    end if;
    for item in select value from jsonb_array_elements(p_shares)
    loop
      project := (item->>'project_id')::uuid;
      if project is null then
        raise exception 'validation';
      end if;
      if project = any(projects) then
        raise exception 'validation';
      end if;
      part := (item->>'amount_minor')::bigint;
      if part <= 0 then
        raise exception 'validation';
      end if;
      projects := projects || project;
      amounts := amounts || part;
      amount_total := amount_total + part;
    end loop;
    if amount_total > line_minor then
      raise exception 'parts exceed the line';
    end if;
    if amount_total <> line_minor then
      raise exception 'parts must sum to the line';
    end if;
    -- share_bp: floor of each part's share, the missing points to the largest remainders
    -- (first part first on a tie), and at least 1 each, taken from the largest share.
    for i in 1..array_length(amounts, 1)
    loop
      bps := bps || (amounts[i] * 10000 / line_minor)::integer;
    end loop;
    select 10000 - sum(b) into leftover from unnest(bps) b;
    for pick in
      select u.ord
      from unnest(amounts) with ordinality as u(amt, ord)
      order by (u.amt * 10000) % line_minor desc, u.ord
      limit leftover
    loop
      bps[pick.ord] := bps[pick.ord] + 1;
    end loop;
    for i in 1..array_length(bps, 1)
    loop
      if bps[i] = 0 then
        select u.ord into biggest
        from unnest(bps) with ordinality as u(bp, ord)
        order by u.bp desc, u.ord
        limit 1;
        bps[biggest] := bps[biggest] - 1;
        bps[i] := 1;
      end if;
    end loop;
  else
    select coalesce(sum((value->>'share_bp')::integer), 0)
    into total_share
    from jsonb_array_elements(p_shares);
    if total_share <> 10000 then
      raise exception 'allocation shares must sum to 10000';
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', a.project_id,
    'share_bp', a.share_bp,
    'amount_net', a.amount_net
  )), '[]'::jsonb)
  into prior_shares
  from public.allocations a
  where a.transaction_id = p_transaction_id;

  delete from public.allocations
  where transaction_id = p_transaction_id and company_id = cid;
  delete from public.overhead
  where transaction_id = p_transaction_id and company_id = cid;

  i := 0;
  for item in select value from jsonb_array_elements(p_shares)
  loop
    i := i + 1;
    project := (item->>'project_id')::uuid;
    if amount_count > 0 then
      share := bps[i];
      part := sign(txn_net)::bigint * amounts[i];
    else
      share := (item->>'share_bp')::integer;
      if share is null or share < 1 or share > 10000 then
        raise exception 'share is out of range';
      end if;
      part := (txn_net * share) / 10000;
    end if;
    if not exists (
      select 1 from public.projects p where p.id = project and p.company_id = cid
    ) then
      raise exception 'project not found';
    end if;
    assigned := assigned + part;
    count_shares := count_shares + 1;
    if first_project is null then
      first_project := project;
    end if;
    insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
    values (cid, p_transaction_id, project, share, part);
  end loop;

  if assigned <> txn_net and first_project is not null then
    update public.allocations
    set amount_net = amount_net + (txn_net - assigned)
    where transaction_id = p_transaction_id and project_id = first_project;
  end if;

  update public.transactions
  set pnl_role = case when count_shares > 1 then 'shared'::public.pnl_role else 'project'::public.pnl_role end,
      project_id = case when count_shares = 1 then first_project else null end,
      user_assigned = true
  where id = p_transaction_id and company_id = cid;

  update public.review_queue
  set status = 'changed',
      resolved_at = now(),
      prior_project_id = prior_project,
      prior_category_id = prior_category,
      prior_pnl_role = prior_role,
      prior_user_assigned = prior_assigned,
      prior_allocations = prior_shares
  where company_id = cid
    and transaction_id = p_transaction_id
    and status = 'open'
    and reason = 'unallocated_shared';
end;
$$;

-- MCP shares: {project_id, share} whole percents summing to 100 (as before), or
-- {project_id, amount_minor} exact parts that save_split checks against the line.
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
  amount_count integer := 0;
  seen uuid[] := '{}'::uuid[];
  out jsonb := '[]'::jsonb;
begin
  if p_shares is null or jsonb_typeof(p_shares) <> 'array' then
    raise exception 'validation';
  end if;
  count_shares := jsonb_array_length(p_shares);
  if count_shares < 2 or count_shares > 50 then
    raise exception 'validation';
  end if;
  for item in select value from jsonb_array_elements(p_shares)
  loop
    if jsonb_typeof(item) <> 'object'
      or item->>'project_id' is null
      or ((item ? 'share')::integer + (item ? 'amount_minor')::integer) <> 1
    then
      raise exception 'validation';
    end if;
    project := (item->>'project_id')::uuid;
    if project = any(seen) then
      raise exception 'validation';
    end if;
    seen := seen || project;
    if item ? 'amount_minor' then
      if jsonb_typeof(item->'amount_minor') <> 'number'
        or (item->>'amount_minor') !~ '^[0-9]{1,15}$'
        or (item->>'amount_minor')::bigint < 1
      then
        raise exception 'validation';
      end if;
      amount_count := amount_count + 1;
      out := out || jsonb_build_array(jsonb_build_object(
        'project_id', project,
        'amount_minor', (item->>'amount_minor')::bigint
      ));
    else
      if jsonb_typeof(item->'share') <> 'number'
        or (item->>'share') !~ '^-?[0-9]+$'
      then
        raise exception 'validation';
      end if;
      share := (item->>'share')::integer;
      if share < 1 or share > 100 then
        raise exception 'validation';
      end if;
      total := total + share;
      out := out || jsonb_build_array(jsonb_build_object(
        'project_id', project,
        'share_bp', share * 100
      ));
    end if;
  end loop;
  if amount_count > 0 and amount_count <> count_shares then
    raise exception 'validation';
  end if;
  if amount_count = 0 and total <> 100 then
    raise exception 'validation';
  end if;
  return out;
end;
$$;

revoke all on function private.mcp_shares_for_save(jsonb) from public, anon, authenticated;

commit;
