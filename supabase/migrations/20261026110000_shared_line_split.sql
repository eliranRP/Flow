-- A shared expense's אישור in לאישור opens the split by categories and projects (line_splits), but
-- save_line_split refused any line with an open review, the shared line's own unallocated_shared
-- review included, so the split said "approve it in the queue first" and the queue sent it back to
-- the split. The split now takes that line: saving it closes the review (status changed, as the
-- older split between projects did), and the sync no longer reopens a shared line that has a split.
-- Each function keeps its signature, security, search_path and grants (patched in place).

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- save_line_split: an open unallocated_shared review does not block the split, and a saved split
-- closes it.
do $split$
declare
  def text;
  a_review constant text := $a$      and q.reason is distinct from 'split_mismatch'$a$;
  a_return constant text := $a$  return private.line_split_parts(p_transaction_id);
end;$a$;
begin
  def := pg_get_functiondef('public.save_line_split(uuid,jsonb,boolean)'::regprocedure);
  if pg_temp.anchor_count(def, a_review) <> 1 or pg_temp.anchor_count(def, a_return) <> 1 then
    raise exception 'save_line_split is not the expected definition';
  end if;
  def := replace(def, a_review, $n$      and coalesce(q.reason, '') not in ('split_mismatch', 'unallocated_shared')$n$);
  def := replace(def, a_return, $n$  -- The split is the answer to a shared line's review: the queue's אישור opened it.
  update public.review_queue q
  set status = 'changed', resolved_at = now()
  where q.company_id = cid and q.transaction_id = p_transaction_id
    and q.status = 'open' and q.reason = 'unallocated_shared';

  return private.line_split_parts(p_transaction_id);
end;$n$);
  execute def;
end;
$split$;

-- sync_review_queue: a shared expense is unallocated only while it has neither allocations nor a
-- split by categories and projects.
do $sync$
declare
  def text;
  a_alloc constant text := $a$select 1 from public.allocations a where a.transaction_id = t.id$a$;
begin
  def := pg_get_functiondef('public.sync_review_queue(uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_alloc) <> 2 then
    raise exception 'sync_review_queue is not the expected definition';
  end if;
  def := replace(def, a_alloc, $n$select 1 from public.allocations a where a.transaction_id = t.id
          union all select 1 from public.line_splits s where s.transaction_id = t.id$n$);
  execute def;
end;
$sync$;

drop function pg_temp.anchor_count(text, text);

commit;
