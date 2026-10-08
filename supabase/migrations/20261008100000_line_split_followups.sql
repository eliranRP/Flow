-- FLOW-312 (FLOW-311 follow-ups), items 1 and 6.
-- 1. get_project's transactions[] also lists a line that reaches the project only through a
--    part of a split by category (line_splits.project_id), and every row carries parts_minor:
--    the sum of the line's parts that count under this project (a part with no project keeps
--    the line's project), or null when no part does (or the line has no split by category).
-- 6. get_home.other_currencies[].count and get_project.other_currencies[].count count each
--    bank line once (distinct transaction_id), as company_pnl does, instead of once per part
--    of a split line, per loan split part or per allocation row. Amounts don't change.
-- get_project is otherwise as in 20261008060000_get_project_followups.sql and get_home as in
-- 20261008003000_unpaid_invoices_cash.sql. Grants are kept by create or replace.

begin;

set local lock_timeout = '5s';

create or replace function public.get_project(p_id uuid, p_basis text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  basis text;
  result jsonb;
  profit bigint;
  available boolean;
  share bigint;
  waiting jsonb;
begin
  select c.id into cid
    from public.companies c
    where c.owner_id = (select auth.uid());
  if cid is null then
    return null;
  end if;
  basis := case when p_basis = 'invoiced' then 'invoiced' else 'cash' end;

  waiting := public.project_waiting(p_id);

  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'status', p.status,
    'state_label', p.state_label,
    'budget_agorot', p.budget_agorot,
    'sumit_budget_section_id', p.sumit_budget_section_id,
    'is_overhead', p.id is not distinct from (select c.overhead_project_id from public.companies c where c.id = cid),
    'after_overhead', coalesce(p.after_overhead, (select c.after_overhead from public.companies c where c.id = cid)),
    'income_agorot', coalesce((
      select sum(l.amount_net) from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
      where l.project_id = p.id and l.kind = 'income'
        and l.in_pnl
        and l.currency = 'ILS'
        and (
          l.direction = 'expense'
          or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
          or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
        )
    ), 0),
    'direct_agorot', -coalesce((
      select sum(l.amount_net) from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
      where l.project_id = p.id and l.kind = 'expense' and l.pnl_role = 'project'
        and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'shared_agorot', -coalesce((
      select sum(coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0))
      from public.allocations a
      join (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l on l.transaction_id = a.transaction_id
      where a.project_id = p.id and l.kind = 'expense' and l.pnl_role = 'shared' and l.in_pnl
        and l.currency = 'ILS'
    ), 0),
    'by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', b.currency,
        'income_minor', b.income_minor,
        'direct_minor', b.direct_minor,
        'shared_minor', b.shared_minor,
        'profit_minor', b.income_minor - b.direct_minor - b.shared_minor
      ) order by b.currency)
      from (
        select
          parts.currency,
          coalesce(sum(parts.income_minor), 0)::bigint as income_minor,
          coalesce(sum(parts.direct_minor), 0)::bigint as direct_minor,
          coalesce(sum(parts.shared_minor), 0)::bigint as shared_minor
        from (
          select l.currency as currency,
            case when l.kind = 'income' and (
                l.direction = 'expense'
                or (basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
                or (basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
              ) then l.amount_net else 0 end as income_minor,
            case when l.kind = 'expense' and l.pnl_role = 'project' then -l.amount_net else 0 end as direct_minor,
            0::bigint as shared_minor
          from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
          where l.project_id = p.id
            and l.in_pnl
          union all
          select l.currency as currency,
            0::bigint,
            0::bigint,
            -coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0) as shared_minor
          from public.allocations a
          join (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l on l.transaction_id = a.transaction_id
          where a.project_id = p.id
            and l.kind = 'expense' and l.pnl_role = 'shared'
            and l.in_pnl
        ) parts
        group by parts.currency
      ) b
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'amount_agorot', s.amount,
        'has_shared_share', s.shared
      ) order by s.amount desc, c.name)
      from (
        select e.category_id,
          (-sum(e.amount_net))::bigint as amount,
          bool_or(e.shared) as shared
        from private.project_category_entries(p.id) e
        left join public.categories cat on cat.id = e.category_id
        join public.transactions lt on lt.id = e.transaction_id
        where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
          and private.line_in_pnl(
          case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
            then lt.in_pnl_override end,
          cat.excluded_from_pnl, cat.loan_part
        )
        group by e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'categories_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', s.currency,
        'id', c.id,
        'name', c.name,
        'amount_minor', s.amount,
        'has_shared_share', s.shared
      ) order by s.currency, s.amount desc, c.name)
      from (
        select e.currency,
          e.category_id,
          (-sum(e.amount_net))::bigint as amount,
          bool_or(e.shared) as shared
        from private.project_category_entries_by_currency(p.id) e
        left join public.categories cat on cat.id = e.category_id
        join public.transactions lt on lt.id = e.transaction_id
        where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
          and private.line_in_pnl(
          case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
            then lt.in_pnl_override end,
          cat.excluded_from_pnl, cat.loan_part
        )
        group by e.currency, e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'excluded_categories_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', s.currency,
        'id', c.id,
        'name', c.name,
        'amount_minor', s.amount,
        'has_shared_share', s.shared
      ) order by s.currency, s.amount desc, c.name)
      from (
        select e.currency,
          e.category_id,
          (-sum(e.amount_net))::bigint as amount,
          bool_or(e.shared) as shared
        from private.project_category_entries_by_currency(p.id) e
        left join public.categories cat on cat.id = e.category_id
        join public.transactions lt on lt.id = e.transaction_id
        where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
          and not private.line_in_pnl(
          case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
            then lt.in_pnl_override end,
          cat.excluded_from_pnl, cat.loan_part
        )
        group by e.currency, e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    -- FLOW-121: income filed to this project that is out of the P&L, by category, on the
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
        from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
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
          from (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l
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
          from public.allocations a
          join (select * from private.pnl_lines u where basis = 'invoiced' or not u.unpaid) l on l.transaction_id = a.transaction_id
          where a.project_id = p.id
            and l.kind = 'expense' and l.pnl_role = 'shared'
            and l.in_pnl
            and l.currency <> 'ILS'
        ) parts
        group by parts.currency
      ) bucket
    ), '[]'::jsonb),
    'pending_count', coalesce(jsonb_array_length(waiting), 0),
    'pending_agorot', coalesce((
      select (-sum(t.amount_net))::bigint
      from jsonb_array_elements(waiting) row
      join public.transactions t on t.id = (row->>'transaction_id')::uuid
      where coalesce(t.currency, 'ILS') = 'ILS'
    ), 0),
    'pending_other_currencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', bucket.currency,
        'expense_minor', bucket.expense_minor,
        'count', bucket.line_count
      ) order by bucket.currency)
      from (
        select
          t.currency,
          sum(t.amount_net)::bigint as expense_minor,
          count(*)::integer as line_count
        from jsonb_array_elements(waiting) row
        join public.transactions t on t.id = (row->>'transaction_id')::uuid
        where coalesce(t.currency, 'ILS') <> 'ILS'
        group by t.currency
      ) bucket
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'description', t.description,
        'doc_date', t.doc_date,
        'amount_net', t.amount_net,
        'currency', coalesce(t.currency, 'ILS'),
        'direction', t.direction,
        'source', t.source,
        'doc_kind', t.doc_kind,
        'line_status', t.line_status,
        'category', c.name,
        'parts_minor', (
          select sum(s.amount_minor)::bigint
          from public.line_splits s
          where s.transaction_id = t.id
            and coalesce(s.project_id, t.project_id) = p.id
        )
      ) order by t.doc_date desc, t.created_at desc, t.id desc)
      from (
        select * from public.transactions t
        where t.company_id = cid
          and t.removed_at is null
          and (t.project_id = p.id or exists (
            select 1 from public.allocations a
            where a.transaction_id = t.id and a.project_id = p.id
          ) or exists (
            select 1 from public.line_splits s
            where s.transaction_id = t.id and s.company_id = cid and s.project_id = p.id
          ))
        order by t.doc_date desc, t.created_at desc, t.id desc
        limit 40
      ) t
      left join public.categories c on c.id = t.category_id
    ), '[]'::jsonb)
  )
  into result
  from public.projects p
  where p.id = p_id and p.company_id = cid;
  if result is null then
    return null;
  end if;
  profit :=
    (result->>'income_agorot')::bigint
    - (result->>'direct_agorot')::bigint
    - (result->>'shared_agorot')::bigint;
  select s.available, s.share_agorot into available, share
  from private.overhead_share(p_id, basis) s;
  return result || jsonb_build_object(
    'profit_agorot', profit,
    'overhead_share_agorot', case when coalesce(available, false) then coalesce(share, 0) else null end,
    'overhead_weighted', coalesce(available, false),
    'profit_after_overhead_agorot', profit - case when coalesce(available, false) then coalesce(share, 0) else 0 end,
    -- FLOW-105: the loans filed under this project. Nothing above reads them.
    'loans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'name', l.name,
        'currency', l.currency,
        'balance_minor', b.balance_minor
      ) order by l.name, l.id)
      from public.loans l
      join public.loan_balances b
        on b.company_id = l.company_id
       and b.loan_id = l.id
      where l.company_id = cid
        and l.project_id = p_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_home()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'company_id', c.id,
        'name', c.name,
        'net_profit_agorot', coalesce((
          select sum(
            case
              when l.kind = 'income' and (l.direction = 'expense' or l.doc_kind in ('receipt', 'invoice_receipt')) then l.amount_net
              when l.kind = 'expense' then l.amount_net
              else 0
            end
          )::bigint
          from (select * from private.pnl_lines u where not u.unpaid) l
          where l.company_id = c.id
            and l.in_pnl
            and l.currency = 'ILS'
        ), 0),
        'other_currencies', coalesce((
          select jsonb_agg(jsonb_build_object(
            'currency', bucket.currency,
            'income_minor', bucket.income_minor,
            'expense_minor', bucket.expense_minor,
            'count', bucket.line_count
          ) order by bucket.currency)
          from (
            select
              l.currency,
              coalesce(sum(l.amount_net) filter (
                where l.kind = 'income' and (l.direction = 'expense' or l.doc_kind in ('receipt', 'invoice_receipt'))
              ), 0)::bigint as income_minor,
              coalesce(sum(l.amount_net) filter (where l.kind = 'expense'), 0)::bigint as expense_minor,
              count(distinct l.transaction_id) filter (
                where (l.kind = 'income' and (l.direction = 'expense' or l.doc_kind in ('receipt', 'invoice_receipt')))
                  or l.kind = 'expense'
              )::integer as line_count
            from (select * from private.pnl_lines u where not u.unpaid) l
            where l.company_id = c.id
              and l.in_pnl
              and l.currency <> 'ILS'
            group by l.currency
          ) bucket
          where bucket.line_count > 0
        ), '[]'::jsonb),
        'is_demo', c.is_demo
      )
      from public.companies c
      where c.id = (select private.readable_company_id())
    ),
    jsonb_build_object(
      'company_id', null,
      'name', null,
      'net_profit_agorot', 0,
      'other_currencies', '[]'::jsonb,
      'is_demo', false
    )
  );
$$;

commit;
