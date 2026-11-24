-- FLOW-1320: the company and project forecasts read the recurring charges once per call. Before, company_forecast
-- read them twice: expected_months(0) ran private.recurring_parties (with the handovers and the parties' names), and
-- company_next_month_inputs ran private.recurring_charge_lines_of_projects (the same lines and the same detection
-- again) for the lines the general costs leave out. The overhead page's project_forecast did the same. Adds two
-- private functions and patches three (same answers); changes no table, no grant of an existing function, and no
-- other read. public.expected_months, public.company_next_month_inputs and public.month_forecast are untouched.
-- - private.recurring_charges(company, today, overrides, lines): private.recurring_parties' query with every charge it
--   detects, its order (ord), whether recurring_parties lists it (listed: not over, FLOW-1266) and, with lines, its
--   lines' ids (line_ids, an id once per part; null without). Made from recurring_parties' current body, patched by
--   anchors that must match once. Closed to the API roles.
-- - private.recurring_parties: the listed rows of recurring_charges (without the lines) in its order, so the
--   detection stays one body.
-- - private.forecast_gather(today, project, inputs): security definer, for the caller's readable company only
--   (private.readable_company_id(); none is refused 42501, as the two reads it replaces refuse). One pass of
--   recurring_charges gives:
--   - recurring: expected_months(0)'s charges (of the project, when one is given) in its order (one party's several
--     charges in the charges' order, which neither build's answer depends on), with the fields the forecast builds
--     read; not the handovers or seen_this_month, which neither build reads (the handovers were a second read of the
--     lines);
--   - inputs ('rest' or 'next'): company_next_month_inputs(today, inputs = 'rest')'s answer, the charges' lines of
--     the active projects but the overhead one taken from the same pass instead of recurring_charge_lines_of_projects
--     (the same lines: every charge detected, listed or not, with a project); 'general': only its general costs.
--   It reads only what expected_months and company_next_month_inputs (both security definer, executable by
--   authenticated) give the same caller. Executable by authenticated and service_role, as the forecast reads are
--   security invoker; it is in private, so the API does not serve it.
-- - public.company_forecast and public.project_forecast read it instead of company_next_month_inputs and
--   expected_months.
-- Every public answer is unchanged: the company-forecast and project-forecast vectors, flow_1307, flow_1309,
-- flow_1313, flow_1318 and flow_1320_recurring_once.test.sql hold it.
begin;

set local lock_timeout = '5s';

create or replace function pg_temp.swap(p_def text, p_from text, p_to text)
returns text
language plpgsql
immutable
as $$
begin
  if (char_length(p_def) - char_length(replace(p_def, p_from, ''))) / char_length(p_from) <> 1 then
    raise exception 'anchor not found exactly once: %', left(p_from, 80);
  end if;
  return replace(p_def, p_from, p_to);
end;
$$;

-- recurring_charges: recurring_parties' body, with every charge detected, its order, listed and its lines.
do $charges$
declare
  def text := pg_get_functiondef('private.recurring_parties(uuid,date,boolean)'::regprocedure);
begin
  def := pg_temp.swap(def, 'FUNCTION private.recurring_parties(', 'FUNCTION private.recurring_charges(');
  def := pg_temp.swap(def, 'p_overrides boolean DEFAULT true)', 'p_overrides boolean, p_lines boolean)');
  def := pg_temp.swap(def, 'this_month_line_count integer, ends_on date)',
    'this_month_line_count integer, ends_on date, ord bigint, listed boolean, line_ids uuid[])');
  def := pg_temp.swap(def, $a$  -- Each charge's category, for every charge in one pass (FLOW-998;$a$,
    $b$  -- FLOW-1320: each charge's lines (an id once per part of a split line), when asked.
  charge_lines as (
    select l.direction, l.party_id, l.currency, l.stream_project, array_agg(l.id) as ids
    from lines l
    where p_lines
    group by l.direction, l.party_id, l.currency, l.stream_project
  ),
  -- Each charge's category, for every charge in one pass (FLOW-998;$b$);
  def := pg_temp.swap(def, $a$    p.this_month_line_count,
    p.ends_on
  from seen p
  cross join bounds b
  left join picks pk on pk.ord = p.ord
  where p.ends_on is null
    or (p.ends_on >= p_today
      and (p.last_seen_month = b.this_month
        or private.recurring_due_date(greatest(b.this_month, case
            when p.pace = 'month' then b.this_month
            else (p.last_seen_month + make_interval(months => private.pace_months(p.pace)))::date
          end), p.typical_day) <= p.ends_on))
  order by p.ord;$a$,
    $b$    p.this_month_line_count,
    p.ends_on,
    p.ord,
    -- recurring_parties lists a charge that is not over (FLOW-1266): no end date, or its end date has not passed
    -- and it came this month or its next due day is not after its end date. A late charge is due from this month.
    coalesce(p.ends_on is null
      or (p.ends_on >= p_today
        and (p.last_seen_month = b.this_month
          or private.recurring_due_date(greatest(b.this_month, case
              when p.pace = 'month' then b.this_month
              else (p.last_seen_month + make_interval(months => private.pace_months(p.pace)))::date
            end), p.typical_day) <= p.ends_on)), false),
    cl.ids
  from seen p
  cross join bounds b
  left join picks pk on pk.ord = p.ord
  left join charge_lines cl on cl.direction = p.direction and cl.party_id = p.party_id and cl.currency = p.currency
    and cl.stream_project is not distinct from p.stream_project
  order by p.ord;$b$);
  execute def;
end
$charges$;

revoke all on function private.recurring_charges(uuid, date, boolean, boolean) from public, anon, authenticated;

comment on function private.recurring_charges(uuid, date, boolean, boolean) is
  'FLOW-1320. Every recurring charge private.recurring_parties detects, in its order (ord), whether recurring_parties lists it (listed: not over) and, with p_lines, its lines'' ids (line_ids). recurring_parties is its listed rows.';

-- recurring_parties: the listed charges, in the same order, from the one body.
create or replace function private.recurring_parties(p_company uuid, p_today date, p_overrides boolean default true)
returns table(direction public.txn_direction, party_id uuid, currency text, months_seen integer, typical_day integer,
  typical_amount_minor bigint, last_doc_date date, seen_this_month boolean, project_id uuid, category_id uuid,
  last_amount_minor bigint, source text, pace text, pace_source text, next_due_month date,
  typical_amount_source text, pays_loan boolean, this_month_minor bigint, this_month_transaction_id uuid,
  this_month_line_count integer, ends_on date)
language sql
stable
security definer
set search_path = ''
as $$
  select c.direction, c.party_id, c.currency, c.months_seen, c.typical_day, c.typical_amount_minor, c.last_doc_date,
    c.seen_this_month, c.project_id, c.category_id, c.last_amount_minor, c.source, c.pace, c.pace_source,
    c.next_due_month, c.typical_amount_source, c.pays_loan, c.this_month_minor, c.this_month_transaction_id,
    c.this_month_line_count, c.ends_on
  from private.recurring_charges(p_company, p_today, p_overrides, false) c
  where c.listed
  order by c.ord;
$$;

revoke all on function private.recurring_parties(uuid, date, boolean) from public, anon, authenticated;

-- The forecasts' read: the charges once, and the next month's inputs from the same pass.
create or replace function private.forecast_gather(p_today date, p_project uuid, p_inputs text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  this_month date;
  first_month date;
  next_month text;
  rest boolean := p_inputs = 'rest';
  overhead uuid;
  recurring jsonb;
  stream_ids uuid[];
  projects jsonb;
  general jsonb;
  edits jsonb;
  rest_edits jsonb;
  rest_months text[];
  month_skips jsonb;
begin
  -- The caller's company only, refused as expected_months and company_next_month_inputs refuse.
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_inputs is not null and p_inputs not in ('rest', 'next', 'general') then
    raise exception 'validation' using errcode = '22023';
  end if;
  this_month := date_trunc('month', today)::date;
  first_month := (this_month - interval '6 months')::date;
  next_month := to_char(this_month + interval '1 month', 'YYYY-MM');
  -- FLOW-1066: the forecast's months, next month to 12 months after this one (forecast-horizon.ts).
  rest_months := array(
    select to_char(m, 'YYYY-MM')
    from generate_series(this_month + interval '1 month', this_month + interval '12 months', interval '1 month') m
  );
  select c.overhead_project_id into overhead from public.companies c where c.id = cid;

  -- One pass over the charges: expected_months(0, p_project)'s charges, as its answer lists them (the fields the
  -- builds read: no handover or seen_this_month), and the lines of every charge of an active project but the
  -- overhead one, which company_next_month_inputs reads from recurring_charge_lines_of_projects.
  with rc as materialized (
    select c.* from private.recurring_charges(cid, today, true, p_inputs is not null) c
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
          'direction', r.direction,
          'party_id', r.party_id,
          'name', coalesce(s.name, cu.name),
          'currency', r.currency,
          'typical_amount_minor', r.typical_amount_minor,
          'typical_day', r.typical_day,
          'project_id', r.project_id,
          'category_id', r.category_id,
          'pace', r.pace,
          'next_due_month', to_char(r.next_due_month, 'YYYY-MM'),
          'pays_loan', r.pays_loan
        ) || case when r.ends_on is null then '{}'::jsonb else jsonb_build_object('ends_on', r.ends_on) end
        -- expected_months' order; one party's several charges (a tie) in the charges' order. The builds' answers do not
        -- depend on how a tie is ordered: one party's charges are of different projects or currencies, so no two of
        -- them meet in one part's rows in the forecast's currency.
        order by r.direction, coalesce(s.name, cu.name), r.party_id, r.ord), '[]'::jsonb)
     from rc r
     left join public.suppliers s on r.direction = 'expense' and s.company_id = cid and s.id = r.party_id
     left join public.customers cu on r.direction = 'income' and cu.company_id = cid and cu.id = r.party_id
     where r.listed
       and (p_project is null or r.project_id = p_project)),
    case when p_inputs is not null then array(
      select l.id
      from rc r
      cross join unnest(r.line_ids) l(id)
      join public.projects sp on sp.id = r.project_id and sp.status = 'active'
      where r.project_id is distinct from overhead
    ) end
  into recurring, stream_ids;

  if p_inputs is null then
    return jsonb_build_object('recurring', recurring);
  end if;

  -- From here, company_next_month_inputs' answer with the charges' lines above.
  if p_inputs <> 'general' then
    -- Every active project's category months in one pass (FLOW-977), as the four fields the forecast reads
    -- (FLOW-1171).
    select coalesce(jsonb_agg(jsonb_build_object(
        'project_id', p.id,
        'categories', coalesce(m.categories, '[]'::jsonb)
      ) order by p.id), '[]'::jsonb)
    into projects
    from public.projects p
    left join private.project_category_months_lean(array(
      select ap.id from public.projects ap
      where ap.company_id = cid and ap.status = 'active' and ap.id is distinct from overhead
    ), 6, today) m on m.project_id = p.id
    where p.company_id = cid
      and p.status = 'active'
      and p.id is distinct from overhead;
  end if;

  with streams as materialized (
    select st.id from unnest(stream_ids) st(id)
  ),
  entries as (
    select l.category_id, l.currency, date_trunc('month', l.doc_date)::date as month, -l.amount_net as amount
    from private.pnl_lines l
    join public.transactions lt on lt.id = l.transaction_id
    left join public.categories cat on cat.id = l.category_id
    where l.company_id = cid
      and l.kind = 'expense'
      and (l.unassigned or l.pnl_role = 'overhead')
      and not lt.category_suggested
      and not exists (
        select 1 from public.review_queue q
        where q.transaction_id = lt.id and q.company_id = lt.company_id and q.status = 'open'
      )
      and l.doc_date >= first_month
      and l.doc_date < this_month
      and not exists (select 1 from streams st where st.id = lt.id)
      and private.line_in_pnl(
        case when not exists (select 1 from private.loan_parts ls where ls.transaction_id = lt.id)
          then lt.in_pnl_override end,
        cat.excluded_from_pnl, cat.loan_part
      )
  ),
  sums as (
    select e.category_id, e.currency, e.month, sum(e.amount)::bigint as amount
    from entries e
    group by e.category_id, e.currency, e.month
  ),
  keys as (
    select distinct s.category_id, s.currency from sums s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', k.category_id,
      'name', c.name,
      'currency', k.currency,
      'months_minor', (
        select jsonb_agg(coalesce(s.amount, 0) order by m)
        from generate_series(first_month, this_month - interval '1 month', interval '1 month') m
        left join sums s on s.category_id is not distinct from k.category_id
          and s.currency = k.currency and s.month = m::date
      )
    ) order by k.currency, c.name), '[]'::jsonb)
  into general
  from keys k
  left join public.categories c on c.id = k.category_id;

  if p_inputs = 'general' then
    return jsonb_build_object('recurring', recurring, 'inputs', jsonb_build_object('general', general));
  end if;

  select coalesce(jsonb_agg(
      private.pfe_json(e.*)
        || jsonb_build_object('project_id', e.project_id, 'category_name', c.name)
        || case when e.kind = 'add' then jsonb_build_object('matched_transaction_id', m.transaction_id) else '{}'::jsonb end
      order by e.created_at, e.id), '[]'::jsonb)
  into edits
  from public.project_forecast_edits e
  left join public.categories c on c.id = e.category_id
  left join public.forecast_line_matches m on m.edit_id = e.id and m.month = next_month and m.company_id = e.company_id
  join public.projects p on p.id = e.project_id
  where e.company_id = cid
    and (p.status = 'active' or p.id = overhead)
    and private.pfe_hits(e.start_month, e.pace, next_month);

  -- The later months' edits, with each added edit's matched line by month. Only for 'rest'.
  if rest then
    select coalesce(jsonb_agg(
        private.pfe_json(e.*)
          || jsonb_build_object('project_id', e.project_id, 'category_name', c.name)
          || case when e.kind = 'add' then jsonb_build_object('matches', coalesce((
            select jsonb_object_agg(m.month, m.transaction_id order by m.month)
            from public.forecast_line_matches m
            where m.edit_id = e.id and m.company_id = e.company_id and m.month = any(rest_months)
          ), '{}'::jsonb)) else '{}'::jsonb end
        order by e.created_at, e.id), '[]'::jsonb)
    into rest_edits
    from public.project_forecast_edits e
    left join public.categories c on c.id = e.category_id
    join public.projects p on p.id = e.project_id
    where e.company_id = cid
      and (p.status = 'active' or p.id = overhead)
      and exists (select 1 from unnest(rest_months) rm where private.pfe_hits(e.start_month, e.pace, rm));
  end if;

  -- FLOW-1195, FLOW-1202: each month's skips, next month to the horizon with 'rest', else next month's only.
  select coalesce(jsonb_object_agg(s.month, s.item_keys order by s.month), '{}'::jsonb)
  into month_skips
  from (
    select f.month, jsonb_agg(f.item_key order by f.item_key) as item_keys
    from public.forecast_overrides f
    where f.company_id = cid
      and f.moved_out
      and f.month = any(case when rest then rest_months else array[next_month] end)
    group by f.month
  ) s;

  return jsonb_build_object('recurring', recurring, 'inputs', jsonb_build_object(
    'today', today,
    'month', next_month,
    'overhead_project_id', overhead,
    'projects', projects,
    'general', general,
    'edits', edits,
    'skips', month_skips
  ) || case when rest then jsonb_build_object('rest_edits', rest_edits) else '{}'::jsonb end);
end;
$$;

revoke all on function private.forecast_gather(date, uuid, text) from public, anon, authenticated;
grant execute on function private.forecast_gather(date, uuid, text) to authenticated, service_role;

comment on function private.forecast_gather(date, uuid, text) is
  'FLOW-1320. For the caller''s readable company: expected_months(0, p_project)''s charges (the fields the forecast builds read) and, with p_inputs ''rest'' or ''next'', company_next_month_inputs(p_today, p_inputs = ''rest'')''s answer (''general'': its general costs only), the charges read once. company_forecast and project_forecast read it.';

-- company_forecast: one read for the inputs and the charges.
do $company$
declare
  def text := pg_get_functiondef('public.company_forecast(text[], text, date)'::regprocedure);
begin
  def := pg_temp.swap(def, E'  expected jsonb;\n', E'  gathered jsonb;\n');
  def := pg_temp.swap(def,
    $a$  inputs := public.company_next_month_inputs(today, exists (select 1 from unnest(p_months) m where m <> next_month));
  expected := public.expected_months(0, null, today);$a$,
    $b$  -- FLOW-1320: company_next_month_inputs' answer and expected_months(0)'s charges in one read, the charges read once.
  gathered := private.forecast_gather(today, null,
    case when exists (select 1 from unnest(p_months) m where m <> next_month) then 'rest' else 'next' end);
  inputs := gathered -> 'inputs';$b$);
  def := pg_temp.swap(def, $a$'recurring', coalesce(expected -> 'recurring', '[]'::jsonb),$a$,
    $b$'recurring', coalesce(gathered -> 'recurring', '[]'::jsonb),$b$);
  execute def;
end
$company$;

-- project_forecast: the charges (and the general costs' months) in one read.
do $project$
declare
  def text := pg_get_functiondef('public.project_forecast(uuid, text, date, text)'::regprocedure);
begin
  def := pg_temp.swap(def, E'  cat_list jsonb;\nbegin\n', E'  cat_list jsonb;\n  gathered jsonb;\nbegin\n');
  def := pg_temp.swap(def,
    $a$  if general then
    months := public.company_next_month_inputs(today, false) -> 'general';
  else$a$,
    $b$  -- FLOW-1320: the charges (expected_months(0)'s, of the project unless it is the general costs) and the general
  -- costs' months (company_next_month_inputs') in one read, the charges read once.
  gathered := private.forecast_gather(today, case when general then null else p_project end,
    case when general then 'general' end);
  if general then
    months := gathered -> 'inputs' -> 'general';
  else$b$);
  def := pg_temp.swap(def,
    $a$    'recurring', coalesce(public.expected_months(0, case when general then null else p_project end, today) -> 'recurring', '[]'::jsonb),$a$,
    $b$    'recurring', coalesce(gathered -> 'recurring', '[]'::jsonb),$b$);
  execute def;
end
$project$;

drop function pg_temp.swap(text, text, text);

commit;
