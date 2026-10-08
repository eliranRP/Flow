-- FLOW-124 items 1 and 2, FLOW-125 item 1 (server parts). Decision 0135.
-- 1. private.line_pnl_state(transaction, project, category): in, out or mixed. A posted line
--    reads its parts in private.pnl_lines (only those on the project and category, when given),
--    so a line split by category with one part kept out is mixed; a pending line follows the
--    rule get_transaction's in_pnl uses.
-- 2. The list reads the app shows as transaction rows return the line's source and kept_out:
--    list_project_category and project_waiting (the parts on that project and category),
--    list_auto_assigned_today and list_review (the whole line), get_breakdown_lines (each row is
--    already a part in or out, so p_excluded). get_project's transactions[] has both (#166).
-- 3. get_transaction (and so MCP get_expense) returns pnl_state next to in_pnl.
-- Each function is patched from its current definition, so an earlier redefinition (viewer
-- reads, basis) stays as it is. A missing anchor stops the migration.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function private.line_pnl_state(
  p_transaction_id uuid,
  p_project_id uuid default null,
  p_category_id uuid default null
)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    -- A posted line: its parts on this project and category, when the caller names them.
    (
      select case
        when bool_and(pl.in_pnl) then 'in'
        when not bool_or(pl.in_pnl) then 'out'
        else 'mixed'
      end
      from private.pnl_lines pl
      where pl.transaction_id = t.id
        and (p_project_id is null or pl.project_id = p_project_id)
        and (p_category_id is null or pl.category_id = p_category_id)
      having count(*) > 0
    ),
    -- Every part of a posted line.
    (
      select case
        when bool_and(pl.in_pnl) then 'in'
        when not bool_or(pl.in_pnl) then 'out'
        else 'mixed'
      end
      from private.pnl_lines pl
      where pl.transaction_id = t.id
      having count(*) > 0
    ),
    -- A pending line, which pnl_lines does not hold yet.
    case when private.line_in_pnl(
      case when not exists (
        select 1 from public.loan_splits ls where ls.transaction_id = t.id and ls.company_id = t.company_id
      ) then t.in_pnl_override end,
      private.line_category_out(c.excluded_from_pnl, t.category_suggested, c.loan_part),
      c.loan_part
    ) then 'in' else 'out' end
  )
  from public.transactions t
  left join public.categories c on c.id = t.category_id
  where t.id = p_transaction_id;
$$;

revoke all on function private.line_pnl_state(uuid, uuid, uuid) from public, anon;
grant execute on function private.line_pnl_state(uuid, uuid, uuid) to authenticated, service_role;

comment on function private.line_pnl_state(uuid, uuid, uuid) is
  'in, out or mixed: whether a line counts in the P&L. A posted line reads private.pnl_lines, limited to the parts on the given project and category when they are given and match; a pending line follows the line rule. Decision 0135.';

do $patch$
declare
  def text;
begin
  -- list_project_category: rows read the transaction already joined as lt.
  def := pg_get_functiondef('public.list_project_category(uuid,uuid,integer,integer,date,date,text)'::regprocedure);
  if (length(def) - length(replace(def, $a$'amount_net', page.amount_net$a$, ''))) / length($a$'amount_net', page.amount_net$a$) <> 1
    or position('select e.transaction_id, e.description, e.doc_date, e.amount_net, e.created_at' in def) = 0
  then
    raise exception 'list_project_category anchor not found';
  end if;
  def := replace(def, $a$'amount_net', page.amount_net$a$,
    $n$'amount_net', page.amount_net,
    'source', page.source,
    'kept_out', private.line_pnl_state(page.transaction_id, p_project, p_category) = 'out'$n$);
  def := replace(def, 'select e.transaction_id, e.description, e.doc_date, e.amount_net, e.created_at',
    'select e.transaction_id, e.description, e.doc_date, e.amount_net, e.created_at, lt.source');
  execute def;

  -- list_auto_assigned_today.
  def := pg_get_functiondef('public.list_auto_assigned_today()'::regprocedure);
  if position($a$'category_name', c.name$a$ in def) = 0 then
    raise exception 'list_auto_assigned_today anchor not found';
  end if;
  execute replace(def, $a$'category_name', c.name$a$,
    $n$'category_name', c.name,
    'source', filed.source,
    'kept_out', private.line_pnl_state(filed.id) = 'out'$n$);

  -- get_breakdown_lines: every row is a part in or out of the P&L already (p_excluded picks
  -- which), so kept_out is p_excluded.
  def := pg_get_functiondef('public.get_breakdown_lines(text,text,text,text,date,date,text,boolean,integer,integer)'::regprocedure);
  if position($a$'shared', pg.shared$a$ in def) = 0 or position('t.description,' in def) = 0 then
    raise exception 'get_breakdown_lines anchor not found';
  end if;
  def := replace(def, $a$'shared', pg.shared$a$,
    $n$'shared', pg.shared,
    'source', pg.source,
    'kept_out', coalesce(p_excluded, false)$n$);
  def := replace(def, '      t.description,', '      t.description,
      t.source,');
  execute def;

  -- project_waiting: both branches.
  def := pg_get_functiondef('public.project_waiting(uuid)'::regprocedure);
  if (length(def) - length(replace(def, $a$'supplier_name', s.name$a$, ''))) / length($a$'supplier_name', s.name$a$) <> 2 then
    raise exception 'project_waiting anchor not found';
  end if;
  execute replace(def, $a$'supplier_name', s.name$a$,
    $n$'supplier_name', s.name,
    'source', t.source,
    'kept_out', private.line_pnl_state(t.id, p_project) = 'out'$n$);

  -- list_review: kept_out (source is there since #111).
  def := pg_get_functiondef('public.list_review()'::regprocedure);
  if position($a$'source', t.source,$a$ in def) = 0 then
    raise exception 'list_review anchor not found';
  end if;
  execute replace(def, $a$'source', t.source,$a$,
    $n$'source', t.source,
    'kept_out', private.line_pnl_state(t.id) = 'out',$n$);

  -- get_transaction: pnl_state next to in_pnl.
  def := pg_get_functiondef('public.get_transaction(uuid)'::regprocedure);
  if position($a$'pnl_fixed', c.loan_part is not null$a$ in def) = 0 then
    raise exception 'get_transaction anchor not found';
  end if;
  execute replace(def, $a$'pnl_fixed', c.loan_part is not null$a$,
    $n$'pnl_state', private.line_pnl_state(t.id),
    'pnl_fixed', c.loan_part is not null$n$);
end
$patch$;

commit;
