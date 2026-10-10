-- FLOW-431 follow-up (decision 0178, point 5): party_charges compares a line with the party's charges
-- in the same context, not with all of them. A supplier holding two loans showed one loan's payment
-- 110% over a usual amount that summed both. The context is the line's loan when it pays one, else
-- its project and category. The months, the charges and the count read the same context. The recurring
-- rule's usual amount is used only when every charge of the party is in that context; otherwise
-- the usual amount is the median of the context's earlier complete months, as before.

begin;

set local lock_timeout = '5s';

create or replace function private.party_charges_json(p_company uuid, p_transaction_id uuid, p_today date)
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
  -- The line's own context: its loan when it pays one, else its project and category, so a supplier
  -- with two loans (or two projects) compares this one with its own earlier charges.
  scope as (
    select t.project_id, t.category_id,
      (select ls.loan_id from public.loan_splits ls where ls.transaction_id = t.id limit 1) as loan_id
    from line l
    join public.transactions t on t.id = l.id
  ),
  party_lines as (
    select t.id, t.doc_date, t.amount_net as amount, t.line_status = 'posted' as posted, t.created_at,
      date_trunc('month', t.doc_date)::date as month,
      case
        when s.loan_id is not null then exists (
          select 1 from public.loan_splits ls where ls.transaction_id = t.id and ls.loan_id = s.loan_id
        )
        else t.project_id is not distinct from s.project_id and t.category_id is not distinct from s.category_id
          and not exists (select 1 from public.loan_splits ls where ls.transaction_id = t.id)
      end as in_scope
    from party p
    cross join scope s
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
  lines as (
    select pl.id, pl.doc_date, pl.amount, pl.posted, pl.created_at, pl.month from party_lines pl where pl.in_scope
  ),
  recurring as (
    select r.typical_amount_minor as usual
    from party p, private.recurring_parties(p_company, p.as_of) r
    where r.direction = p.direction and r.party_id = p.party_id and r.currency = p.currency
      and r.typical_amount_minor <> 0
      -- As in recurring_arrivals: a party marked recurring with no complete month yet has no usual.
      and r.months_seen > 0
      -- The rule's usual is the whole party's; it stands for this context only when every one of the
      -- party's charges is in it.
      and not exists (select 1 from party_lines pl where not pl.in_scope)
  ),
  -- Otherwise: the median of the context's earlier complete months, at least 2 of the last 6.
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

comment on function public.party_charges(uuid, date) is
  'FLOW-431. A line''s earlier charges from its supplier or customer in its currency and context (its loan, else its project and category): the month against the usual amount, 6 months'' totals and the 12 newest charges. Decision 0178.';

commit;
