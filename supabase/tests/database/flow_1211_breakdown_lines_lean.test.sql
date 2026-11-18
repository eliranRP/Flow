-- FLOW-1211: get_breakdown_lines with no key and no limit is one computation. Parity against a pg_temp copy of the body
-- as FLOW-1207 left it (20261114123209_flow_1207_breakdown_lines_all.sql), on invented data; amounts are cents.
-- - The no-key read with a null limit (the new app) of a direction with more than 200 lines is one call: no page,
--   has_more false. With a limit of 200 (the FLOW-1207 app, live on phones) it pages as before.
-- - Its rows are the keyed row less category_id, kept_out, category_name, currency and shared (FLOW-1228), with
--   group_key: per category they equal the keyed read's rows less those five, in order; with category_id put back they
--   equal the keyed rows less kept_out, category_name, currency and shared.
-- - A keyed read, a kept-out read and a read by project are unchanged, field for field.

begin;

select plan(25);

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
        or (not coalesce(p_excluded, false) and x.in_pnl and ((p_group_key is null and p_project_id is null) or x.drill_key = p_group_key))
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
      bool_or(r.gross_up) as gross_up,
      min(r.drill_key) as drill_key
    from r
    -- FLOW-989: and by project, so a line's parts on two projects stay two rows, each with its own amount.
    group by r.transaction_id, r.part, r.shared, r.project_id, case when coalesce(p_excluded, false) or (p_group_key is null and p_project_id is null) then r.drill_key end
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
      m.drill_key,
      row_number() over (order by m.doc_date desc, m.transaction_id, m.part, m.shared, m.category_id nulls first, p.name nulls first, m.project_id, m.drill_key) as n
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
      ) || case
        when p_group_key is null and p_project_id is null and not coalesce(p_excluded, false) then jsonb_build_object('group_key', pg.drill_key)
        else '{}'::jsonb
      end order by pg.n)
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
    'projects', case when p_group_key is null or p_project_id is not null or coalesce(p_excluded, false) or p_group_by not in ('category', 'parent') then '[]'::jsonb else coalesce((
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
  perform tests.create_supabase_user('b11_owner', 'b11-owner@example.com');
  perform tests.create_supabase_user('b11_other', 'b11-other@example.com');
end
$users$;

create temp table b11_ref (label text primary key, id uuid);
grant all on b11_ref to authenticated;

create function pg_temp.ref(l text) returns uuid
language sql stable
as $$ select id from b11_ref where label = l $$;

grant execute on function pg_temp.ref(text) to authenticated;

select tests.authenticate_as('b11_owner');
select public.create_company('Example Lean Lines LLC', true);
select public.upsert_project(null, 'Site Alpha', null, 'active');
select public.upsert_project(null, 'Site Beta', null, 'active');
insert into b11_ref (label, id) select 'co', id from public.companies where name = 'Example Lean Lines LLC';
insert into b11_ref (label, id) select lower(replace(name, 'Site ', '')), id from public.projects where name like 'Site %';

select tests.authenticate_as('b11_other');
select public.create_company('Other Lean Co', true);

reset role;

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
values
  (pg_temp.ref('co'), 'Example repairs', 'expense', 61, false, false),
  (pg_temp.ref('co'), 'Example renovation', 'expense', 62, false, false),
  (pg_temp.ref('co'), 'Example deposit', 'expense', 63, false, true),
  (pg_temp.ref('co'), 'Example rent', 'income', 64, false, false),
  (pg_temp.ref('co'), 'Example fees', 'income', 65, false, false);
insert into b11_ref (label, id) select 'repairs', id from public.categories where company_id = pg_temp.ref('co') and name = 'Example repairs';
insert into b11_ref (label, id) select 'reno', id from public.categories where company_id = pg_temp.ref('co') and name = 'Example renovation';
insert into b11_ref (label, id) select 'deposit', id from public.categories where company_id = pg_temp.ref('co') and name = 'Example deposit';
insert into b11_ref (label, id) select 'rent', id from public.categories where company_id = pg_temp.ref('co') and name = 'Example rent';
insert into b11_ref (label, id) select 'fees', id from public.categories where company_id = pg_temp.ref('co') and name = 'Example fees';

-- Expenses: five on repairs (two on one day with equal amounts), two on renovation, a line split across repairs
-- and renovation, a shared cost, an uncategorized line, a kept-out deposit, and an ILS line (another currency).
-- Income: rent twice, fees once.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select pg_temp.ref('co'), v.dir::public.txn_direction, (case when v.dir = 'income' then 'receipt' else 'expense' end)::public.doc_kind,
  v.role::public.pnl_role, 'posted', v.cur, v.amount, v.amount, abs(v.amount), 0, 'source',
  v.d::date, v.d::date, 'manual', 'b11:' || v.ikey, pg_temp.ref(v.proj), pg_temp.ref(v.cat), v.ikey, true
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
insert into b11_ref (label, id) select substr(idempotency_key, 5), id from public.transactions where idempotency_key like 'b11:%';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, pg_temp.ref(s.proj), s.bp, t.amount_net * s.bp / 10000
from public.transactions t
join (values ('alpha', 6000), ('beta', 4000)) as s(proj, bp) on true
where t.idempotency_key = 'b11:shared';
select private.set_line_parts(pg_temp.ref('co'), pg_temp.ref('split'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.ref('repairs'), 'project_id', pg_temp.ref('alpha'), 'amount_minor', 50000),
  jsonb_build_object('category_id', pg_temp.ref('repairs'), 'project_id', pg_temp.ref('beta'), 'amount_minor', 10000),
  jsonb_build_object('category_id', pg_temp.ref('reno'), 'project_id', pg_temp.ref('beta'), 'amount_minor', 20000)));

select tests.authenticate_as('b11_owner');

reset role;

-- More than 200 lines in one direction: 230 more repairs lines (equal days and amounts, so the order's ties count),
-- and 12 on renovation; some on a project, some on none.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency, amount_gross, amount_net, amount_original,
  vat_amount, vat_status, doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select pg_temp.ref('co'), 'expense', 'expense', 'project', 'posted', 'USD', -(1000 + (i % 7) * 100), -(1000 + (i % 7) * 100), 1000 + (i % 7) * 100, 0, 'source',
  ('2026-06-01'::date + (i % 27)), ('2026-06-01'::date + (i % 27)), 'manual', 'b11:bulk' || i,
  case i % 3 when 0 then pg_temp.ref('alpha') when 1 then pg_temp.ref('beta') end,
  case when i <= 230 then pg_temp.ref('repairs') else pg_temp.ref('reno') end, 'bulk' || i, true
from generate_series(1, 242) i;

select tests.authenticate_as('b11_owner');

create temp table b11_new as
select d.dir, public.get_breakdown_lines(d.dir, 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', false, null, 0) as body
from (values ('expense'), ('income')) d(dir);
grant all on b11_new to authenticated;

-- The keyed read's every page of one group, joined.
create function pg_temp.keyed(p_dir text, p_key text) returns jsonb
language sql stable
as $$
  select coalesce(jsonb_agg(x order by o, n), '[]'::jsonb)
  from generate_series(0, 400, 200) o,
    jsonb_array_elements(public.get_breakdown_lines(p_dir, 'category', p_key, 'USD', '2026-06-01', '2026-06-30', 'cash', false, 200, o) -> 'rows') with ordinality t(x, n)
$$;

-- The no-key rows of one group, as the screen files them: the row less its key.
create function pg_temp.lean(p_dir text, p_key text) returns jsonb
language sql stable
as $$
  select coalesce(jsonb_agg(x - 'group_key' order by n), '[]'::jsonb)
  from b11_new b, jsonb_array_elements(b.body -> 'rows') with ordinality t(x, n)
  where b.dir = p_dir and x ->> 'group_key' = p_key
$$;

-- What the app puts back to seed a group's keyed cache: the category id, the key (null for none).
create function pg_temp.lean_row(p_dir text, p_key text, x jsonb) returns jsonb
language sql stable
as $$
  select x || jsonb_build_object(
    'category_id', case when p_key = 'none' then null else to_jsonb(p_key) end)
$$;
create function pg_temp.seeded(p_dir text, p_key text) returns jsonb
language sql stable
as $$
  select coalesce(jsonb_agg(pg_temp.lean_row(p_dir, p_key, x) order by n), '[]'::jsonb)
  from jsonb_array_elements(pg_temp.lean(p_dir, p_key)) with ordinality t(x, n)
$$;
create function pg_temp.keyed_less(p_dir text, p_key text, p_drop text[]) returns jsonb
language sql stable
as $$
  select coalesce(jsonb_agg(x - p_drop order by n), '[]'::jsonb)
  from jsonb_array_elements(pg_temp.keyed(p_dir, p_key)) with ordinality t(x, n)
$$;
grant execute on function pg_temp.keyed(text, text), pg_temp.lean(text, text), pg_temp.seeded(text, text), pg_temp.lean_row(text, text, jsonb), pg_temp.keyed_less(text, text, text[]) to authenticated;

-- One call for the whole direction.
select cmp_ok((select jsonb_array_length(body -> 'rows') from b11_new where dir = 'expense'), '>', 200, 'the expense direction has more than 200 lines, read in one call');
select is(
  (select jsonb_build_array(body -> 'has_more', body -> 'count', jsonb_array_length(body -> 'rows'), body -> 'projects') from b11_new where dir = 'expense'),
  (select jsonb_build_array(false, jsonb_array_length(body -> 'rows'), jsonb_array_length(body -> 'rows'), '[]'::jsonb) from b11_new where dir = 'expense'),
  'one page: no more, the count is the rows, no project split');
select is(
  (select (body ->> 'total_minor')::bigint from b11_new where dir = 'expense'),
  (select sum((g ->> 'amount_minor')::bigint)::bigint from jsonb_array_elements(public.get_breakdown('expense', '2026-06-01', '2026-06-30', 'category', 'cash') -> 'groups') g where g ->> 'currency' = 'USD'),
  'the total is the breakdown''s counted total');
select is(
  public.get_breakdown_lines('expense', 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', false, null, 50),
  (select body from b11_new where dir = 'expense'),
  'with no limit an offset changes nothing');

-- The FLOW-1207 app, still live on phones, asks for pages of 200 by offset: they are as before, disjoint, and join into the whole read.
create temp table b11_pages as
select o as off, public.get_breakdown_lines('expense', 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', false, 200, o) as body
from generate_series(0, 200, 200) o;
grant all on b11_pages to authenticated;
select is(
  (select jsonb_agg(x order by p.off, n) from b11_pages p, jsonb_array_elements(p.body -> 'rows') with ordinality t(x, n)),
  (select body -> 'rows' from b11_new where dir = 'expense'),
  'a limit of 200 at offsets 0 and 200: the two pages are disjoint and together are the whole read, in order');
select is(
  (select jsonb_build_array(jsonb_array_length(body -> 'rows'), body -> 'has_more', body -> 'count') from b11_pages where off = 0),
  (select jsonb_build_array(200, true, jsonb_array_length(body -> 'rows')) from b11_new where dir = 'expense'),
  'the first page of 200 says there is more, and the count is the whole direction''s');

-- The row.
select is(
  (select array_agg(distinct k order by k) from b11_new b, jsonb_array_elements(b.body -> 'rows') x, jsonb_object_keys(x) k where b.dir = 'expense'),
  array['amount_minor', 'description', 'doc_date', 'gross_up', 'group_key', 'part', 'project_name', 'source', 'supplier_name', 'transaction_id'],
  'every expense row holds exactly the lean keys');
select is(
  (select count(*)::int from b11_new b, jsonb_array_elements(b.body -> 'rows') x where b.dir = 'expense' and (select count(*) from jsonb_object_keys(x)) <> 10),
  0, 'and all ten, null or not');
select is(
  (select array_agg(distinct k order by k) from b11_new b, jsonb_array_elements(b.body -> 'rows') x, jsonb_object_keys(x) k where b.dir = 'income'),
  array['amount_minor', 'description', 'doc_date', 'gross_up', 'group_key', 'part', 'project_name', 'source', 'supplier_name', 'transaction_id'],
  'every income row holds exactly the lean keys');
select is(
  (select array_agg(k order by k) from jsonb_object_keys((select body from b11_new where dir = 'expense')) k),
  array['count', 'has_more', 'projects', 'rows', 'total_minor'],
  'the page keeps its own keys');

-- Parity per category, in order, against the keyed read (its pages joined).
select is(pg_temp.lean('expense', pg_temp.ref('repairs')::text),
  pg_temp.keyed_less('expense', pg_temp.ref('repairs')::text, array['category_id', 'kept_out', 'category_name', 'currency', 'shared']),
  'repairs (more than 200 lines, two keyed pages): the no-key rows are the keyed rows less the dropped fields, in order');
select is(pg_temp.lean('expense', pg_temp.ref('reno')::text),
  pg_temp.keyed_less('expense', pg_temp.ref('reno')::text, array['category_id', 'kept_out', 'category_name', 'currency', 'shared']),
  'renovation: the same');
select is(pg_temp.lean('expense', 'none'),
  pg_temp.keyed_less('expense', 'none', array['category_id', 'kept_out', 'category_name', 'currency', 'shared']),
  'no category: the same');
select is(pg_temp.lean('income', pg_temp.ref('rent')::text),
  pg_temp.keyed_less('income', pg_temp.ref('rent')::text, array['category_id', 'kept_out', 'category_name', 'currency', 'shared']),
  'income, rent: the same');
select is(pg_temp.lean('income', pg_temp.ref('fees')::text),
  pg_temp.keyed_less('income', pg_temp.ref('fees')::text, array['category_id', 'kept_out', 'category_name', 'currency', 'shared']),
  'income, fees: the same');
select is(
  (select sum(jsonb_array_length(pg_temp.lean('expense', k))) from unnest(array[pg_temp.ref('repairs')::text, pg_temp.ref('reno')::text, 'none']) k)::int,
  (select jsonb_array_length(body -> 'rows') from b11_new where dir = 'expense'),
  'the groups hold every row: none is filed nowhere');

-- Seeding: the category id put back makes the keyed row less what the no-key row never holds (kept_out, category_name,
-- currency, shared: the app has the name from get_breakdown, and reads the other two nowhere).
select is(pg_temp.seeded('expense', pg_temp.ref('repairs')::text), pg_temp.keyed_less('expense', pg_temp.ref('repairs')::text, array['kept_out', 'category_name', 'currency', 'shared']),
  'repairs: the row with its category id is the keyed row less kept_out, category_name, currency and shared');
select is(pg_temp.seeded('expense', 'none'), pg_temp.keyed_less('expense', 'none', array['kept_out', 'category_name', 'currency', 'shared']),
  'no category: the same');
select is(pg_temp.seeded('income', pg_temp.ref('rent')::text), pg_temp.keyed_less('income', pg_temp.ref('rent')::text, array['kept_out', 'category_name', 'currency', 'shared']),
  'income: the same');

-- A keyed read, a kept-out read and a read by project are as they were.
select is(
  (select jsonb_agg(public.get_breakdown_lines('expense', 'category', k, 'USD', '2026-06-01', '2026-06-30', 'cash', false, 200, o) order by k, o)
   from unnest(array[pg_temp.ref('repairs')::text, pg_temp.ref('reno')::text, 'none']) k, generate_series(0, 200, 200) o),
  (select jsonb_agg(pg_temp.old_breakdown_lines('expense', 'category', k, 'USD', '2026-06-01', '2026-06-30', 'cash', false, 200, o) order by k, o)
   from unnest(array[pg_temp.ref('repairs')::text, pg_temp.ref('reno')::text, 'none']) k, generate_series(0, 200, 200) o),
  'keyed reads, every page and every field, are as they were');
select is(
  public.get_breakdown_lines('income', 'category', pg_temp.ref('rent')::text, 'USD', '2026-06-01', '2026-06-30', 'cash'),
  pg_temp.old_breakdown_lines('income', 'category', pg_temp.ref('rent')::text, 'USD', '2026-06-01', '2026-06-30', 'cash'),
  'a keyed income read is as it was');
select is(
  (select jsonb_agg(public.get_breakdown_lines('expense', 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', true, l, o) order by l, o)
   from (values (40, 0), (5, 0), (5, 5)) v(l, o)),
  (select jsonb_agg(pg_temp.old_breakdown_lines('expense', 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', true, l, o) order by l, o)
   from (values (40, 0), (5, 0), (5, 5)) v(l, o)),
  'kept-out reads, paged, are as they were');
select is(
  (select jsonb_agg(public.get_breakdown_lines('expense', 'category', k, 'USD', '2026-06-01', '2026-06-30', 'cash', false, 200, 0, pg_temp.ref('alpha')) order by k)
   from unnest(array[pg_temp.ref('repairs')::text, pg_temp.ref('reno')::text, 'none']) k),
  (select jsonb_agg(pg_temp.old_breakdown_lines('expense', 'category', k, 'USD', '2026-06-01', '2026-06-30', 'cash', false, 200, 0, pg_temp.ref('alpha')) order by k)
   from unnest(array[pg_temp.ref('repairs')::text, pg_temp.ref('reno')::text, 'none']) k),
  'reads of one project are as they were');
select is(
  public.get_breakdown_lines('expense', 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', false, 200, 0, pg_temp.ref('alpha')),
  pg_temp.old_breakdown_lines('expense', 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', false, 200, 0, pg_temp.ref('alpha')),
  'a read of one project with no key is as it was');

select tests.authenticate_as('b11_other');
select is(
  public.get_breakdown_lines('expense', 'category', null, 'USD', '2026-06-01', '2026-06-30', 'cash', false, 200, 0) -> 'rows',
  '[]'::jsonb,
  'another company''s read holds none of them');

select * from finish();

rollback;
