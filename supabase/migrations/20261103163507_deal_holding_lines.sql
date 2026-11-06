-- FLOW-1071: get_property_return_lines gains the line `deal_holding`, all time: the holding costs a
-- renovation's net profit counts (FLOW-1068, decision 0261): holding lines that rehab does not already
-- count, a loan's principal left out. Its total is get_property_returns' deal.holding_minor, so the
-- net profit's holding row opens the transactions behind it.

begin;

create or replace function public.get_property_return_lines(p_project_id uuid, p_line text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_category_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  cur text;
  d_from date;
  d_to date;
  result jsonb;
  all_time constant text[] := array['rehab', 'acquisition', 'renovation', 'holding', 'financing', 'money_in', 'deal_holding'];
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  -- Another company's project reads as not found before any argument is checked.
  select pr.investment_currency into cur from public.projects pr where pr.id = p_project_id and pr.company_id = cid;
  if cur is null then
    return null;
  end if;
  if p_line is null or p_line not in ('income', 'opex', 'debt_service', 'capex', 'principal', 'before_rent',
      'not_counted', 'rehab', 'acquisition', 'renovation', 'holding', 'financing', 'money_in', 'deal_holding')
    or (p_from is null) <> (p_to is null) or p_from > p_to
    or p_limit is null or p_limit < 1 or p_limit > 200 or p_offset is null or p_offset < 0
  then
    raise exception 'validation' using errcode = '22023';
  end if;
  if not p_line = any(all_time) then
    d_to := coalesce(p_to, (now() at time zone 'Asia/Jerusalem')::date);
    d_from := coalesce(p_from, (d_to - interval '1 year')::date + 1);
  end if;

  with picked as (
    select x.*
    from private.property_lines(cid, p_project_id, d_from, d_to) x
    left join public.categories lc on lc.id = x.category_id and lc.company_id = cid
    where x.currency = cur
      and case p_line
        when 'rehab' then x.in_rehab
        when 'principal' then x.line = 'debt_service' and x.part = 'principal'
        when 'before_rent' then x.line in ('holding', 'renovation')
        when 'not_counted' then x.line in ('acquisition', 'financing')
        when 'money_in' then x.line in ('acquisition', 'renovation', 'holding', 'financing')
        -- FLOW-1071: the holding costs a renovation's net profit counts (get_property_returns deal.holding_minor).
        when 'deal_holding' then x.line = 'holding' and not x.in_rehab
          and coalesce(x.part, lc.loan_part::text, '') <> 'principal'
        else x.line = p_line
      end
      and (p_category_id is null or x.category_id = p_category_id)
  ),
  per_line as (
    select k.transaction_id, k.category_id, bool_or(k.shared) as shared, max(k.line_date) as line_date,
      sum(k.amount_minor)::bigint as amount_minor, string_agg(distinct k.part, ',') as parts
    from picked k
    group by k.transaction_id, k.category_id
  ),
  page as (
    select r.*, t.description, sup.name as supplier_name, c.name as category_name
    from per_line r
    join public.transactions t on t.id = r.transaction_id and t.company_id = cid
    left join public.suppliers sup on sup.id = t.supplier_id
    left join public.categories c on c.id = r.category_id and c.company_id = cid
    order by r.line_date desc, r.transaction_id, r.category_id
    limit p_limit + 1 offset p_offset
  )
  select jsonb_build_object(
    'line', p_line,
    'currency', cur,
    'from', d_from,
    'to', d_to,
    'total_minor', (select coalesce(sum(r.amount_minor), 0)::bigint from per_line r),
    'count', (select count(*)::integer from per_line r),
    'has_more', (select count(*) from page) > p_limit,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'transaction_id', g.transaction_id,
        'description', g.description,
        'supplier_name', g.supplier_name,
        'category_id', g.category_id,
        'category_name', g.category_name,
        'date', g.line_date,
        'amount_minor', g.amount_minor,
        'parts', g.parts,
        'shared', g.shared
      ) order by g.line_date desc, g.transaction_id, g.category_id)
      from (select * from page order by line_date desc, transaction_id, category_id limit p_limit) g
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$function$;

commit;
