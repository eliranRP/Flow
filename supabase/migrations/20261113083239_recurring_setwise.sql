-- FLOW-1171 (perf queue): missing_bills and expected_months ran two helpers once per recurring charge.
-- recurring_match_suggestion compared the charge's name with every supplier or customer (party_name_words
-- twice per pair) and recurring_handover re-read this month's line parts each time. Both now answer for every
-- charge in one statement: each party's words are made once, this month's line parts are read once, and the
-- earlier lines are read only when a candidate exists. The matching rules, the tie-breaks and the answers are
-- the per-charge functions' (kept, and the pgTAP file recurring_setwise compares them).

-- 1. The suggestion of every charge. p_charges: a json array of {direction, party_id, currency, due_month,
-- typical}; one row back per distinct charge, its suggestion null when none.
create function private.recurring_match_suggestions(p_company uuid, p_today date, p_charges jsonb)
returns table(direction public.txn_direction, party_id uuid, currency text, due_month date, typical bigint, suggestion jsonb)
language sql
stable
security definer
set search_path to ''
as $$
  with ch as (
    select distinct c.direction, c.party_id, c.currency, c.due_month, c.typical
    from jsonb_to_recordset(p_charges)
      as c(direction public.txn_direction, party_id uuid, currency text, due_month date, typical bigint)
  ),
  -- Every party's name, its words made once (private.party_names_alike's rule, below).
  names as (
    select 'expense'::public.txn_direction as direction, s.id, s.name, private.party_name_words(s.name) as words
    from public.suppliers s where s.company_id = p_company
    union all
    select 'income'::public.txn_direction, cu.id, cu.name, private.party_name_words(cu.name)
    from public.customers cu where cu.company_id = p_company
  ),
  -- Same rule as private.party_names_alike, on the words: neither empty, and the same first word of 3 letters
  -- or more, or one name inside the other.
  alike as (
    select me.direction, me.id as party_id, n.id, n.name
    from (select distinct c.direction, c.party_id from ch c) cp
    join names me on me.direction = cp.direction and me.id = cp.party_id
    join names n on n.direction = me.direction and n.id <> me.id
    where me.words <> '' and n.words <> ''
      and ((char_length(split_part(me.words, ' ', 1)) >= 3 and split_part(me.words, ' ', 1) = split_part(n.words, ' ', 1))
        or position(me.words in n.words) > 0 or position(n.words in me.words) > 0)
  )
  select ch.direction, ch.party_id, ch.currency, ch.due_month, ch.typical,
    (select jsonb_build_object(
        'party_id', l.id,
        'party_name', l.name,
        'transaction_id', l.transaction_id,
        'doc_date', l.doc_date,
        'amount_minor', l.amount_net
      )
     from (
       select distinct on (c.id) c.id, c.name, t.id as transaction_id, t.doc_date, t.amount_net
       from alike c
       join public.transactions t
         on t.company_id = p_company and t.direction = ch.direction and t.currency = ch.currency
         and c.id = case when ch.direction = 'expense' then t.supplier_id else t.customer_id end
       where c.direction = ch.direction and c.party_id = ch.party_id
         and not exists (
           select 1 from public.recurring_matches m
           where m.company_id = p_company and m.direction = ch.direction
             and ((m.party_id = ch.party_id and m.match_party_id = c.id) or (m.match_party_id = c.id and m.same)
               or m.party_id = c.id)
         )
         and t.removed_at is null
         and t.line_status = 'posted'
         and (ch.direction = 'expense' or t.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
         and t.doc_date >= (ch.due_month - interval '1 month')::date
         and t.doc_date <= p_today
         -- First seen lately: no line before the month ahead of the due month.
         and not exists (
           select 1 from public.transactions o
           where o.company_id = p_company and o.removed_at is null and o.line_status = 'posted'
             and c.id = case when ch.direction = 'expense' then o.supplier_id else o.customer_id end
             and o.doc_date < (ch.due_month - interval '1 month')::date
         )
       order by c.id, t.doc_date desc, t.created_at desc
     ) l
     where ch.typical <> 0
       and abs(l.amount_net) * 2 >= abs(ch.typical)
       and abs(l.amount_net) * 2 <= abs(ch.typical) * 3
     order by abs(abs(l.amount_net) - abs(ch.typical)), l.doc_date desc, l.id
     limit 1) as suggestion
  from ch;
$$;

revoke all on function private.recurring_match_suggestions(uuid, date, jsonb) from public, anon, authenticated;

-- 2. The handover of every charge (FLOW-1037). p_charges: a json array of {direction, party_id, currency,
-- project_id, typical}; one row back per charge that has a handover.
create function private.recurring_handovers(p_company uuid, p_today date, p_charges jsonb)
returns table(direction public.txn_direction, party_id uuid, currency text, project_id uuid, typical bigint, handover jsonb)
language sql
stable
security definer
set search_path to ''
as $$
  with b as (select date_trunc('month', p_today)::date as this_month),
  ch as (
    select distinct c.direction, c.party_id, c.currency, c.project_id, c.typical
    from jsonb_to_recordset(p_charges)
      as c(direction public.txn_direction, party_id uuid, currency text, project_id uuid, typical bigint)
    where c.project_id is not null and c.typical <> 0
  ),
  -- This month's lines up to today, read once, as recurring_parties reads them: a split line by its parts,
  -- each on its own project (decision 0189). Each charge's candidates: another party's line on its project,
  -- within 2% of the usual amount either way.
  parts as (
    select lp.*
    from b, private.recurring_line_parts(p_company, b.this_month, p_today) lp
  ),
  found as (
    select ch.direction, ch.party_id, ch.currency, ch.project_id, ch.typical,
      lp.id, lp.doc_date, lp.created_at, lp.amount_net, lp.line_party_id as to_party_id
    from ch
    join parts lp on lp.direction = ch.direction and lp.currency = ch.currency and lp.project_id = ch.project_id
      and lp.line_party_id <> ch.party_id
      and lp.party_id <> ch.party_id
      and abs(abs(lp.amount_net) - abs(ch.typical)) * 50 <= abs(ch.typical)
  ),
  -- The candidates' lines and parts on those projects before this month. Read only when there is a candidate.
  earlier as (
    select distinct lp.direction, lp.project_id, lp.line_party_id as party_id
    from b, private.recurring_line_parts(p_company, '0001-01-01'::date, (b.this_month - 1)) lp
    where exists (select 1 from found)
      and (lp.direction, lp.project_id) in (select f.direction, f.project_id from found f)
  )
  select distinct on (f.direction, f.party_id, f.currency, f.project_id, f.typical)
    f.direction, f.party_id, f.currency, f.project_id, f.typical,
    jsonb_build_object(
      'party_id', f.to_party_id,
      'party_name', coalesce(s.name, cu.name),
      'transaction_id', f.id,
      'doc_date', f.doc_date,
      'amount_minor', f.amount_net
    ) as handover
  from found f
  left join public.suppliers s on f.direction = 'expense' and s.company_id = p_company and s.id = f.to_party_id
  left join public.customers cu on f.direction = 'income' and cu.company_id = p_company and cu.id = f.to_party_id
  where coalesce(s.id, cu.id) is not null
    -- New on the project: no posted line or part of that party on it before this month.
    and not exists (
      select 1 from earlier e
      where e.direction = f.direction and e.project_id = f.project_id and e.party_id = f.to_party_id
    )
    -- Answered for this charge already (yes or no): not offered again.
    and not exists (
      select 1 from public.recurring_handovers h
      where h.company_id = p_company and h.direction = f.direction and h.party_id = f.party_id
        and h.currency = f.currency and h.project_id = f.project_id and h.to_party_id = f.to_party_id
    )
  order by f.direction, f.party_id, f.currency, f.project_id, f.typical,
    abs(abs(f.amount_net) - abs(f.typical)), f.doc_date desc, f.created_at desc, f.id;
$$;

revoke all on function private.recurring_handovers(uuid, date, jsonb) from public, anon, authenticated;

-- 3. expected_months: the handovers in one read. Otherwise the live body.
CREATE OR REPLACE FUNCTION public.expected_months(p_months integer DEFAULT 3, p_project_id uuid DEFAULT NULL::uuid, p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_months is null or p_months < 1 or p_months > 13 then
    raise exception 'validation';
  end if;
  return (
    with rp as (
      select p.*
      from private.recurring_parties(cid, today) p
      where p_project_id is null or p.project_id = p_project_id
    ),
    -- FLOW-1037: due this month with no line yet, and another party's line on its project came instead.
    ho as (
      select h.*
      from private.recurring_handovers(cid, today, (
        select coalesce(jsonb_agg(jsonb_build_object('direction', x.direction, 'party_id', x.party_id,
          'currency', x.currency, 'project_id', x.project_id, 'typical', x.typical_amount_minor)), '[]'::jsonb)
        from rp x
        where not x.seen_this_month and x.project_id is not null
          and x.next_due_month <= date_trunc('month', today)::date
      )) h
    ),
    r as (
      select rp.*, ho.handover
      from rp
      left join ho on not rp.seen_this_month and rp.project_id is not null
        and rp.next_due_month <= date_trunc('month', today)::date
        and ho.direction = rp.direction and ho.party_id = rp.party_id and ho.currency = rp.currency
        and ho.project_id = rp.project_id and ho.typical = rp.typical_amount_minor
    ),
    months as (
      select n, (date_trunc('month', today) + make_interval(months => n))::date as month
      from generate_series(0, p_months - 1) n
    ),
    cells as (
      select m.month, r.currency, r.direction, r.typical_amount_minor as amount
      from months m
      join r on m.month >= greatest(r.next_due_month, date_trunc('month', today)::date)
        and private.month_diff(m.month, greatest(r.next_due_month, date_trunc('month', today)::date))
          % private.pace_months(r.pace) = 0
        -- A charge with a handover is not expected this month: its payment came under the other party.
        and not (m.month = date_trunc('month', today)::date and r.handover is not null)
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
          'category_id', r.category_id,
          'source', r.source,
          'pace', r.pace,
          'next_due_month', to_char(r.next_due_month, 'YYYY-MM'),
          -- Any of the charge's stream lines is split into loan parts (recurring_parties says).
          'pays_loan', r.pays_loan,
          'handover', r.handover
        ) order by r.direction, coalesce(s.name, cu.name), r.party_id)
        from r
        left join public.suppliers s on r.direction = 'expense' and s.company_id = cid and s.id = r.party_id
        left join public.customers cu on r.direction = 'income' and cu.company_id = cid and cu.id = r.party_id
      ), '[]'::jsonb)
    )
  );
end;
$function$;

-- 4. missing_bills: the handovers and the suggestions in one read each. Otherwise the live body.
CREATE OR REPLACE FUNCTION public.missing_bills(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return (
    with due as (
      select r.*,
        make_date(extract(year from r.next_due_month)::integer, extract(month from r.next_due_month)::integer,
          least(r.typical_day + 5, extract(day from private.month_end(r.next_due_month))::integer)) as expected_by,
        -- A party with one charge keeps the key it always had; a party split by project adds its project.
        r.direction || ':' || r.party_id || ':' || r.currency || ':' || to_char(r.next_due_month, 'YYYY-MM')
          || case when r.charges > 1 then ':' || coalesce(r.project_id::text, 'none') else '' end as alert_key
      from (
        select rp.*, count(*) over (partition by rp.direction, rp.party_id, rp.currency) as charges
        from private.recurring_parties(cid, today) rp
      ) r
      where r.next_due_month <= date_trunc('month', today)::date
    ),
    late as (
      select d.*, s.id as supplier_id, s.name as supplier_name, coalesce(s.name, cu.name) as party_name,
        p.name as project_name, c.name as category_name
      from due d
      left join public.suppliers s on d.direction = 'expense' and s.company_id = cid and s.id = d.party_id
      left join public.customers cu on d.direction = 'income' and cu.company_id = cid and cu.id = d.party_id
      left join public.projects p on p.company_id = cid and p.id = d.project_id
      left join public.categories c on c.company_id = cid and c.id = d.category_id
      where coalesce(s.id, cu.id) is not null
        -- A deadline past the month's end falls on its last day.
        and (today > d.expected_by or (today = d.expected_by and d.expected_by = private.month_end(d.next_due_month)))
        and not exists (
          select 1 from public.recurring_dismissals x
          where x.user_id = auth.uid() and x.company_id = cid and x.kind = 'missing' and x.alert_key = d.alert_key
        )
    ),
    -- FLOW-1037: a charge whose payment came this month under another party is not late.
    ho as (
      select h.*
      from private.recurring_handovers(cid, today, (
        select coalesce(jsonb_agg(jsonb_build_object('direction', x.direction, 'party_id', x.party_id,
          'currency', x.currency, 'project_id', x.project_id, 'typical', x.typical_amount_minor)), '[]'::jsonb)
        from late x
        where not x.seen_this_month and x.project_id is not null
      )) h
    ),
    shown as (
      select d.*
      from late d
      where d.seen_this_month or d.project_id is null
        or not exists (
          select 1 from ho
          where ho.direction = d.direction and ho.party_id = d.party_id and ho.currency = d.currency
            and ho.project_id = d.project_id and ho.typical = d.typical_amount_minor
        )
    ),
    sg as (
      select g.*
      from private.recurring_match_suggestions(cid, today, (
        select coalesce(jsonb_agg(jsonb_build_object('direction', x.direction, 'party_id', x.party_id,
          'currency', x.currency, 'due_month', x.next_due_month, 'typical', x.typical_amount_minor)), '[]'::jsonb)
        from shown x
      )) g
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'direction', d.direction,
        'party_id', d.party_id,
        'party_name', d.party_name,
        'supplier_id', d.supplier_id,
        'supplier_name', d.supplier_name,
        'currency', d.currency,
        'typical_amount_minor', d.typical_amount_minor,
        'typical_day', d.typical_day,
        'due_month', to_char(d.next_due_month, 'YYYY-MM'),
        'expected_by', d.expected_by,
        'months_seen', d.months_seen,
        'last_doc_date', d.last_doc_date,
        'last_amount_minor', d.last_amount_minor,
        'project_id', d.project_id,
        'project_name', d.project_name,
        'category_id', d.category_id,
        'category_name', d.category_name,
        'source', d.source,
        'pace', d.pace,
        'pace_source', d.pace_source,
        'alert_key', d.alert_key,
        'suggestion', g.suggestion
      ) order by d.direction = 'income', d.typical_day, d.party_name, d.project_name, d.party_id), '[]'::jsonb)
    from shown d
    left join sg g on g.direction = d.direction and g.party_id = d.party_id and g.currency = d.currency
      and g.due_month = d.next_due_month and g.typical = d.typical_amount_minor
  );
end;
$function$;
