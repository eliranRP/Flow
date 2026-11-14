-- FLOW-852 (the owner's decision of 2026-11-14): Jev never files a line in a closed period. The
-- books-closed guard (20261111080447_books_closed_lock.sql) refuses a person's write; Jev writes as the
-- service role, so jev_prefill and jev_prefill_loan now skip a line that private.books_closed_hit counts
-- as closed (posted, not removed, its doc_date or cash_date on or before the date), with 'closed_month'.
-- A pending line is in no report and is still filled. Signatures and grants do not change; they are
-- restated below as they are.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.
begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $prefill$
declare
  def text;
  anchor constant text := $a$and h.state = 'held'
  ) then
    return jsonb_build_object('project', false, 'category', false, 'skipped', 'closed');
  end if;$a$;
begin
  def := pg_get_functiondef('public.jev_prefill(uuid,uuid,uuid,uuid,text,numeric)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'jev_prefill is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
  -- FLOW-852: a line in a closed period keeps its filing.
  if private.books_closed_hit(
    (select c.books_closed_through from public.companies c where c.id = p_company), line, null)
  then
    return jsonb_build_object('project', false, 'category', false, 'skipped', 'closed_month');
  end if;$n$);
  execute def;
end
$prefill$;

do $prefill_loan$
declare
  def text;
  anchor constant text := $a$  if review is distinct from 'open' or line.user_assigned or line.category_assigned then
    return jsonb_build_object('loan', false, 'skipped', 'closed');
  end if;$a$;
begin
  def := pg_get_functiondef('public.jev_prefill_loan(uuid,uuid,uuid,jsonb,text,numeric)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'jev_prefill_loan is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
  -- FLOW-852: a line in a closed period keeps its filing.
  if private.books_closed_hit(
    (select c.books_closed_through from public.companies c where c.id = p_company), line, null)
  then
    return jsonb_build_object('loan', false, 'skipped', 'closed_month');
  end if;$n$);
  execute def;
end
$prefill_loan$;

revoke all on function public.jev_prefill(uuid, uuid, uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.jev_prefill(uuid, uuid, uuid, uuid, text, numeric) to service_role;
revoke all on function public.jev_prefill_loan(uuid, uuid, uuid, jsonb, text, numeric) from public, anon, authenticated;
grant execute on function public.jev_prefill_loan(uuid, uuid, uuid, jsonb, text, numeric) to service_role;

drop function pg_temp.anchor_count(text, text);

commit;
