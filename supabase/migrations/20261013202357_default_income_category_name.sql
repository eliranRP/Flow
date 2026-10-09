-- Money terms glossary (DESIGN-RULES §3.6): the default income category is "הכנסה מלקוחות", not
-- "תקבול מלקוח". A receipt (תקבול) is any money in, a loan too; income is what counts in profit.
-- 1. private.seed_default_categories gives new companies the new name.
-- 2. Existing default rows still named "תקבול מלקוח" take the new name. A category the owner renamed
--    keeps its name, and a company that already has an income category "הכנסה מלקוחות" is left alone.
--    The id stays, so lines, splits, remembered suppliers and flags stay. The name trigger keeps
--    excluded_from_pnl: neither name is a kept-out default.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- or replace: an earlier migration may have left its copy in the session.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $do$
declare
  def text := pg_get_functiondef('private.seed_default_categories()'::regprocedure);
  anchor text := $a$(new.id, 'תקבול מלקוח', 'income', 1, true)$a$;
begin
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'seed_default_categories is not the expected definition';
  end if;
  execute replace(def, anchor, $n$(new.id, 'הכנסה מלקוחות', 'income', 1, true)$n$);
end;
$do$;

update public.categories c
set name = 'הכנסה מלקוחות'
where c.is_default
  and c.kind = 'income'
  and c.name = 'תקבול מלקוח'
  and not exists (
    select 1 from public.categories o
    where o.company_id = c.company_id and o.kind = 'income' and o.name = 'הכנסה מלקוחות'
  );

commit;
