-- FLOW-1204, FLOW-1205 (20261114123417): projects_cash_month.
-- - Without p_project (the Projects list): projects[] has neither pending_count nor deletable, the project menu's two
--   figures (two passes over the open review queue and suggested lines, and six index probes per project).
-- - With p_project (the menu reads its own row): both are there, with the values the previous body gave.
-- - No group_id on a row, and no top-level month or basis, in either form (no reader).
-- Everything else is the previous body's answer, checked against pg_temp.old_projects_cash_month, a copy of that body
-- (20261113083534) made here. "Today" is 2026-09-20. Invented data only. Amounts are agorot.

begin;

select plan(23);

do $users$
begin
  perform tests.create_supabase_user('pcm_owner', 'pcm-owner@example.com');
  perform tests.create_supabase_user('pcm_other', 'pcm-other@example.com');
end
$users$;

create temp table pcm (label text primary key, id uuid);
grant all on pcm to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.pcm where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into pcm (label, id) values ('co', tests.fixture_company('pcm_owner', 'Example Menu LLC'));
insert into pcm (label, id) values ('other_co', tests.fixture_company('pcm_other', 'Example Other Menu LLC'));
insert into pcm (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('barn', tests.fixture_project(pg_temp.id('co'), 'Example Barn')),
  ('shed', tests.fixture_project(pg_temp.id('co'), 'Example Shed')),
  ('lark', tests.fixture_project(pg_temp.id('co'), 'Example Lark', 'finished')),
  ('other_house', tests.fixture_project(pg_temp.id('other_co'), 'Example Other House')),
  ('paint', tests.fixture_category(pg_temp.id('co'), 'Paint')),
  ('sales', tests.fixture_category(pg_temp.id('co'), 'Sales', 'income'));

-- The house: income and cost in September, a cost in July; two expenses waiting in the review queue, a third whose
-- category is a guess. The barn: a shared line, half to it. The shed and the finished project: nothing.
insert into pcm (label, id) values
  ('in9', tests.fixture_line(pg_temp.id('co'), 'pcm:in9', 100000, 'income', pg_temp.id('house'), pg_temp.id('sales'), '2026-09-03')),
  ('out9', tests.fixture_line(pg_temp.id('co'), 'pcm:out9', 40000, 'expense', pg_temp.id('house'), pg_temp.id('paint'), '2026-09-05')),
  ('out7', tests.fixture_line(pg_temp.id('co'), 'pcm:out7', 25000, 'expense', pg_temp.id('house'), pg_temp.id('paint'), '2026-07-09')),
  ('w1', tests.fixture_line(pg_temp.id('co'), 'pcm:w1', 7000, 'expense', pg_temp.id('house'), pg_temp.id('paint'), '2026-09-07')),
  ('w2', tests.fixture_line(pg_temp.id('co'), 'pcm:w2', 3000, 'expense', pg_temp.id('house'), pg_temp.id('paint'), '2026-09-08')),
  ('g1', tests.fixture_line(pg_temp.id('co'), 'pcm:g1', 2000, 'expense', pg_temp.id('house'), pg_temp.id('paint'), '2026-09-09',
    p_suggested => true)),
  ('s1', tests.fixture_line(pg_temp.id('co'), 'pcm:s1', 20000, 'expense', null, pg_temp.id('paint'), '2026-09-10', p_pnl_role => 'shared')),
  ('ox', tests.fixture_line(pg_temp.id('other_co'), 'pcm:ox', 5000, 'expense', pg_temp.id('other_house'), null, '2026-09-02'));
insert into public.review_queue (company_id, transaction_id, status, reason)
values (pg_temp.id('co'), pg_temp.id('w1'), 'open', 'suggested'), (pg_temp.id('co'), pg_temp.id('w2'), 'open', 'suggested'),
  (pg_temp.id('other_co'), pg_temp.id('ox'), 'open', 'suggested');
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
values (pg_temp.id('co'), pg_temp.id('s1'), pg_temp.id('barn'), 5000, -10000);

create function pg_temp.old_projects_cash_month(p_month date DEFAULT NULL::date, p_today date DEFAULT NULL::date, p_project uuid DEFAULT NULL::uuid)
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
      p.group_id,
      p.created_at,
      p.finished_on,
      p.budget_agorot as budget_minor,
      coalesce((select r.spent_all from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as spent_minor,
      coalesce((select r.profit_all from pnl_projects r where r.project_id = p.id and r.currency = base), 0) as profit_all_minor,
      (select f.first_month from first_months f where f.project_id = p.id) as first_month,
      coalesce((select wc.n from waiting_counts wc where wc.project_id = p.id), 0) as pending_count,
      private.project_is_empty(cid, p.id) as deletable,
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
    'month', to_char(month_start, 'YYYY-MM-DD'),
    'base_currency', base,
    'basis', basis,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'name', r.name,
        'type', r.type,
        'status', r.status,
        'is_overhead', r.is_overhead,
        'group_id', r.group_id,
        'created_at', r.created_at,
        'finished_on', r.finished_on,
        'budget_minor', r.budget_minor,
        'spent_minor', r.spent_minor,
        'cash', r.cash,
        'profit_all_minor', r.profit_all_minor,
        'first_month', r.first_month,
        'pending_count', r.pending_count,
        'deletable', r.deletable
      ) order by r.name)
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
grant execute on function pg_temp.old_projects_cash_month(date, date, uuid) to authenticated;

-- The previous answer as the list gives it now: no month, basis, group_id, pending_count or deletable.
create function pg_temp.as_list(p_old jsonb) returns jsonb language sql immutable as $$
  select (p_old - 'month' - 'basis') || jsonb_build_object('projects', coalesce((
    select jsonb_agg(r - 'group_id' - 'pending_count' - 'deletable' order by o)
    from jsonb_array_elements(p_old->'projects') with ordinality t(r, o)), '[]'::jsonb));
$$;
grant execute on function pg_temp.as_list(jsonb) to authenticated;

-- ... and as a project's own answer gives it: the same, but pending_count and deletable stay. FLOW-1213: the unassigned
-- figures are the list's only; FLOW-1223: one project's answer holds a constant stub in their place.
create function pg_temp.as_menu(p_old jsonb) returns jsonb language sql immutable as $$
  select (p_old - 'month' - 'basis') || '{"unassigned": {"count": 0, "cash": []}}'::jsonb || jsonb_build_object('projects', coalesce((
    select jsonb_agg(r - 'group_id' order by o)
    from jsonb_array_elements(p_old->'projects') with ordinality t(r, o)), '[]'::jsonb));
$$;
grant execute on function pg_temp.as_menu(jsonb) to authenticated;

create function pg_temp.new(p_month date, p_project text default null) returns jsonb language sql stable as $$
  select public.projects_cash_month(p_month, '2026-09-20', pg_temp.id(p_project));
$$;
grant execute on function pg_temp.new(date, text) to authenticated;

create function pg_temp.old(p_month date, p_project text default null) returns jsonb language sql stable as $$
  select pg_temp.old_projects_cash_month(p_month, '2026-09-20', pg_temp.id(p_project));
$$;
grant execute on function pg_temp.old(date, text) to authenticated;

select tests.authenticate_as('pcm_owner');

-- The list.
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.new('2026-09-01')) k),
  array['base_currency', 'projects', 'unassigned'], 'the list: base_currency, projects and unassigned, no month and no basis');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.new('2026-09-01')->'projects'->0) k),
  array['budget_minor', 'cash', 'created_at', 'finished_on', 'first_month', 'id', 'is_overhead', 'name', 'profit_all_minor',
    'spent_minor', 'status', 'type'],
  'a list row has twelve fields: no pending_count, no deletable, no group_id');
select is(jsonb_array_length(pg_temp.new('2026-09-01')->'projects'), 4, 'the list has the company''s four projects');
select is(pg_temp.new('2026-09-01'), pg_temp.as_list(pg_temp.old('2026-09-01')), 'the list is the previous answer less those fields (September)');
select is(pg_temp.new('2026-07-01'), pg_temp.as_list(pg_temp.old('2026-07-01')), 'another month');
select is(pg_temp.new(null), pg_temp.as_list(pg_temp.old(null)), 'the default month (today in Israel)');

-- A project's own answer.
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.new('2026-09-01', 'house')->'projects'->0) k),
  array['budget_minor', 'cash', 'created_at', 'deletable', 'finished_on', 'first_month', 'id', 'is_overhead', 'name',
    'pending_count', 'profit_all_minor', 'spent_minor', 'status', 'type'],
  'a project''s own row has the two menu fields beside the twelve, and no group_id');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.new('2026-09-01', 'house')) k),
  array['base_currency', 'projects', 'unassigned'], 'and its answer has no month or basis either (FLOW-1223: unassigned is a stub)');
select is(jsonb_array_length(pg_temp.new('2026-09-01', 'house')->'projects'), 1, 'one row');
select is(pg_temp.new('2026-09-01', 'house'), pg_temp.as_menu(pg_temp.old('2026-09-01', 'house')), 'the house: the previous answer less month, basis and group_id, with the unassigned stub');
select is(pg_temp.new('2026-09-01', 'barn'), pg_temp.as_menu(pg_temp.old('2026-09-01', 'barn')), 'the barn');
select is(pg_temp.new('2026-09-01', 'shed'), pg_temp.as_menu(pg_temp.old('2026-09-01', 'shed')), 'the shed');
select is(pg_temp.new('2026-09-01', 'lark'), pg_temp.as_menu(pg_temp.old('2026-09-01', 'lark')), 'the finished project');
select is(pg_temp.new('2026-07-01', 'house'), pg_temp.as_menu(pg_temp.old('2026-07-01', 'house')), 'the house in another month');
select is((pg_temp.new('2026-09-01', 'house')->'projects'->0->>'pending_count')::int, 3,
  'the house waits on three lines: two in the review queue and one whose category is a guess');
select is(pg_temp.new('2026-09-01', 'house')->'projects'->0->>'deletable', 'false', 'the house, with lines, is not deletable');
select is(pg_temp.new('2026-09-01', 'barn')->'projects'->0->>'deletable', 'false', 'the barn, with an allocation, is not deletable');
select is(pg_temp.new('2026-09-01', 'shed')->'projects'->0->>'deletable', 'true', 'the shed, empty, is deletable');
select is((pg_temp.new('2026-09-01', 'shed')->'projects'->0->>'pending_count')::int, 0, 'and waits on nothing');

-- The menu's figures are the list's old ones, project by project.
select is(
  (select jsonb_agg(jsonb_build_object('id', r->>'id', 'pending', r->'pending_count', 'deletable', r->'deletable') order by r->>'id')
   from jsonb_array_elements(pg_temp.old('2026-09-01')->'projects') r),
  (select jsonb_agg(jsonb_build_object('id', p.id::text, 'pending', pg_temp.new('2026-09-01', p.label)->'projects'->0->'pending_count',
      'deletable', pg_temp.new('2026-09-01', p.label)->'projects'->0->'deletable') order by p.id::text)
   from pg_temp.pcm p where p.label in ('house', 'barn', 'shed', 'lark')),
  'one call per project gives, project by project, the two figures the list used to carry');

-- Another company's project is refused, as before; a viewer reads.
select is(pg_temp.new('2026-09-01', 'other_house'), null::jsonb, 'another company''s project is not read');
select is(pg_temp.old('2026-09-01', 'other_house'), null::jsonb, 'as before');

select tests.authenticate_as('pcm_other');
select is(jsonb_array_length(pg_temp.new('2026-09-01')->'projects'), 1, 'another company reads its own project, and no other');

select * from finish();
rollback;
