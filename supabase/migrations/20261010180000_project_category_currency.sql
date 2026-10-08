-- A project's category drill-down for a currency other than ILS (Production QA, 2026-10-08).
-- list_project_category read private.project_category_entries, which keeps only ILS rows
-- (since #95), so in a USD company the drill-down was empty while get_project showed the
-- category's total under categories_by_currency. It now takes p_currency: the drill-down
-- lists that currency's rows (the same rows categories_by_currency sums). Left out, it uses
-- ILS when the category has ILS rows on the project, else the first other currency that has
-- rows. The output adds currency.
-- Patched from the current definition (the viewer read and the basis stay); the old
-- signature is dropped, so a caller without p_currency gets the default.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;
set local lock_timeout = '5s';

do $patch$
declare
  def text;
  item record;
begin
  def := pg_get_functiondef('public.list_project_category(uuid,uuid,integer,integer,date,date,text)'::regprocedure);
  -- In order: the cur lookup added in step 5 has its own category filter, so step 4 runs first.
  for item in
    select * from (values
      (1, $a$p_basis text DEFAULT 'invoiced'::text)$a$,
       $n$p_basis text DEFAULT 'invoiced'::text, p_currency text DEFAULT NULL::text)$n$, 1),
      (2, $a$  basis text;
$a$,
       $n$  basis text;
  cur text;
$n$, 1),
      (5, $a$  basis := case when p_basis = 'cash' then 'cash' else 'invoiced' end;
$a$,
       $n$  basis := case when p_basis = 'cash' then 'cash' else 'invoiced' end;
  cur := coalesce(
    upper(nullif(btrim(p_currency), '')),
    (
      select e.currency
      from private.project_category_entries_by_currency(p_project) e
      where e.category_id = p_category
      order by e.currency <> 'ILS', e.currency
      limit 1
    ),
    'ILS'
  );
$n$, 1),
      (3, 'from private.project_category_entries(p_project) e',
       'from private.project_category_entries_by_currency(p_project) e', 2),
      (4, 'where e.category_id = p_category',
       'where e.category_id = p_category and e.currency = cur', 2),
      (6, $a$'total_agorot', total,$a$,
       $n$'currency', cur,
    'total_agorot', total,$n$, 1)
    ) as v(step, old_text, new_text, times)
    order by step
  loop
    if (length(def) - length(replace(def, item.old_text, ''))) / length(item.old_text) <> item.times then
      raise exception 'list_project_category anchor not found as expected: %', item.old_text;
    end if;
    def := replace(def, item.old_text, item.new_text);
  end loop;
  drop function public.list_project_category(uuid, uuid, integer, integer, date, date, text);
  execute def;
end
$patch$;

revoke all on function public.list_project_category(uuid, uuid, integer, integer, date, date, text, text) from public, anon;
grant execute on function public.list_project_category(uuid, uuid, integer, integer, date, date, text, text) to authenticated, service_role;

commit;
