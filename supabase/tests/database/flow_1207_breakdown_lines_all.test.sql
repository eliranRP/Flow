-- FLOW-1207: get_breakdown_lines with no group key reads every counted line of a direction, paged. Parity
-- against a pg_temp copy of the body as it was (20261029190012_category_by_project_parts.sql), read one
-- category at a time, on invented data; amounts are cents.

begin;

select plan(15);

-- The old body, verbatim, renamed.
create or replace function pg_temp.old_breakdown_lines(
  p_direction text,
  p_group_by text,
  p_group_key text,
  p_currency text,
  p_from date default null,
  p_to date default null,
  p_basis text default null,
  p_excluded boolean default false,
  p_limit integer default 40,
  p_offset integer default 0,
  p_project_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  basis text;
  lim integer;
  off integer;
  result jsonb;
begin
  -- FLOW-165: the project first, so another company's project reads as unknown before any other check.
  if p_project_id is not null then
    cid := private.readable_company_id();
    if cid is null then
      return null;
    end if;
    perform 1 from public.projects p where p.id = p_project_id and p.company_id = cid;
    if not found then
      return null;
    end if;
  end if;
  cid := private.breakdown_company(p_direction, p_group_by, p_from, p_to);
  if cid is null then
    return null;
  end if;
  if p_project_id is not null and p_group_by not in ('category', 'parent') then
    raise exception 'validation';
  end if;
  basis := private.pnl_basis(cid, p_basis);
  lim := least(greatest(coalesce(p_limit, 40), 1), 200);
  off := greatest(coalesce(p_offset, 0), 0);

  with src as (
    -- One project reads by project key (its allocation of a shared cost), keyed again by category or parent.
    select x.*,
      case
        when p_project_id is null then x.group_key
        when p_group_by = 'parent' then coalesce(coalesce(pc.parent_id, x.category_id)::text, 'none')
        else coalesce(x.category_id::text, 'none')
      end as drill_key
    from private.breakdown_rows(cid, p_direction, p_from, p_to, basis,
      case when p_project_id is null then p_group_by else 'project' end) x
    left join public.categories pc on p_project_id is not null and p_group_by = 'parent' and pc.id = x.category_id
    where p_project_id is null or x.group_key = p_project_id::text
  ),
  r as (
    select *
    from src x
    where x.currency = coalesce(p_currency, 'ILS')
      and (
        (coalesce(p_excluded, false) and not x.in_pnl)
        or (not coalesce(p_excluded, false) and x.in_pnl and x.drill_key = p_group_key)
      )
  ),
  -- A line split by category can put two parts of one line in the same group; they show
  -- as one row. Each part names its own category and project (loan or line split).
  merged as (
    select
      r.transaction_id,
      r.part,
      r.shared,
      max(r.doc_date) as doc_date,
      sum(r.amount_minor)::bigint as amount_minor,
      case when count(distinct r.category_id) = 1 and count(r.category_id) = count(*) then min(r.category_id::text)::uuid end as category_id,
      case when count(distinct r.project_id) = 1 and count(r.project_id) = count(*) then min(r.project_id::text)::uuid end as project_id,
      bool_or(r.gross_up) as gross_up
    from r
    -- FLOW-989: and by project, so a line's parts on two projects stay two rows, each with its own amount.
    group by r.transaction_id, r.part, r.shared, r.project_id, case when coalesce(p_excluded, false) then r.drill_key end
  ),
  page as (
    select
      m.transaction_id,
      m.part,
      m.amount_minor,
      m.doc_date,
      m.shared,
      t.description,
      t.source,
      sup.name as supplier_name,
      p.name as project_name,
      c.name as category_name,
      m.gross_up,
      m.category_id,
      row_number() over (order by m.doc_date desc, m.transaction_id, m.part, m.shared, m.category_id nulls first, p.name nulls first, m.project_id) as n
    from merged m
    join public.transactions t on t.id = m.transaction_id
    left join public.suppliers sup on sup.id = t.supplier_id
    left join public.projects p on p.id = m.project_id
    left join public.categories c on c.id = m.category_id
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'transaction_id', pg.transaction_id,
        'part', pg.part,
        'description', pg.description,
        'supplier_name', pg.supplier_name,
        'project_name', pg.project_name,
        'category_name', pg.category_name,
        'doc_date', pg.doc_date,
        'currency', coalesce(p_currency, 'ILS'),
        'amount_minor', pg.amount_minor,
        'shared', pg.shared,
        'source', pg.source,
        'kept_out', coalesce(p_excluded, false),
        'gross_up', pg.gross_up,
        'category_id', pg.category_id
      ) order by pg.n)
      from page pg
      where pg.n > off and pg.n <= off + lim
    ), '[]'::jsonb),
    'has_more', exists (select 1 from page pg where pg.n > off + lim),
    -- FLOW-165: the whole group's total and row count, so a screen that loads a page shows the full figure.
    'total_minor', (select coalesce(sum(pg.amount_minor), 0)::bigint from page pg),
    'count', (select count(*)::integer from page pg),
    -- FLOW-989: the whole group by project, read as get_pnl_statement reads by project: a split line by its
    -- parts (each on its own project, only the parts in this group), a shared cost by its allocations, a
    -- whole line by its own project. Keys and names as get_pnl_statement's projects: a project id,
    -- 'overhead', 'unassigned', or null (no project). Largest first. Empty for one project and kept-out lines.
    'projects', case when p_project_id is not null or coalesce(p_excluded, false) or p_group_by not in ('category', 'parent') then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', g.key,
        'project_id', case when g.key in ('overhead', 'unassigned') then null else g.key::uuid end,
        'name', g.name,
        'total_minor', g.total
      ) order by g.total desc, g.name nulls last, g.key nulls first)
      from (
        select x.group_key as key, max(x.group_name) as name, sum(x.amount_minor)::bigint as total
        from private.breakdown_rows(cid, p_direction, p_from, p_to, basis, 'project') x
        left join public.categories pc on p_group_by = 'parent' and pc.id = x.category_id
        where x.currency = coalesce(p_currency, 'ILS')
          and x.in_pnl
          and case
            when p_group_by = 'parent' then coalesce(coalesce(pc.parent_id, x.category_id)::text, 'none')
            else coalesce(x.category_id::text, 'none')
          end = p_group_key
        group by x.group_key
        having sum(x.amount_minor) <> 0
      ) g
    ), '[]'::jsonb) end
  ) into result;

  return result;
end;
$$;

grant execute on function pg_temp.old_breakdown_lines(text, text, text, text, date, date, text, boolean, integer, integer, uuid) to authenticated;

do $users$
begin
  perform tests.create_supabase_user('bla_owner', 'bla-owner@example.com');
  perform tests.create_supabase_user('bla_other', 'bla-other@example.com');
end
$users$;

create temp table bla_ref (label text primary key, id uuid);
grant all on bla_ref to authenticated;

create function pg_temp.ref(l text) returns uuid
language sql stable
as $$ select id from bla_ref where label = l $$;

grant execute on function pg_temp.ref(text) to authenticated;

select tests.authenticate_as('bla_owner');
select public.create_company('Example All Lines LLC', true);
select public.upsert_project(null, 'Site Alpha', null, 'active');
select public.upsert_project(null, 'Site Beta', null, 'active');
insert into bla_ref (label, id) select 'co', id from public.companies where name = 'Example All Lines LLC';
insert into bla_ref (label, id) select lower(replace(name, 'Site ', '')), id from public.projects where name like 'Site %';

select tests.authenticate_as('bla_other');
select public.create_company('Other Lines Co', true);

reset role;

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values
  (pg_temp.ref('co'), 'Example repairs', 'expense', 61, false, false),
  (pg_temp.ref('co'), 'Example renovation', 'expense', 62, false, false),
  (pg_temp.ref('co'), 'Example deposit', 'expense', 63, false, true),
  (pg_temp.ref('co'), 'Example rent', 'income', 64, false, false),
  (pg_temp.ref('co'), 'Example fees', 'income', 65, false, false);
insert into bla_ref (label, id) select 'repairs', id from public.categories where company_id = pg_temp.ref('co') and name = 'Example repairs';
insert into bla_ref (label, id) select 'reno', id from public.categories where company_id = pg_temp.ref('co') and name = 'Example renovation';
insert into bla_ref (label, id) select 'deposit', id from public.categories where company_id = pg_temp.ref('co') and name = 'Example deposit';
insert into bla_ref (label, id) select 'rent', id from public.categories where company_id = pg_temp.ref('co') and name = 'Example rent';
insert into bla_ref (label, id) select 'fees', id from public.categories where company_id = pg_temp.ref('co') and name = 'Example fees';

-- Expenses: five on repairs (two on one day with equal amounts), two on renovation, a line split across repairs
-- and renovation, a shared cost, an uncategorized line, a kept-out deposit, and an ILS line (another currency).
-- Income: rent twice, fees once.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select pg_temp.ref('co'), v.dir::public.txn_direction, (case when v.dir = 'income' then 'invoice' else 'expense' end)::public.doc_kind,
  v.role::public.pnl_role, 'posted', v.cur, v.amount, v.amount, abs(v.amount), 0, 'source',
  v.d::date, v.d::date, 'manual', 'bla:' || v.ikey, pg_temp.ref(v.proj), pg_temp.ref(v.cat), v.ikey, true
from (values
  ('r1',     'expense', -10000,  '2026-06-01', 'alpha', 'repairs', 'project', 'USD'),
  ('r2',     'expense', -20000,  '2026-06-05', 'alpha', 'repairs', 'project', 'USD'),
  ('r3',     'expense', -20000,  '2026-06-05', 'beta',  'repairs', 'project', 'USD'),
  ('r4',     'expense', -5000,   '2026-06-20', null,    'repairs', 'project', 'USD'),
  ('r5',     'expense', -7000,   '2026-06-28', 'beta',  'repairs', 'project', 'USD'),
  ('n1',     'expense', -90000,  '2026-06-03', 'alpha', 'reno',    'project', 'USD'),
  ('n2',     'expense', -30000,  '2026-06-15', 'beta',  'reno',    'project', 'USD'),
  ('split',  'expense', -80000,  '2026-06-10', 'alpha', 'repairs', 'project', 'USD'),
  ('shared', 'expense', -10000,  '2026-06-12', null,    'repairs', 'shared',  'USD'),
  ('loose',  'expense', -4000,   '2026-06-08', 'alpha', null,      'project', 'USD'),
  ('dep',    'expense', -150000, '2026-06-09', 'alpha', 'deposit', 'project', 'USD'),
  ('ils',    'expense', -6000,   '2026-06-11', 'alpha', 'repairs', 'project', 'ILS'),
  ('i1',     'income',  300000,  '2026-06-02', 'alpha', 'rent',    'project', 'USD'),
  ('i2',     'income',  300000,  '2026-06-30', 'beta',  'rent',    'project', 'USD'),
  ('i3',     'income',  12000,   '2026-06-14', 'alpha', 'fees',    'project', 'USD')
) as v(ikey, dir, amount, d, proj, cat, role, cur);
insert into bla_ref (label, id) select substr(idempotency_key, 5), id from public.transactions where idempotency_key like 'bla:%';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, pg_temp.ref(s.proj), s.bp, t.amount_net * s.bp / 10000
from public.transactions t
join (values ('alpha', 6000), ('beta', 4000)) as s(proj, bp) on true
where t.idempotency_key = 'bla:shared';
select private.set_line_parts(pg_temp.ref('co'), pg_temp.ref('split'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.ref('repairs'), 'project_id', pg_temp.ref('alpha'), 'amount_minor', 50000),
  jsonb_build_object('category_id', pg_temp.ref('repairs'), 'project_id', pg_temp.ref('beta'), 'amount_minor', 10000),
  jsonb_build_object('category_id', pg_temp.ref('reno'), 'project_id', pg_temp.ref('beta'), 'amount_minor', 20000)));

select tests.authenticate_as('bla_owner');

-- The whole direction in one read (no key) against the old read one key at a time, for each direction.
create temp table bla_new as
select d.dir, public.get_breakdown_lines(d.dir, 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', false, 200, 0) as body
from (values ('expense'), ('income')) d(dir);
grant all on bla_new to authenticated;

create function pg_temp.new_by_key(p_dir text) returns jsonb
language sql stable
as $$
  select coalesce(jsonb_object_agg(k, arr), '{}'::jsonb)
  from (
    select x ->> 'group_key' as k, jsonb_agg(x - 'group_key' order by n) as arr
    from bla_new b, jsonb_array_elements(b.body -> 'rows') with ordinality t(x, n)
    where b.dir = p_dir
    group by 1
  ) s
$$;

create function pg_temp.old_by_key(p_dir text) returns jsonb
language sql stable
as $$
  -- FLOW-1211, FLOW-1228: the no-key row has no category_id, kept_out, category_name, currency or shared (the keyed read's row less those).
  select coalesce(jsonb_object_agg(g ->> 'key', (
    select coalesce(jsonb_agg(r - 'category_id' - 'kept_out' - 'category_name' - 'currency' - 'shared' order by n), '[]'::jsonb)
    from jsonb_array_elements(pg_temp.old_breakdown_lines(p_dir, 'category', g ->> 'key', 'USD', '2026-06-01', '2026-06-30', 'cash', false, 200, 0) -> 'rows') with ordinality t(r, n))), '{}'::jsonb)
  from jsonb_array_elements(public.get_breakdown(p_dir, '2026-06-01', '2026-06-30', 'category', 'cash') -> 'groups') g
  where g ->> 'currency' = 'USD' and g ->> 'key' <> ''
$$;

grant execute on function pg_temp.new_by_key(text), pg_temp.old_by_key(text) to authenticated;

select is(pg_temp.new_by_key('expense'), pg_temp.old_by_key('expense'), 'expense: each category''s rows equal the keyed read''s, field for field and in order');
select is(pg_temp.new_by_key('income'), pg_temp.old_by_key('income'), 'income: each category''s rows equal the keyed read''s, field for field and in order');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(pg_temp.new_by_key('expense')) k),
  (select array_agg(k order by k) from unnest(array['none', pg_temp.ref('repairs')::text, pg_temp.ref('reno')::text]) k),
  'the fixture reads three expense groups: repairs, renovation and no category');
select is(
  (select count(*)::int from bla_new b, jsonb_array_elements(b.body -> 'rows') x where b.dir = 'expense' and x ->> 'category_id' = pg_temp.ref('deposit')::text),
  0, 'a kept-out line is not read');
select is(
  (select count(*)::int from bla_new b, jsonb_array_elements(b.body -> 'rows') x where b.dir = 'expense' and x ->> 'doc_date' = '2026-06-11'),
  0, 'a line in another currency is not read');
select is(
  (select jsonb_build_array(body -> 'count', body -> 'total_minor', jsonb_array_length(body -> 'rows'), body -> 'has_more', body -> 'projects') from bla_new where dir = 'expense'),
  (select jsonb_build_array(
    jsonb_array_length(n.body -> 'rows'),
    (select sum((x ->> 'amount_minor')::bigint) from jsonb_array_elements(n.body -> 'rows') x),
    jsonb_array_length(n.body -> 'rows'), false, '[]'::jsonb) from bla_new n where n.dir = 'expense'),
  'the count and the total are the whole direction''s, with no more pages and no project split');
select is(
  (select (body ->> 'total_minor')::bigint from bla_new where dir = 'expense'),
  (select sum((g ->> 'amount_minor')::bigint)::bigint from jsonb_array_elements(public.get_breakdown('expense', '2026-06-01', '2026-06-30', 'category', 'cash') -> 'groups') g where g ->> 'currency' = 'USD'),
  'the total is the breakdown''s counted total');
select is(
  (select array_agg(x ->> 'doc_date' order by n) from bla_new b, jsonb_array_elements(b.body -> 'rows') with ordinality t(x, n) where b.dir = 'expense'),
  (select array_agg(x ->> 'doc_date' order by x ->> 'doc_date' desc) from bla_new b, jsonb_array_elements(b.body -> 'rows') x where b.dir = 'expense'),
  'newest first');

-- Paged by 5: the pages join into the one read, and only the last has no more.
create temp table bla_pages as
select o as off, public.get_breakdown_lines('expense', 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', false, 5, o) as body
from generate_series(0, 10, 5) o;
grant all on bla_pages to authenticated;
select is(
  (select jsonb_agg(x order by p.off, n) from bla_pages p, jsonb_array_elements(p.body -> 'rows') with ordinality t(x, n)),
  (select body -> 'rows' from bla_new where dir = 'expense'),
  'pages of 5 join into the whole read');
select is((select array_agg((body ->> 'has_more')::boolean order by off) from bla_pages), array[true, true, false], 'only the last page has no more');

-- What a key or kept-out read returned stays as it was, with no group_key.
select is(
  public.get_breakdown_lines('expense', 'category', pg_temp.ref('repairs')::text, 'USD', '2026-06-01', '2026-06-30', 'cash'),
  pg_temp.old_breakdown_lines('expense', 'category', pg_temp.ref('repairs')::text, 'USD', '2026-06-01', '2026-06-30', 'cash'),
  'a keyed read is as it was');
select is(
  public.get_breakdown_lines('expense', 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', true),
  pg_temp.old_breakdown_lines('expense', 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', true),
  'a kept-out read is as it was');

-- A read of one project with a null key stays empty, as it was.
select is(
  public.get_breakdown_lines('expense', 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', false, 200, 0, pg_temp.ref('alpha')),
  pg_temp.old_breakdown_lines('expense', 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', false, 200, 0, pg_temp.ref('alpha')),
  'a by-project read with no key is as it was');
select is(
  public.get_breakdown_lines('expense', 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', false, 200, 0, pg_temp.ref('alpha')) -> 'rows',
  '[]'::jsonb,
  'a by-project read with no key has no rows');

-- Another company reads none of these lines.
select tests.authenticate_as('bla_other');
select is(
  public.get_breakdown_lines('expense', 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', false, 200, 0) -> 'rows',
  '[]'::jsonb,
  'another company''s read holds none of them');

select * from finish();

rollback;
