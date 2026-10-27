-- FLOW-150 (MCP/data agent request, decision 0229): move a shared line back to one project.
-- 1. public.reassign_transaction refuses a shared line ('shared costs are split, not assigned to one
--    project'), so a share is never lost by a plain assign. Under the transaction-local flag
--    flow.unshare it goes on: its shares are deleted and the whole line goes to the one project, as
--    for any line it moves. Its undo row keeps the shares and the shared role before (it always
--    did), so undo_reassign puts them back.
-- 2. mcp_assign_expense takes p_unshare (default false). On a shared line (role shared, or waiting in
--    review as an unsplit shared cost) it sets the flag and reassigns; category_id may then be left
--    out, and the line keeps its own. On any other line it is a plain assign. A line split by
--    category is refused (its parts carry their own shares). A request without unshare hashes as
--    before, so its replays still match.
-- 3. mcp_assign_expenses takes unshare per row (with project_id; not with shares or parts).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- 1. The flag lets reassign_transaction move a shared line.
do $reassign$
declare
  def text;
  a_open constant text := $a$  if prior_role = 'shared' or exists ($a$;
  a_close constant text := $a$  ) then
    raise exception 'shared costs are split, not assigned to one project';$a$;
begin
  def := pg_get_functiondef('public.reassign_transaction(uuid,uuid,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_open) <> 1 or pg_temp.anchor_count(def, a_close) <> 1 then
    raise exception 'reassign_transaction is not the expected definition';
  end if;
  def := replace(def, a_open, $n$  -- FLOW-150: mcp_assign_expense with unshare sets flow.unshare to move a shared line on purpose.
  if current_setting('flow.unshare', true) is distinct from 'on' and (prior_role = 'shared' or exists ($n$);
  def := replace(def, a_close, $n$  )) then
    raise exception 'shared costs are split, not assigned to one project';$n$);
  execute def;
end
$reassign$;

-- 2. assign_expense with unshare.
drop function public.mcp_assign_expense(text, uuid, uuid, uuid, boolean);

create function public.mcp_assign_expense(
  p_idempotency_key text,
  p_transaction_id uuid,
  p_project_id uuid,
  p_category_id uuid,
  p_remember boolean default false,
  p_unshare boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  hash text;
  prior jsonb;
  cid uuid;
  review uuid;
  outcome jsonb;
  undo_id uuid;
  response jsonb;
  locked boolean;
  line record;
  shared boolean := false;
  category uuid := p_category_id;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or (p_category_id is null and not coalesce(p_unshare, false))
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  -- Without unshare the hash is the one before FLOW-150, so a replay of an earlier key still matches.
  hash := 'assign|' || p_transaction_id::text || '|' || coalesce(p_project_id::text, '') || '|'
    || coalesce(p_category_id::text, '') || '|' || coalesce(p_remember, false)::text
    || case when coalesce(p_unshare, false) then '|unshare' else '' end;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    -- Lock the line before the review so assign and category share one order.
    select t.category_id, t.pnl_role into line
    from public.transactions t
    where t.id = p_transaction_id
      and t.company_id = cid
      and t.removed_at is null
    for update;
    locked := found;

    if locked and coalesce(p_unshare, false) then
      shared := line.pnl_role is not distinct from 'shared'::public.pnl_role or exists (
        select 1 from public.review_queue q
        where q.transaction_id = p_transaction_id and q.company_id = cid
          and q.status = 'open' and q.reason = 'unallocated_shared'
      );
      -- The line keeps its category unless a new one is given.
      category := coalesce(p_category_id, line.category_id);
    end if;

    if exists (
      select 1
      from public.review_queue q
      where q.id = p_transaction_id
        and q.company_id = cid
    ) and not locked then
      response := private.mcp_error(
        'validation',
        'id is not a transaction; list_review.id is the review id'
      );
    elsif not locked then
      response := private.mcp_refused('transaction not found');
    elsif category is null then
      response := private.mcp_refused('category is required');
    elsif shared and p_project_id is null then
      response := private.mcp_error('validation', 'validation');
    elsif shared and exists (
      select 1 from public.line_splits s where s.transaction_id = p_transaction_id and s.company_id = cid
    ) then
      -- A split line's parts carry their own shares: split_line moves them.
      response := private.mcp_refused('line has a split by category');
    elsif shared then
      -- FLOW-150: the shares go and the whole line goes to the one project. reassign_transaction keeps
      -- the shares and the shared role in its undo row, and resolves an open review as changed.
      if not exists (select 1 from public.projects p where p.id = p_project_id and p.company_id = cid) then
        response := private.mcp_refused('project or category not found');
      else
        perform set_config('flow.unshare', 'on', true);
        undo_id := public.reassign_transaction(p_transaction_id, p_project_id, category);
        perform set_config('flow.unshare', '', true);
        response := private.mcp_record_write(token, p_transaction_id, null, undo_id, 'reassign');
        if response->>'ok' = 'true' then
          response := jsonb_set(response, '{data,unshared}', 'true'::jsonb);
        end if;
      end if;
    else
      if p_project_id is null and not exists (
        select 1
        from public.categories c
        where c.id = category
          and c.company_id = cid
          and c.kind = 'income'
          and c.excluded_from_pnl
      ) then
        response := private.mcp_error('validation', 'validation');
      elsif p_project_id is not null and not exists (
        select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
      ) then
        response := private.mcp_refused('project or category not found');
      else
      select q.id into review
      from public.review_queue q
      where q.transaction_id = p_transaction_id
        and q.company_id = cid
        and q.status = 'open'
      order by q.created_at desc
      limit 1
      for update;

      if review is not null then
        outcome := public.approve_review_item(
          review,
          p_project_id,
          category,
          coalesce(p_remember, false),
          null,
          null,
          false
        );
        if outcome->>'ok' is distinct from 'true' then
          response := outcome;
        else
          response := private.mcp_record_write(token, p_transaction_id, review, null, 'review');
        end if;
      else
        undo_id := public.reassign_transaction(p_transaction_id, p_project_id, category);
        response := private.mcp_record_write(token, p_transaction_id, null, undo_id, 'reassign');
      end if;
      end if;
    end if;
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;
revoke all on function public.mcp_assign_expense(text, uuid, uuid, uuid, boolean, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_assign_expense(text, uuid, uuid, uuid, boolean, boolean) to authenticated;
comment on function public.mcp_assign_expense(text, uuid, uuid, uuid, boolean, boolean) is
  'MCP assign_expense: file a line under a project and category. With unshare (FLOW-150, decision 0229) a shared line''s shares go and the whole line goes to the one project; undo kind reassign puts the shares back.';

-- 3. assign_expenses: unshare per row.
do $batch$
declare
  def text;
  a_check constant text := $a$    elsif (item->>'project_id') is not null and (item->>'category_id') is null then
      row_result := private.mcp_error('validation', 'validation');$a$;
  a_call constant text := $a$          row_result := public.mcp_assign_expense(
            row_key,
            txn,
            project_id,
            category_id,
            remember
          );$a$;
begin
  def := pg_get_functiondef('public.mcp_assign_expenses(text,jsonb)'::regprocedure);
  if pg_temp.anchor_count(def, a_check) <> 1 or pg_temp.anchor_count(def, a_call) <> 1 then
    raise exception 'mcp_assign_expenses is not the expected definition';
  end if;
  def := replace(def, a_check, $n$    elsif item ? 'unshare' and (
      jsonb_typeof(item->'unshare') <> 'boolean'
      or item ? 'shares'
      or item ? 'parts'
      or (item->>'project_id') is null
    ) then
      -- FLOW-150: unshare moves a shared line to the one project_id of its row.
      row_result := private.mcp_error('validation', 'validation');
    elsif (item->>'project_id') is not null and (item->>'category_id') is null
      and not coalesce((item->>'unshare')::boolean, false) then
      row_result := private.mcp_error('validation', 'validation');$n$);
  def := replace(def, a_call, $n$          row_result := public.mcp_assign_expense(
            row_key,
            txn,
            project_id,
            category_id,
            remember,
            coalesce((item->>'unshare')::boolean, false)
          );$n$);
  execute def;
end
$batch$;

drop function pg_temp.anchor_count(text, text);

commit;
