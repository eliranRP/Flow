-- FLOW-205 undo follow-ups.
-- 1. Undo of a project or category the MCP created is a conflict while a review row or a
--    reassign undo row still points at it in prior_project_id, prior_category_id or
--    prior_allocations: deleting it would leave reopen_review or the reassign undo restoring
--    an id that no longer exists.
-- 2. hide_category on a category this user's open hide already covers (a second hide, or a
--    re-hide after the app unhid it) hides it and keeps the one undoable write, instead of
--    the generic refusal. Undo of a hide the app already reversed (the category is back to
--    how it was before the hide) succeeds and closes the write, instead of conflict.
-- mcp_hide_category is otherwise as in 20261008050000_mcp_lock_retry.sql. mcp_undo is
-- patched in place (guarded), so its long body cannot drift. Grants are kept.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function public.mcp_hide_category(
  p_idempotency_key text,
  p_category_id uuid
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
  was_hidden boolean;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_category_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'category_hide|' || p_category_id::text;
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
    select c.hidden into was_hidden
    from public.categories c
    where c.id = p_category_id
      and c.company_id = cid
    for update;

    if not found then
      response := private.mcp_refused('category not found');
    else
      perform public.set_category_hidden(p_category_id, true);
      -- FLOW-205: a hide this user can still undo stays the one write, so a second hide (or a
      -- re-hide after the app unhid it) succeeds, and its undo restores the state before the
      -- first hide.
      if not exists (
        select 1 from private.mcp_writes w
        where w.user_id = auth.uid()
          and w.kind = 'category_hidden'
          and w.category_id = p_category_id
          and w.undone_at is null
      ) then
        insert into private.mcp_writes (token_id, user_id, kind, category_id, prior_hidden)
        values (token, auth.uid(), 'category_hidden', p_category_id, was_hidden);
      end if;
      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object('id', p_category_id, 'undo_kind', 'category_hidden')
      );
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

do $undo$
declare
  def text;
  a_project constant text := $old$        where l.company_id = cid and l.project_id = p_id
      ) then$old$;
  a_category constant text := $old$          and (q.prior_remembered_category_id = p_id or q.written_remembered_category_id = p_id)
      ) then$old$;
  a_hidden constant text := $old$      if not found or cur_hidden is distinct from true then
        response := private.mcp_error('conflict', 'conflict');
      else
        perform public.set_category_hidden(p_id, rec.prior_hidden);$old$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if position(a_project in def) = 0 or position(a_category in def) = 0
    or position(a_hidden in def) = 0 or position('r.prior_project_id = p_id' in def) > 0
  then
    raise exception 'mcp_undo is not the expected definition';
  end if;
  def := replace(def, a_project, $new$        where l.company_id = cid and l.project_id = p_id
      ) or exists (
        -- FLOW-205: a reopen or a reassign undo would restore this project.
        select 1 from public.review_queue q
        where q.company_id = cid
          and (q.prior_project_id = p_id
            or q.prior_allocations @> jsonb_build_array(jsonb_build_object('project_id', p_id)))
      ) or exists (
        select 1 from public.reassign_undo r
        where r.company_id = cid
          and (r.prior_project_id = p_id
            or r.prior_allocations @> jsonb_build_array(jsonb_build_object('project_id', p_id)))
      ) then$new$);
  def := replace(def, a_category, $new$          and (q.prior_remembered_category_id = p_id or q.written_remembered_category_id = p_id
            or q.prior_category_id = p_id)
      ) or exists (
        -- FLOW-205: a reassign undo would restore this category.
        select 1 from public.reassign_undo r
        where r.company_id = cid and r.prior_category_id = p_id
      ) then$new$);
  def := replace(def, a_hidden, $new$      if found and cur_hidden is not distinct from rec.prior_hidden then
        -- FLOW-205: the app already put it back as it was before the hide; close the write.
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      elsif not found or cur_hidden is distinct from true then
        response := private.mcp_error('conflict', 'conflict');
      else
        perform public.set_category_hidden(p_id, rec.prior_hidden);$new$);
  execute def;
end
$undo$;

commit;
