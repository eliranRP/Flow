-- FLOW-1213 (20261115185901): two trims in the database, checked against copies of their bodies from before this change.
-- (a) public.projects_cash_month: with p_project, the answer is the previous body's answer less `unassigned` (only the
--     list reads it); the list (no p_project) is the previous answer exactly. The copy is pg_temp.old_pcm_1213.
-- (b) public.mcp_jev_status: the answer is the previous body's answer with no refusal, with a refusal that holds, and
--     with that refusal made stale by a category rename. The copy is pg_temp.old_jev_1213. With no refused line, the
--     company's key is not read: a trap that raises when private.jev_inputs_key is read shows it (rolled back below).
-- Invented names and example.com emails only. "Today" is 2026-09-20.

begin;

select plan(23);

do $users$
begin
  perform tests.create_supabase_user('fx_a', 'fx-a@example.com');
  perform tests.create_supabase_user('fx_b', 'fx-b@example.com');
end
$users$;

create temp table fx (label text primary key, id uuid);
grant all on fx to authenticated, service_role;

create function pg_temp.fx_id(p_label text) returns uuid language sql stable as $$ select id from pg_temp.fx where label = p_label; $$;
grant execute on function pg_temp.fx_id(text) to authenticated, service_role;

insert into fx (label, id) values
  ('a', tests.fixture_company('fx_a', 'Example Trim One LLC')),
  ('b', tests.fixture_company('fx_b', 'Example Trim Two LLC'));
insert into fx (label, id) values
  ('house', tests.fixture_project(pg_temp.fx_id('a'), 'Example House')),
  ('barn', tests.fixture_project(pg_temp.fx_id('a'), 'Example Barn')),
  ('shed', tests.fixture_project(pg_temp.fx_id('a'), 'Example Shed')),
  ('lark', tests.fixture_project(pg_temp.fx_id('a'), 'Example Lark', 'finished')),
  ('b_house', tests.fixture_project(pg_temp.fx_id('b'), 'Example Other House')),
  ('paint', tests.fixture_category(pg_temp.fx_id('a'), 'Paint')),
  ('sales', tests.fixture_category(pg_temp.fx_id('a'), 'Sales', 'income'));

-- Company A: a project's lines, lines with no project (the unassigned figures), a shared line split to two projects,
-- and one expense waiting in the review queue. Company B: one project's income and one line with no project.
insert into fx (label, id) values
  ('h_in', tests.fixture_line(pg_temp.fx_id('a'), 'fx:h_in', 100000, 'income', pg_temp.fx_id('house'), pg_temp.fx_id('sales'), '2026-09-03')),
  ('h_out', tests.fixture_line(pg_temp.fx_id('a'), 'fx:h_out', 40000, 'expense', pg_temp.fx_id('house'), pg_temp.fx_id('paint'), '2026-09-05')),
  ('h_w', tests.fixture_line(pg_temp.fx_id('a'), 'fx:h_w', 7000, 'expense', pg_temp.fx_id('house'), pg_temp.fx_id('paint'), '2026-09-07')),
  ('b_in', tests.fixture_line(pg_temp.fx_id('a'), 'fx:b_in', 60000, 'income', pg_temp.fx_id('barn'), pg_temp.fx_id('sales'), '2026-09-04')),
  ('u_out', tests.fixture_line(pg_temp.fx_id('a'), 'fx:u_out', 9000, 'expense', null, pg_temp.fx_id('paint'), '2026-09-06')),
  ('u_in', tests.fixture_line(pg_temp.fx_id('a'), 'fx:u_in', 15000, 'income', null, pg_temp.fx_id('sales'), '2026-09-07')),
  ('s_out', tests.fixture_line(pg_temp.fx_id('a'), 'fx:s_out', 20000, 'expense', null, pg_temp.fx_id('paint'), '2026-09-10', p_pnl_role => 'shared')),
  ('bp_in', tests.fixture_line(pg_temp.fx_id('b'), 'fx:bp_in', 30000, 'income', pg_temp.fx_id('b_house'), null, '2026-09-02')),
  ('bu_out', tests.fixture_line(pg_temp.fx_id('b'), 'fx:bu_out', 4000, 'expense', null, null, '2026-09-02'));
insert into public.review_queue (company_id, transaction_id, status, reason)
values (pg_temp.fx_id('a'), pg_temp.fx_id('h_w'), 'open', 'suggested');
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
values (pg_temp.fx_id('a'), pg_temp.fx_id('s_out'), pg_temp.fx_id('barn'), 5000, -10000),
  (pg_temp.fx_id('a'), pg_temp.fx_id('s_out'), pg_temp.fx_id('house'), 3000, -6000);

-- The copies of the bodies before this change (the bodies after 20261115022953, as the database holds them).
create function pg_temp.old_pcm_1213(p_month date DEFAULT NULL::date, p_today date DEFAULT NULL::date, p_project uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  today date := coalesce(p_today, private.flow_today());
  month_start date;
  month_end date;
  basis text;
  base text;
  overhead_id uuid;
  pnl_basis text;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  if p_project is not null and not exists (
    select 1 from public.projects p where p.id = p_project and p.company_id = cid
  ) then
    return null;
  end if;
  select c.cash_basis, c.base_currency, c.overhead_project_id
  into basis, base, overhead_id
  from public.companies c
  where c.id = cid;
  month_start := date_trunc('month', coalesce(p_month, today))::date;
  month_end := (month_start + interval '1 month' - interval '1 day')::date;
  -- The project totals below count as company_pnl(cid, all time, basis) counts its projects'
  -- by_currency, and company_pnl reads
  -- anything but 'invoiced' as the cash basis.
  pnl_basis := case when basis = 'invoiced' then 'invoiced' else 'cash' end;

  with parts as (
    select * from private.cash_parts(cid, basis, month_start, month_end)
    where in_cash
  ),
  direct_parts as (
    select p.transaction_id, p.currency, p.kind, p.project_id as owner_id, p.amount_minor
    from parts p
    where p.pnl_role is distinct from 'shared' and p.project_id is not null
  ),
  unfiled_parts as (
    select p.transaction_id, p.currency, p.kind, null::uuid as owner_id, p.amount_minor
    from parts p
    where p.pnl_role is distinct from 'shared' and p.project_id is null
  ),
  shared_parts as (
    select
      p.transaction_id, p.part, p.category_id, p.project_id as part_project_id, p.currency, p.kind, p.amount_minor,
      least(coalesce(sum(a.share_bp), 0), 10000) as total_bp
    from parts p
    left join public.allocations a on a.transaction_id = p.transaction_id and a.company_id = cid
    where p.pnl_role = 'shared'
    group by p.transaction_id, p.part, p.category_id, p.project_id, p.currency, p.kind, p.amount_minor
  ),
  shared_alloc as (
    select
      sp.transaction_id, sp.part, sp.category_id, sp.part_project_id, sp.currency, sp.kind, sp.amount_minor,
      a.project_id,
      a.share_bp,
      private.div_half_even(sp.amount_minor::numeric * a.share_bp, 10000::numeric) as share_minor,
      private.div_half_even(sp.amount_minor::numeric * sp.total_bp, 10000::numeric) as alloc_total
    from shared_parts sp
    join public.allocations a on a.transaction_id = sp.transaction_id and a.company_id = cid
  ),
  shared_owned as (
    select
      x.transaction_id, x.currency, x.kind, x.project_id as owner_id,
      (x.share_minor + case
        when row_number() over (partition by x.transaction_id, x.part, x.category_id, x.part_project_id, x.amount_minor order by x.share_bp desc, x.project_id) = 1
          then x.alloc_total - sum(x.share_minor) over (partition by x.transaction_id, x.part, x.category_id, x.part_project_id, x.amount_minor)
        else 0
      end)::bigint as amount_minor
    from shared_alloc x
  ),
  shared_unassigned as (
    select
      sp.transaction_id, sp.currency, sp.kind, null::uuid as owner_id,
      (sp.amount_minor - private.div_half_even(sp.amount_minor::numeric * sp.total_bp, 10000::numeric))::bigint as amount_minor
    from shared_parts sp
  ),
  attributed as (
    select * from direct_parts
    union all select * from unfiled_parts
    union all select * from shared_owned
    union all select * from shared_unassigned
  ),
  project_cash as (
    select
      a.owner_id, a.currency,
      coalesce(sum(a.amount_minor) filter (where a.kind = 'income'), 0)::bigint as in_minor,
      coalesce(sum(-a.amount_minor) filter (where a.kind = 'expense'), 0)::bigint as out_minor
    from attributed a
    where a.owner_id is not null
    group by a.owner_id, a.currency
  ),
  unassigned_cash as (
    select
      a.currency,
      coalesce(sum(a.amount_minor) filter (where a.kind = 'income'), 0)::bigint as in_minor,
      coalesce(sum(-a.amount_minor) filter (where a.kind = 'expense'), 0)::bigint as out_minor
    from attributed a
    where a.owner_id is null
    group by a.currency
  ),
  unassigned_lines as (
    select count(distinct a.transaction_id)::integer as n
    from attributed a
    where a.owner_id is null and a.amount_minor <> 0
  ),
  -- The company's lines, read once: the project totals and every project's first month.
  pnl as materialized (
    select
      l.transaction_id, l.project_id, l.kind, l.pnl_role, l.direction, l.doc_kind, l.currency,
      l.amount_net, l.line_amount_net, l.in_pnl, l.unpaid, l.doc_date
    from private.pnl_lines l
    where l.company_id = cid
  ),
  pnl_counted as (
    select
      l.transaction_id, l.project_id, l.kind, l.pnl_role, l.currency, l.amount_net, l.line_amount_net
    from pnl l
    where l.in_pnl
      and (pnl_basis = 'invoiced' or not l.unpaid)
      and (
        l.kind = 'expense'
        or (
          l.kind = 'income'
          and (
            l.direction = 'expense'
            or (pnl_basis = 'cash' and l.doc_kind in ('receipt', 'invoice_receipt'))
            or (pnl_basis = 'invoiced' and l.doc_kind in ('invoice', 'credit', 'invoice_receipt'))
          )
        )
      )
  ),
  pnl_parts as (
    select l.project_id, l.currency, l.amount_net as income_net, 0::bigint as direct_net, 0::bigint as shared_net
    from pnl_counted l
    where l.kind = 'income'
    union all
    select l.project_id, l.currency, 0::bigint, l.amount_net, 0::bigint
    from pnl_counted l
    where l.kind = 'expense' and l.pnl_role = 'project' and l.project_id is not null
    union all
    select a.project_id, l.currency, 0::bigint, 0::bigint,
      coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    from pnl_counted l
    join public.allocations a on a.transaction_id = l.transaction_id
    where l.kind = 'expense' and l.pnl_role = 'shared'
  ),
  -- Per project and currency, company_pnl's income_net, direct_net and shared_net for all time.
  pnl_sums as (
    select
      x.project_id,
      x.currency,
      coalesce(sum(x.income_net), 0)::bigint as all_income,
      coalesce(sum(x.direct_net), 0)::bigint as all_direct,
      coalesce(sum(x.shared_net), 0)::bigint as all_shared
    from pnl_parts x
    where x.project_id is not null
    group by x.project_id, x.currency
  ),
  pnl_projects as (
    select
      s.project_id,
      s.currency,
      s.all_income + s.all_direct + s.all_shared as profit_all,
      (-s.all_direct) + (-s.all_shared) as spent_all
    from pnl_sums s
  ),
  -- Every project's lines (filed, shared or split to it, as private.project_line_ids lists them)
  -- and the month of the earliest.
  project_lines as (
    select t.project_id, t.id as transaction_id
    from public.transactions t
    where t.company_id = cid and t.project_id is not null
    union
    select a.project_id, a.transaction_id
    from public.allocations a
    where a.company_id = cid
    union
    select s.project_id, s.transaction_id
    from private.split_parts s
    where s.company_id = cid and s.project_id is not null
  ),
  first_months as (
    select pl.project_id, to_char(date_trunc('month', min(l.doc_date)), 'YYYY-MM-DD') as first_month
    from project_lines pl
    join pnl l on l.transaction_id = pl.transaction_id
    group by pl.project_id
  ),
  -- Every project's waiting lines, counted as project_waiting lists them (its row rule, grouped by project).
  waiting as (
    select t.project_id
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where q.company_id = cid
      and q.status = 'open'
      and t.removed_at is null
      and t.line_status <> 'pending'
      and t.direction = 'expense'
      and t.pnl_role = 'project'
      and t.project_id is not null
    union all
    select t.project_id
    from public.transactions t
    where t.company_id = cid
      and t.project_id is not null
      and t.direction = 'expense'
      and t.pnl_role = 'project'
      and t.removed_at is null
      and t.line_status <> 'pending'
      and t.category_suggested
      and not exists (
        select 1
        from public.review_queue q
        where q.transaction_id = t.id
          and q.company_id = t.company_id
          and q.status = 'open'
      )
  ),
  waiting_counts as (
    select w.project_id, count(*)::integer as n
    from waiting w
    group by w.project_id
  ),
  project_rows as (
    select
      p.id,
      p.name,
      p.state_label as type,
      p.status::text as status,
      p.id is not distinct from overhead_id as is_overhead,
      p.created_at,
      p.finished_on,
      p.budget_agorot as budget_minor,
      coalesce((select r.spent_all from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as spent_minor,
      coalesce((select r.profit_all from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as profit_all_minor,
      (select f.first_month from first_months f where f.project_id = p.id) as first_month,
      -- FLOW-1204: the project menu's two figures, for the one project asked for only.
      case when p_project is not null then coalesce((select wc.n from waiting_counts wc where wc.project_id = p.id), 0) end as pending_count,
      case when p_project is not null then private.project_is_empty(cid, p.id) end as deletable,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', pc.currency,
          'in_minor', pc.in_minor,
          'out_minor', pc.out_minor,
          'net_minor', pc.in_minor - pc.out_minor
        ) order by pc.currency is distinct from base, pc.currency)
        from project_cash pc
        where pc.owner_id = p.id
      ), '[]'::jsonb) as cash
    from public.projects p
    where p.company_id = cid
      and (p_project is null or p.id = p_project)
  )
  select jsonb_build_object(
    'base_currency', base,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'type', r.type,
        'status', r.status,
        'is_overhead', r.is_overhead,
        'created_at', r.created_at,
        'finished_on', r.finished_on,
        'budget_minor', r.budget_minor,
        'spent_minor', r.spent_minor,
        'cash', r.cash,
        'profit_all_minor', r.profit_all_minor,
        'first_month', r.first_month
      ) || case when p_project is not null
        then jsonb_build_object('pending_count', r.pending_count, 'deletable', r.deletable)
        else '{}'::jsonb end order by r.name)
      from project_rows r
    ), '[]'::jsonb),
    'unassigned', jsonb_build_object(
      'count', (select n from unassigned_lines),
      'cash', coalesce((
        select jsonb_agg(jsonb_build_object(
          'currency', uc.currency,
          'in_minor', uc.in_minor,
          'out_minor', uc.out_minor,
          'net_minor', uc.in_minor - uc.out_minor
        ) order by uc.currency is distinct from base, uc.currency)
        from unassigned_cash uc
      ), '[]'::jsonb)
    )
  )
  into result;

  return result;
end;
$function$;

grant execute on function pg_temp.old_pcm_1213(date, date, uuid) to authenticated, service_role;

create function pg_temp.old_jev_1213()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cid uuid;
  integration public.company_integrations%rowtype;
  last_run timestamptz;
  waiting integer;
  filled_today integer;
  filled_open integer;
  refused_key text;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into integration
  from public.company_integrations ci
  where ci.company_id = cid and ci.provider = 'jev';
  -- FLOW-1206: the refused lines are compared with one key, read once per call (whether or not the
  -- company has a refusal).
  refused_key := private.jev_inputs_key(cid);
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
  select count(*)::integer into filled_today
  from public.jev_prefills jp
  where jp.company_id = cid and jp.undone_at is null
    and jp.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  select count(distinct jp.transaction_id)::integer into filled_open
  from public.jev_prefills jp
  join public.transactions t on t.company_id = jp.company_id and t.id = jp.transaction_id
  where jp.company_id = cid and jp.undone_at is null and t.removed_at is null
    and (
      select q.status from public.review_queue q
      where q.company_id = cid and q.transaction_id = jp.transaction_id
      order by q.created_at desc, q.updated_at desc, q.id desc
      limit 1
    ) = 'open';
  return jsonb_build_object(
    'enabled', coalesce(integration.enabled, false)
      and coalesce(integration.mode, 'off') in ('shadow', 'auto'),
    'mode', coalesce(integration.mode, 'off'),
    'threshold', coalesce(integration.threshold, 0.90),
    'daily_call_cap', coalesce(integration.daily_call_cap, 200),
    'calls_today', private.jev_calls_today(cid),
    'last_run_at', last_run,
    'lines_without_suggestion', waiting,
    'prefilled_today', filled_today,
    'prefilled_open', filled_open,
    -- FLOW-1168: open lines Jev refused as invalid; not sent again until they change (30 days at most).
    'lines_not_retried', (
      select count(*)::integer
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
        )
        and exists (
          select 1 from public.jev_line_failures f
          where f.transaction_id = t.id
            and f.model_version = 'jev-1.13.0'
            and f.refused_at is not null
            and f.retry_after > now()
            and f.refused_inputs = refused_key
        )
    )
  );
end;
$function$;

grant execute on function pg_temp.old_jev_1213() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- A. projects_cash_month
-- ---------------------------------------------------------------------------------------------
create function pg_temp.new(p_month date, p_project text default null) returns jsonb language sql stable as $$
  select public.projects_cash_month(p_month, '2026-09-20', pg_temp.fx_id(p_project));
$$;
grant execute on function pg_temp.new(date, text) to authenticated, service_role;

create function pg_temp.old(p_month date, p_project text default null) returns jsonb language sql stable as $$
  select pg_temp.old_pcm_1213(p_month, '2026-09-20', pg_temp.fx_id(p_project));
$$;
grant execute on function pg_temp.old(date, text) to authenticated, service_role;

select tests.authenticate_as('fx_a');

select ok((pg_temp.old('2026-09-01')->'unassigned'->>'count')::int > 0,
  'fixture: the list has lines with no project, so the unassigned figures are not empty');
select is(pg_temp.new('2026-09-01'), pg_temp.old('2026-09-01'), 'the list is the previous answer exactly (September)');
select is(pg_temp.new('2026-07-01'), pg_temp.old('2026-07-01'), 'the list is the previous answer exactly (July)');
select is(pg_temp.new('2026-09-01', 'house'), pg_temp.old('2026-09-01', 'house') - 'unassigned', 'the house: the previous answer less unassigned');
select is(pg_temp.new('2026-09-01', 'barn'), pg_temp.old('2026-09-01', 'barn') - 'unassigned', 'the barn (a share of a shared line)');
select is(pg_temp.new('2026-09-01', 'shed'), pg_temp.old('2026-09-01', 'shed') - 'unassigned', 'the shed (empty)');
select is(pg_temp.new('2026-09-01', 'lark'), pg_temp.old('2026-09-01', 'lark') - 'unassigned', 'the finished project');
select is(pg_temp.new('2026-07-01', 'house'), pg_temp.old('2026-07-01', 'house') - 'unassigned', 'the house in July');
select ok((pg_temp.new('2026-09-01', 'house')->'unassigned') is null, 'one project''s answer has no unassigned key');
select is(pg_temp.new('2026-09-01', 'b_house'), null::jsonb, 'another company''s project is not read');
select is(pg_temp.old('2026-09-01', 'b_house'), null::jsonb, 'as before');

select tests.authenticate_as('fx_b');
select is(pg_temp.new('2026-09-01'), pg_temp.old('2026-09-01'), 'company B: the list is the previous answer exactly');
select is(pg_temp.new('2026-09-01', 'b_house'), pg_temp.old('2026-09-01', 'b_house') - 'unassigned', 'company B: its project, less unassigned');

-- ---------------------------------------------------------------------------------------------
-- B. mcp_jev_status
-- ---------------------------------------------------------------------------------------------
select tests.clear_authentication();
reset role;
insert into public.company_integrations (company_id, provider, enabled, mode)
values (pg_temp.fx_id('a'), 'jev', true, 'auto'), (pg_temp.fx_id('b'), 'jev', true, 'auto');

select tests.authenticate_as('fx_b');
select is(public.mcp_jev_status(), pg_temp.old_jev_1213(), 'company B, no refusal: mcp_jev_status answers as before');

select tests.authenticate_as('fx_a');
select is(public.mcp_jev_status(), pg_temp.old_jev_1213(), 'company A, no refusal: mcp_jev_status answers as before');
select is((public.mcp_jev_status()->>'lines_not_retried')::int, 0, 'company A, no refusal: no line is not retried');

-- Line u_out is refused as invalid (the job's call), with the inputs the company has now.
select tests.clear_authentication();
reset role;
insert into public.review_queue (company_id, transaction_id, status)
values (pg_temp.fx_id('a'), pg_temp.fx_id('u_out'), 'open');
set role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.jev_mark_failed(pg_temp.fx_id('a'), pg_temp.fx_id('u_out'), 'jev-1.13.0', true);
reset role;

select tests.authenticate_as('fx_a');
select is(public.mcp_jev_status(), pg_temp.old_jev_1213(), 'company A, a refusal that holds: mcp_jev_status answers as before');
select is((public.mcp_jev_status()->>'lines_not_retried')::int, 1, 'company A, a refusal that holds: one line is not retried');

-- A category rename changes company A's inputs key, so the refusal holds nothing.
select tests.clear_authentication();
reset role;
update public.categories set name = 'Paint and Upkeep' where id = pg_temp.fx_id('paint');
select tests.authenticate_as('fx_a');
select is(public.mcp_jev_status(), pg_temp.old_jev_1213(), 'company A, a refusal made stale: mcp_jev_status answers as before');
select is((public.mcp_jev_status()->>'lines_not_retried')::int, 0, 'company A, a refusal made stale: no line is not retried');

select tests.authenticate_as('fx_b');
select is(public.mcp_jev_status(), pg_temp.old_jev_1213(), 'company B, after A''s refusal: mcp_jev_status answers as before');

-- Trap: the key raises when read. Company B has no refused line and never reads it; company A's refusal is still
-- there, so it does. Rolled back with the rest of this file.
select tests.clear_authentication();
reset role;
create or replace function private.jev_inputs_key(p_company uuid) returns text language plpgsql stable set search_path = ''
as $$ begin raise exception 'jev_inputs_key read'; end $$;
select tests.authenticate_as('fx_b');
select lives_ok($$select public.mcp_jev_status()$$, 'company B, no refused line: the key is not read');
select tests.authenticate_as('fx_a');
select throws_ok($$select public.mcp_jev_status()$$, 'jev_inputs_key read', 'company A, a refused line: the key is read');

select * from finish();
rollback;
