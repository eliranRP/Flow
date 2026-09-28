-- Undo for a resolved review item. The queue row goes back to open.
-- The transaction assignment is left in place. Decision 0061.

create or replace function public.reopen_review(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  updated int;
begin
  update public.review_queue
  set status = 'open',
      resolved_at = null
  where id = p_id
    and company_id = private.current_company_id()
    and status in ('approved', 'skipped', 'changed');
  get diagnostics updated = row_count;
  if updated = 0 then
    raise exception 'review item not found';
  end if;
end;
$$;

revoke all on function public.reopen_review(uuid) from public, anon;
grant execute on function public.reopen_review(uuid) to authenticated, service_role;
