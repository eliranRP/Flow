-- FLOW-954. The ledger on the app's screens, read only (UI PR A). Decision 0208.
--
-- The owner approved the ledger screens on 2026-10-22 (the board's Ledger frames). This migration
-- gives the app the reads those screens need. It writes nothing and moves no P&L figure: legs,
-- the legs posting (FLOW-951/953) and private.pnl_lines are untouched; the new reads only join legs
-- (account_id, category_id, project_id, amount_minor, ordinal) to accounts, categories and projects,
-- and name a kept-out category's balance-sheet account through private.kept_out_account (FLOW-953).
--
--   1. public.get_line_journal(p_transaction_id) — the line screen's "פקודת יומן": one line's legs
--      with the live account name and type, whether each leg counts in profit, the project, the
--      signed amount, `balanced`, and `booked_by_ai` (an MCP `book_line` or `line_split` write on
--      the line that was not undone). The app's own read: mcp_line_legs is the MCP tool's.
--   2. public.get_breakdown gains `excluded_groups` (by category only): the kept-out categories with
--      their sums, counts, projects, loan part and the balance-sheet account their lines post to
--      (account_type, account_name), for the P&L drill-down's "לא נספר ברווח" group.
--      `groups`, `totals` and `excluded` are unchanged (counted anchors on the live body).
--   3. public.get_breakdown_lines rows gain `category_id`, so the kept-out lines (p_excluded) can be
--      shown under their own category; in excluded mode two kept-out parts of one line on two
--      categories stay two rows. Counted rows and every other key are unchanged (counted anchors).
--
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. public.get_line_journal — one line's legs for the line screen (any member).
-- ---------------------------------------------------------------------------
-- Null for an unknown, removed or another company's line, and with no company. A pending line has
-- no legs: legs [] and balanced true. Security definer only to read private.mcp_writes (RLS, no
-- policy); every other row is filtered by the caller's readable company.
create or replace function public.get_line_journal(p_transaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  t public.transactions%rowtype;
begin
  cid := private.readable_company_id();
  if cid is null then
    return null;
  end if;
  select * into t from public.transactions x
  where x.id = p_transaction_id and x.company_id = cid and x.removed_at is null;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'transaction_id', t.id,
    'currency', coalesce(t.currency, 'ILS'),
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'ordinal', l.ordinal,
          'account_id', l.account_id,
          'account_name', coalesce(c.name, a.name),
          'account_type', coalesce(c.kind::text, a.type),
          'system', a.category_id is null,
          'is_bank', a.is_bank,
          -- Only income and expense legs count in profit (decision 0208: the projection).
          'in_pnl', coalesce(c.kind::text, a.type) in ('income', 'expense'),
          -- The leg's own category (FLOW-951: a kept-out leg on a system account names it too), live.
          'category_name', lc.name,
          'project_id', l.project_id,
          'project_name', p.name,
          'amount_minor', l.amount_minor
        ) order by l.ordinal)
      from public.legs l
      join public.accounts a on a.id = l.account_id and a.company_id = l.company_id
      left join public.categories c on c.id = a.category_id and c.company_id = a.company_id
      left join public.categories lc on lc.id = coalesce(l.category_id, a.category_id) and lc.company_id = l.company_id
      left join public.projects p on p.id = l.project_id and p.company_id = l.company_id
      where l.company_id = cid and l.transaction_id = t.id
    ), '[]'::jsonb),
    'balanced', coalesce((
      select sum(l.amount_minor) = 0 from public.legs l
      where l.company_id = cid and l.transaction_id = t.id
    ), true),
    'booked_by_ai', exists (
      select 1 from private.mcp_writes w
      where w.company_id = cid and w.transaction_id = t.id
        and w.kind in ('book_line', 'line_split') and w.undone_at is null
    )
  );
end;
$$;

revoke all on function public.get_line_journal(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_line_journal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. get_breakdown: the kept-out categories (excluded_groups), by category only.
-- ---------------------------------------------------------------------------
-- Read from the same rows as `excluded` (r, the category rows), so a kept-out group's sums add up
-- to `excluded`. loan_part lets the drill-down name the ledger account type (principal: a
-- liability, escrow: an asset). Patched on the live body with counted anchors.
do $bd$
declare
  def text;
  a_cte constant text := E'    where not r.in_pnl\n    group by r.currency\n  )\n  select jsonb_build_object(';
  a_key constant text := E'    ''review_count'', (';
begin
  def := pg_get_functiondef('public.get_breakdown(text,date,date,text,text)'::regprocedure);
  if (length(def) - length(replace(def, a_cte, ''))) / length(a_cte) <> 1
    or (length(def) - length(replace(def, a_key, ''))) / length(a_key) <> 1
    or position('excluded_groups' in def) > 0 then
    raise exception 'get_breakdown is not the expected definition';
  end if;
  def := replace(def, a_cte, E'    where not r.in_pnl\n    group by r.currency\n  ),\n'
    || E'  excluded_groups as (\n'
    || E'    select\n'
    || E'      r.currency,\n'
    || E'      r.group_key,\n'
    || E'      max(r.group_name) as group_name,\n'
    || E'      sum(r.amount_minor)::bigint as amount_minor,\n'
    || E'      count(distinct r.transaction_id)::integer as line_count,\n'
    || E'      count(distinct r.project_id) filter (where r.project_id is not null)::integer as project_count,\n'
    || E'      max(c.loan_part::text) as loan_part,\n'
    || E'      max(ka.type) as account_type,\n'
    || E'      max(ka.name) as account_name\n'
    || E'    from r\n'
    || E'    left join public.categories c on c.id = r.category_id\n'
    || E'    left join public.accounts ka on ka.company_id = cid\n'
    || E'      and ka.id = private.kept_out_account(cid, r.category_id, c.loan_part)\n'
    || E'    where not r.in_pnl and p_group_by = ''category''\n'
    || E'    group by r.currency, r.group_key\n'
    || E'  )\n  select jsonb_build_object(');
  def := replace(def, a_key, E'    ''excluded_groups'', coalesce((\n'
    || E'      select jsonb_agg(jsonb_build_object(\n'
    || E'        ''key'', x.group_key,\n'
    || E'        ''name'', x.group_name,\n'
    || E'        ''currency'', x.currency,\n'
    || E'        ''amount_minor'', x.amount_minor,\n'
    || E'        ''count'', x.line_count,\n'
    || E'        ''projects'', x.project_count,\n'
    || E'        ''loan_part'', x.loan_part,\n'
    || E'        ''account_type'', x.account_type,\n'
    || E'        ''account_name'', x.account_name\n'
    || E'      ) order by (x.currency <> ''ILS''), x.currency, x.amount_minor desc, x.group_name nulls last, x.group_key)\n'
    || E'      from excluded_groups x\n'
    || E'    ), ''[]''::jsonb),\n'
    || a_key);
  execute def;
end
$bd$;

revoke all on function public.get_breakdown(text, date, date, text, text) from public, anon;
grant execute on function public.get_breakdown(text, date, date, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. get_breakdown_lines: each row names its category id.
-- ---------------------------------------------------------------------------
-- The kept-out lines (p_excluded) come back for every kept-out category at once; category_id lets
-- the drill-down put each under its own group. In excluded mode the rows also group by the row's
-- group key, so two kept-out parts of one line on two categories stay two rows (each under its own
-- group) instead of merging into one row with no category. Counted rows (p_excluded false) keep
-- their grouping: there every row already has the one group key asked for. Null category_id only
-- when a merged row spans two categories of one group (by parent), as category_name already is.
-- Patched on the live body with counted anchors.
do $bl$
declare
  def text;
  a_group constant text := E'    group by r.transaction_id, r.part, r.shared\n';
  a_order constant text := E'order by m.doc_date desc, m.transaction_id, m.part, m.shared)';
  a_page constant text := E'      m.gross_up,\n      row_number()';
  a_row constant text := E'        ''gross_up'', pg.gross_up\n';
begin
  def := pg_get_functiondef('public.get_breakdown_lines(text,text,text,text,date,date,text,boolean,integer,integer)'::regprocedure);
  if (length(def) - length(replace(def, a_group, ''))) / length(a_group) <> 1
    or (length(def) - length(replace(def, a_order, ''))) / length(a_order) <> 1
    or (length(def) - length(replace(def, a_page, ''))) / length(a_page) <> 1
    or (length(def) - length(replace(def, a_row, ''))) / length(a_row) <> 1
    or position('pg.category_id' in def) > 0 then
    raise exception 'get_breakdown_lines is not the expected definition';
  end if;
  def := replace(def, a_group, E'    group by r.transaction_id, r.part, r.shared, case when coalesce(p_excluded, false) then r.group_key end\n');
  def := replace(def, a_order, E'order by m.doc_date desc, m.transaction_id, m.part, m.shared, m.category_id nulls first)');
  def := replace(def, a_page, E'      m.gross_up,\n      m.category_id,\n      row_number()');
  def := replace(def, a_row, E'        ''gross_up'', pg.gross_up,\n        ''category_id'', pg.category_id\n');
  execute def;
end
$bl$;

revoke all on function public.get_breakdown_lines(text, text, text, text, date, date, text, boolean, integer, integer) from public, anon;
grant execute on function public.get_breakdown_lines(text, text, text, text, date, date, text, boolean, integer, integer) to authenticated, service_role;

commit;
