-- FLOW-1205 (20261114123417): expected_months with p_months 0 (the app's read) leaves out recurring[].months_seen,
-- recurring[].source and the top-level project_id: no app reader. With 1 to 13 months (flow-mcp's get_expected_months)
-- the answer is what it was, those fields included, for the company and for a project.
-- Checked against pg_temp.old_expected_months, a copy of the previous body (20261103151207) made here.
-- "Today" is 2026-09-20. Invented data only. Amounts are agorot.

begin;

select plan(20);

do $users$
begin
  perform tests.create_supabase_user('el_owner', 'el-owner@example.com');
  perform tests.create_supabase_user('el_other', 'el-other@example.com');
end
$users$;

create temp table el (label text primary key, id uuid);
grant all on el to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.el where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into el (label, id) values ('co', tests.fixture_company('el_owner', 'Example Expected LLC'));
insert into el (label, id) values ('other_co', tests.fixture_company('el_other', 'Example Other Expected LLC'));
insert into el (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('barn', tests.fixture_project(pg_temp.id('co'), 'Example Barn'));

-- A monthly supplier on the house (June to August: due in September) and a quarterly one with no project (February,
-- May and August: due in November). The barn has no charge.
insert into public.suppliers (company_id, name) values (pg_temp.id('co'), 'Example Power'), (pg_temp.id('co'), 'Example Quarterly');
insert into el (label, id) select 'power', s.id from public.suppliers s where s.company_id = pg_temp.id('co') and s.name = 'Example Power';
insert into el (label, id) select 'quarterly', s.id from public.suppliers s where s.company_id = pg_temp.id('co') and s.name = 'Example Quarterly';
create temp table el_lines (label text, doc_date date, party text, project text, direction text);
insert into el_lines values
  ('p06', '2026-06-05', 'power', 'house', 'expense'), ('p07', '2026-07-05', 'power', 'house', 'expense'),
  ('p08', '2026-08-05', 'power', 'house', 'expense'),
  ('q02', '2026-02-05', 'quarterly', null, 'expense'), ('q05', '2026-05-05', 'quarterly', null, 'expense'),
  ('q08', '2026-08-06', 'quarterly', null, 'expense');
insert into el (label, id)
select l.label, tests.fixture_line(pg_temp.id('co'), 'el:' || l.label, 9000, l.direction,
  pg_temp.id(l.project), null, l.doc_date, p_pnl_role => case when l.project is null then null else 'project' end)
from el_lines l;
update public.transactions t set supplier_id = pg_temp.id(l.party) from el_lines l where t.id = pg_temp.id(l.label);

create function pg_temp.old_expected_months(p_months integer DEFAULT 3, p_project_id uuid DEFAULT NULL::uuid, p_today date DEFAULT NULL::date)
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
  if p_months is null or p_months < 0 or p_months > 13 then
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
    ) || case when p_months > 0 then jsonb_build_object(
      'months', (select jsonb_agg(jsonb_build_object(
          'month', to_char(pm.month, 'YYYY-MM'),
          'open', pm.month = date_trunc('month', today)::date,
          'by_currency', pm.by_currency
        ) order by pm.month) from per_month pm)
    ) else '{}'::jsonb end
  );
end;
$function$;
grant execute on function pg_temp.old_expected_months(integer, uuid, date) to authenticated;

create function pg_temp.new(p_months integer, p_project text default null) returns jsonb language sql stable as $$
  select public.expected_months(p_months, pg_temp.id(p_project), '2026-09-20');
$$;
grant execute on function pg_temp.new(integer, text) to authenticated;

create function pg_temp.old(p_months integer, p_project text default null) returns jsonb language sql stable as $$
  select pg_temp.old_expected_months(p_months, pg_temp.id(p_project), '2026-09-20');
$$;
grant execute on function pg_temp.old(integer, text) to authenticated;

-- The previous p_months 0 answer as it is now: no project_id, and no months_seen or source on a recurring row.
create function pg_temp.as_lean(p_old jsonb) returns jsonb language sql immutable as $$
  select (p_old - 'project_id') || jsonb_build_object('recurring', coalesce((
    select jsonb_agg(r - 'months_seen' - 'source' order by o) from jsonb_array_elements(p_old->'recurring') with ordinality t(r, o)), '[]'::jsonb));
$$;
grant execute on function pg_temp.as_lean(jsonb) to authenticated;

select tests.authenticate_as('el_owner');

-- With months (flow-mcp's): exactly what it was.
select is(pg_temp.new(1), pg_temp.old(1), '1 month: the previous answer');
select is(pg_temp.new(3), pg_temp.old(3), '3 months');
select is(pg_temp.new(13), pg_temp.old(13), '13 months');
select is(pg_temp.new(3, 'house'), pg_temp.old(3, 'house'), 'for the house');
select is(pg_temp.new(2, 'barn'), pg_temp.old(2, 'barn'), 'for the barn (no charge)');
select is(public.expected_months(p_today => '2026-09-20'), pg_temp.old(3), 'the default is 3 months, as before');
select ok(pg_temp.new(1) ? 'project_id' and pg_temp.new(1, 'house')->>'project_id' = pg_temp.id('house')::text
    and (select bool_and(r ? 'months_seen' and r ? 'source') from jsonb_array_elements(pg_temp.new(1)->'recurring') r),
  'with months, the answer has project_id (null for the company, the project''s for a project) and months_seen and source on each charge');
select is((select (r->>'months_seen')::int from jsonb_array_elements(pg_temp.new(3)->'recurring') r where (r->>'party_id')::uuid = pg_temp.id('power')),
  3, 'the house''s supplier was seen in three months');

-- p_months 0 (the app's): the previous answer less those fields.
select is(pg_temp.new(0), pg_temp.as_lean(pg_temp.old(0)), 'p_months 0: the previous answer less project_id, months_seen and source');
select is(pg_temp.new(0, 'house'), pg_temp.as_lean(pg_temp.old(0, 'house')), 'for the house');
select is(pg_temp.new(0, 'barn'), pg_temp.as_lean(pg_temp.old(0, 'barn')), 'for the barn');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.new(0)) k), array['recurring', 'today'], 'its top level is today and recurring');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.new(0)->'recurring'->0) k),
  array['category_id', 'currency', 'direction', 'handover', 'name', 'next_due_month', 'pace', 'party_id', 'pays_loan', 'project_id',
    'seen_this_month', 'typical_amount_minor', 'typical_day'],
  'a recurring row keeps what the app reads (project_id on the row stays: a charge''s project) and has no months_seen or source');
select ok(jsonb_array_length(pg_temp.new(0)->'recurring') = 2 and pg_temp.new(0)->'recurring' = pg_temp.as_lean(pg_temp.new(3))->'recurring',
  'its two charges are the 3 months'' answer''s, less the two fields');
select ok(octet_length(pg_temp.new(0)::text) < octet_length(pg_temp.old(0)::text), 'and the answer is smaller');
select is(pg_temp.as_lean(pg_temp.new(13) - 'months'), pg_temp.new(0), 'the 13 months'' answer less months[] and those fields is the lean one');
select is(jsonb_array_length(pg_temp.new(0, 'house')->'recurring'), 1, 'a project''s lean answer lists only its charge');

-- Refusals are as before.
select throws_ok($$ select public.expected_months(14, null, '2026-09-20') $$, 'validation', 'fourteen months is refused');
select throws_ok($$ select public.expected_months(-1, null, '2026-09-20') $$, 'validation', 'a negative count is refused');

select tests.authenticate_as('el_other');
select is(pg_temp.new(0)->'recurring', '[]'::jsonb, 'another company reads only its own charges');

select * from finish();
rollback;
