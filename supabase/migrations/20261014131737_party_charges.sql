-- FLOW-431 (decision 0178): a line's earlier charges from the same supplier (expense) or customer
-- (income) in the same currency, for the transaction screen's "לעומת הרגיל" chip and its sheet.
-- - public.party_charges(p_id, p_today): the line's party, its month's total against the usual
--   amount (the recurring rule's usual when the party recurs with a complete month, else the median
--   of its earlier complete months, at least 2 of the last 6), the 6 months up to the line's month
--   and the 12 newest charges up to it. No percent for a line the rule does not count (an income
--   receipt), or a month that went the other way (a refund).
-- Lines are counted as in private.recurring_parties: not removed, not void, and for income only
-- invoices, credits and invoice-receipts. "Today" is Asia/Jerusalem. All reads are the caller's company.

begin;

set local lock_timeout = '5s';

create function private.party_charges_json(p_company uuid, p_transaction_id uuid, p_today date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with line as (
    select t.id, t.amount_net, t.doc_date, date_trunc('month', t.doc_date)::date as anchor
    from public.transactions t
    where t.id = p_transaction_id and t.company_id = p_company and t.removed_at is null
  ),
  party as (
    select pp.direction, pp.party_id, pp.currency, pp.name, l.anchor,
      -- The usual amount as of the line's own month: this month's line reads today's usual.
      least(p_today, (l.anchor + interval '1 month' - interval '1 day')::date) as as_of
    from line l, private.payment_party(p_company, p_transaction_id) pp
  ),
  lines as (
    select t.id, t.doc_date, t.amount_net as amount, t.line_status = 'posted' as posted, t.created_at,
      date_trunc('month', t.doc_date)::date as month
    from party p
    join public.transactions t
      on t.company_id = p_company and t.direction = p.direction and t.currency = p.currency
      and p.party_id = case when p.direction = 'expense' then t.supplier_id else t.customer_id end
    where t.removed_at is null
      and t.line_status <> 'void'
      and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and t.doc_date >= (p.anchor - interval '24 months')::date
      -- A line dated after today still reads its own month.
      and t.doc_date <= greatest(p_today, p.anchor + interval '1 month' - interval '1 day')
  ),
  recurring as (
    select r.typical_amount_minor as usual
    from party p, private.recurring_parties(p_company, p.as_of) r
    where r.direction = p.direction and r.party_id = p.party_id and r.currency = p.currency
      and r.typical_amount_minor <> 0
      -- As in recurring_arrivals: a party marked recurring with no complete month yet has no usual.
      and r.months_seen > 0
  ),
  -- Not a recurring party: the median of its earlier complete months, at least 2 of the last 6.
  earlier as (
    select ((case when p.direction = 'expense' then -1 else 1 end)
        * percentile_disc(0.5) within group (order by abs(m.amount)))::bigint as usual
    from party p, (
      select l.month, sum(l.amount) as amount
      from lines l, party p
      where l.posted and l.month >= (p.anchor - interval '6 months')::date and l.month < p.anchor
      group by l.month
    ) m
    group by p.direction
    having count(*) >= 2
  ),
  usual as (
    select coalesce((select r.usual from recurring r), (select nullif(e.usual, 0) from earlier e)) as amount,
      case
        when exists (select 1 from recurring) then 'recurring'
        when exists (select 1 from earlier e where e.usual <> 0) then 'earlier_months'
      end as source
  ),
  month_total as (
    select (select sum(l.amount)::bigint from lines l, party p where l.month = p.anchor) as amount,
      -- An income receipt is not one of the counted lines (its invoice is), so it gets no comparison.
      exists (select 1 from lines l where l.id = p_transaction_id) as counted
  ),
  -- The percent only when the month and the usual amount go the same way (a refund month gets none)
  -- and it fits a readable figure.
  change as (
    select case
      when u.amount is null or not mt.counted or mt.amount is null or sign(mt.amount) <> sign(u.amount) then null
      else round((abs(mt.amount) - abs(u.amount)) * 100.0 / abs(u.amount))
    end as percent
    from usual u, month_total mt
  )
  select case
    when not exists (select 1 from line) then null
    when not exists (select 1 from party) then jsonb_build_object(
      'transaction_id', p_transaction_id, 'party', null, 'month', null, 'month_amount_minor', null,
      'typical_amount_minor', null, 'typical_source', null, 'change_percent', null,
      'others', 0, 'months', '[]'::jsonb, 'charges', '[]'::jsonb
    )
    else (
      select jsonb_build_object(
        'transaction_id', p_transaction_id,
        'party', jsonb_build_object('direction', p.direction, 'id', p.party_id, 'name', p.name, 'currency', p.currency),
        'month', to_char(p.anchor, 'YYYY-MM'),
        'month_amount_minor', mt.amount,
        'typical_amount_minor', u.amount,
        'typical_source', u.source,
        'change_percent', case when abs(c.percent) < 100000 then c.percent::integer end,
        'others', (select count(*) from lines l where l.id <> p_transaction_id),
        'months', (
          select jsonb_agg(jsonb_build_object(
              'month', to_char(g.month, 'YYYY-MM'),
              'amount_minor', coalesce((select sum(l.amount)::bigint from lines l where l.month = g.month::date), 0)
            ) order by g.month)
          from generate_series(p.anchor - interval '5 months', p.anchor, interval '1 month') g(month)
        ),
        'charges', coalesce((
          select jsonb_agg(jsonb_build_object(
              'id', c.id, 'doc_date', c.doc_date, 'amount_minor', c.amount, 'pending', not c.posted
            ) order by c.doc_date desc, c.created_at desc)
          -- The 12 newest up to the line's month, so an older line sits among its own neighbours.
          from (
            select * from lines l where l.month <= p.anchor order by l.doc_date desc, l.created_at desc limit 12
          ) c
        ), '[]'::jsonb)
      )
      from party p, usual u, month_total mt, change c
    )
  end;
$$;

revoke all on function private.party_charges_json(uuid, uuid, date) from public, anon, authenticated;

create function public.party_charges(p_id uuid, p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  result := private.party_charges_json(cid, p_id, coalesce(p_today, private.flow_today()));
  if result is null then
    raise exception 'transaction not found';
  end if;
  return result;
end;
$$;

comment on function public.party_charges(uuid, date) is
  'FLOW-431. A line''s earlier charges from its supplier or customer in its currency: the month against the usual amount, 6 months'' totals and the 12 newest charges. Decision 0178.';

revoke all on function public.party_charges(uuid, date) from public, anon;
grant execute on function public.party_charges(uuid, date) to authenticated, service_role;

commit;
