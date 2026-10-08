-- FLOW-507 follow-up (viewer reads). A demo viewer's project page was empty: get_project found the
-- company by owner_id, and the project's category totals, the category drill-down and the
-- review screen's "filed today" rows read private helpers scoped to current_company_id(), which
-- is null for a viewer. Each now reads the readable company, as 20261010100000_viewer_reads.sql
-- did for the other screen reads. The owner reads as before (readable_company_id() is the
-- owner's company first); writes stay on current_company_id(). viewer_reads.test.sql guards the
-- private helpers and the owner_id lookup too.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

do $viewer$
declare
  name text;
  def text;
begin
  def := pg_get_functiondef('public.get_project(uuid,text,date,date)'::regprocedure);
  if (length(def) - length(replace(def, 'where c.owner_id = (select auth.uid());', ''))) / length('where c.owner_id = (select auth.uid());') <> 1 then
    raise exception 'get_project owner lookup was not found once';
  end if;
  execute replace(def, 'where c.owner_id = (select auth.uid());', 'where c.id = (select private.readable_company_id());');

  foreach name in array array[
    'private.project_category_entries_by_currency(uuid)',
    'private.filed_today_rows()',
    'private.overhead_share(uuid,text)'
  ]
  loop
    def := pg_get_functiondef(name::regprocedure);
    if position('private.current_company_id()' in def) = 0 then
      raise exception 'expected current_company_id in %', name;
    end if;
    execute replace(def, 'private.current_company_id()', 'private.readable_company_id()');
  end loop;
end
$viewer$;

commit;
