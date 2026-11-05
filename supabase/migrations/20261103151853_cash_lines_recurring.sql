-- FLOW-1035: each row of cash_month_lines says whether it belongs to a recurring charge.
-- Home v3 splits the month into what is left to pay, the recurring charges paid and the one-off lines, and
-- a month line carried no link to the recurring schedule.
-- - private.recurring_month_lines(company, day): the lines of the day's month (up to that day; cash_month_lines
--   passes the month's last day) that belong to a charge recurring_schedule lists for that day. It is the schedule's own match: the stream lines
--   (recurring_stream_lines: the party or the party answered the same, FLOW-430; a split line as its
--   counted parts, each by its own project, decision 0189) joined to recurring_parties on direction,
--   party, currency and the charge's project (decision 0185), for a party the schedule names. A line is matched
--   by its document date, as the schedule matches its arrivals, so on the cash basis a bill dated last month
--   and paid this month reads false on this month's row; a split line reads true when any of its parts
--   belongs to a charge (the row is the whole line, and the schedule shows the part as the charge's arrival).
-- - cash_month_lines: each row gains recurring, true when its line is one of those lines for the month
--   (as of the month's last day), false otherwise. The signature, the grants and every other key stay.

begin;

set local lock_timeout = '5s';

create or replace function private.recurring_month_lines(p_company uuid, p_today date)
returns table(id uuid, direction public.txn_direction, party_id uuid, currency text, project_id uuid)
language sql
stable
security definer
set search_path = ''
as $function$
  select sl.id, x.direction, x.party_id, x.currency, x.project_id
  from private.recurring_parties(p_company, p_today) x
  -- The charge's lines, as recurring_schedule_json's arrival sum matches them.
  join private.recurring_stream_lines(p_company, p_today) sl
    on sl.direction = x.direction and sl.party_id = x.party_id and sl.currency = x.currency
    and sl.stream_project is not distinct from x.project_id
  where sl.doc_date >= date_trunc('month', p_today)::date
    -- The schedule lists a charge whose party is a supplier or customer of the company.
    and exists (
      select 1 from public.suppliers s
      where x.direction = 'expense' and s.company_id = p_company and s.id = x.party_id
      union all
      select 1 from public.customers cu
      where x.direction = 'income' and cu.company_id = p_company and cu.id = x.party_id
    );
$function$;

revoke all on function private.recurring_month_lines(uuid, date) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cash_month_lines(p_month date, p_side text, p_currency text DEFAULT NULL::text, p_limit integer DEFAULT 40, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  basis text;
  base text;
  month_start date;
  lim integer;
  off integer;
  result jsonb;
  recurring_ids uuid[];
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_month is null or p_side is null or p_side not in ('in', 'out', 'excluded', 'not_in_profit', 'in_profit') then
    raise exception 'validation';
  end if;
  select c.cash_basis, c.base_currency into basis, base
  from public.companies c
  where c.id = cid;
  month_start := date_trunc('month', p_month)::date;
  lim := least(greatest(coalesce(p_limit, 40), 1), 200);
  off := greatest(coalesce(p_offset, 0), 0);
  -- FLOW-1035: the month's lines of the charges recurring_schedule lists for it, as of the month's end.
  select coalesce(array_agg(distinct rl.id), '{}') into recurring_ids
  from private.recurring_month_lines(cid, private.month_end(month_start)) rl;

  with r as (
    select
      p.*,
      case when p.kind = 'income' then 'in' else 'out' end as side,
      case when p.kind = 'income' then p.amount_minor else -p.amount_minor end as side_minor
    from private.cash_parts(cid, basis, month_start, (month_start + interval '1 month' - interval '1 day')::date) p
    where p.currency = coalesce(p_currency, base)
      and (
        (p_side = 'excluded' and not p.in_cash)
        or (p_side = 'not_in_profit' and p.in_cash and not p.in_pnl)
        or (p_side = 'in_profit' and p.in_cash and p.in_pnl)
        or (p_side = 'in' and p.in_cash and p.kind = 'income')
        or (p_side = 'out' and p.in_cash and p.kind = 'expense')
      )
  ),
  merged as (
    select
      r.transaction_id,
      r.part,
      r.side,
      max(r.month_date) as month_date,
      sum(r.side_minor)::bigint as amount_minor,
      bool_or(r.in_pnl) as in_pnl,
      jsonb_agg(jsonb_build_object('category_id', r.category_id, 'amount_minor', r.side_minor)) filter (where r.part is null) as part_list,
      case when count(distinct r.category_id) = 1 and count(r.category_id) = count(*) then min(r.category_id::text)::uuid end as category_id,
      case when count(distinct r.project_id) = 1 and count(r.project_id) = count(*) then min(r.project_id::text)::uuid end as project_id
    from r
    group by r.transaction_id, r.part, r.side
  ),
  page as (
    select
      m.*,
      t.description,
      t.source,
      t.doc_date,
      abs(t.amount_gross) as line_gross,
      m.part is null and private.line_split_valid(m.transaction_id) as split_shown,
      sup.name as supplier_name,
      pr.name as project_name,
      c.name as category_name,
      row_number() over (order by m.month_date desc, m.transaction_id, m.part, m.side) as n
    from merged m
    join public.transactions t on t.id = m.transaction_id
    left join public.suppliers sup on sup.id = t.supplier_id
    left join public.projects pr on pr.id = m.project_id
    left join public.categories c on c.id = m.category_id
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'transaction_id', pg.transaction_id,
        'part', pg.part,
        'description', pg.description,
        'supplier_name', pg.supplier_name,
        'project_name', pg.project_name,
        'category_name', pg.category_name,
        'doc_date', pg.doc_date,
        'cash_month_date', pg.month_date,
        'currency', coalesce(p_currency, base),
        'amount_minor', pg.amount_minor,
        'side', pg.side,
        'shared', false,
        'source', pg.source,
        'kept_out', p_side = 'excluded',
        'in_pnl', pg.in_pnl,
        'recurring', pg.transaction_id = any(recurring_ids),
        'pending', exists (
          select 1 from public.review_queue q
          where q.transaction_id = pg.transaction_id and q.status = 'open'
        ),
        'line_minor', case when pg.split_shown or pg.part is not null then pg.line_gross end,
        'parts', case when pg.split_shown then (
          select jsonb_agg(jsonb_build_object('name', c.name, 'amount_minor', x.amount_minor) order by abs(x.amount_minor) desc, c.name)
          from (
            select (e.v ->> 'category_id')::uuid as category_id, sum((e.v ->> 'amount_minor')::bigint)::bigint as amount_minor
            from jsonb_array_elements(pg.part_list) e(v)
            group by 1
          ) x
          left join public.categories c on c.id = x.category_id
        ) end
      ) order by pg.n)
      from page pg
      where pg.n > off and pg.n <= off + lim
    ), '[]'::jsonb),
    'has_more', exists (select 1 from page pg where pg.n > off + lim)
  ) into result;

  return result;
end;
$function$;

revoke all on function public.cash_month_lines(date, text, text, integer, integer) from public, anon;
grant execute on function public.cash_month_lines(date, text, text, integer, integer) to authenticated, service_role;

commit;
