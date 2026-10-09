-- FLOW-213: match_lines, one read that reconciles an outside ledger export against Flow.
-- Decision 0084: the matching is SQL; the MCP tool only checks its arguments.
--
-- p_rows is a JSON array (1 to 500) of {date: YYYY-MM-DD, amount_minor: non-zero integer, ref?: text}.
-- A row matches a line of the same gross amount (without its sign) in p_currency (the company's
-- base currency by default) whose document date or payment date is within p_window_days (0 to 31,
-- default 5) of the row's date; p_direction (income or expense) narrows the lines. Removed and void
-- lines never match. Each row is paired with at most one line and each line with at most one row:
-- pairs are taken closest dates first, then by row order. Lines are the company's own
-- (private.readable_company_id()).
create or replace function public.match_lines(
  p_rows jsonb,
  p_window_days integer default 5,
  p_direction text default null,
  p_currency text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  cur text;
  win integer := coalesce(p_window_days, 5);
  valid boolean;
  rows_in jsonb;
  first_date date;
  last_date date;
  line_map jsonb;
  pairs jsonb := '[]'::jsonb;
  claims jsonb := '{}'::jsonb;
  taken_rows integer[] := '{}';
  taken_lines uuid[] := '{}';
  pr record;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500
    or win < 0 or win > 31
    or (p_direction is not null and p_direction not in ('income', 'expense'))
    or (p_currency is not null and p_currency !~ '^[A-Z]{3}$') then
    raise exception 'validation';
  end if;

  select bool_and(
    case
      when jsonb_typeof(e.v) <> 'object' then false
      when (e.v - 'date' - 'amount_minor' - 'ref') <> '{}'::jsonb then false
      when jsonb_typeof(e.v->'date') is distinct from 'string' then false
      when (e.v->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then false
      when jsonb_typeof(e.v->'amount_minor') is distinct from 'number' then false
      when (e.v->>'amount_minor') !~ '^-?[1-9][0-9]{0,14}$' then false
      when coalesce(jsonb_typeof(e.v->'ref'), 'null') not in ('string', 'null') then false
      else coalesce(length(e.v->>'ref'), 0) <= 200
    end
  ) into valid
  from jsonb_array_elements(p_rows) as e(v);
  if not valid then
    raise exception 'validation';
  end if;

  begin
    select
      jsonb_agg(jsonb_build_object(
        'index', e.n - 1,
        'date', (e.v->>'date')::date,
        'amount_minor', (e.v->>'amount_minor')::bigint,
        'ref', e.v->>'ref'
      ) order by e.n),
      min((e.v->>'date')::date),
      max((e.v->>'date')::date)
    into rows_in, first_date, last_date
    from jsonb_array_elements(p_rows) with ordinality as e(v, n);
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception 'validation';
  end;

  select coalesce(p_currency, c.base_currency) into cur from public.companies c where c.id = cid;

  -- Every line a row could match, as the tool returns it.
  select coalesce(jsonb_object_agg(t.id::text, jsonb_build_object(
    'transaction_id', t.id,
    'doc_date', t.doc_date,
    'cash_date', t.cash_date,
    'amount_minor', t.amount_gross,
    'currency', t.currency,
    'direction', t.direction,
    'line_status', t.line_status,
    'party', coalesce(sup.name, cus.name),
    'description', t.description,
    'project_name', pj.name,
    'pnl_role', t.pnl_role,
    'category_name', cat.name
  )), '{}'::jsonb) into line_map
  from public.transactions t
  left join public.suppliers sup on sup.id = t.supplier_id
  left join public.customers cus on cus.id = t.customer_id
  left join public.projects pj on pj.id = t.project_id
  left join public.categories cat on cat.id = t.category_id
  where t.company_id = cid
    and t.removed_at is null
    and t.line_status <> 'void'
    and t.currency = cur
    and (p_direction is null or t.direction::text = p_direction)
    and (
      t.doc_date between first_date - win and last_date + win
      or t.cash_date between first_date - win and last_date + win
    );

  for pr in
    with r as (
      select (x->>'index')::integer as idx, (x->>'date')::date as d, abs((x->>'amount_minor')::bigint) as amt
      from jsonb_array_elements(rows_in) as x
    ),
    l as (
      select (v->>'transaction_id')::uuid as id, (v->>'doc_date')::date as doc_date,
        (v->>'cash_date')::date as cash_date, abs((v->>'amount_minor')::bigint) as amt
      from jsonb_each(line_map) as m(k, v)
    ),
    p as (
      select r.idx, l.id, least(abs(l.doc_date - r.d), abs(l.cash_date - r.d)) as diff
      from r
      join l on l.amt = r.amt
    )
    select p.idx, p.id, p.diff from p where p.diff <= win order by p.diff, p.idx, p.id
  loop
    pairs := pairs || jsonb_build_array(jsonb_build_object('index', pr.idx, 'id', pr.id, 'day_diff', pr.diff));
    if not (pr.idx = any(taken_rows)) and not (pr.id = any(taken_lines)) then
      taken_rows := taken_rows || pr.idx;
      taken_lines := taken_lines || pr.id;
      claims := claims || jsonb_build_object(pr.idx::text, jsonb_build_object('id', pr.id, 'day_diff', pr.diff));
    end if;
  end loop;

  with r as (
    select (x->>'index')::integer as idx, x
    from jsonb_array_elements(rows_in) as x
  ),
  p as (
    select (y->>'index')::integer as idx, y->>'id' as id, (y->>'day_diff')::integer as diff,
      row_number() over (partition by y->>'index' order by (y->>'day_diff')::integer, y->>'id') as n
    from jsonb_array_elements(pairs) as y
  ),
  open_lines as (
    select v as line
    from jsonb_each(line_map) as m(k, v)
    where not ((v->>'transaction_id')::uuid = any(taken_lines))
      and (
        (v->>'doc_date')::date between first_date and last_date
        or (v->>'cash_date')::date between first_date and last_date
      )
  )
  select jsonb_build_object(
    'currency', cur,
    'window_days', win,
    'direction', p_direction,
    'from', first_date,
    'to', last_date,
    'rows', (
      select jsonb_agg(r.x || jsonb_build_object(
        'match', case when claims ? r.idx::text then
          (line_map -> (claims -> r.idx::text ->> 'id')) || jsonb_build_object('day_diff', claims -> r.idx::text -> 'day_diff')
        end,
        'candidate_count', (select count(*) from p where p.idx = r.idx),
        'candidates', coalesce((
          select jsonb_agg((line_map -> p.id) || jsonb_build_object('day_diff', p.diff) order by p.n)
          from p where p.idx = r.idx and p.n <= 5
        ), '[]'::jsonb)
      ) order by r.idx)
      from r
    ),
    'matched_count', (select count(*) from jsonb_object_keys(claims)),
    'unmatched_rows', coalesce((
      select jsonb_agg(r.idx order by r.idx) from r where not claims ? r.idx::text
    ), '[]'::jsonb),
    'unclaimed_count', (select count(*) from open_lines),
    'unclaimed_lines', coalesce((
      select jsonb_agg(o.line order by coalesce(o.line->>'cash_date', o.line->>'doc_date'), o.line->>'transaction_id')
      from (
        select ol.line from open_lines ol
        order by coalesce(ol.line->>'cash_date', ol.line->>'doc_date'), ol.line->>'transaction_id'
        limit 200
      ) o
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.match_lines(jsonb, integer, text, text) from public, anon;
grant execute on function public.match_lines(jsonb, integer, text, text) to authenticated, service_role;
