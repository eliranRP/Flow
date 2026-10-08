-- FLOW-701 part 5 (Jev phase 1). Decision 0134.
-- 1. Income lines: the jev-tag job also sends open income lines (a project and an income
--    category), so the party history below covers customers too. Auto mode does not pre-fill
--    income; the suggestion shows on the card like any other.
-- 2. Reasons: jev_suggestions says, from SQL, why a suggestion looks right: it matches the
--    party's last filed line, or most of its recent ones, or the party is new, or neither.
-- 3. Scores on flagged lines: when the SQL check flags a line, the same Jev call also asks how
--    likely the flag is a real problem (answers.anomaly, a noul). No extra call. The flags
--    carry that score as jev_score.
-- 4. #160 review follow-ups: a voided credit note no longer hides a duplicate; an income
--    receipt is not compared with single invoices for a spike or a new customer; the MCP pick
--    of open lines starts from the open review rows.
-- Jev never approves a line and computes no number (decision 0084).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

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
            and cr.line_status <> 'void'
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
      -- A receipt that pays several invoices is not compared with single invoices.
      and (tg.direction = 'expense' or tg.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
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

-- The newest suggestion of each line, read as ids and a score. Invalid answers read as null.
create or replace function private.jev_suggestion_rows(p_company uuid, p_ids uuid[])
returns table (
  transaction_id uuid,
  project_id uuid,
  category_id uuid,
  confidence numeric,
  anomaly_score numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.transaction_id,
    private.jev_uuid_or_null(s.answers->'project'->>'choice'),
    private.jev_uuid_or_null(s.answers->'category'->>'choice'),
    s.confidence,
    case
      when jsonb_typeof(s.answers->'anomaly'->'noul') = 'number'
       and (s.answers->'anomaly'->>'noul')::numeric between 0 and 1
      then round((s.answers->'anomaly'->>'noul')::numeric, 3)
    end
  from (
    select distinct on (ts.transaction_id) ts.transaction_id, ts.answers, ts.confidence
    from public.tag_suggestions ts
    where ts.company_id = p_company and ts.transaction_id = any (p_ids)
    order by ts.transaction_id, ts.created_at desc, ts.id desc
  ) s;
$$;

-- Flags with Jev's score when the line's Jev call scored them (null otherwise).
create or replace function private.flags_with_scores(p_company uuid, p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(f.flag || jsonb_build_object('jev_score', s.anomaly_score)
    order by f.n), '[]'::jsonb)
  from jsonb_array_elements(private.line_anomalies(p_company, p_ids)) with ordinality as f(flag, n)
  left join private.jev_suggestion_rows(p_company, p_ids) s
    on s.transaction_id = (f.flag->>'transaction_id')::uuid;
$$;

revoke all on function private.line_anomalies(uuid, uuid[]) from public, anon, authenticated;
revoke all on function private.jev_suggestion_rows(uuid, uuid[]) from public, anon, authenticated;
revoke all on function private.flags_with_scores(uuid, uuid[]) from public, anon, authenticated;

-- The review card: flags for the lines on screen (at most 500 ids), with jev_score.
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
  return private.flags_with_scores(cid, coalesce(p_transaction_ids, array[]::uuid[]));
end;
$$;

-- The open review lines, newest 500. Starts from the open review rows.
create or replace function private.open_review_ids(p_company uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(x.id order by x.doc_date desc, x.id desc), array[]::uuid[])
  from (
    select t.id, t.doc_date
    from public.review_queue q
    join public.transactions t on t.company_id = q.company_id and t.id = q.transaction_id
    where q.company_id = p_company and q.status = 'open' and t.removed_at is null
      and not exists (
        select 1 from public.review_queue n
        where n.company_id = q.company_id and n.transaction_id = q.transaction_id
          and (n.created_at, n.updated_at, n.id) > (q.created_at, q.updated_at, q.id)
      )
    order by t.doc_date desc, t.id desc
    limit 500
  ) x;
$$;

revoke all on function private.open_review_ids(uuid) from public, anon, authenticated;

-- MCP get_anomalies: flags on the open review lines, newest 500, with jev_score.
create or replace function public.mcp_review_anomalies()
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
  return jsonb_build_object('anomalies', private.flags_with_scores(cid, private.open_review_ids(cid)));
end;
$$;

-- jev-tag: the flags of the lines in a run, so the Jev call can score them. Service role only.
create or replace function public.jev_line_flags(p_company uuid, p_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_company is null or coalesce(cardinality(p_ids), 0) > 500 then
    raise exception 'validation';
  end if;
  return private.line_anomalies(p_company, coalesce(p_ids, array[]::uuid[]));
end;
$$;

-- How the owner filed a party before (decision 0127), now for customers too: p_suppliers holds
-- supplier or customer ids, and supplier_id in the result is that party id. p_per lines per
-- party and direction, each with its direction.
create or replace function public.jev_supplier_history(
  p_company uuid,
  p_suppliers uuid[],
  p_per integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_company is null or p_per is null or p_per < 1 or p_per > 20
     or coalesce(cardinality(p_suppliers), 0) > 500 then
    raise exception 'validation';
  end if;

  with latest as (
    -- The current (newest) review row of each line of these parties, read once.
    select distinct on (q.transaction_id) q.transaction_id, q.status
    from public.review_queue q
    join public.transactions t on t.company_id = q.company_id and t.id = q.transaction_id
    where q.company_id = p_company
      and coalesce(t.supplier_id, t.customer_id) = any (p_suppliers)
    order by q.transaction_id, q.created_at desc, q.updated_at desc, q.id desc
  ),
  filed as (
    select coalesce(t.supplier_id, t.customer_id) as party_id, t.id, t.direction, t.doc_date,
      t.description, t.amount_net, t.project_id, t.category_id, t.pnl_role,
      exists (
        select 1 from public.line_splits ls
        where ls.company_id = t.company_id and ls.transaction_id = t.id
      ) as split,
      (select count(*) from public.allocations a
       where a.company_id = t.company_id and a.transaction_id = t.id) as allocation_count,
      row_number() over (
        partition by coalesce(t.supplier_id, t.customer_id), t.direction order by t.doc_date desc, t.id desc
      ) as n
    from public.transactions t
    join latest l on l.transaction_id = t.id and l.status in ('approved', 'changed')
    where t.company_id = p_company
      and coalesce(t.supplier_id, t.customer_id) = any (p_suppliers)
      and t.removed_at is null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'supplier_id', f.party_id,
      'direction', f.direction,
      'doc_date', f.doc_date,
      'description', left(coalesce(f.description, ''), 120),
      'amount_net', f.amount_net,
      'project_id', f.project_id,
      'category_id', f.category_id,
      'pnl_role', f.pnl_role,
      'split', f.split or f.allocation_count > 1
    ) order by f.party_id, f.direction, f.n), '[]'::jsonb)
  into result
  from filed f
  where f.n <= p_per;
  return result;
end;
$$;

-- Open lines the job would send now, income included. The pin matches JEV_MODEL in jev.ts.
create or replace function private.jev_has_work()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_integrations ci
    join public.transactions t
      on t.company_id = ci.company_id
     and t.removed_at is null
    join public.review_queue q
      on q.company_id = t.company_id
     and q.transaction_id = t.id
     and q.status = 'open'
    where ci.provider = 'jev'
      and ci.enabled
      and ci.mode in ('shadow', 'auto')
      and ci.daily_call_cap > private.jev_calls_today(ci.company_id)
      and not exists (
        select 1 from public.tag_suggestions s
        where s.transaction_id = t.id and s.model_version = 'jev-1.13.0'
      )
      and not exists (
        select 1 from public.jev_line_failures f
        where f.transaction_id = t.id
          and f.model_version = 'jev-1.13.0'
          and f.retry_after > now()
      )
  );
$$;

revoke all on function private.jev_has_work() from public, anon, authenticated;

-- MCP get_jev_status. lines_without_suggestion now counts open income lines too.
create or replace function public.mcp_jev_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  integration public.company_integrations%rowtype;
  last_run timestamptz;
  waiting integer;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into integration
  from public.company_integrations ci
  where ci.company_id = cid and ci.provider = 'jev';
  select max(coalesce(u.finished_at, u.started_at)) into last_run
  from public.jev_usage u
  where u.company_id = cid;
  select count(*)::integer into waiting
  from public.transactions t
  join public.review_queue q
    on q.company_id = t.company_id
   and q.transaction_id = t.id
   and q.status = 'open'
  where t.company_id = cid
    and t.removed_at is null
    and not exists (
      select 1 from public.tag_suggestions s
      where s.transaction_id = t.id and s.model_version = 'jev-1.13.0'
    );
  return jsonb_build_object(
    'enabled', coalesce(integration.enabled, false)
      and coalesce(integration.mode, 'off') in ('shadow', 'auto'),
    'mode', coalesce(integration.mode, 'off'),
    'threshold', coalesce(integration.threshold, 0.90),
    'daily_call_cap', coalesce(integration.daily_call_cap, 200),
    'calls_today', private.jev_calls_today(cid),
    'last_run_at', last_run,
    'lines_without_suggestion', waiting
  );
end;
$$;

-- Jev's suggestions for some lines, each with a reason from SQL:
--   same_as_last     the answered fields equal the party's last filed line
--   usual_for_party  they equal at least 2 of its last 5 filed lines
--   new_party        no filed line of this party yet (or the line has no party)
--   model_only       none of the above: Jev's own call
-- party_filings and matching_filings are the counts behind it. Names are the current ones.
create or replace function private.jev_suggestions_for(p_company uuid, p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select r.*, t.direction, coalesce(t.supplier_id, t.customer_id) as party_id
    from private.jev_suggestion_rows(p_company, p_ids) r
    join public.transactions t on t.company_id = p_company and t.id = r.transaction_id
    where r.project_id is not null or r.category_id is not null
  ),
  parties as (
    select distinct s.party_id, s.direction from s where s.party_id is not null
  ),
  candidates as (
    select t.id, coalesce(t.supplier_id, t.customer_id) as party_id, t.direction, t.doc_date,
      t.project_id, t.category_id
    from public.transactions t
    join parties p on p.party_id = coalesce(t.supplier_id, t.customer_id) and p.direction = t.direction
    where t.company_id = p_company and t.removed_at is null
  ),
  -- The current (newest) review row of each candidate, read once.
  latest as (
    select distinct on (q.transaction_id) q.transaction_id, q.status
    from public.review_queue q
    join candidates c on c.id = q.transaction_id
    where q.company_id = p_company
    order by q.transaction_id, q.created_at desc, q.updated_at desc, q.id desc
  ),
  -- The last 6 filed lines per party and direction: 5 once the line itself is left out.
  recent as (
    select r.* from (
      select c.*, row_number() over (
          partition by c.party_id, c.direction order by c.doc_date desc, c.id desc
        ) as rank
      from candidates c
      join latest l on l.transaction_id = c.id and l.status in ('approved', 'changed')
    ) r
    where r.rank <= 6
  ),
  filings as (
    select f.* from (
      select s.transaction_id, r.project_id, r.category_id,
        row_number() over (partition by s.transaction_id order by r.doc_date desc, r.id desc) as n
      from s
      join recent r on r.party_id = s.party_id and r.direction = s.direction and r.id <> s.transaction_id
    ) f
    where f.n <= 5
  ),
  counted as (
    select s.transaction_id,
      count(f.n) as party_filings,
      count(f.n) filter (
        where (s.project_id is null or f.project_id = s.project_id)
          and (s.category_id is null or f.category_id = s.category_id)
      ) as matching_filings,
      bool_or(f.n = 1
        and (s.project_id is null or f.project_id = s.project_id)
        and (s.category_id is null or f.category_id = s.category_id)) as last_matches
    from s
    left join filings f on f.transaction_id = s.transaction_id
    group by s.transaction_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'transaction_id', s.transaction_id,
      'direction', s.direction,
      'project_id', s.project_id,
      'project_name', p.name,
      'category_id', s.category_id,
      'category_name', c.name,
      'confidence', s.confidence,
      'reason', case
        when c2.party_filings = 0 then 'new_party'
        when coalesce(c2.last_matches, false) then 'same_as_last'
        when c2.matching_filings >= 2 then 'usual_for_party'
        else 'model_only'
      end,
      'party_filings', c2.party_filings,
      'matching_filings', c2.matching_filings,
      'anomaly_score', s.anomaly_score
    ) order by s.transaction_id), '[]'::jsonb)
  from s
  join counted c2 on c2.transaction_id = s.transaction_id
  left join public.projects p on p.company_id = p_company and p.id = s.project_id
  left join public.categories c on c.company_id = p_company and c.id = s.category_id;
$$;

revoke all on function private.jev_suggestions_for(uuid, uuid[]) from public, anon, authenticated;

-- The review card: Jev's suggestions with reasons for the lines on screen (at most 500 ids).
create or replace function public.jev_suggestions(p_transaction_ids uuid[])
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
  return private.jev_suggestions_for(cid, coalesce(p_transaction_ids, array[]::uuid[]));
end;
$$;

-- MCP get_jev_suggestions: the open review lines (newest 500) that have a Jev suggestion.
create or replace function public.mcp_jev_suggestions()
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
  return jsonb_build_object('suggestions', private.jev_suggestions_for(cid, private.open_review_ids(cid)));
end;
$$;

revoke all on function public.review_anomalies(uuid[]) from public, anon;
revoke all on function public.mcp_review_anomalies() from public, anon;
revoke all on function public.mcp_jev_status() from public, anon;
revoke all on function public.jev_suggestions(uuid[]) from public, anon;
revoke all on function public.mcp_jev_suggestions() from public, anon;
grant execute on function public.review_anomalies(uuid[]) to authenticated, service_role;
grant execute on function public.mcp_review_anomalies() to authenticated, service_role;
grant execute on function public.mcp_jev_status() to authenticated, service_role;
grant execute on function public.jev_suggestions(uuid[]) to authenticated, service_role;
grant execute on function public.mcp_jev_suggestions() to authenticated, service_role;
revoke all on function public.jev_line_flags(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.jev_supplier_history(uuid, uuid[], integer) from public, anon, authenticated;
grant execute on function public.jev_line_flags(uuid, uuid[]) to service_role;
grant execute on function public.jev_supplier_history(uuid, uuid[], integer) to service_role;

commit;
