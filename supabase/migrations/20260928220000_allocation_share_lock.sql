-- The share-sum trigger is deferred, so it runs at commit as the session
-- user. Authenticated no longer has UPDATE on transactions (decision 0063).
-- The lock has to run as the function owner.

create or replace function private.check_allocation_shares()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_target uuid;
  old_target uuid;
  total integer;
begin
  if tg_op = 'DELETE' then
    old_target := old.transaction_id;
  elsif tg_op = 'UPDATE' then
    new_target := new.transaction_id;
    if old.transaction_id is distinct from new.transaction_id then
      old_target := old.transaction_id;
    end if;
  else
    new_target := new.transaction_id;
  end if;

  if old_target is not null and new_target is not null and old_target < new_target then
    perform 1 from public.transactions where id = old_target for update;
    perform 1 from public.transactions where id = new_target for update;
  else
    if new_target is not null then
      perform 1 from public.transactions where id = new_target for update;
    end if;
    if old_target is not null then
      perform 1 from public.transactions where id = old_target for update;
    end if;
  end if;

  if new_target is not null then
    select coalesce(sum(share_bp), 0) into total
    from public.allocations
    where transaction_id = new_target;
    if total <> 0 and total <> 10000 then
      raise exception 'allocation shares for % must sum to 10000 (got %)', new_target, total
        using errcode = '23514';
    end if;
  end if;

  if old_target is not null then
    select coalesce(sum(share_bp), 0) into total
    from public.allocations
    where transaction_id = old_target;
    if total <> 0 and total <> 10000 then
      raise exception 'allocation shares for % must sum to 10000 (got %)', old_target, total
        using errcode = '23514';
    end if;
  end if;

  return null;
end;
$$;

revoke all on function private.check_allocation_shares() from public, anon;
grant execute on function private.check_allocation_shares() to authenticated, service_role;
