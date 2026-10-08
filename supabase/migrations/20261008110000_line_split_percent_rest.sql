-- FLOW-325. Split a line (a refund, a mixed payment) by percent or exact amount, with an
-- optional rest part that keeps what is left on the line's own category and project, and
-- parts of the other kind as reversals. Decision 0123. The view is unchanged: since
-- FLOW-104 it takes each part's P&L side from its category kind.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- Replace the parts of one line. An empty array clears the split. Each part has a category,
-- an optional project, and exactly one of:
--   amount_minor  whole minor units above zero;
--   percent       above 0 and up to 100, at most 4 decimals, of the whole line;
--   rest: true    whatever the other parts leave (at most one such part). Its category
--                 defaults to the line's own category, its project to the line's project.
-- Percent parts are rounded together by largest remainder, so they sum to the rounded total
-- of their percents (the whole line at 100%). Without a rest part the parts sum to the line.
-- A part of the other kind is a reversal (a refund under an expense category) and needs a
-- project unless it is the line's own category. Returns the parts as stored, in cents.
create or replace function public.save_line_split(p_transaction_id uuid, p_parts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  line_net bigint;
  line_minor bigint;
  line_direction public.txn_direction;
  line_category uuid;
  item jsonb;
  n integer;
  i integer := 0;
  categories uuid[] := '{}';
  projects uuid[] := '{}';
  amounts bigint[] := '{}';
  percents numeric[] := '{}';
  rest_at integer;
  category uuid;
  project uuid;
  kind text;
  fixed_total bigint := 0;
  percent_total numeric := 0;
  percent_minor bigint := 0;
  leftover bigint;
  rest_minor bigint;
  seen text[] := '{}'::text[];
  pair text;
  pick record;
  ord integer := 0;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_parts is null or jsonb_typeof(p_parts) <> 'array' then
    raise exception 'validation';
  end if;
  n := jsonb_array_length(p_parts);
  if n = 1 or n > 50 then
    raise exception 'validation';
  end if;

  select t.amount_net, t.direction, t.category_id into line_net, line_direction, line_category
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;

  if n = 0 then
    delete from public.line_splits where transaction_id = p_transaction_id and company_id = cid;
    return '[]'::jsonb;
  end if;

  if line_net = 0 then
    raise exception 'parts must sum to the line';
  end if;
  line_minor := abs(line_net);
  if exists (select 1 from public.loan_splits s where s.transaction_id = p_transaction_id) then
    raise exception 'line has a loan split';
  end if;
  if exists (
    select 1 from public.review_queue q
    where q.transaction_id = p_transaction_id and q.company_id = cid and q.status = 'open'
  ) then
    raise exception 'line has an open review';
  end if;

  for item in select value from jsonb_array_elements(p_parts)
  loop
    i := i + 1;
    if jsonb_typeof(item) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(item) k
        where k not in ('category_id', 'project_id', 'amount_minor', 'percent', 'rest')
      )
      -- Exactly one of amount_minor, percent and rest.
      or ((item ? 'amount_minor')::integer + (item ? 'percent')::integer + (item ? 'rest')::integer) <> 1
      or (item ? 'rest' and item->'rest' is distinct from 'true'::jsonb)
      or (item ? 'amount_minor' and (
        jsonb_typeof(item->'amount_minor') is distinct from 'number'
        or (item->>'amount_minor') !~ '^[0-9]{1,15}$'))
      or (item ? 'percent' and (
        jsonb_typeof(item->'percent') is distinct from 'number'
        or (item->>'percent') !~ '^[0-9]{1,3}(\.[0-9]{1,4})?$'))
      or (not item ? 'rest' and not item ? 'category_id')
      or (item ? 'category_id' and (
        jsonb_typeof(item->'category_id') is distinct from 'string'
        or (item->>'category_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
      or (item ? 'project_id' and jsonb_typeof(item->'project_id') not in ('string', 'null'))
      or (jsonb_typeof(item->'project_id') = 'string'
        and (item->>'project_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    then
      raise exception 'validation';
    end if;

    if item ? 'rest' then
      if rest_at is not null then
        raise exception 'validation';
      end if;
      rest_at := i;
    end if;
    if item ? 'amount_minor' and (item->>'amount_minor')::bigint <= 0 then
      raise exception 'validation';
    end if;
    if item ? 'percent' and ((item->>'percent')::numeric <= 0 or (item->>'percent')::numeric > 100) then
      raise exception 'validation';
    end if;

    category := (item->>'category_id')::uuid;
    if category is null then
      -- A rest part with no category keeps the line's own category.
      category := line_category;
      if category is null then
        raise exception 'line has no category for the rest';
      end if;
    end if;
    project := (item->>'project_id')::uuid;

    pair := category::text || '|' || coalesce(project::text, '');
    if pair = any(seen) then
      raise exception 'validation';
    end if;
    seen := seen || pair;

    select c.kind::text into kind
    from public.categories c
    where c.id = category and c.company_id = cid;
    if kind is null then
      raise exception 'category not found';
    end if;
    -- A reversal part needs its own project: the line's role was set for its own kind, so a
    -- part of the other kind cannot borrow it. The line's own category already fits it.
    if kind is distinct from line_direction::text and project is null
      and category is distinct from line_category then
      raise exception 'a reversal part needs a project';
    end if;
    if project is not null and not exists (
      select 1 from public.projects p where p.id = project and p.company_id = cid
    ) then
      raise exception 'project not found';
    end if;

    categories := categories || category;
    projects := projects || project;
    amounts := amounts || (item->>'amount_minor')::bigint;
    percents := percents || (item->>'percent')::numeric;
    if item ? 'amount_minor' then
      fixed_total := fixed_total + (item->>'amount_minor')::bigint;
    elsif item ? 'percent' then
      percent_total := percent_total + (item->>'percent')::numeric;
    end if;
  end loop;

  if percent_total > 100 then
    raise exception 'parts exceed the line';
  end if;

  -- Percent parts: floor each share of the line, then hand the cents still missing from the
  -- rounded total to the largest remainders, first part first on a tie.
  if percent_total > 0 then
    percent_minor := case
      when percent_total = 100 then line_minor
      else round(line_minor * percent_total / 100)::bigint
    end;
    for pick in
      select u.ord, floor(line_minor * u.pct / 100)::bigint as base,
        line_minor * u.pct / 100 - floor(line_minor * u.pct / 100) as frac
      from unnest(percents) with ordinality as u(pct, ord)
      where u.pct is not null
    loop
      amounts[pick.ord] := pick.base;
    end loop;
    select percent_minor - coalesce(sum(amounts[u.ord]), 0) into leftover
    from unnest(percents) with ordinality as u(pct, ord)
    where u.pct is not null;
    for pick in
      select u.ord
      from unnest(percents) with ordinality as u(pct, ord)
      where u.pct is not null
      order by line_minor * u.pct / 100 - floor(line_minor * u.pct / 100) desc, u.ord
      limit leftover
    loop
      amounts[pick.ord] := amounts[pick.ord] + 1;
    end loop;
    if exists (
      select 1 from unnest(percents) with ordinality as u(pct, ord)
      where u.pct is not null and amounts[u.ord] = 0
    ) then
      raise exception 'a part rounds to zero';
    end if;
  end if;

  if fixed_total + percent_minor > line_minor then
    raise exception 'parts exceed the line';
  end if;
  if rest_at is null then
    if fixed_total + percent_minor <> line_minor then
      raise exception 'parts must sum to the line';
    end if;
  else
    rest_minor := line_minor - fixed_total - percent_minor;
    amounts[rest_at] := rest_minor;
    -- Nothing left: the rest part is dropped, and the others must still be a split.
    if rest_minor = 0 and n - 1 < 2 then
      raise exception 'nothing is left for the rest';
    end if;
  end if;

  delete from public.line_splits where transaction_id = p_transaction_id and company_id = cid;
  for i in 1..n
  loop
    continue when amounts[i] = 0;
    ord := ord + 1;
    insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
    values (cid, p_transaction_id, ord, categories[i], projects[i], amounts[i]);
  end loop;

  -- The owner chose these categories, so the line is no longer a suggestion.
  update public.transactions
  set user_assigned = true,
      category_suggested = false
  where id = p_transaction_id and company_id = cid;

  return private.line_split_parts(p_transaction_id);
end;
$$;

revoke all on function public.save_line_split(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_line_split(uuid, jsonb) to authenticated;

-- The new refusals reach MCP callers with their reason.
create or replace function private.mcp_refused(p_message text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select private.mcp_error(
    'refused',
    case
      when p_message in (
        'no company',
        'unknown review action',
        'review item not found',
        'shared costs are split, not assigned to one project',
        'category is required',
        'project or category not found',
        'category kind must match the direction',
        'project and category are required',
        'transaction not found',
        'category not found',
        'project name is too short',
        'project already exists',
        'category name is too short',
        'category already exists',
        'unknown category kind',
        'in use',
        'loan not found',
        'loan currency mismatch',
        'loan already attached',
        'loan balance exceeded',
        'no schedule row for this date',
        'loan categories missing',
        'invalid loan terms',
        'loan category is fixed',
        'project not found',
        'parts must sum to the line',
        'line has a loan split',
        'line has a split by category',
        'line has an open review',
        'payment below interest',
        'invalid loan parts',
        'loan line is fixed',
        'parts exceed the line',
        'a part rounds to zero',
        'nothing is left for the rest',
        'line has no category for the rest',
        'a reversal part needs a project',
        -- FLOW-106 (#132) adds these in 20261008100000_loan_status.sql; kept here so the
        -- list holds whichever of the two lands first.
        'closed_on required',
        'loan is open',
        'payments after closed_on',
        'loan closed'
      ) then p_message
      when p_message = 'loan_closed' then 'loan closed'
      else 'The write was refused.'
    end
  );
$$;

revoke all on function private.mcp_refused(text) from public, anon, authenticated;

commit;
