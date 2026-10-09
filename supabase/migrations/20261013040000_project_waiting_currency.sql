-- FLOW-408 (currency in project lists). project_waiting returned each line's amount without its
-- currency, so the project's waiting list showed a USD line in shekels. Both branches now carry
-- the line's currency, next to its source. The function is otherwise as in
-- 20261010170000_line_state_in_lists.sql. Grants are kept by create or replace.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $patch$
declare
  def text;
begin
  def := pg_get_functiondef('public.project_waiting(uuid)'::regprocedure);
  if pg_temp.anchor_count(def, $a$'source', t.source,$a$) <> 2
    or pg_temp.anchor_count(def, $a$'currency'$a$) <> 0 then
    raise exception 'project_waiting is not the expected definition';
  end if;
  execute replace(def, $a$'source', t.source,$a$, $n$'currency', t.currency,
    'source', t.source,$n$);
end;
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
