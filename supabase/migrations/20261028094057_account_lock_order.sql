-- FLOW-154. book_line and create_journal_entry hold, in id order and before they read any, every account
-- their legs name and every balance-sheet account a named kept-out category posts to (its legs land
-- there: private.kept_out_account). merge_account takes its two accounts in id order too. A booking and
-- a merge on the same accounts could take them in opposite orders and deadlock; Postgres broke it and
-- the booking answered "retry". Each function is patched in place with a counted anchor, as in
-- 20261028090000_journal_income_and_loan_reattach.sql.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

do $book$
declare
  def text;
  anchor constant text := $a$  -- Validate every leg (shape, company ownership, project ownership) and resolve it: the account it$a$;
begin
  def := pg_get_functiondef('private.book_line_core(uuid,text,date,text,text,jsonb,uuid,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'book_line_core is not the expected definition';
  end if;
  def := replace(def, anchor, $n$  -- FLOW-154: every account the legs name, and the account each named kept-out category posts to,
  -- is held first, in id order, as merge_account takes them.
  perform 1
  from public.accounts a
  where a.company_id = cid
    and a.id = any (array(
      select x.id
      from public.accounts n
      cross join lateral (values (n.id), (case when n.category_id is not null
                                            then private.kept_out_account(cid, n.category_id, null) end)) x(id)
      where n.company_id = cid and x.id is not null
        and n.id in (
          select (e.value->>'account_id')::uuid
          from jsonb_array_elements(p_legs) e
          where jsonb_typeof(e.value) = 'object'
            and (e.value->>'account_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )))
  order by a.id
  for share;

$n$ || anchor);
  execute def;
end
$book$;

do $journal$
declare
  def text;
  anchor constant text := $a$    -- Each leg: its shape, then where it goes.$a$;
begin
  def := pg_get_functiondef('public.mcp_create_journal_entry(text,date,text,text,text,jsonb)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_create_journal_entry is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    -- FLOW-154: every account the legs name, and the account each named kept-out category posts to,
    -- is held first, in id order, as merge_account takes them.
    perform 1
    from public.accounts a
    where a.company_id = cid
      and a.id = any (array(
        select x.id
        from public.accounts n
        cross join lateral (values (n.id), (case when n.category_id is not null
                                              then private.kept_out_account(cid, n.category_id, null) end)) x(id)
        where n.company_id = cid and x.id is not null
          and n.id in (
            select (e.value->>'account_id')::uuid
            from jsonb_array_elements(case when jsonb_typeof(p_legs) = 'array' then p_legs else '[]'::jsonb end) e
            where jsonb_typeof(e.value) = 'object'
              and (e.value->>'account_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        )))
    order by a.id
    for share;

$n$ || anchor);
  execute def;
end
$journal$;

commit;
