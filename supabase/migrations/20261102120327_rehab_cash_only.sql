-- FLOW-460 (decision 0247): renovation so far counts cash lines only.
--
-- private.project_investment summed every posted, paid expense line in a rehab category, journal
-- entries included, so a depreciation entry filed in a category on the default (counted) showed as
-- renovation. A line now counts only when the cash view counts it (the owner's switch on the line,
-- else the category's), as the property's returns do since decision 0245. private.line_in_cash is
-- that rule for one line part.

begin;

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$
  select (char_length(p_def) - char_length(replace(p_def, p_anchor, ''))) / char_length(p_anchor);
$$;

-- As the cash view counts a line part (decision 0170): the owner's switch on the line, else the
-- category (a guessed category does not take a line out).
create function private.line_in_cash(p_transaction_id uuid, p_category_id uuid, p_part public.loan_split_part)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    t.in_cash_override,
    not private.line_category_out(
      c.in_cash is false,
      t.category_suggested and p_category_id is not distinct from t.category_id,
      p_part
    )
  )
  from public.transactions t
  left join public.categories c on c.id = p_category_id and c.company_id = t.company_id
  where t.id = p_transaction_id;
$$;
revoke all on function private.line_in_cash(uuid, uuid, public.loan_split_part) from public, anon;
grant execute on function private.line_in_cash(uuid, uuid, public.loan_split_part) to authenticated, service_role;

do $patch$
declare
  def text;
  anchor constant text := $a$      and private.category_in_rehab(c.rehab, c.excluded_from_pnl, coalesce(c.loan_part, l.part))$a$;
begin
  def := pg_get_functiondef('private.project_investment(uuid,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 2 then
    raise exception 'project_investment is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$
      and coalesce(private.line_in_cash(l.transaction_id, l.category_id, l.part), true)$n$);
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
