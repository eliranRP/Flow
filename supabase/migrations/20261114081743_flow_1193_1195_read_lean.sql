-- FLOW-1193 and FLOW-1195 (perf queue, decision 0230): fields the app never reads, and the year view's skips in
-- one read. Same figures everywhere the app and flow-mcp read them; only what neither reads is left out.
--
-- - get_project, p_lines false (what the app asks): excluded_income_by_currency and other_currencies move into
--   the p_lines branch (flow-mcp's spec names both, and it asks with lines). has_shared_share (on each category
--   row), profit_after_overhead_agorot and sumit_budget_section_id are left out too: no app code reads them.
--   The default answer, which flow-mcp gets, keeps all of them, as it keeps every key it had.
-- - projects_cash_month: projects[].profit_month_minor and the month sums it came from are dropped; no app code
--   reads it, flow-mcp does not call this RPC, and the all-time sums are untouched.
-- - expected_months: p_months 0 answers without months[]: today, project_id and recurring[] only, the same ones
--   p_months 1 and up give (recurring[] never depended on p_months). The app asks with 0. Any p_months from 1 to
--   13 is the answer it was, flow-mcp's get_expected_months included.
-- - company_next_month_inputs, with p_rest (the year and since-start views): skips, the keys of the forecast items
--   taken out of each month (moved_out), by month, for next month and every month after it to the horizon. A
--   month with no skip has no key. Each month's list is what forecast_overrides_for(month) gives for the moved
--   out rows, in its order, so the year view no longer reads forecast_overrides_for once per month left.
--
-- The bodies are patched in place: each anchor must be found exactly once, or the migration fails.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.swap(p_def text, p_from text, p_to text)
returns text
language plpgsql
immutable
as $$
begin
  if (char_length(p_def) - char_length(replace(p_def, p_from, ''))) / char_length(p_from) <> 1 then
    raise exception 'anchor not found exactly once: %', left(p_from, 80);
  end if;
  return replace(p_def, p_from, p_to);
end;
$$;

-- 1. get_project.
do $project$
declare
  def text := pg_get_functiondef('public.get_project(uuid,text,date,date,boolean)'::regprocedure);
  -- The two blocks that move into the p_lines branch, as they stood in the main answer.
  income_block constant text := $a$    -- FLOW-121: income filed to this project that is out of the P&L, by category, on the
    -- same basis as income_agorot. Positive minor units.
    'excluded_income_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', s.currency,
        'id', c.id,
        'name', c.name,
        'amount_minor', s.amount,
        'count', s.line_count
      ) order by s.currency, s.amount desc, c.name)
      from (
        select l.currency,
          l.category_id,
          sum(l.amount_net)::bigint as amount,
          count(distinct l.transaction_id)::integer as line_count
        from unnest(pl_rows) l
        where l.project_id = p.id
          and l.company_id = cid
          and l.kind = 'income'
          and not l.in_pnl
          and (
            l.direction = 'expense'
            or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
        group by l.currency, l.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'income_minor', bucket.income_minor,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          parts.currency,
          sum(parts.income_minor)::bigint as income_minor,
          sum(parts.expense_minor)::bigint as expense_minor,
          count(distinct parts.transaction_id)::integer as line_count
        from (
          select
            l.currency,
            case when l.kind = 'income' then l.amount_net else 0 end as income_minor,
            case when l.kind = 'expense' then l.amount_net else 0 end as expense_minor,
            l.transaction_id
          from unnest(pl_rows) l
          where l.project_id = p.id
            and l.in_pnl
            and l.currency <> 'ILS'
            and (
              (l.kind = 'income' and (
                l.direction = 'expense'
                or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              ))
              or (l.kind = 'expense' and l.pnl_role = 'project')
            )
          union all
          select l.currency, 0, coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0), l.transaction_id
          from unnest(pl_rows) l
          -- Lines first, then each line's share by index, so the allocations never drive the join.
          cross join lateral (
            select a.amount_net from public.allocations a
            where a.transaction_id = l.transaction_id and a.project_id = p.id
            offset 0 -- keeps this a per-line lookup
          ) a
          where l.kind = 'expense' and l.pnl_role = 'shared'
            and l.in_pnl
            and l.currency <> 'ILS'
        ) parts
        group by parts.currency
      ) bucket
    ), '[]'::jsonb),
$a$;
  sumit_line constant text := $a$    'sumit_budget_section_id', p.sumit_budget_section_id,
$a$;
  profit_line constant text := $a$    'profit_after_overhead_agorot', profit - case when coalesce(available, false) then coalesce(share, 0) else 0 end,
$a$;
begin
  def := pg_temp.swap(def, income_block, '');
  def := pg_temp.swap(def, sumit_line, '');
  def := pg_temp.swap(def, profit_line, '');
  def := pg_temp.swap(def, $a$  ) || case when p_lines then jsonb_build_object(
    'pending_agorot', coalesce((
$a$, $b$  ) || case when p_lines then jsonb_build_object(
$b$ || sumit_line || income_block || $b$    'pending_agorot', coalesce((
$b$);
  def := pg_temp.swap(def, $a$    result := result || jsonb_build_object(
      'excluded_categories_by_currency',$a$, $b$    result := result || jsonb_build_object(
$b$ || profit_line || $b$      'excluded_categories_by_currency',$b$);
  -- has_shared_share, on the three category lists, only with the lines.
  def := pg_temp.swap(def, $a$      'amount_agorot', s.amount,
      'has_shared_share', s.shared
    ) order by s.amount desc, c.name)$a$, $b$      'amount_agorot', s.amount
    ) || case when p_lines then jsonb_build_object('has_shared_share', s.shared) else '{}'::jsonb end
    order by s.amount desc, c.name)$b$);
  def := pg_temp.swap(def, $a$      'amount_minor', s.amount,
      'has_shared_share', s.shared
    ) order by s.currency, s.amount desc, c.name) filter (where s.in_pnl), '[]'::jsonb),$a$, $b$      'amount_minor', s.amount
    ) || case when p_lines then jsonb_build_object('has_shared_share', s.shared) else '{}'::jsonb end
    order by s.currency, s.amount desc, c.name) filter (where s.in_pnl), '[]'::jsonb),$b$);
  def := pg_temp.swap(def, $a$      'amount_minor', s.amount,
      'has_shared_share', s.shared
    ) order by s.currency, s.amount desc, c.name) filter (where not s.in_pnl), '[]'::jsonb)$a$, $b$      'amount_minor', s.amount
    ) || case when p_lines then jsonb_build_object('has_shared_share', s.shared) else '{}'::jsonb end
    order by s.currency, s.amount desc, c.name) filter (where not s.in_pnl), '[]'::jsonb)$b$);
  execute def;
end
$project$;

-- 2. projects_cash_month: no profit_month_minor, and nothing left that only it read.
do $cash$
declare
  def text := pg_get_functiondef('public.projects_cash_month(date,date,uuid)'::regprocedure);
begin
  def := pg_temp.swap(def, $a$l.in_pnl, l.unpaid, l.doc_date, l.cash_date$a$, $b$l.in_pnl, l.unpaid, l.doc_date$b$);
  def := pg_temp.swap(def, $a$      l.transaction_id, l.project_id, l.kind, l.pnl_role, l.currency, l.amount_net, l.line_amount_net,
      coalesce(
        case when l.kind = 'income' and pnl_basis = 'cash' then coalesce(l.cash_date, l.doc_date) else l.doc_date end
          between month_start and month_end,
        false
      ) as in_month
    from pnl l$a$, $b$      l.transaction_id, l.project_id, l.kind, l.pnl_role, l.currency, l.amount_net, l.line_amount_net
    from pnl l$b$);
  def := pg_temp.swap(def, $a$select l.project_id, l.currency, l.in_month, l.amount_net as income_net,$a$,
    $b$select l.project_id, l.currency, l.amount_net as income_net,$b$);
  def := pg_temp.swap(def, $a$select l.project_id, l.currency, l.in_month, 0::bigint, l.amount_net, 0::bigint$a$,
    $b$select l.project_id, l.currency, 0::bigint, l.amount_net, 0::bigint$b$);
  def := pg_temp.swap(def, $a$select a.project_id, l.currency, l.in_month, 0::bigint, 0::bigint,$a$,
    $b$select a.project_id, l.currency, 0::bigint, 0::bigint,$b$);
  def := pg_temp.swap(def, $a$      coalesce(sum(x.income_net) filter (where x.in_month), 0)::bigint as month_income,
      coalesce(sum(x.direct_net) filter (where x.in_month), 0)::bigint as month_direct,
      coalesce(sum(x.shared_net) filter (where x.in_month), 0)::bigint as month_shared,
$a$, '');
  def := pg_temp.swap(def, $a$      s.month_income + s.month_direct + s.month_shared as profit_month,
$a$, '');
  def := pg_temp.swap(def, $a$      coalesce((select r.profit_month from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as profit_month_minor,
$a$, '');
  def := pg_temp.swap(def, $a$        'profit_month_minor', r.profit_month_minor,
$a$, '');
  execute def;
end
$cash$;

-- 3. expected_months: p_months 0 leaves out months[].
do $expected$
declare
  def text := pg_get_functiondef('public.expected_months(integer,uuid,date)'::regprocedure);
  months_pair constant text := $a$      'months', (select jsonb_agg(jsonb_build_object(
          'month', to_char(pm.month, 'YYYY-MM'),
          'open', pm.month = date_trunc('month', today)::date,
          'by_currency', pm.by_currency
        ) order by pm.month) from per_month pm),
$a$;
begin
  def := pg_temp.swap(def, $a$p_months is null or p_months < 1 or p_months > 13$a$, $b$p_months is null or p_months < 0 or p_months > 13$b$);
  def := pg_temp.swap(def, months_pair, '');
  def := pg_temp.swap(def, $a$      ), '[]'::jsonb)
    )
  );
end;$a$, $b$      ), '[]'::jsonb)
    ) || case when p_months > 0 then jsonb_build_object(
      'months', (select jsonb_agg(jsonb_build_object(
          'month', to_char(pm.month, 'YYYY-MM'),
          'open', pm.month = date_trunc('month', today)::date,
          'by_currency', pm.by_currency
        ) order by pm.month) from per_month pm)
    ) else '{}'::jsonb end
  );
end;$b$);
  execute def;
end
$expected$;

-- 4. company_next_month_inputs: the year view's skips, by month.
do $inputs$
declare
  def text := pg_get_functiondef('public.company_next_month_inputs(date,boolean)'::regprocedure);
begin
  def := pg_temp.swap(def, $a$  rest_months text[];
begin$a$, $b$  rest_months text[];
  rest_skips jsonb;
begin$b$);
  def := pg_temp.swap(def, $a$      and exists (select 1 from unnest(rest_months) rm where private.pfe_hits(e.start_month, e.pace, rm));
  end if;$a$, $b$      and exists (select 1 from unnest(rest_months) rm where private.pfe_hits(e.start_month, e.pace, rm));
    -- FLOW-1195: each month's skips (forecast_overrides_for's moved_out keys), next month to the horizon, so the
    -- year view reads them with the rest of the answer, not once per month.
    select coalesce(jsonb_object_agg(s.month, s.item_keys order by s.month), '{}'::jsonb)
    into rest_skips
    from (
      select f.month, jsonb_agg(f.item_key order by f.item_key) as item_keys
      from public.forecast_overrides f
      where f.company_id = cid
        and f.moved_out
        and f.month = any(rest_months)
      group by f.month
    ) s;
  end if;$b$);
  def := pg_temp.swap(def, $a$jsonb_build_object('rest_edits', rest_edits)$a$, $b$jsonb_build_object('rest_edits', rest_edits, 'skips', rest_skips)$b$);
  execute def;
end
$inputs$;

drop function pg_temp.swap(text, text, text);

commit;
