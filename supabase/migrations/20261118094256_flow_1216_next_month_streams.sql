-- FLOW-1216 (perf, Company profit): company_next_month_inputs is the heaviest read. As Flow QA, read-only, its
-- 178 ms (slim) split as: 58 ms the projects' category months (project_category_months_lean), about 115 ms the
-- `general` part, and a few ms the edits. Inside `general`, the `streams` CTE (the lines of each recurring charge,
-- which the general rows leave out) took 22 ms for private.recurring_stream_lines and 81 ms for
-- private.recurring_parties, which reads recurring_stream_lines a second time and then builds, for every charge,
-- what the forecast never reads here: the cycle's usual day and amount, the last bill, this month's lines, the loan
-- flag, and the category (the picks join, the heaviest). `streams` needs only which charges are recurring.
--
-- New private.recurring_charge_lines_of_projects(company, today): the stream lines (read once) of every recurring
-- charge that has a project, as (id, stream_project). A charge is recurring exactly as recurring_parties says:
-- its `parties` (auto-detected or marked by the owner) and `forced` (marked, with no complete month yet) rows. Those
-- two CTEs and what they read (lines, monthly, gapped, stats, detected, main, overrides, words) are copied from
-- recurring_parties as it stands (20261019063254 and later); the rest of its body is left out. When
-- recurring_parties' detection changes, change this too: supabase/tests/database/flow_1216_next_month_streams.test.sql
-- compares the two on a fixture with several paces, an owner word and a forced charge.
--
-- company_next_month_inputs is patched in place (the anchor must match exactly once): its `streams` CTE reads the
-- new function. The same ids come out, so the answer is the same. Grants, security definer, search_path and the
-- signature are unchanged; the new function is private and closed to every API role, like recurring_parties.

begin;

set local lock_timeout = '5s';

create or replace function private.recurring_charge_lines_of_projects(p_company uuid, p_today date)
returns table(id uuid, stream_project uuid)
language sql
stable
security definer
set search_path to ''
as $function$
  with bounds as (
    select date_trunc('month', p_today)::date as this_month,
      (date_trunc('month', p_today) - interval '6 months')::date as window6
  ),
  lines as (
    select sl.direction, sl.party_id, sl.currency, sl.stream_project, sl.doc_date, sl.amount_net,
      date_trunc('month', sl.doc_date)::date as month, sl.id
    from private.recurring_stream_lines(p_company, p_today) sl
  ),
  overrides as (
    select o.direction, o.party_id, o.currency, o.project_id, o.recurring
    from public.recurring_overrides o
    where o.company_id = p_company
  ),
  monthly as (
    select l.direction, l.party_id, l.currency, l.stream_project, l.month,
      sum(l.amount_net) as amount, min(extract(day from l.doc_date))::integer as first_day
    from lines l, bounds b
    where l.month < b.this_month
    group by l.direction, l.party_id, l.currency, l.stream_project, l.month
  ),
  gapped as (
    select m.*,
      private.month_diff(m.month, lag(m.month) over w) as gap,
      row_number() over (partition by m.direction, m.party_id, m.currency, m.stream_project order by m.month desc) as back
    from monthly m
    window w as (partition by m.direction, m.party_id, m.currency, m.stream_project order by m.month)
  ),
  stats as (
    select g.direction, g.party_id, g.currency, g.stream_project,
      (count(*) filter (where g.month >= b.window6))::integer as months6,
      coalesce(bool_or(g.month >= (b.this_month - interval '2 months')::date), false) as recent,
      count(*)::integer as months24,
      max(g.month) as last_month,
      max(g.gap) filter (where g.back = 1) as gap_last,
      max(g.gap) filter (where g.back = 2) as gap_prev
    from gapped g, bounds b
    group by g.direction, g.party_id, g.currency, g.stream_project
  ),
  detected as (
    select s.*,
      case
        when s.months24 >= 3 and s.gap_last = 2 and s.gap_prev = 2
          and private.month_diff(b.this_month, s.last_month) <= 4 then '2months'
        when s.months24 >= 3 and s.gap_last = 3 and s.gap_prev = 3
          and private.month_diff(b.this_month, s.last_month) <= 6 then 'quarter'
        when s.months6 >= 3 and s.recent then 'month'
        when s.months24 >= 2 and s.gap_last between 11 and 13
          and private.month_diff(b.this_month, s.last_month) <= 13 then 'year'
      end as auto_pace
    from stats s, bounds b
  ),
  main as (
    select distinct on (l.direction, l.party_id, l.currency) l.direction, l.party_id, l.currency, l.stream_project
    from lines l, bounds b
    group by l.direction, l.party_id, l.currency, l.stream_project
    order by l.direction, l.party_id, l.currency,
      count(distinct l.month) filter (where l.month >= b.window6 and l.month < b.this_month) desc, max(l.doc_date) desc,
      l.stream_project nulls last
  ),
  words as (
    select s.direction, s.party_id, s.currency, s.stream_project,
      coalesce(own.recurring, case
        when pw.recurring is false then false
        when pw.recurring and s.stream_project is not distinct from mn.stream_project then true
      end) as recurring
    from (select distinct l.direction, l.party_id, l.currency, l.stream_project from lines l) s
    left join main mn on mn.direction = s.direction and mn.party_id = s.party_id and mn.currency = s.currency
    left join overrides own on own.direction = s.direction and own.party_id = s.party_id and own.currency = s.currency
      and own.project_id = s.stream_project
    left join overrides pw on pw.direction = s.direction and pw.party_id = s.party_id and pw.currency = s.currency
      and pw.project_id is null
  ),
  parties as (
    select d.direction, d.party_id, d.currency, d.stream_project
    from detected d
    left join words w on w.direction = d.direction and w.party_id = d.party_id and w.currency = d.currency
      and w.stream_project is not distinct from d.stream_project
    where case
      when w.recurring is false then false
      when d.auto_pace is not null then true
      else coalesce(w.recurring, false)
    end
  ),
  forced as (
    select distinct l.direction, l.party_id, l.currency, l.stream_project
    from lines l
    join words w on w.direction = l.direction and w.party_id = l.party_id and w.currency = l.currency
      and w.stream_project is not distinct from l.stream_project
    where w.recurring
      and not exists (
        select 1 from stats s
        where s.direction = l.direction and s.party_id = l.party_id and s.currency = l.currency
          and s.stream_project is not distinct from l.stream_project
      )
  ),
  charges as (
    select p.direction, p.party_id, p.currency, p.stream_project from parties p
    union
    select f.direction, f.party_id, f.currency, f.stream_project from forced f
  )
  select l.id, l.stream_project
  from lines l
  join charges c on c.direction = l.direction and c.party_id = l.party_id and c.currency = l.currency
    and c.stream_project = l.stream_project
  where l.stream_project is not null;
$function$;

revoke all on function private.recurring_charge_lines_of_projects(uuid, date) from public, anon, authenticated;

do $flow_1216$
declare
  def text;
  n integer;
  a text;
  b text;
begin
  def := pg_get_functiondef('public.company_next_month_inputs(date,boolean)'::regprocedure);
  a := $a$    select sl.id
    from private.recurring_stream_lines(cid, today) sl
    join private.recurring_parties(cid, today) rp
      on rp.direction = sl.direction and rp.party_id = sl.party_id and rp.currency = sl.currency
      and rp.project_id = sl.stream_project
    join public.projects sp on sp.id = sl.stream_project and sp.status = 'active'
    where sl.stream_project is not null
      and sl.stream_project is distinct from overhead
  ),$a$;
  b := $n$    -- FLOW-1216: from private.recurring_charge_lines_of_projects (the recurring charges' lines, read once,
    -- without the detail recurring_parties builds that this answer never reads).
    select sl.id
    from private.recurring_charge_lines_of_projects(cid, today) sl
    join public.projects sp on sp.id = sl.stream_project and sp.status = 'active'
    where sl.stream_project is distinct from overhead
  ),$n$;
  n := (char_length(def) - char_length(replace(def, a, ''))) / char_length(a);
  if n <> 1 then
    raise exception 'company_next_month_inputs is not the expected definition (streams %)', n;
  end if;
  def := replace(def, a, b);
  execute def;
end
$flow_1216$;

commit;
