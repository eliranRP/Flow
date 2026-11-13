-- FLOW-1171 (perf queue, small database fixes). Same results, less work. Measured as Flow QA on the
-- largest company (1,856 transactions, 14 projects, 182 forecast edits):
-- - private.line_pnl_states(uuid[]) and the (uuid[], uuid, uuid) overload read private.pnl_lines for every
--   line of the ids it is given, with no company predicate. The view's per-line account join then scanned
--   every account of every company (about 1,855 index scans of 202 rows each): 159 ms for 1,856 ids. Both
--   read only the caller's company's lines now, and the company is passed as a bound parameter, so the
--   planner sees a constant and limits the view's own reads to it: 21 ms. Service role keeps every company
--   (its outer read is unlimited too). The result map is looked up only for lines the outer read returns,
--   which are the caller's company's lines, so the answers are the same.
-- - private.pfe_hits, pfe_month_index and pfe_json had `set search_path`, which keeps Postgres from inlining
--   them. pfe_hits had a FROM too. pfe_hits is now one expression with no FROM, and all three drop the
--   setting; their bodies name only pg_catalog functions and private functions, schema-qualified.
-- - public.projects_cash_month called public.project_waiting once per project only to count its rows, and
--   that builds the whole JSON list each time (76 ms for the 14 projects). It now counts the same rows once,
--   grouped by project (8 ms). public.project_waiting stays for the app and the MCP tools.

begin;
set local lock_timeout = '5s';

-- The P&L line states of the given ids, as 20261027211001 and the latest bodies gave them. The parts of a
-- line split are read for the caller's company only. $2 is the caller's company (null for service_role).
create or replace function private.line_pnl_states(p_ids uuid[])
returns table(transaction_id uuid, state text)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  reader uuid;
begin
  reader := case when (select auth.role()) = 'service_role' then null else (select private.readable_company_id()) end;
  -- Executed, so each call is planned for its own ids. The parts' states are one id-keyed map
  -- read once, so the lines never nested-loop against them.
  return query execute $q$
    select t.id,
      case
        when t.line_status = 'posted' then coalesce(
          (
            select coalesce(jsonb_object_agg(parts.transaction_id, parts.state), '{}'::jsonb)
            from (
              select pl.transaction_id,
                case
                  when bool_and(pl.in_pnl) then 'in'
                  when not bool_or(pl.in_pnl) then 'out'
                  else 'mixed'
                end as state
              from private.pnl_lines pl
              where pl.transaction_id = any($1)
                and ($2::uuid is null or pl.company_id = $2)
              group by pl.transaction_id
            ) parts
          ) ->> t.id::text,
          pending.state
        )
        else pending.state
      end
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    -- A pending line, which pnl_lines does not hold yet, follows the line rule in_pnl uses.
    cross join lateral (
      select case when private.line_in_pnl(
        case when not exists (
          select 1 from private.loan_parts ls where ls.transaction_id = t.id and ls.company_id = t.company_id
        ) then t.in_pnl_override end,
        private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
        c.loan_part
      ) then 'in' else 'out' end as state
    ) pending
    where t.id = any($1)
      and ((select auth.role()) = 'service_role' or t.company_id = (select private.readable_company_id()))
  $q$ using p_ids, reader;
end;
$function$;

-- The overload for one project and/or category: the same read, with the caller's company as $4.
create or replace function private.line_pnl_states(p_ids uuid[], p_project_id uuid, p_category_id uuid)
returns table(transaction_id uuid, state text)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  reader uuid;
begin
  reader := case when (select auth.role()) = 'service_role' then null else (select private.readable_company_id()) end;
  -- Executed, so each call is planned for its own ids. The parts' states are one id-keyed map
  -- read once, so the lines never nested-loop against them.
  return query execute $q$
    with parts as (
      select pl.transaction_id,
        case
          when count(*) filter (where scoped.on_it) = 0 then null
          when bool_and(pl.in_pnl) filter (where scoped.on_it) then 'in'
          when not bool_or(pl.in_pnl) filter (where scoped.on_it) then 'out'
          else 'mixed'
        end as scoped_state,
        case
          when bool_and(pl.in_pnl) then 'in'
          when not bool_or(pl.in_pnl) then 'out'
          else 'mixed'
        end as state
      from private.pnl_lines pl
      cross join lateral (
        select ($2 is not null or $3 is not null)
          and ($2 is null or pl.project_id = $2 or pl.pnl_role = 'shared')
          and ($3 is null or pl.category_id = $3) as on_it
      ) scoped
      where pl.transaction_id = any($1)
        and ($4::uuid is null or pl.company_id = $4)
      group by pl.transaction_id
    ),
    states as (
      select coalesce(jsonb_object_agg(p.transaction_id, coalesce(p.scoped_state, p.state)), '{}'::jsonb) as map
      from parts p
    )
    select t.id,
      case
        when t.line_status = 'posted' then coalesce((select s.map from states s) ->> t.id::text, pending.state)
        else pending.state
      end
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    -- A pending line, which pnl_lines does not hold yet, follows the line rule in_pnl uses.
    cross join lateral (
      select case when private.line_in_pnl(
        case when not exists (
          select 1 from private.loan_parts ls where ls.transaction_id = t.id and ls.company_id = t.company_id
        ) then t.in_pnl_override end,
        private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
        c.loan_part
      ) then 'in' else 'out' end as state
    ) pending
    where t.id = any($1)
      and ((select auth.role()) = 'service_role' or t.company_id = (select private.readable_company_id()))
  $q$ using p_ids, p_project_id, p_category_id, reader;
end;
$function$;

-- The forecast helpers. Each body names only pg_catalog functions and private helpers, all schema-qualified,
-- so the search path never changes what it means, and each drops its `set search_path`, so Postgres
-- inlines it. Signatures, volatility and results stay the same.
create or replace function private.pfe_month_index(p_month text)
returns integer
language sql
immutable
as $$
  select substr(p_month, 1, 4)::integer * 12 + substr(p_month, 6, 2)::integer - 1;
$$;

-- Whether an edit that starts in p_start, on p_pace, applies to p_month. No FROM: the gap is written out.
create or replace function private.pfe_hits(p_start text, p_pace text, p_month text)
returns boolean
language sql
immutable
as $$
  select (private.pfe_month_index(p_month) - private.pfe_month_index(p_start)) >= 0 and case p_pace
    when 'once' then private.pfe_month_index(p_month) - private.pfe_month_index(p_start) = 0
    when 'month' then true
    when '2months' then (private.pfe_month_index(p_month) - private.pfe_month_index(p_start)) % 2 = 0
    when 'quarter' then (private.pfe_month_index(p_month) - private.pfe_month_index(p_start)) % 3 = 0
    when 'year' then (private.pfe_month_index(p_month) - private.pfe_month_index(p_start)) % 12 = 0
    else false
  end;
$$;

create or replace function private.pfe_json(e public.project_forecast_edits)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', e.id,
    'kind', e.kind,
    'row_key', e.row_key,
    'category_id', e.category_id,
    'direction', e.direction,
    'amount_minor', e.amount_minor,
    'pace', e.pace,
    'start_month', e.start_month
  );
$$;

-- projects_cash_month, as 20261013184812 and the latest bodies gave it, with one change: a project's
-- waiting lines are counted once for the company (waiting_counts), not by calling project_waiting per project.
-- waiting_counts is project_waiting's row rule, grouped: an open review row on a project's expense line, or
-- (without an open review row) a line the category suggested. project_waiting's kept_out join filters nothing,
-- so the count is its row count.
create or replace function public.projects_cash_month(p_month date default null::date, p_today date default null::date, p_project uuid default null::uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  month_start date;
  month_end date;
  basis text;
  base text;
  overhead_id uuid;
  pnl_basis text;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_project is not null and not exists (
    select 1 from public.projects p where p.id = p_project and p.company_id = cid
  ) then
    return null;
  end if;
  select c.cash_basis, c.base_currency, c.overhead_project_id
  into basis, base, overhead_id
  from public.companies c
  where c.id = cid;
  month_start := date_trunc('month', coalesce(p_month, today))::date;
  month_end := (month_start + interval '1 month' - interval '1 day')::date;
  -- The project totals below count as company_pnl(cid, month, basis) and
  -- company_pnl(cid, all time, basis) count their projects' by_currency, and company_pnl reads
  -- anything but 'invoiced' as the cash basis.
  pnl_basis := case when basis = 'invoiced' then 'invoiced' else 'cash' end;

  with parts as (
    select * from private.cash_parts(cid, basis, month_start, month_end)
    where in_cash
  ),
  direct_parts as (
    select p.transaction_id, p.currency, p.kind, p.project_id as owner_id, p.amount_minor
    from parts p
    where p.pnl_role is distinct from 'shared' and p.project_id is not null
  ),
  unfiled_parts as (
    select p.transaction_id, p.currency, p.kind, null::uuid as owner_id, p.amount_minor
    from parts p
    where p.pnl_role is distinct from 'shared' and p.project_id is null
  ),
  shared_parts as (
    select
      p.transaction_id, p.part, p.category_id, p.project_id as part_project_id, p.currency, p.kind, p.amount_minor,
      least(coalesce(sum(a.share_bp), 0), 10000) as total_bp
    from parts p
    left join public.allocations a on a.transaction_id = p.transaction_id and a.company_id = cid
    where p.pnl_role = 'shared'
    group by p.transaction_id, p.part, p.category_id, p.project_id, p.currency, p.kind, p.amount_minor
  ),
  shared_alloc as (
    select
      sp.transaction_id, sp.part, sp.category_id, sp.part_project_id, sp.currency, sp.kind, sp.amount_minor,
      a.project_id,
      a.share_bp,
      private.div_half_even(sp.amount_minor::numeric * a.share_bp, 10000::numeric) as share_minor,
      private.div_half_even(sp.amount_minor::numeric * sp.total_bp, 10000::numeric) as alloc_total
    from shared_parts sp
    join public.allocations a on a.transaction_id = sp.transaction_id and a.company_id = cid
  ),
  shared_owned as (
    select
      x.transaction_id, x.currency, x.kind, x.project_id as owner_id,
      (x.share_minor + case
        when row_number() over (partition by x.transaction_id, x.part, x.category_id, x.part_project_id, x.amount_minor order by x.share_bp desc, x.project_id) = 1
          then x.alloc_total - sum(x.share_minor) over (partition by x.transaction_id, x.part, x.category_id, x.part_project_id, x.amount_minor)
        else 0
      end)::bigint as amount_minor
    from shared_alloc x
  ),
  shared_unassigned as (
    select
      sp.transaction_id, sp.currency, sp.kind, null::uuid as owner_id,
      (sp.amount_minor - private.div_half_even(sp.amount_minor::numeric * sp.total_bp, 10000::numeric))::bigint as amount_minor
    from shared_parts sp
  ),
  attributed as (
    select * from direct_parts
    union all select * from unfiled_parts
    union all select * from shared_owned
    union all select * from shared_unassigned
  ),
  project_cash as (
    select
      a.owner_id, a.currency,
      coalesce(sum(a.amount_minor) filter (where a.kind = 'income'), 0)::bigint as in_minor,
      coalesce(sum(-a.amount_minor) filter (where a.kind = 'expense'), 0)::bigint as out_minor
    from attributed a
    where a.owner_id is not null
    group by a.owner_id, a.currency
  ),
  unassigned_cash as (
    select
      a.currency,
      coalesce(sum(a.amount_minor) filter (where a.kind = 'income'), 0)::bigint as in_minor,
      coalesce(sum(-a.amount_minor) filter (where a.kind = 'expense'), 0)::bigint as out_minor
    from attributed a
    where a.owner_id is null
    group by a.currency
  ),
  unassigned_lines as (
    select count(distinct a.transaction_id)::integer as n
    from attributed a
    where a.owner_id is null and a.amount_minor <> 0
  ),
  -- The company's lines, read once: the project totals and every project's first month.
  pnl as materialized (
    select
      l.transaction_id, l.project_id, l.kind, l.pnl_role, l.direction, l.doc_kind, l.currency,
      l.amount_net, l.line_amount_net, l.in_pnl, l.unpaid, l.doc_date, l.cash_date
    from private.pnl_lines l
    where l.company_id = cid
  ),
  pnl_counted as (
    select
      l.transaction_id, l.project_id, l.kind, l.pnl_role, l.currency, l.amount_net, l.line_amount_net,
      coalesce(
        case when l.kind = 'income' and pnl_basis = 'cash' then coalesce(l.cash_date, l.doc_date) else l.doc_date end
          between month_start and month_end,
        false
      ) as in_month
    from pnl l
    where l.in_pnl
      and (pnl_basis = 'invoiced' or not l.unpaid)
      and (
        l.kind = 'expense'
        or (
          l.kind = 'income'
          and (
            l.direction = 'expense'
            or (pnl_basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (pnl_basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
        )
      )
  ),
  pnl_parts as (
    select l.project_id, l.currency, l.in_month, l.amount_net as income_net, 0::bigint as direct_net, 0::bigint as shared_net
    from pnl_counted l
    where l.kind = 'income'
    union all
    select l.project_id, l.currency, l.in_month, 0::bigint, l.amount_net, 0::bigint
    from pnl_counted l
    where l.kind = 'expense' and l.pnl_role = 'project' and l.project_id is not null
    union all
    select a.project_id, l.currency, l.in_month, 0::bigint, 0::bigint,
      coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    from pnl_counted l
    join public.allocations a on a.transaction_id = l.transaction_id
    where l.kind = 'expense' and l.pnl_role = 'shared'
  ),
  -- Per project and currency, company_pnl's income_net, direct_net and shared_net for the month
  -- and for all time.
  pnl_sums as (
    select
      x.project_id,
      x.currency,
      coalesce(sum(x.income_net) filter (where x.in_month), 0)::bigint as month_income,
      coalesce(sum(x.direct_net) filter (where x.in_month), 0)::bigint as month_direct,
      coalesce(sum(x.shared_net) filter (where x.in_month), 0)::bigint as month_shared,
      coalesce(sum(x.income_net), 0)::bigint as all_income,
      coalesce(sum(x.direct_net), 0)::bigint as all_direct,
      coalesce(sum(x.shared_net), 0)::bigint as all_shared
    from pnl_parts x
    where x.project_id is not null
    group by x.project_id, x.currency
  ),
  pnl_projects as (
    select
      s.project_id,
      s.currency,
      s.month_income + s.month_direct + s.month_shared as profit_month,
      s.all_income + s.all_direct + s.all_shared as profit_all,
      (-s.all_direct) + (-s.all_shared) as spent_all
    from pnl_sums s
  ),
  -- Every project's lines (filed, shared or split to it, as private.project_line_ids lists them)
  -- and the month of the earliest.
  project_lines as (
    select t.project_id, t.id as transaction_id
    from public.transactions t
    where t.company_id = cid and t.project_id is not null
    union
    select a.project_id, a.transaction_id
    from public.allocations a
    where a.company_id = cid
    union
    select s.project_id, s.transaction_id
    from private.split_parts s
    where s.company_id = cid and s.project_id is not null
  ),
  first_months as (
    select pl.project_id, to_char(date_trunc('month', min(l.doc_date)), 'YYYY-MM-DD') as first_month
    from project_lines pl
    join pnl l on l.transaction_id = pl.transaction_id
    group by pl.project_id
  ),
  -- Every project's waiting lines, counted as project_waiting lists them (its row rule, grouped by project).
  waiting as (
    select t.project_id
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where q.company_id = cid
      and q.status = 'open'
      and t.removed_at is null
      and t.line_status <> 'pending'
      and t.direction = 'expense'
      and t.pnl_role = 'project'
      and t.project_id is not null
    union all
    select t.project_id
    from public.transactions t
    where t.company_id = cid
      and t.project_id is not null
      and t.direction = 'expense'
      and t.pnl_role = 'project'
      and t.removed_at is null
      and t.line_status <> 'pending'
      and t.category_suggested
      and not exists (
        select 1
        from public.review_queue q
        where q.transaction_id = t.id
          and q.company_id = t.company_id
          and q.status = 'open'
      )
  ),
  waiting_counts as (
    select w.project_id, count(*)::integer as n
    from waiting w
    group by w.project_id
  ),
  project_rows as (
    select
      p.id,
      p.name,
      p.state_label as type,
      p.status::text as status,
      p.id is not distinct from overhead_id as is_overhead,
      p.group_id,
      p.created_at,
      p.finished_on,
      p.budget_agorot as budget_minor,
      coalesce((select r.spent_all from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as spent_minor,
      coalesce((select r.profit_month from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as profit_month_minor,
      coalesce((select r.profit_all from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as profit_all_minor,
      (select f.first_month from first_months f where f.project_id = p.id) as first_month,
      coalesce((select wc.n from waiting_counts wc where wc.project_id = p.id), 0) as pending_count,
      private.project_is_empty(cid, p.id) as deletable,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', pc.currency,
          'in_minor', pc.in_minor,
          'out_minor', pc.out_minor,
          'net_minor', pc.in_minor - pc.out_minor
        ) order by pc.currency is distinct from base, pc.currency)
        from project_cash pc
        where pc.owner_id = p.id
      ), '[]'::jsonb) as cash
    from public.projects p
    where p.company_id = cid
      and (p_project is null or p.id = p_project)
  )
  select jsonb_build_object(
    'month', to_char(month_start, 'YYYY-MM-DD'),
    'base_currency', base,
    'basis', basis,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'type', r.type,
        'status', r.status,
        'is_overhead', r.is_overhead,
        'group_id', r.group_id,
        'created_at', r.created_at,
        'finished_on', r.finished_on,
        'budget_minor', r.budget_minor,
        'spent_minor', r.spent_minor,
        'cash', r.cash,
        'profit_month_minor', r.profit_month_minor,
        'profit_all_minor', r.profit_all_minor,
        'first_month', r.first_month,
        'pending_count', r.pending_count,
        'deletable', r.deletable
      ) order by r.name)
      from project_rows r
    ), '[]'::jsonb),
    'unassigned', jsonb_build_object(
      'count', (select n from unassigned_lines),
      'cash', coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', uc.currency,
          'in_minor', uc.in_minor,
          'out_minor', uc.out_minor,
          'net_minor', uc.in_minor - uc.out_minor
        ) order by uc.currency is distinct from base, uc.currency)
        from unassigned_cash uc
      ), '[]'::jsonb)
    )
  )
  into result;

  return result;
end;
$function$;

commit;
