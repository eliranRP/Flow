-- What the category delete confirm needs (FLOW-405 screen, UI lane 3): public.list_categories
-- returns, per category,
--   lines: lines on the books (not removed, not void) in it, whole or by a split part, the same
--          set delete_category sends back to review;
--   split_lines: how many of those are split by category (delete removes their whole split);
--   loan_used: true when a loan or a loan payment part uses it, so delete_category refuses with
--          "a loan uses this category".
-- Patched from the current definition, with counted anchors, so changes merged since stay. The
-- MCP list_categories passes the fields through.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
  anchor text;
begin
  def := pg_get_functiondef('public.list_categories()'::regprocedure);

  anchor := $a$  select coalesce(jsonb_agg(jsonb_build_object($a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'list_categories select is not the expected definition';
  end if;
  def := replace(def, anchor, $n$  with co as (
    select private.readable_company_id() as id
  ),
  tagged as (
    select t.category_id, t.id as transaction_id
    from public.transactions t
    where t.company_id = (select id from co)
      and t.category_id is not null
      and t.removed_at is null
      and t.line_status is distinct from 'void'::public.line_status
    union
    select s.category_id, s.transaction_id
    from public.line_splits s
    join public.transactions t on t.id = s.transaction_id and t.company_id = s.company_id
    where s.company_id = (select id from co)
      and t.removed_at is null
      and t.line_status is distinct from 'void'::public.line_status
  ),
  counted as (
    select
      g.category_id,
      count(*)::integer as lines,
      count(*) filter (where exists (
        select 1 from public.line_splits s where s.transaction_id = g.transaction_id
      ))::integer as split_lines
    from tagged g
    group by g.category_id
  ),
  loan_used as (
    select v.category_id
    from public.loans l
    cross join lateral (values
      (l.interest_category_id), (l.escrow_category_id), (l.principal_category_id), (l.fees_category_id)
    ) v(category_id)
    where l.company_id = (select id from co) and v.category_id is not null
    union
    select s.category_id
    from public.loan_splits s
    where s.company_id = (select id from co) and s.category_id is not null
  )
$n$ || anchor);

  anchor := $a$    'in_rehab', private.category_in_rehab(c.rehab, c.excluded_from_pnl, c.loan_part)
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'list_categories in_rehab is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    'in_rehab', private.category_in_rehab(c.rehab, c.excluded_from_pnl, c.loan_part),
    'lines', coalesce(n.lines, 0),
    'split_lines', coalesce(n.split_lines, 0),
    'loan_used', lu.category_id is not null
$n$);

  anchor := $a$  from public.categories c
$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'list_categories from is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$  left join counted n on n.category_id = c.id
  left join loan_used lu on lu.category_id = c.id
$n$);

  anchor := $a$  where c.company_id = (select private.readable_company_id());$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'list_categories where is not the expected definition';
  end if;
  def := replace(def, anchor, $n$  where c.company_id = (select id from co);$n$);

  execute def;
end
$patch$;

commit;
