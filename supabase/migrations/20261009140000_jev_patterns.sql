-- FLOW-701 part 4 (Jev phase 1). Decision 0130.
-- SQL finds the patterns; Jev does not compute numbers (decision 0084).
-- 1. Anomaly candidates on a line: a likely duplicate, an amount far above what the same
--    supplier or customer usually bills, or a large first line from a new one. The review card
--    flags them (no new screen). Scoring candidates with Jev is a later step.
-- 2. Recurring suppliers and customers: seen in at least 3 of the last 6 complete months and in
--    one of the last 2. They feed missing-bill notices (a recurring supplier with no line this
--    month after its usual day) and expected future months.
-- Amounts are amount_net in the line's currency (minor units), grouped by currency.
-- Amounts and history read posted lines only (a pending line is in no total, decision 0086);
-- a pending line still counts as this month's bill and can be flagged. Income reads the
-- invoiced basis (invoice, credit, invoice_receipt), so an invoice and its receipt count once.
-- "Today" is Asia/Jerusalem. All reads are the caller's company (private.readable_company_id).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function private.flow_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Jerusalem')::date;
$$;

-- Live lines: not removed, not void.
-- One row per supplier (expense) or customer (income) and currency that recurs as of p_today.
create or replace function private.recurring_parties(p_company uuid, p_today date)
returns table (
  direction public.txn_direction,
  party_id uuid,
  currency text,
  months_seen integer,
  typical_day integer,
  typical_amount_minor bigint,
  last_doc_date date,
  seen_this_month boolean,
  project_id uuid,
  category_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today) - interval '6 months')::date as window_start
  ),
  lines as (
    select t.direction, coalesce(t.supplier_id, t.customer_id) as party_id, t.currency,
      t.doc_date, t.amount_net, t.project_id, t.category_id,
      date_trunc('month', t.doc_date)::date as month, t.line_status = 'posted' as posted
    from public.transactions t, bounds b
    where t.company_id = p_company
      and t.removed_at is null
      and t.line_status <> 'void'
      and ((t.direction = 'expense' and t.supplier_id is not null)
        or (t.direction = 'income' and t.customer_id is not null
          and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')))
      and t.doc_date >= b.window_start
      and t.doc_date <= p_today
  ),
  monthly as (
    select l.direction, l.party_id, l.currency, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l, bounds b
    where l.month < b.this_month and l.posted
    group by l.direction, l.party_id, l.currency, l.month
  ),
  parties as (
    select m.direction, m.party_id, m.currency,
      count(*)::integer as months_seen,
      bool_or(m.month >= (b.this_month - interval '2 months')::date) as recent,
      percentile_disc(0.5) within group (order by m.first_day)::integer as typical_day,
      -- The median by size, with the direction's sign, so an even count does not lean one way.
      ((case when m.direction = 'expense' then -1 else 1 end)
        * percentile_disc(0.5) within group (order by abs(m.amount)))::bigint as typical_amount_minor
    from monthly m, bounds b
    group by m.direction, m.party_id, m.currency
  )
  select p.direction, p.party_id, p.currency, p.months_seen, p.typical_day, p.typical_amount_minor,
    (select max(l.doc_date) from lines l
     where l.posted and l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency),
    exists (
      select 1 from lines l, bounds b
      where l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
        and l.month = b.this_month
    ),
    (select l.project_id from lines l
     where l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
       and l.project_id is not null
     group by l.project_id order by count(*) desc, max(l.doc_date) desc limit 1),
    (select l.category_id from lines l
     where l.direction = p.direction and l.party_id = p.party_id and l.currency = p.currency
       and l.category_id is not null
     group by l.category_id order by count(*) desc, max(l.doc_date) desc limit 1)
  from parties p
  where p.months_seen >= 3 and p.recent;
$$;

-- Anomaly candidates for the given lines of one company.
create or replace function private.line_anomalies(p_company uuid, p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select t.id, t.direction, coalesce(t.supplier_id, t.customer_id) as party_id, t.currency,
      t.doc_date, t.amount_net, t.amount_gross, t.doc_kind, t.external_id, t.linked_external_id
    from public.transactions t
    where t.company_id = p_company
      and t.id = any (p_ids)
      and t.removed_at is null
      and t.line_status <> 'void'
  ),
  -- The company's 90th percentile posted line, per direction and currency, over the year up to
  -- the newest target line. Materialized, so it is read once and not per line.
  p90 as materialized (
    select c.direction, c.currency,
      percentile_disc(0.9) within group (order by abs(c.amount_net)) as amount
    from public.transactions c
    where c.company_id = p_company
      and c.removed_at is null and c.line_status = 'posted'
      and (c.direction = 'expense' or c.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and c.doc_date >= (select max(doc_date) from target) - 365
      and c.doc_date <= (select max(doc_date) from target)
      and (c.direction, c.currency) in (select direction, currency from target)
    group by c.direction, c.currency
    having count(*) >= 20
  ),
  duplicate as (
    select tg.id, 'duplicate' as kind, jsonb_build_object(
        'other_transaction_id', d.id,
        'other_doc_date', d.doc_date
      ) as detail
    from target tg
    cross join lateral (
      select o.id, o.doc_date
      from public.transactions o
      where o.company_id = p_company
        and o.id <> tg.id
        and o.direction = tg.direction
        and coalesce(o.supplier_id, o.customer_id) = tg.party_id
        and o.currency = tg.currency
        and o.amount_gross = tg.amount_gross
        and o.doc_kind = tg.doc_kind
        and o.removed_at is null
        and o.line_status = 'posted'
        and o.doc_date between tg.doc_date - 7 and tg.doc_date + 7
        -- Not a document and the one it links to.
        and coalesce(o.linked_external_id <> tg.external_id, true)
        and coalesce(tg.linked_external_id <> o.external_id, true)
        -- Not an invoice that a credit note cancels (cancelled and issued again).
        and not exists (
          select 1 from public.transactions cr
          where cr.company_id = p_company and cr.doc_kind = 'credit' and cr.removed_at is null
            and cr.linked_external_id is not null
            and cr.linked_external_id in (o.external_id, tg.external_id)
        )
        -- Not two loans' payments to the same lender.
        and not exists (
          select 1 from public.loan_splits a
          join public.loan_splits b on b.company_id = a.company_id and b.loan_id <> a.loan_id
          where a.company_id = p_company and a.transaction_id = tg.id and b.transaction_id = o.id
        )
      order by abs(o.doc_date - tg.doc_date), o.id
      limit 1
    ) d
    where tg.party_id is not null and tg.amount_gross <> 0
  ),
  history as (
    select tg.id, tg.amount_net,
      (select count(*) from public.transactions h
       where h.company_id = p_company and h.id <> tg.id and h.direction = tg.direction
         and coalesce(h.supplier_id, h.customer_id) = tg.party_id and h.currency = tg.currency
         and h.removed_at is null and h.line_status = 'posted'
         and (h.direction = 'expense' or h.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
         and h.doc_date < tg.doc_date) as earlier,
      (select percentile_disc(0.5) within group (order by abs(h.amount_net))
       from (
         select h.amount_net from public.transactions h
         where h.company_id = p_company and h.id <> tg.id and h.direction = tg.direction
           and coalesce(h.supplier_id, h.customer_id) = tg.party_id and h.currency = tg.currency
           and h.removed_at is null and h.line_status = 'posted'
           and (h.direction = 'expense' or h.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
           and h.doc_date < tg.doc_date and h.doc_date >= tg.doc_date - 365
         order by h.doc_date desc limit 12
       ) h) as typical,
      (select count(*) from public.transactions h
       where h.company_id = p_company and h.id <> tg.id and h.direction = tg.direction
         and coalesce(h.supplier_id, h.customer_id) = tg.party_id and h.currency = tg.currency
         and h.removed_at is null and h.line_status = 'posted'
         and (h.direction = 'expense' or h.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
         and h.doc_date < tg.doc_date and h.doc_date >= tg.doc_date - 365) as recent,
      (select p.amount from p90 p
       where p.direction = tg.direction and p.currency = tg.currency) as company_p90
    from target tg
    where tg.party_id is not null
  ),
  spike as (
    select h.id, 'amount_spike' as kind, jsonb_build_object(
        'typical_amount_minor', h.typical,
        'ratio', round(abs(h.amount_net)::numeric / h.typical, 1)
      ) as detail
    from history h
    where h.recent >= 3
      and h.typical > 0
      and abs(h.amount_net) >= 3 * h.typical
      and abs(h.amount_net) - h.typical >= 10000
  ),
  new_party as (
    select h.id, 'new_party_large' as kind, jsonb_build_object(
        'company_p90_minor', h.company_p90
      ) as detail
    from history h
    where h.earlier = 0
      and h.company_p90 is not null
      and abs(h.amount_net) >= h.company_p90
      and abs(h.amount_net) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object('transaction_id', a.id, 'kind', a.kind) || a.detail
    order by a.id, a.kind), '[]'::jsonb)
  from (
    select * from duplicate
    union all select * from spike
    union all select * from new_party
  ) a;
$$;

-- The party lookups in line_anomalies (per line: earlier lines, the last 12, the year before).
create index if not exists transactions_party_date_idx
  on public.transactions (company_id, (coalesce(supplier_id, customer_id)), doc_date)
  where removed_at is null;

revoke all on function private.flow_today() from public, anon, authenticated;
revoke all on function private.recurring_parties(uuid, date) from public, anon, authenticated;
revoke all on function private.line_anomalies(uuid, uuid[]) from public, anon, authenticated;

-- The review card: flags for the lines on screen (at most 500 ids).
create or replace function public.review_anomalies(p_transaction_ids uuid[])
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
  if coalesce(cardinality(p_transaction_ids), 0) > 500 then
    raise exception 'validation';
  end if;
  return private.line_anomalies(cid, coalesce(p_transaction_ids, array[]::uuid[]));
end;
$$;

-- MCP get_anomalies: flags on the open review lines, newest 500.
create or replace function public.mcp_review_anomalies()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  ids uuid[];
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(array_agg(x.id), array[]::uuid[]) into ids
  from (
    select t.id from public.transactions t
    where t.company_id = cid and t.removed_at is null
      and (
        select q.status from public.review_queue q
        where q.company_id = t.company_id and q.transaction_id = t.id
        order by q.created_at desc, q.updated_at desc, q.id desc
        limit 1
      ) = 'open'
    order by t.doc_date desc, t.id desc
    limit 500
  ) x;
  return jsonb_build_object('anomalies', private.line_anomalies(cid, ids));
end;
$$;

-- Missing bills: recurring suppliers with no expense line this month, past their usual day
-- plus 5 days (or the month's last day).
create or replace function public.missing_bills(p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  last_day integer := extract(day from (date_trunc('month', today) + interval '1 month - 1 day'))::integer;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'supplier_id', r.party_id,
        'supplier_name', s.name,
        'currency', r.currency,
        'typical_amount_minor', r.typical_amount_minor,
        'typical_day', r.typical_day,
        'expected_by', make_date(extract(year from today)::integer, extract(month from today)::integer,
          least(r.typical_day + 5, last_day)),
        'months_seen', r.months_seen,
        'last_doc_date', r.last_doc_date,
        'project_id', r.project_id,
        'category_id', r.category_id
      ) order by r.typical_day, s.name, r.party_id), '[]'::jsonb)
    from private.recurring_parties(cid, today) r
    join public.suppliers s on s.company_id = cid and s.id = r.party_id
    where r.direction = 'expense'
      and not r.seen_this_month
      -- A deadline past the month's end falls on its last day.
      and (extract(day from today)::integer > r.typical_day + 5
        or (r.typical_day + 5 >= last_day and extract(day from today)::integer = last_day))
  );
end;
$$;

-- Expected months: this month (the recurring lines not seen yet) and the next ones, from the
-- recurring parties' typical monthly amounts. One project's when p_project_id is given
-- (a party counts for its most common project).
create or replace function public.expected_months(
  p_months integer default 3,
  p_project_id uuid default null,
  p_today date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_months is null or p_months < 1 or p_months > 12 then
    raise exception 'validation';
  end if;
  return (
    with r as (
      select * from private.recurring_parties(cid, today) rp
      where p_project_id is null or rp.project_id = p_project_id
    ),
    months as (
      select n, (date_trunc('month', today) + make_interval(months => n))::date as month
      from generate_series(0, p_months - 1) n
    ),
    cells as (
      select m.month, r.currency, r.direction, r.typical_amount_minor as amount
      from months m
      join r on m.n > 0 or not r.seen_this_month
    ),
    per_month as (
      select m.month,
        coalesce((
          select jsonb_agg(jsonb_build_object(
              'currency', c.currency,
              'income_minor', c.income,
              'expense_minor', c.expense
            ) order by c.currency <> 'ILS', c.currency)
          from (
            select cl.currency,
              coalesce(sum(cl.amount) filter (where cl.direction = 'income'), 0)::bigint as income,
              coalesce(sum(cl.amount) filter (where cl.direction = 'expense'), 0)::bigint as expense
            from cells cl where cl.month = m.month
            group by cl.currency
          ) c
        ), '[]'::jsonb) as by_currency
      from months m
    )
    select jsonb_build_object(
      'today', today,
      'project_id', p_project_id,
      'months', (select jsonb_agg(jsonb_build_object(
          'month', to_char(pm.month, 'YYYY-MM'),
          'open', pm.month = date_trunc('month', today)::date,
          'by_currency', pm.by_currency
        ) order by pm.month) from per_month pm),
      'recurring', coalesce((select jsonb_agg(jsonb_build_object(
          'direction', r.direction,
          'party_id', r.party_id,
          'name', coalesce(s.name, cu.name),
          'currency', r.currency,
          'typical_amount_minor', r.typical_amount_minor,
          'typical_day', r.typical_day,
          'months_seen', r.months_seen,
          'seen_this_month', r.seen_this_month,
          'project_id', r.project_id,
          'category_id', r.category_id
        ) order by r.direction, coalesce(s.name, cu.name), r.party_id)
        from r
        left join public.suppliers s on r.direction = 'expense' and s.company_id = cid and s.id = r.party_id
        left join public.customers cu on r.direction = 'income' and cu.company_id = cid and cu.id = r.party_id
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.review_anomalies(uuid[]) from public, anon;
revoke all on function public.mcp_review_anomalies() from public, anon;
revoke all on function public.missing_bills(date) from public, anon;
revoke all on function public.expected_months(integer, uuid, date) from public, anon;
grant execute on function public.review_anomalies(uuid[]) to authenticated, service_role;
grant execute on function public.mcp_review_anomalies() to authenticated, service_role;
grant execute on function public.missing_bills(date) to authenticated, service_role;
grant execute on function public.expected_months(integer, uuid, date) to authenticated, service_role;

commit;
