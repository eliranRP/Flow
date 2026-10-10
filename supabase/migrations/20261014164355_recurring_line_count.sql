-- FLOW-913: a recurring party's row in הגיעו החודש sums every one of this month's lines (RentRedi:
-- three rents, $6,055) but opened only the newest. The arrivals now say how many lines they sum
-- ('line_count'), so the app opens all of them when there are several. Only
-- private.recurring_arrivals_json changes; its signature and every other key stay as in
-- 20261014091554_recurring_pace.sql.

create or replace function private.recurring_arrivals_json(p_company uuid, p_today date, p_changes boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'direction', a.direction,
      'party_id', a.party_id,
      'party_name', coalesce(s.name, cu.name),
      'supplier_id', s.id,
      'supplier_name', s.name,
      'currency', a.currency,
      'amount_minor', a.amount_minor,
      'typical_amount_minor', a.typical_amount_minor,
      'change_percent', a.change_percent,
      'changed', a.changed,
      'typical_day', a.typical_day,
      'transaction_id', a.transaction_id,
      'project_id', a.project_id,
      'project_name', p.name,
      'category_id', a.category_id,
      'category_name', c.name,
      'source', a.source,
      'pace', a.pace,
      'alert_key', a.transaction_id::text,
      'line_count', n.line_count
    ) order by
      case when p_changes then abs(a.change_percent) end desc,
      a.direction = 'income', coalesce(s.name, cu.name), a.party_id), '[]'::jsonb)
  from (
    select ar.*,
      abs(abs(ar.amount_minor) - abs(ar.typical_amount_minor)) * 5 >= abs(ar.typical_amount_minor) as changed
    from private.recurring_arrivals(p_company, p_today) ar
  ) a
  left join public.suppliers s on a.direction = 'expense' and s.company_id = p_company and s.id = a.party_id
  left join public.customers cu on a.direction = 'income' and cu.company_id = p_company and cu.id = a.party_id
  left join public.projects p on p.company_id = p_company and p.id = a.project_id
  left join public.categories c on c.company_id = p_company and c.id = a.category_id
  -- FLOW-913: how many of this month's lines make up the amount, with recurring_arrivals' filters.
  cross join lateral (
    select count(*)::integer as line_count
    from public.transactions t
    where t.company_id = p_company and t.direction = a.direction and t.currency = a.currency
      -- FLOW-430: a party answered "the same" counts as the recurring one.
      and a.party_id = private.recurring_party_of(p_company, t.direction,
        case when a.direction = 'expense' then t.supplier_id else t.customer_id end)
      and t.removed_at is null
      and t.line_status <> 'void'
      and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and t.doc_date >= date_trunc('month', p_today)::date
      and t.doc_date <= p_today
  ) n
  where coalesce(s.id, cu.id) is not null
    and (not p_changes or (a.changed and not exists (
      select 1 from public.recurring_dismissals x
      where x.user_id = auth.uid() and x.company_id = p_company and x.kind = 'change'
        and x.alert_key = a.transaction_id::text
    )));
$$;

revoke all on function private.recurring_arrivals_json(uuid, date, boolean) from public, anon, authenticated;
