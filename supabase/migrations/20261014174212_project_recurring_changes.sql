-- FLOW-441: a project's "income changed" row measured the payer, not the project.
--
-- recurring_changes groups a recurring party's lines company-wide. Its project_id is the party's
-- most common project, its transaction_id the party's latest line and its amounts the party's
-- totals, so a payer split across projects showed its whole change on one project and opened a
-- line headed by another. project_recurring_changes measures one project's own share instead:
-- each line counts for its amount when the line is the project's, or for its parts on the project
-- when it is split (a part with no project keeps the line's). The party is still found recurring
-- company-wide (private.recurring_parties); only the amounts, the percent and the line it opens
-- are the project's. Home keeps recurring_changes as it is.

begin;

set local lock_timeout = '5s';

-- The project's share of each of a recurring party's lines, signed like amount_net.
create function private.project_recurring_arrivals(p_company uuid, p_project uuid, p_today date)
returns table (
  direction public.txn_direction,
  party_id uuid,
  currency text,
  amount_minor bigint,
  typical_amount_minor bigint,
  change_percent integer,
  typical_day integer,
  transaction_id uuid,
  line_count integer,
  category_id uuid,
  source text,
  pace text
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today) - interval '6 months')::date as window6,
      (date_trunc('month', p_today) - interval '24 months')::date as window24
  ),
  r as (
    select rp.* from private.recurring_parties(p_company, p_today) rp
    where rp.seen_this_month and rp.months_seen > 0
  ),
  shares as (
    select r.direction, r.party_id, r.currency, r.pace, t.id, t.doc_date, t.created_at,
      date_trunc('month', t.doc_date)::date as month, t.line_status = 'posted' as posted,
      case
        when exists (select 1 from public.line_splits s where s.company_id = p_company and s.transaction_id = t.id)
          then sign(t.amount_net)::bigint * (
            select coalesce(sum(s.amount_minor), 0) from public.line_splits s
            where s.company_id = p_company and s.transaction_id = t.id
              and coalesce(s.project_id, t.project_id) = p_project)
        when t.project_id = p_project then t.amount_net::bigint
        else 0
      end as share
    from r
    cross join bounds b
    join public.transactions t
      on t.company_id = p_company and t.direction = r.direction and t.currency = r.currency
      -- FLOW-430: a party answered "the same" counts as the recurring one.
      and r.party_id = private.recurring_party_of(p_company, t.direction,
        case when r.direction = 'expense' then t.supplier_id else t.customer_id end)
    where t.removed_at is null
      and t.line_status <> 'void'
      and (t.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
      and t.doc_date >= b.window24
      and t.doc_date <= p_today
  ),
  usual as (
    -- As recurring_parties: complete posted months, the last 6 for a monthly party, else 24.
    select m.direction, m.party_id, m.currency,
      percentile_disc(0.5) within group (order by abs(m.amount)) as amount
    from (
      select s.direction, s.party_id, s.currency, s.month, sum(s.share) as amount
      from shares s, bounds b
      where s.posted and s.month < b.this_month
        and s.month >= case when s.pace = 'month' then b.window6 else b.window24 end
      group by s.direction, s.party_id, s.currency, s.month
      having sum(s.share) <> 0
    ) m
    group by m.direction, m.party_id, m.currency
  ),
  this_month as (
    select s.direction, s.party_id, s.currency, sum(s.share)::bigint as amount, count(*)::integer as line_count,
      (array_agg(s.id order by s.doc_date desc, s.created_at desc))[1] as transaction_id
    from shares s, bounds b
    where s.share <> 0 and s.doc_date >= b.this_month
    group by s.direction, s.party_id, s.currency
  )
  select r.direction, r.party_id, r.currency, m.amount,
    ((case when r.direction = 'expense' then -1 else 1 end) * u.amount)::bigint,
    round((abs(m.amount) - u.amount) * 100.0 / u.amount)::integer,
    r.typical_day, m.transaction_id, m.line_count, r.category_id, r.source, r.pace
  from r
  join this_month m on m.direction = r.direction and m.party_id = r.party_id and m.currency = r.currency
  join usual u on u.direction = r.direction and u.party_id = r.party_id and u.currency = r.currency
  where m.amount <> 0 and u.amount <> 0;
$$;

revoke all on function private.project_recurring_arrivals(uuid, uuid, date) from public, anon, authenticated;

-- A project's changes, in recurring_changes' shape: 20% or more either way, less what the caller
-- dismissed (the same key as Home's, the line's id), largest change first. Null when the project
-- is not the caller's company's.
create function public.project_recurring_changes(p_project uuid, p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  today date;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_project is null then
    raise exception 'validation';
  end if;
  if not exists (select 1 from public.projects pr where pr.id = p_project and pr.company_id = cid) then
    return null;
  end if;
  today := coalesce(p_today, private.flow_today());
  return (
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
        'changed', true,
        'typical_day', a.typical_day,
        'transaction_id', a.transaction_id,
        'project_id', p_project,
        'project_name', p.name,
        'category_id', a.category_id,
        'category_name', c.name,
        'source', a.source,
        'pace', a.pace,
        'alert_key', a.transaction_id::text,
        'line_count', a.line_count
      ) order by abs(a.change_percent) desc, a.direction = 'income', coalesce(s.name, cu.name), a.party_id), '[]'::jsonb)
    from private.project_recurring_arrivals(cid, p_project, today) a
    left join public.suppliers s on a.direction = 'expense' and s.company_id = cid and s.id = a.party_id
    left join public.customers cu on a.direction = 'income' and cu.company_id = cid and cu.id = a.party_id
    left join public.projects p on p.company_id = cid and p.id = p_project
    left join public.categories c on c.company_id = cid and c.id = a.category_id
    where coalesce(s.id, cu.id) is not null
      and abs(abs(a.amount_minor) - abs(a.typical_amount_minor)) * 5 >= abs(a.typical_amount_minor)
      and not exists (
        select 1 from public.recurring_dismissals x
        where x.user_id = auth.uid() and x.company_id = cid and x.kind = 'change'
          and x.alert_key = a.transaction_id::text
      )
  );
end;
$$;

revoke all on function public.project_recurring_changes(uuid, date) from public, anon;
grant execute on function public.project_recurring_changes(uuid, date) to authenticated, service_role;

comment on function public.project_recurring_changes(uuid, date) is
  'FLOW-441. recurring_changes for one project: each recurring party''s share on the project (split parts counted), this month against its usual, 20% or more either way, less the caller''s dismissals.';

commit;
