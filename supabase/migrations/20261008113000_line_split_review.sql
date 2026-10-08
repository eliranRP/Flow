-- FLOW-312 (FLOW-311 follow-ups), item 2. A bank re-sync that changes the amount of a line
-- split by category no longer makes it count whole in silence: the line gets an open review
-- item with reason split_mismatch. Saving new parts (or clearing the split) closes it, and so
-- does an amount that comes back to match the parts. save_line_split accepts a line whose
-- only open review is split_mismatch; it is otherwise as in 20261007190000_line_splits.sql.
-- Decision 0123.

begin;

set local lock_timeout = '5s';

-- Open or close the split_mismatch review of one line. A line whose parts no longer sum to
-- it, and that is not removed or void, gets one open review unless it already has an open
-- review of any reason. A line whose parts match again, or that has no parts, loses its open
-- split_mismatch review. Idempotent.
create or replace function private.line_split_review_sync(p_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  line record;
  parts integer;
  parts_minor bigint;
  mismatch boolean;
begin
  select t.company_id, t.amount_net, t.removed_at, t.line_status
  into line
  from public.transactions t
  where t.id = p_transaction_id;
  if not found then
    return;
  end if;

  select count(*)::integer, coalesce(sum(s.amount_minor), 0)
  into parts, parts_minor
  from public.line_splits s
  where s.transaction_id = p_transaction_id;

  mismatch := parts > 0
    and parts_minor <> abs(line.amount_net)
    and line.removed_at is null
    and line.line_status is distinct from 'void'::public.line_status;

  if mismatch then
    insert into public.review_queue (company_id, transaction_id, status, reason)
    select line.company_id, p_transaction_id, 'open', 'split_mismatch'
    where not exists (
      select 1 from public.review_queue q
      where q.transaction_id = p_transaction_id and q.status = 'open'
    );
  else
    delete from public.review_queue q
    where q.transaction_id = p_transaction_id
      and q.company_id = line.company_id
      and q.status = 'open'
      and q.reason = 'split_mismatch';
  end if;
end;
$$;

revoke all on function private.line_split_review_sync(uuid) from public, anon, authenticated;

-- The bank sync (and any other writer) changing a line's amount, or a line that is removed,
-- voided or comes back.
create or replace function private.transactions_line_split_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.line_splits s where s.transaction_id = new.id) then
    perform private.line_split_review_sync(new.id);
  end if;
  return null;
end;
$$;

revoke all on function private.transactions_line_split_review() from public, anon, authenticated;

create trigger transactions_line_split_review
  after update of amount_net, removed_at, line_status on public.transactions
  for each row
  when (
    old.amount_net is distinct from new.amount_net
    or old.removed_at is distinct from new.removed_at
    or old.line_status is distinct from new.line_status
  )
  execute function private.transactions_line_split_review();

-- New parts, cleared parts and undo. Deferred, so save_line_split's delete-then-insert is
-- judged once, on the parts as they stand at commit.
create or replace function private.line_splits_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.line_split_review_sync(coalesce(new.transaction_id, old.transaction_id));
  return null;
end;
$$;

revoke all on function private.line_splits_review() from public, anon, authenticated;

create constraint trigger line_splits_review
  after insert or update or delete on public.line_splits
  deferrable initially deferred
  for each row
  execute function private.line_splits_review();

-- Replace the parts of one line. An empty array clears the split. Each part needs a
-- category of the line's kind, an optional project, and a whole minor-unit amount above
-- zero; the parts sum to the line. A line with a loan split or an open review is refused,
-- except a split_mismatch review, which the new parts (or the cleared split) close at commit.
-- Returns the parts as stored.
create or replace function public.save_line_split(p_transaction_id uuid, p_parts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  line_net bigint;
  line_direction public.txn_direction;
  item jsonb;
  ord integer := 0;
  total numeric := 0;
  category uuid;
  project uuid;
  amount bigint;
  kind text;
  seen text[] := '{}'::text[];
  pair text;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_parts is null or jsonb_typeof(p_parts) <> 'array' then
    raise exception 'validation';
  end if;
  if jsonb_array_length(p_parts) = 1 or jsonb_array_length(p_parts) > 50 then
    raise exception 'validation';
  end if;

  select t.amount_net, t.direction into line_net, line_direction
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;

  if jsonb_array_length(p_parts) = 0 then
    delete from public.line_splits where transaction_id = p_transaction_id and company_id = cid;
    return '[]'::jsonb;
  end if;

  if line_net = 0 then
    raise exception 'parts must sum to the line';
  end if;
  if exists (select 1 from public.loan_splits s where s.transaction_id = p_transaction_id) then
    raise exception 'line has a loan split';
  end if;
  if exists (
    select 1 from public.review_queue q
    where q.transaction_id = p_transaction_id and q.company_id = cid and q.status = 'open'
      and q.reason is distinct from 'split_mismatch'
  ) then
    raise exception 'line has an open review';
  end if;

  for item in select value from jsonb_array_elements(p_parts)
  loop
    if jsonb_typeof(item) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(item) k
        where k not in ('category_id', 'project_id', 'amount_minor')
      )
      or jsonb_typeof(item->'category_id') is distinct from 'string'
      or (item->>'category_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or (item ? 'project_id' and jsonb_typeof(item->'project_id') not in ('string', 'null'))
      or (jsonb_typeof(item->'project_id') = 'string'
        and (item->>'project_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      or jsonb_typeof(item->'amount_minor') is distinct from 'number'
      or (item->>'amount_minor') !~ '^[0-9]{1,15}$'
    then
      raise exception 'validation';
    end if;
    category := (item->>'category_id')::uuid;
    project := (item->>'project_id')::uuid;
    amount := (item->>'amount_minor')::bigint;
    if amount <= 0 then
      raise exception 'validation';
    end if;
    pair := category::text || '|' || coalesce(project::text, '');
    if pair = any(seen) then
      raise exception 'validation';
    end if;
    seen := seen || pair;
    total := total + amount;

    select c.kind::text into kind
    from public.categories c
    where c.id = category and c.company_id = cid;
    if kind is null then
      raise exception 'category not found';
    end if;
    if kind is distinct from line_direction::text then
      raise exception 'category kind must match the direction';
    end if;
    if project is not null and not exists (
      select 1 from public.projects p where p.id = project and p.company_id = cid
    ) then
      raise exception 'project not found';
    end if;
  end loop;

  if total <> abs(line_net) then
    raise exception 'parts must sum to the line';
  end if;

  delete from public.line_splits where transaction_id = p_transaction_id and company_id = cid;
  for item in select value from jsonb_array_elements(p_parts)
  loop
    ord := ord + 1;
    insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
    values (
      cid,
      p_transaction_id,
      ord,
      (item->>'category_id')::uuid,
      (item->>'project_id')::uuid,
      (item->>'amount_minor')::bigint
    );
  end loop;

  -- The owner chose these categories, so the line is no longer a suggestion.
  update public.transactions
  set user_assigned = true,
      category_suggested = false
  where id = p_transaction_id and company_id = cid;

  return private.line_split_parts(p_transaction_id);
end;
$$;

revoke all on function public.save_line_split(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_line_split(uuid, jsonb) to authenticated;

-- Lines that already mismatch get their review now.
select private.line_split_review_sync(d.transaction_id)
from (select distinct s.transaction_id from public.line_splits s) d;

commit;
