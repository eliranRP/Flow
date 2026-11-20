-- FLOW-1240 (perf queue, decision 0230): get_project's loans carry the four category ids the project forecast reads.
-- The forecast (project-next-loans.ts) files a loan's interest and escrow to the loan's own category, else the
-- company's keyed one. get_project already returns every other field it reads (terms, rates, balance), so with these
-- four ids the app builds the forecast's loans from the get_project answer the page already waits for, and no longer
-- reads `loans` and `loan_balances` again (2 of the second wave's 8 requests).
--
-- Add-only: loans[] gains interest_category_id, escrow_category_id, principal_category_id and fees_category_id (the
-- loan's columns, null when unset). Nothing is removed or renamed; the answer of both forms (p_lines true and false)
-- is otherwise what it was. The body is patched in place: the anchor must be found exactly once, or the migration
-- fails. Same signature, security and grants (create or replace keeps them). An older app ignores the new keys.

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

do $patch$
declare
  def text;
begin
  def := pg_get_functiondef('public.get_project(uuid,text,date,date,boolean)'::regprocedure);
  def := pg_temp.swap(def, $a$        'amortization_months', l.amortization_months,
$a$, $b$        'amortization_months', l.amortization_months,
        -- FLOW-1240: the categories the loan's payment parts file to, which the project forecast reads.
        'interest_category_id', l.interest_category_id,
        'escrow_category_id', l.escrow_category_id,
        'principal_category_id', l.principal_category_id,
        'fees_category_id', l.fees_category_id,
$b$);
  execute def;
end
$patch$;

drop function pg_temp.swap(text, text, text);

commit;
