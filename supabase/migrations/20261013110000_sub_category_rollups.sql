-- FLOW-406 server 1b (decision 0164): the roll-up reads for sub-categories.
--
-- Every line still counts once, by its own category. The parent sums are extra rows next to
-- the per-category rows, never mixed into them, so a client that adds up the category rows
-- gets the same total as before:
-- - get_project: each category row gains parent_id; new category_rollups (agorot) and
--   category_rollups_by_currency hold one row per parent with sub-categories: the sum of its
--   own and its children's rows, and own_* for its own lines ("בלי תת-קטגוריה").
-- - project_category_months: each row gains parent_id; a new parents[] sums the months.
-- - get_breakdown and get_breakdown_lines: group_by 'parent' folds sub-categories into their
--   parent.
-- - search_transactions: a parent id matches its children's lines too; p_category_exact
--   keeps the old match.

begin;

set local lock_timeout = '5s';

-- Adds parent_id to each category row of a get_project array.
create function private.category_rows_with_parent(p_rows jsonb, p_company uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    case when jsonb_typeof(r.row) = 'object'
      then r.row || jsonb_build_object('parent_id', c.parent_id)
      else r.row end
    order by r.ord), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as r(row, ord)
  left join public.categories c
    on c.id = case when r.row->>'id' ~* '^[0-9a-f-]{36}$' then (r.row->>'id')::uuid end
   and c.company_id = p_company;
$$;

-- One row per parent with sub-categories, from a get_project category array: the sum of the
-- parent's own row and its children's rows, per currency when the rows carry one.
create function private.category_rollup_rows(p_rows jsonb, p_amount_key text, p_company uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with rows as (
    select r->>'currency' as currency,
      (r->>'id')::uuid as id,
      (r->>p_amount_key)::bigint as amount,
      coalesce((r->>'has_shared_share')::boolean, false) as shared
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where r->>'id' is not null
  ),
  tagged as (
    select rows.*, coalesce(c.parent_id, c.id) as parent, c.parent_id is null as own
    from rows
    join public.categories c on c.id = rows.id and c.company_id = p_company
  ),
  sums as (
    select t.currency, t.parent,
      sum(t.amount)::bigint as amount,
      coalesce(sum(t.amount) filter (where t.own), 0)::bigint as own_amount,
      count(*) filter (where not t.own)::integer as children,
      bool_or(t.shared) as shared
    from tagged t
    group by t.currency, t.parent
    having bool_or(not t.own)
  )
  select coalesce(jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object('currency', s.currency))
      || jsonb_build_object(
        'id', s.parent,
        'name', pc.name,
        p_amount_key, s.amount,
        'own_' || p_amount_key, s.own_amount,
        'children', s.children,
        'has_shared_share', s.shared
      )
    order by s.currency, s.amount desc, pc.name), '[]'::jsonb)
  from sums s
  join public.categories pc on pc.id = s.parent;
$$;

-- The parents of project_category_months: months summed element by element.
create function private.category_month_parents(p_rows jsonb, p_company uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with rows as (
    select r->>'currency' as currency,
      (r->>'id')::uuid as id,
      (r->>'this_month_minor')::bigint as this_month,
      r->'months_minor' as months
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where r->>'id' is not null
  ),
  tagged as (
    select rows.*, coalesce(c.parent_id, c.id) as parent, c.parent_id is null as own
    from rows
    join public.categories c on c.id = rows.id and c.company_id = p_company
  ),
  folded as (
    select t.currency, t.parent from tagged t
    group by t.currency, t.parent
    having bool_or(not t.own)
  ),
  totals as (
    select t.currency, t.parent,
      sum(t.this_month)::bigint as this_month,
      coalesce(sum(t.this_month) filter (where t.own), 0)::bigint as own_this_month,
      count(*) filter (where not t.own)::integer as children
    from tagged t
    join folded f on f.currency = t.currency and f.parent = t.parent
    group by t.currency, t.parent
  ),
  months as (
    select t.currency, t.parent, m.ord, sum(m.value::bigint)::bigint as amount
    from tagged t
    join folded f on f.currency = t.currency and f.parent = t.parent
    cross join lateral jsonb_array_elements_text(t.months) with ordinality as m(value, ord)
    group by t.currency, t.parent, m.ord
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.parent,
    'name', pc.name,
    'currency', x.currency,
    'this_month_minor', x.this_month,
    'own_this_month_minor', x.own_this_month,
    'children', x.children,
    'months_minor', coalesce((
      select jsonb_agg(m.amount order by m.ord) from months m
      where m.currency = x.currency and m.parent = x.parent
    ), '[]'::jsonb)
  ) order by x.currency, x.this_month desc, pc.name), '[]'::jsonb)
  from totals x
  join public.categories pc on pc.id = x.parent;
$$;

-- Invoker functions: get_project and project_category_months run as the caller, and the
-- categories RLS keeps each caller to their own company's rows.
revoke all on function private.category_rows_with_parent(jsonb, uuid) from public, anon;
revoke all on function private.category_rollup_rows(jsonb, text, uuid) from public, anon;
revoke all on function private.category_month_parents(jsonb, uuid) from public, anon;
grant execute on function private.category_rows_with_parent(jsonb, uuid) to authenticated, service_role;
grant execute on function private.category_rollup_rows(jsonb, text, uuid) to authenticated, service_role;
grant execute on function private.category_month_parents(jsonb, uuid) to authenticated, service_role;

-- or replace: an earlier migration may leave its copy in the session.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
  anchor text;
  addition text;
begin
  -- get_project: parent_id on the rows, and the roll-up arrays, before the closing keys.
  def := pg_get_functiondef('public.get_project(uuid, text, date, date)'::regprocedure);
  anchor := $a$  return result || jsonb_build_object($a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'get_project is not the expected definition';
  end if;
  addition := $n$  -- FLOW-406: parent_id on each category row and the parent roll-ups beside them.
  result := result || jsonb_build_object(
    'categories', private.category_rows_with_parent(result->'categories', cid),
    'categories_by_currency', private.category_rows_with_parent(result->'categories_by_currency', cid),
    'excluded_categories_by_currency', private.category_rows_with_parent(result->'excluded_categories_by_currency', cid),
    'category_rollups', private.category_rollup_rows(result->'categories', 'amount_agorot', cid),
    'category_rollups_by_currency', private.category_rollup_rows(result->'categories_by_currency', 'amount_minor', cid)
  );
$n$;
  execute replace(def, anchor, addition || anchor);

  -- project_category_months: parent_id on the rows and parents[].
  def := pg_get_functiondef('public.project_category_months(uuid, integer, date)'::regprocedure);
  anchor := $a$      'group_name', c.group_name,$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'project_category_months is not the expected definition (row)';
  end if;
  def := replace(def, anchor, anchor || E'\n      ''parent_id'', c.parent_id,');
  anchor := E'  return result;\nend;';
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'project_category_months is not the expected definition (return)';
  end if;
  def := replace(def, anchor,
    E'  -- FLOW-406: the parents, months summed, for folding sub-categories.\n'
    || E'  result := result || jsonb_build_object(''parents'', private.category_month_parents(result->''categories'', cid));\n'
    || anchor);
  execute def;

  -- breakdown: group_by 'parent'.
  def := pg_get_functiondef('private.breakdown_company(text, text, date, date)'::regprocedure);
  anchor := $a$('category', 'project', 'payer')$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'breakdown_company is not the expected definition';
  end if;
  execute replace(def, anchor, $n$('category', 'parent', 'project', 'payer')$n$);

  def := pg_get_functiondef('private.breakdown_rows(uuid, text, date, date, text, text)'::regprocedure);
  anchor := E'  where p_group_by = ''category''\n  union all\n';
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'breakdown_rows is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$  -- FLOW-406: by parent category: a sub-category's lines count under its parent.
  select
    s.transaction_id, s.part, s.currency,
    coalesce(coalesce(c.parent_id, s.category_id)::text, 'none'),
    coalesce(pc.name, c.name),
    s.amount_minor, s.in_pnl, false, s.doc_date, s.category_id, s.project_id
  from signed s
  left join public.categories c on c.id = s.category_id
  left join public.categories pc on pc.id = c.parent_id
  where p_group_by = 'parent'
  union all
$n$);

  -- search_transactions: a parent matches its children's lines; p_category_exact for the old
  -- match. A new argument, so the function is dropped and made again with its grants.
  def := pg_get_functiondef('public.search_transactions(text, text, integer, integer, date, date, text, text, text, bigint, bigint)'::regprocedure);
  anchor := 'p_amount_max bigint DEFAULT NULL::bigint)';
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'search_transactions is not the expected definition (args)';
  end if;
  def := replace(def, anchor, 'p_amount_max bigint DEFAULT NULL::bigint, p_category_exact boolean DEFAULT false)');
  anchor := E'  want_category uuid;\n';
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'search_transactions is not the expected definition (declare)';
  end if;
  def := replace(def, anchor, anchor || E'  want_categories uuid[];\n');
  anchor := E'  scope := coalesce(p_scope, ''all'');\n';
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'search_transactions is not the expected definition (scope)';
  end if;
  def := replace(def, anchor, $n$  -- FLOW-406: a parent category also matches its sub-categories' lines, unless exact.
  if want_category is not null then
    if coalesce(p_category_exact, false) then
      want_categories := array[want_category];
    else
      select array_agg(c.id) into want_categories
      from public.categories c
      where c.company_id = cid and (c.id = want_category or c.parent_id = want_category);
      want_categories := coalesce(want_categories, array[want_category]);
    end if;
  end if;
$n$ || anchor);
  anchor := 'category_id = want_category';
  if pg_temp.anchor_count(def, anchor) <> 3 then
    raise exception 'search_transactions is not the expected definition (match)';
  end if;
  def := replace(def, anchor, 'category_id = any(want_categories)');
  drop function public.search_transactions(text, text, integer, integer, date, date, text, text, text, bigint, bigint);
  execute def;
end
$patch$;

revoke all on function public.search_transactions(text, text, integer, integer, date, date, text, text, text, bigint, bigint, boolean) from public, anon;
grant execute on function public.search_transactions(text, text, integer, integer, date, date, text, text, text, bigint, bigint, boolean) to authenticated, service_role;

commit;
