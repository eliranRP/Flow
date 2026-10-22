-- FLOW-947. Gross-up contra effect. Decision 0207 (extends 0206).
--
-- A gross-up split part may now use EITHER category kind. The effect is auto-derived at read
-- time from the part's category kind vs the line's direction; there is no new column and no data
-- migration.
--   - category kind OPPOSITE the line direction -> NORMAL (today's rule, byte-identical): a real
--     item of its category's kind (expense negative, income positive).
--   - category kind EQUAL to the line direction -> CONTRA: the part reduces its own category
--     (like a refund), netting it. An expense category credits (+minor), an income category
--     debits (-minor).
--
-- The cash/sum math does NOT change: a gross-up part's bank contribution is still -amount_minor
-- either way (the signed sum rule = the bank amount). Only the P&L placement/sign changes.
--
-- save_line_split drops the old same-kind rejection (any kind is now allowed) and accepts an
-- OPTIONAL per-part effect ('contra'|'normal') for explicitness, validated against the derived
-- value. It KEEPS: a gross-up part needs its own project, is an exact amount only (no percent or
-- rest), and the signed sum rule. get_line_split reports the derived effect per gross-up part.
-- private.pnl_lines negates a contra part so it reduces its own category; private.cash_parts and
-- private.breakdown_rows read amount_net/kind from it, so the change carries through unchanged.
-- No stored column, so mcp_undo restore, line_split_parts and line_split_valid are untouched.
--
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- D1/D2 (0207): replace the parts of one line. A gross_up part may carry either kind; the old
-- same-kind rejection is gone. The sum stays SIGNED (a gross_up part subtracted), and a gross_up
-- part still needs its own project and an exact amount. An OPTIONAL per-part effect is validated
-- against the value derived from (category kind vs line direction): default when omitted.
-- Based on the live definition (20261022063554).
create or replace function public.save_line_split(
  p_transaction_id uuid,
  p_parts jsonb,
  p_preview boolean default false
)
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
  line_project uuid;
  line_override boolean;
  kept_out boolean;
  line_kind text;
  item jsonb;
  n integer;
  i integer := 0;
  categories uuid[] := '{}';
  projects uuid[] := '{}';
  amounts bigint[] := '{}';
  percents numeric[] := '{}';
  gross_ups boolean[] := '{}';
  rest_at integer;
  category uuid;
  project uuid;
  gross_up boolean;
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

  select t.amount_net, t.direction, t.category_id, t.project_id, t.in_pnl_override
  into line_net, line_direction, line_category, line_project, line_override
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;

  -- The line's role was set for its own category's kind (the direction when it has none).
  select coalesce(c.kind::text, line_direction::text) into line_kind
  from (select 1) one
  left join public.categories c on c.id = line_category and c.company_id = cid;

  if n = 0 then
    if p_preview then
      return '[]'::jsonb;
    end if;
    delete from public.line_splits where transaction_id = p_transaction_id and company_id = cid;
    return '[]'::jsonb;
  end if;

  if line_net = 0 then
    raise exception 'line amount is zero';
  end if;
  line_minor := abs(line_net);
  if exists (select 1 from public.loan_splits s where s.transaction_id = p_transaction_id) then
    raise exception 'line has a loan split';
  end if;
  if exists (
    select 1 from public.review_queue q
    where q.transaction_id = p_transaction_id and q.company_id = cid and q.status = 'open'
      and q.reason is distinct from 'split_mismatch'
  ) then
    raise exception 'line has an open review';
  end if;

  for item in select value from jsonb_array_elements(p_parts)
  loop
    i := i + 1;
    if jsonb_typeof(item) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(item) k
        where k not in ('category_id', 'project_id', 'amount_minor', 'percent', 'rest', 'gross_up', 'effect')
      )
      -- Exactly one of amount_minor, percent and rest.
      or ((item ? 'amount_minor')::integer + (item ? 'percent')::integer + (item ? 'rest')::integer) <> 1
      or (item ? 'rest' and item->'rest' is distinct from 'true'::jsonb)
      or (item ? 'gross_up' and jsonb_typeof(item->'gross_up') is distinct from 'boolean')
      -- 0207: effect is a gross-up-only string marker, one of 'contra' or 'normal'.
      or (item ? 'effect' and (
        jsonb_typeof(item->'effect') is distinct from 'string'
        or (item->>'effect') not in ('contra', 'normal')
        or item->'gross_up' is distinct from 'true'::jsonb))
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

    gross_up := coalesce((item->>'gross_up')::boolean, false);
    -- v1: a gross_up part is an exact amount only.
    if gross_up and not (item ? 'amount_minor') then
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

    pair := category::text || '|' || coalesce(coalesce(project, line_project)::text, '');
    if pair = any(seen) then
      raise exception 'same category and project twice';
    end if;
    seen := seen || pair;

    select c.kind::text, c.excluded_from_pnl into kind, kept_out
    from public.categories c
    where c.id = category and c.company_id = cid;
    if kind is null then
      raise exception 'category not found';
    end if;
    -- 0207: a gross_up part may carry EITHER kind. The effect is derived from (category kind vs
    -- line direction): the SAME kind is a contra entry, the OPPOSITE kind a normal real item. An
    -- explicit effect, when given, must match the derived value. A gross_up part names its project.
    if gross_up then
      if project is null then
        raise exception 'a gross-up part needs a project';
      end if;
      if item ? 'effect'
        and (item->>'effect') is distinct from
          (case when kind is not distinct from line_direction::text then 'contra' else 'normal' end) then
        raise exception 'validation';
      end if;
    end if;
    -- A part of another kind than the line's own category needs its own project: the line's
    -- role was set for that kind, so the part cannot borrow it.
    if kind is distinct from line_kind and project is null
      and category is distinct from line_category
      and not (kept_out and line_override is distinct from true) then
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
    gross_ups := gross_ups || gross_up;
    if item ? 'amount_minor' then
      -- Signed: a gross_up amount nets against the line's primary side.
      fixed_total := fixed_total
        + case when gross_up then -(item->>'amount_minor')::bigint else (item->>'amount_minor')::bigint end;
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

  -- A preview returns what a save would store, with each part's percent, rest marker and
  -- gross_up flag, and writes nothing.
  if p_preview then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', categories[u.i],
        'project_id', projects[u.i],
        'amount_minor', amounts[u.i],
        'percent', percents[u.i],
        'rest', coalesce(u.i = rest_at, false),
        'gross_up', gross_ups[u.i]
      ) order by u.i)
      from generate_series(1, n) as u(i)
      where amounts[u.i] > 0
    ), '[]'::jsonb);
  end if;

  delete from public.line_splits where transaction_id = p_transaction_id and company_id = cid;
  for i in 1..n
  loop
    continue when amounts[i] = 0;
    ord := ord + 1;
    insert into public.line_splits (
      company_id, transaction_id, ordinal, category_id, project_id, amount_minor, percent, is_rest, gross_up
    )
    values (
      cid, p_transaction_id, ord, categories[i], projects[i], amounts[i], percents[i],
      coalesce(i = rest_at, false), gross_ups[i]
    );
  end loop;

  -- The owner chose these categories, so the line is no longer a suggestion.
  update public.transactions
  set user_assigned = true,
      category_suggested = false
  where id = p_transaction_id and company_id = cid;

  return private.line_split_parts(p_transaction_id);
end;
$$;

revoke all on function public.save_line_split(uuid, jsonb, boolean) from public, anon, authenticated, service_role;
grant execute on function public.save_line_split(uuid, jsonb, boolean) to authenticated;

-- 0207: the owner/viewer read now reports the DERIVED effect per gross_up part ('contra' when
-- the part's category kind equals the line direction, else 'normal'). The key is added only on a
-- gross_up part, so a non-gross-up part's parts object stays byte-identical. parts_match (the
-- signed sum) is unchanged. Based on the live definition (20261022063554).
create or replace function public.get_line_split(p_transaction_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'transaction_id', t.id,
    'currency', coalesce(t.currency, 'ILS'),
    'line_minor', abs(t.amount_net),
    'parts', coalesce((
      select jsonb_agg((jsonb_build_object(
        'category_id', s.category_id,
        'category_name', c.name,
        'project_id', s.project_id,
        'project_name', p.name,
        'amount_minor', s.amount_minor,
        'percent', s.percent,
        'rest', s.is_rest,
        'gross_up', s.gross_up
      ) || case when s.gross_up then jsonb_build_object(
        'effect', case when c.kind::text = t.direction::text then 'contra' else 'normal' end
      ) else '{}'::jsonb end) order by s.ordinal)
      from public.line_splits s
      join public.categories c on c.id = s.category_id
      left join public.projects p on p.id = s.project_id
      where s.transaction_id = t.id
    ), '[]'::jsonb),
    'parts_match', coalesce((
      select count(*) >= 2
        and sum(case when s.gross_up then -s.amount_minor else s.amount_minor end) = abs(t.amount_net)
      from public.line_splits s
      where s.transaction_id = t.id
      having count(*) > 0
    ), true)
  )
  from public.transactions t
  where t.id = p_transaction_id
    and t.removed_at is null
    and t.company_id = (select private.readable_company_id());
$$;

revoke all on function public.get_line_split(uuid) from public, anon;
grant execute on function public.get_line_split(uuid) to authenticated;

-- 0207: private.pnl_lines. The line-split branch now derives a gross_up part's P&L sign from
-- (category kind vs line direction): the OPPOSITE kind keeps today's real-item sign (expense
-- negative, income positive) = NORMAL; the SAME kind as the line direction is a CONTRA part that
-- reduces its own category, so the sign flips (an expense category credits +, an income category
-- debits -). The non-gross-up path is byte-identical. The validity gate stays the SIGNED sum.
-- Body is 20261022063554's otherwise. private.cash_parts and private.breakdown_rows read
-- amount_net and kind from here, so the change carries into the cash view and the breakdown.
create or replace view private.pnl_lines
with (security_invoker = true) as
select
  t.company_id,
  t.id as transaction_id,
  t.project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and t.pnl_role = 'project' and t.project_id is not null
      and t.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    else t.pnl_role
  end as pnl_role,
  t.direction,
  t.doc_kind,
  t.doc_date,
  t.cash_date,
  coalesce(t.currency, 'ILS') as currency,
  s.category_id,
  s.part,
  case when t.direction = 'expense' then -s.amount_minor else s.amount_minor end as amount_net,
  t.amount_net as line_amount_net,
  -- By parts: a loan line, so its parts decide and the override does not apply.
  private.line_in_pnl(null, c.excluded_from_pnl, c.loan_part) as in_pnl,
  false as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then t.project_id is null
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind,
  private.line_unpaid(t.direction, t.doc_kind, t.cash_date) as unpaid,
  false as gross_up
from public.transactions t
join public.loan_splits s on s.transaction_id = t.id
join lateral (
  select
    count(*) as parts,
    sum(x.amount_minor) as parts_minor,
    bool_or(x.needs_review) as flagged
  from public.loan_splits x
  where x.transaction_id = t.id
) sp on sp.parts in (3, 4) and not sp.flagged
  and sp.parts_minor = abs(t.amount_net)
left join public.categories c on c.id = s.category_id
left join public.companies co on co.id = t.company_id
where t.removed_at is null
  and t.line_status = 'posted'
  and t.vat_amount = 0
union all
select
  t.company_id,
  t.id as transaction_id,
  coalesce(s.project_id, t.project_id) as project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and s.project_id is not null
      and s.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    when coalesce(c.kind::text, t.direction::text) = 'expense' and s.project_id is not null
      then 'project'::public.pnl_role
    when coalesce(c.kind::text, t.direction::text) = 'expense' and t.pnl_role = 'project' and t.project_id is not null
      and t.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    else t.pnl_role
  end as pnl_role,
  t.direction,
  t.doc_kind,
  t.doc_date,
  t.cash_date,
  coalesce(t.currency, 'ILS') as currency,
  s.category_id,
  null::public.loan_split_part as part,
  -- A gross_up part is a real item of its category's kind, unless it is a CONTRA part (its
  -- category kind equals the line direction), which reduces its own category and so flips. A
  -- refund part (not gross_up) keeps the line's sign.
  case
    when s.gross_up then
      (case when coalesce(c.kind::text, t.direction::text) = 'expense' then -s.amount_minor else s.amount_minor end)
        * (case when coalesce(c.kind::text, t.direction::text) = t.direction::text then -1 else 1 end)
    else
      case when t.direction = 'expense' then -s.amount_minor else s.amount_minor end
  end as amount_net,
  t.amount_net as line_amount_net,
  private.line_in_pnl(t.in_pnl_override, c.excluded_from_pnl, c.loan_part) as in_pnl,
  false as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then coalesce(s.project_id, t.project_id) is null
    when s.project_id is not null then false
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind,
  private.line_unpaid(t.direction, t.doc_kind, t.cash_date) as unpaid,
  s.gross_up
from public.transactions t
join public.line_splits s on s.transaction_id = t.id
join lateral (
  select
    count(*) as parts,
    sum(case when x.gross_up then -x.amount_minor else x.amount_minor end) as parts_minor
  from public.line_splits x
  where x.transaction_id = t.id
) lp on lp.parts >= 2
  and lp.parts_minor = abs(t.amount_net)
left join public.categories c on c.id = s.category_id
left join public.companies co on co.id = t.company_id
where t.removed_at is null
  and t.line_status = 'posted'
  and not exists (select 1 from public.loan_splits ls where ls.transaction_id = t.id)
union all
select
  t.company_id,
  t.id as transaction_id,
  t.project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and t.pnl_role = 'project' and t.project_id is not null
      and t.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    else t.pnl_role
  end as pnl_role,
  t.direction,
  t.doc_kind,
  t.doc_date,
  t.cash_date,
  coalesce(t.currency, 'ILS') as currency,
  t.category_id,
  null::public.loan_split_part as part,
  t.amount_net,
  t.amount_net as line_amount_net,
  -- A line with a loan split stays fixed, even when it falls back to its own category.
  private.line_in_pnl(
    case when coalesce(sp.parts, 0) = 0 then t.in_pnl_override end,
    private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
    c.loan_part
  ) as in_pnl,
  coalesce(sp.parts, 0) > 0 as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then t.project_id is null
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind,
  private.line_unpaid(t.direction, t.doc_kind, t.cash_date) as unpaid,
  false as gross_up
from public.transactions t
left join public.categories c on c.id = t.category_id
left join public.companies co on co.id = t.company_id
left join (
  select x.company_id, x.transaction_id,
    count(*) as parts,
    sum(x.amount_minor) as parts_minor,
    bool_or(x.needs_review) as flagged
  from public.loan_splits x
  group by x.company_id, x.transaction_id
) sp on sp.company_id = t.company_id and sp.transaction_id = t.id
left join (
  select x.company_id, x.transaction_id,
    count(*) as parts,
    sum(case when x.gross_up then -x.amount_minor else x.amount_minor end) as parts_minor
  from public.line_splits x
  group by x.company_id, x.transaction_id
) lp on lp.company_id = t.company_id and lp.transaction_id = t.id
where t.removed_at is null
  and t.line_status = 'posted'
  and (
    coalesce(sp.parts, 0) = 0 or sp.parts not in (3, 4) or sp.flagged or t.vat_amount <> 0
    or sp.parts_minor <> abs(t.amount_net)
  )
  and (
    coalesce(sp.parts, 0) > 0 or coalesce(lp.parts, 0) < 2
    or lp.parts_minor <> abs(t.amount_net)
  );

revoke all on private.pnl_lines from public, anon;
grant select on private.pnl_lines to authenticated, service_role;

-- 0207: the same-kind rejection is gone, so 'category kind must match the part sign' is now
-- unreachable (nothing else raises it). Remove it from the MCP refusal allow-list. An explicit
-- effect that does not match the derived value raises 'validation', already on the list.
do $patch$
declare
  def text;
  a_anchor constant text := $a$        -- FLOW-946 (decision 0206).
        'category kind must match the part sign',
        'a gross-up part needs a project',
$a$;
begin
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  if (length(def) - length(replace(def, a_anchor, ''))) / length(a_anchor) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  def := replace(def, a_anchor, $a$        -- FLOW-946 (decision 0206).
        'a gross-up part needs a project',
$a$);
  execute def;
end
$patch$;

commit;
