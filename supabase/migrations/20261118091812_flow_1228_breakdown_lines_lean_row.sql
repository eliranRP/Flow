-- FLOW-1228 (owner, 2026-11-18: "No need to wait for older versions; there are no users on older versions."). One
-- function is patched in place; no table changes.
--
-- public.get_breakdown_lines, the read with no key (p_group_key null, p_excluded false, no p_project_id): FLOW-1211
-- (20261115190314) kept `category_name`, `currency` and `shared` on its row because the FLOW-1207 app's schema requires
-- them. No FLOW-1207 app is in use, and the current app never reads them there: `currency` is the p_currency the call
-- asked for, `shared` is not read, and `category_name` is the group's name, which the app already has from
-- get_breakdown. The row now drops them, with category_id and kept_out (FLOW-1211); it holds ten keys: transaction_id,
-- part, description, supplier_name, project_name, doc_date, amount_minor, source, gross_up and group_key.
-- A keyed read, a kept-out read (p_excluded) and a read by project are unchanged and keep every field: flow-mcp names
-- them. total_minor, count, has_more and projects are as they were.
--
-- The body is patched in place: the anchor must be found exactly once, or the migration fails. Same signature,
-- security, search_path and grants (create or replace keeps them). The anchor is the body as it stands after
-- 20261115190314.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.swap(p_def text, p_from text, p_to text)
returns text
language plpgsql
immutable
as $$
begin
  if (char_length(p_def) - char_length(replace(p_def, p_from, ''))) / char_length(p_from) <> 1 then
    raise exception 'anchor not found exactly once: %', left(p_from, 80);
  end if;
  return replace(p_def, p_from, p_to);
end;
$$;

do $lines$
declare
  def text := pg_get_functiondef('public.get_breakdown_lines(text,text,text,text,date,date,text,boolean,integer,integer,uuid)'::regprocedure);
begin
  def := pg_temp.swap(def,
    $a$      ) - case when nokey then array['category_id', 'kept_out'] else array[]::text[] end || case$a$,
    $b$      ) - case when nokey then array['category_id', 'kept_out', 'category_name', 'currency', 'shared'] else array[]::text[] end || case$b$);
  execute def;
end
$lines$;

drop function pg_temp.swap(text, text, text);

commit;
