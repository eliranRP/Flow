-- FLOW-985: private.recurring_line_parts, the first step of every recurring read (recurring_stream_lines,
-- then recurring_parties: the recurring screen, the forecast, the month's changes and the company
-- profit page's next month), reads a company's split lines without a nested loop over all its lines.
--
-- A SQL function that sets search_path is not inlined, so its query is planned with p_company,
-- p_from and p_to unknown. With that generic plan the parts step joined the split lines back to every
-- line of the company in a nested loop (55 split lines x 1,518 lines on the largest sandbox, about
-- 9 of its 14 ms). The split step now carries the line's own columns, so the parts step reads them
-- from it and no longer joins the lines again. The rule and the result are unchanged; the rest of
-- the body is the latest live one (20261028093217_ledger_only.sql).
begin;
set local lock_timeout = '5s';

create or replace function private.recurring_line_parts(p_company uuid, p_from date, p_to date)
 RETURNS TABLE(id uuid, direction txn_direction, party_id uuid, line_party_id uuid, currency text, doc_date date, created_at timestamp with time zone, amount_net bigint, project_id uuid, category_id uuid, split boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with lines as (
    select t.id, t.direction, coalesce(mm.party_id, t.supplier_id, t.customer_id) as party_id,
      coalesce(t.supplier_id, t.customer_id) as line_party_id, t.currency,
      t.doc_date, t.created_at, t.amount_net::bigint as amount_net, t.project_id, t.category_id
    from public.transactions t
    -- FLOW-430: a party answered "the same" counts as the recurring one.
    left join public.recurring_matches mm
      on mm.company_id = t.company_id and mm.direction = t.direction and mm.same
      and mm.match_party_id = coalesce(t.supplier_id, t.customer_id)
    where t.company_id = p_company
      and t.removed_at is null
      and t.line_status = 'posted'
      and ((t.direction = 'expense' and t.supplier_id is not null)
        or (t.direction = 'income' and t.customer_id is not null
          and t.doc_kind in ('invoice', 'credit', 'invoice_receipt')))
      and t.doc_date >= p_from
      and t.doc_date <= p_to
  ),
  -- A split the P&L counts (pnl_lines, decision 0104): two or more parts that sum to the line, no loan split.
  split as (
    select l.id, l.direction, l.party_id, l.line_party_id, l.currency, l.doc_date, l.created_at, l.amount_net,
      l.project_id, l.category_id
    from lines l
    join private.split_parts s on s.company_id = p_company and s.transaction_id = l.id
    where not exists (select 1 from private.loan_parts ls where ls.transaction_id = l.id)
    group by l.id, l.direction, l.party_id, l.line_party_id, l.currency, l.doc_date, l.created_at, l.amount_net,
      l.project_id, l.category_id
    having count(*) >= 2 and sum(s.amount_minor) = abs(l.amount_net)
  ),
  -- The counted parts (a kept-out category never counts), each with the project it is for: its own, else
  -- the line's. Of a line's parts for one project the charge takes one: the line's own category, else the
  -- largest part.
  parts as (
    select l.id, l.direction, l.party_id, l.line_party_id, l.currency, l.doc_date, l.created_at,
      (sign(l.amount_net) * s.amount_minor)::bigint as amount_net,
      coalesce(s.project_id, l.project_id) as project_id, s.category_id,
      row_number() over (
        partition by l.id, coalesce(s.project_id, l.project_id)
        order by (s.category_id = l.category_id) desc, s.amount_minor desc, s.ordinal
      ) as pick
    from split l
    join private.split_parts s on s.company_id = p_company and s.transaction_id = l.id
    join public.categories c on c.company_id = p_company and c.id = s.category_id
    where not c.excluded_from_pnl
  )
  select l.id, l.direction, l.party_id, l.line_party_id, l.currency, l.doc_date, l.created_at, l.amount_net,
    l.project_id, l.category_id, false
  from lines l
  where not exists (select 1 from split sp where sp.id = l.id)
  union all
  select p.id, p.direction, p.party_id, p.line_party_id, p.currency, p.doc_date, p.created_at, p.amount_net,
    p.project_id, p.category_id, true
  from parts p
  where p.pick = 1;
$function$;

commit;
