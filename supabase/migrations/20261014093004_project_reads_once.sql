-- Project page speed, round 5: get_project stops doing the same work twice. Opening several
-- projects together took 1.3 to 1.7 s live (build 59e1bca): each read keeps a CPU busy on the
-- small instance, so reads that arrive together queue behind each other. Locally on invented
-- data the size of a busy company (10,600 lines, 12 projects) a call took a median of 330 ms:
--   1. Eight totals each read private.pnl_lines with the same filter. The rows are now read
--      once into an array and every total reads the array.
--   2. The three category lists each ran private.project_category_entries_by_currency. One
--      grouped pass now feeds all three; each list keeps its own filter and order.
--   3. private.overhead_share_for ran the view's per-line work on every line of the company to
--      find its income and overhead lines. It now passes only the lines that can be either.
-- On the same data the median call is 125 ms. Results stay the same: get_project's output was
-- identical before and after on 78 cases (13 projects, three bases, with and without a range).
-- get_project keeps plan_cache_mode = force_generic_plan (20261014013227), which
-- pg_get_functiondef carries.

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $once$
declare
  fn text := 'public.get_project(uuid,text,date,date)';
  def text;
  decl_old text := $a$  ids uuid[];
$a$;
  decl_new text := $a$  ids uuid[];
  pl_rows private.pnl_lines[];
  cats_ils jsonb;
  cats_in jsonb;
  cats_out jsonb;
$a$;
  select_old text := $a$  );

  select jsonb_build_object(
$a$;
  select_new text := $a$  );
  -- The project's lines, read once. Every total below reads this array instead of reading
  -- private.pnl_lines again with the same filter (eight times before).
  pl_rows := array(
    select u from private.pnl_lines u
    where u.transaction_id = any(ids) and (basis = 'invoiced' or not u.unpaid)
      and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)
  );
  -- One pass over the project's category entries feeds the three category lists (three before).
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'amount_agorot', s.amount,
      'has_shared_share', s.shared
    ) order by s.amount desc, c.name) filter (where s.in_pnl and s.currency = 'ILS'), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'currency', s.currency,
      'id', c.id,
      'name', c.name,
      'amount_minor', s.amount,
      'has_shared_share', s.shared
    ) order by s.currency, s.amount desc, c.name) filter (where s.in_pnl), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'currency', s.currency,
      'id', c.id,
      'name', c.name,
      'amount_minor', s.amount,
      'has_shared_share', s.shared
    ) order by s.currency, s.amount desc, c.name) filter (where not s.in_pnl), '[]'::jsonb)
  into cats_ils, cats_in, cats_out
  from (
    select e.currency,
      e.category_id,
      private.line_in_pnl(
        case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
          then lt.in_pnl_override end,
        cat.excluded_from_pnl, cat.loan_part
      ) as in_pnl,
      (-sum(e.amount_net))::bigint as amount,
      bool_or(e.shared) as shared
    from private.project_category_entries_by_currency(p_id) e
    left join public.categories cat on cat.id = e.category_id
    join public.transactions lt on lt.id = e.transaction_id
    where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
      and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
    group by 1, 2, 3
  ) s
  left join public.categories c on c.id = s.category_id;

  select jsonb_build_object(
$a$;
  lines_old text := $a$(select * from private.pnl_lines u where u.transaction_id = any(ids) and (basis = 'invoiced' or not u.unpaid)
        and private.pnl_in_range(u.kind, basis, u.doc_date, u.cash_date, p_from, p_to)) l$a$;
  cats_old text := $a$    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'amount_agorot', s.amount,
        'has_shared_share', s.shared
      ) order by s.amount desc, c.name)
      from (
        select e.category_id,
          (-sum(e.amount_net))::bigint as amount,
          bool_or(e.shared) as shared
        from private.project_category_entries(p.id) e
        left join public.categories cat on cat.id = e.category_id
        join public.transactions lt on lt.id = e.transaction_id
        where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
          and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
          and private.line_in_pnl(
          case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
            then lt.in_pnl_override end,
          cat.excluded_from_pnl, cat.loan_part
        )
        group by e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'categories_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', s.currency,
        'id', c.id,
        'name', c.name,
        'amount_minor', s.amount,
        'has_shared_share', s.shared
      ) order by s.currency, s.amount desc, c.name)
      from (
        select e.currency,
          e.category_id,
          (-sum(e.amount_net))::bigint as amount,
          bool_or(e.shared) as shared
        from private.project_category_entries_by_currency(p.id) e
        left join public.categories cat on cat.id = e.category_id
        join public.transactions lt on lt.id = e.transaction_id
        where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
          and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
          and private.line_in_pnl(
          case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
            then lt.in_pnl_override end,
          cat.excluded_from_pnl, cat.loan_part
        )
        group by e.currency, e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),
    'excluded_categories_by_currency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', s.currency,
        'id', c.id,
        'name', c.name,
        'amount_minor', s.amount,
        'has_shared_share', s.shared
      ) order by s.currency, s.amount desc, c.name)
      from (
        select e.currency,
          e.category_id,
          (-sum(e.amount_net))::bigint as amount,
          bool_or(e.shared) as shared
        from private.project_category_entries_by_currency(p.id) e
        left join public.categories cat on cat.id = e.category_id
        join public.transactions lt on lt.id = e.transaction_id
        where (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
          and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
          and not private.line_in_pnl(
          case when not exists (select 1 from public.loan_splits ls where ls.transaction_id = lt.id)
            then lt.in_pnl_override end,
          cat.excluded_from_pnl, cat.loan_part
        )
        group by e.currency, e.category_id
      ) s
      left join public.categories c on c.id = s.category_id
    ), '[]'::jsonb),$a$;
  cats_new text := $a$    'categories', cats_ils,
    'categories_by_currency', cats_in,
    'excluded_categories_by_currency', cats_out,$a$;
begin
  def := pg_get_functiondef(fn::regprocedure);
  if pg_temp.anchor_count(def, decl_old) <> 1
    or pg_temp.anchor_count(def, select_old) <> 1
    or pg_temp.anchor_count(def, lines_old) <> 8
    or pg_temp.anchor_count(def, cats_old) <> 1
    or pg_temp.anchor_count(def, 'force_generic_plan') <> 1
  then
    raise exception '% is not the expected definition', fn;
  end if;
  def := replace(def, cats_old, cats_new);
  def := replace(def, lines_old, 'unnest(pl_rows) l');
  def := replace(def, decl_old, decl_new);
  def := replace(def, select_old, select_new);
  execute def;
end;
$once$;

do $overhead$
declare
  fn text;
  def text;
  lines_old text := $a$      and private.pnl_in_range(l.kind, (select basis from cid), l.doc_date, l.cash_date, p_from, p_to)
  ),$a$;
  lines_new text := $a$      and private.pnl_in_range(l.kind, (select basis from cid), l.doc_date, l.cash_date, p_from, p_to)
      -- Only lines that can be income or overhead reach the view's per-line work: a line of an
      -- income kind or direction, filed to the overhead project, or split (its parts can be
      -- either). A superset: the filters above still decide.
      and l.transaction_id = any(array(
        select t.id
        from public.transactions t
        left join public.categories k on k.id = t.category_id
        where t.company_id = p_company
          and (t.direction = 'income' or k.kind = 'income' or t.pnl_role = 'overhead'
            or t.project_id = (select overhead_project from cid))
        union
        select s.transaction_id from public.line_splits s where s.company_id = p_company
        union
        select s.transaction_id from public.loan_splits s where s.company_id = p_company
      ))
  ),$a$;
begin
  foreach fn in array array[
    'private.overhead_share_for(uuid,uuid,text,date,date)',
    'private.overhead_share_for(uuid,uuid,text,date,date,text)'
  ] loop
    def := pg_get_functiondef(fn::regprocedure);
    if pg_temp.anchor_count(def, lines_old) <> 1 then
      raise exception '% is not the expected definition', fn;
    end if;
    execute replace(def, lines_old, lines_new);
  end loop;
end;
$overhead$;
