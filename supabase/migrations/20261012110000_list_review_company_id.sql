-- FLOW-704: each list_review row carries its company_id, so the app can bind the remembered Jev
-- flag to the company from the review payload when its company lookup fails. The row's company
-- is the readable company the list already filters on; nothing else changes. Patched from the
-- current definition with a counted anchor, so changes merged since stay. One transaction.

begin;

set local lock_timeout = '5s';

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
begin
  def := pg_get_functiondef('public.list_review()'::regprocedure);
  anchor := $a$    'id', q.id,$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'list_review is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$
    'company_id', q.company_id,$n$);
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
