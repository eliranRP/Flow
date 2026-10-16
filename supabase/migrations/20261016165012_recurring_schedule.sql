-- FLOW-447, server PR (decision 0175): the קבועים list's one read. Every recurring party of the
-- company with its state this month: arrived (seen this month), late (past its expected day, the
-- same rule as missing_bills), soon (due this month, not yet late) or later (its next month is after
-- this one). Read only and company scoped. It reuses private.recurring_parties, the base that
-- expected_months and missing_bills read, so the pace and the next due month are the same values.

create function private.recurring_schedule_json(p_company uuid, p_today date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with this_month as (
    select date_trunc('month', p_today)::date as month_start
  ),
  due as (
    select r.*,
      make_date(extract(year from r.next_due_month)::integer, extract(month from r.next_due_month)::integer,
        least(r.typical_day + 5, extract(day from private.month_end(r.next_due_month))::integer)) as expected_by
    from private.recurring_parties(p_company, p_today) r
  ),
  rows as (
    select d.*,
      case
        when d.seen_this_month then 'arrived'
        when d.next_due_month > (select month_start from this_month) then 'later'
        when p_today > d.expected_by
          or (p_today = d.expected_by and d.expected_by = private.month_end(d.next_due_month)) then 'late'
        else 'soon'
      end as state
    from due d
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'direction', x.direction,
      'party_id', x.party_id,
      'party_name', coalesce(s.name, cu.name),
      'currency', x.currency,
      'state', x.state,
      'typical_amount_minor', x.typical_amount_minor,
      'amount_minor', case when x.seen_this_month then ma.amount end,
      'typical_day', x.typical_day,
      'pace', x.pace,
      'next_due_month', to_char(x.next_due_month, 'YYYY-MM'),
      'expected_by', x.expected_by,
      'project_id', x.project_id,
      'project_name', p.name,
      'category_id', x.category_id,
      'category_name', c.name
    ) order by
      case x.state when 'arrived' then 0 when 'late' then 1 when 'soon' then 2 else 3 end,
      x.direction = 'income', x.typical_day, coalesce(s.name, cu.name), x.party_id), '[]'::jsonb)
  from rows x
  -- This month's live lines of the party, the same sum recurring_arrivals takes.
  left join lateral (
    select sum(t.amount_net)::bigint as amount
    from public.transactions t
    where t.company_id = p_company and t.direction = x.direction and t.currency = x.currency
      and x.party_id = case when x.direction = 'expense' then t.supplier_id else t.customer_id end
      and t.removed_at is null
      and t.line_status <> 'void'
      and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and t.doc_date >= date_trunc('month', p_today)::date
      and t.doc_date <= p_today
  ) ma on x.seen_this_month
  left join public.suppliers s on x.direction = 'expense' and s.company_id = p_company and s.id = x.party_id
  left join public.customers cu on x.direction = 'income' and cu.company_id = p_company and cu.id = x.party_id
  left join public.projects p on p.company_id = p_company and p.id = x.project_id
  left join public.categories c on c.company_id = p_company and c.id = x.category_id
  where coalesce(s.id, cu.id) is not null;
$$;

revoke all on function private.recurring_schedule_json(uuid, date) from public, anon, authenticated;

-- The caller's company only. Amounts are minor units; an expense's typical amount is negative, as
-- in recurring_parties. amount_minor is this month's live lines, set only when the party arrived.
create function public.recurring_schedule(p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return private.recurring_schedule_json(cid, coalesce(p_today, private.flow_today()));
end;
$$;

revoke all on function public.recurring_schedule(date) from public, anon;
grant execute on function public.recurring_schedule(date) to authenticated, service_role;
