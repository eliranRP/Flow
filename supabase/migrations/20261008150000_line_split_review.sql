-- FLOW-312 (FLOW-311 follow-ups), item 2. A bank re-sync that changes the amount of a line
-- split by category no longer makes it count whole in silence: the line gets an open review
-- item with reason split_mismatch. Saving new parts (or clearing the split) closes it, and so
-- does an amount that comes back to match the parts. save_line_split accepts a line whose
-- only open review is split_mismatch; it is otherwise as in 20261008140000_line_split_preview.sql
-- (FLOW-325). Decision 0125.

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

-- A line can wait behind another open review (one open review per line). When that review
-- closes, judge the line again. A split_mismatch review that is reopened (reopen_review, undo)
-- is judged again too, so it does not stay open on parts that match; another review that is
-- reopened takes the line back from an open split_mismatch. Closing a split_mismatch
-- review itself (approve, skip, or the delete above) changes nothing here.
create or replace function private.review_queue_line_split_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.transaction_id is null
    or not exists (select 1 from public.line_splits s where s.transaction_id = old.transaction_id)
  then
    return null;
  end if;
  if old.status = 'open'
    and old.reason is distinct from 'split_mismatch'
    and (tg_op = 'DELETE' or new.status is distinct from 'open')
  then
    perform private.line_split_review_sync(old.transaction_id);
  elsif tg_op = 'UPDATE'
    and new.status = 'open'
    and old.status is distinct from 'open'
    and new.reason = 'split_mismatch'
  then
    perform private.line_split_review_sync(new.transaction_id);
  elsif tg_op = 'UPDATE'
    and new.status = 'open'
    and old.status is distinct from 'open'
    and new.reason is distinct from 'split_mismatch'
  then
    -- Another review came back (undo of a skip): it holds the line again, one open review.
    delete from public.review_queue q
    where q.transaction_id = new.transaction_id
      and q.company_id = new.company_id
      and q.status = 'open'
      and q.reason = 'split_mismatch';
  end if;
  return null;
end;
$$;

revoke all on function private.review_queue_line_split_review() from public, anon, authenticated;

create trigger review_queue_line_split_review
  after update of status or delete on public.review_queue
  for each row
  execute function private.review_queue_line_split_review();

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

-- See 20261008110000 for the part shapes and rules. p_preview returns
-- [{category_id, project_id, amount_minor, percent, rest}] without writing. An open review
-- refuses the line, except a split_mismatch review, which the new parts (or the cleared
-- split) close at commit.
create or replace function public.save_line_split(
  p_transaction_id uuid,
  p_parts jsonb,
  p_preview boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  line_net bigint;
  line_minor bigint;
  line_direction public.txn_direction;
  line_category uuid;
  line_kind text;
  item jsonb;
  n integer;
  i integer := 0;
  categories uuid[] := '{}';
  projects uuid[] := '{}';
  amounts bigint[] := '{}';
  percents numeric[] := '{}';
  rest_at integer;
  category uuid;
  project uuid;
  kind text;
  fixed_total bigint := 0;
  percent_total numeric := 0;
  percent_minor bigint := 0;
  leftover bigint;
  rest_minor bigint;
  seen text[] := '{}'::text[];
  pair text;
  pick record;
  ord integer := 0;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_parts is null or jsonb_typeof(p_parts) <> 'array' then
    raise exception 'validation';
  end if;
  n := jsonb_array_length(p_parts);
  if n = 1 or n > 50 then
    raise exception 'validation';
  end if;

  select t.amount_net, t.direction, t.category_id into line_net, line_direction, line_category
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;

  -- The line's role was set for its own category's kind (the direction when it has none).
  select coalesce(c.kind::text, line_direction::text) into line_kind
  from (select 1) one
  left join public.categories c on c.id = line_category and c.company_id = cid;

  if n = 0 then
    if p_preview then
      return '[]'::jsonb;
    end if;
    delete from public.line_splits where transaction_id = p_transaction_id and company_id = cid;
    return '[]'::jsonb;
  end if;

  if line_net = 0 then
    raise exception 'line amount is zero';
  end if;
  line_minor := abs(line_net);
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
    i := i + 1;
    if jsonb_typeof(item) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(item) k
        where k not in ('category_id', 'project_id', 'amount_minor', 'percent', 'rest')
      )
      -- Exactly one of amount_minor, percent and rest.
      or ((item ? 'amount_minor')::integer + (item ? 'percent')::integer + (item ? 'rest')::integer) <> 1
      or (item ? 'rest' and item->'rest' is distinct from 'true'::jsonb)
      or (item ? 'amount_minor' and (
        jsonb_typeof(item->'amount_minor') is distinct from 'number'
        or (item->>'amount_minor') !~ '^[0-9]{1,15}$'))
      or (item ? 'percent' and (
        jsonb_typeof(item->'percent') is distinct from 'number'
        or (item->>'percent') !~ '^[0-9]{1,3}(\.[0-9]{1,4})?$'))
      or (not item ? 'rest' and not item ? 'category_id')
      or (item ? 'category_id' and (
        jsonb_typeof(item->'category_id') is distinct from 'string'
        or (item->>'category_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
      or (item ? 'project_id' and jsonb_typeof(item->'project_id') not in ('string', 'null'))
      or (jsonb_typeof(item->'project_id') = 'string'
        and (item->>'project_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    then
      raise exception 'validation';
    end if;

    if item ? 'rest' then
      if rest_at is not null then
        raise exception 'validation';
      end if;
      rest_at := i;
    end if;
    if item ? 'amount_minor' and (item->>'amount_minor')::bigint <= 0 then
      raise exception 'validation';
    end if;
    if item ? 'percent' and ((item->>'percent')::numeric <= 0 or (item->>'percent')::numeric > 100) then
      raise exception 'validation';
    end if;

    category := (item->>'category_id')::uuid;
    if category is null then
      -- A rest part with no category keeps the line's own category.
      category := line_category;
      if category is null then
        raise exception 'line has no category for the rest';
      end if;
    end if;
    project := (item->>'project_id')::uuid;

    pair := category::text || '|' || coalesce(project::text, '');
    if pair = any(seen) then
      raise exception 'same category and project twice';
    end if;
    seen := seen || pair;

    select c.kind::text into kind
    from public.categories c
    where c.id = category and c.company_id = cid;
    if kind is null then
      raise exception 'category not found';
    end if;
    -- A part of another kind than the line's own category needs its own project: the line's
    -- role was set for that kind, so the part cannot borrow it.
    if kind is distinct from line_kind and project is null
      and category is distinct from line_category then
      raise exception 'a reversal part needs a project';
    end if;
    if project is not null and not exists (
      select 1 from public.projects p where p.id = project and p.company_id = cid
    ) then
      raise exception 'project not found';
    end if;

    categories := categories || category;
    projects := projects || project;
    amounts := amounts || (item->>'amount_minor')::bigint;
    percents := percents || (item->>'percent')::numeric;
    if item ? 'amount_minor' then
      fixed_total := fixed_total + (item->>'amount_minor')::bigint;
    elsif item ? 'percent' then
      percent_total := percent_total + (item->>'percent')::numeric;
    end if;
  end loop;

  if percent_total > 100 then
    raise exception 'parts exceed the line';
  end if;

  -- Percent parts: floor each share of the line, then hand the cents still missing from the
  -- rounded total to the largest remainders, first part first on a tie.
  if percent_total > 0 then
    percent_minor := case
      when percent_total = 100 then line_minor
      else round(line_minor * percent_total / 100)::bigint
    end;
    for pick in
      select u.ord, floor(line_minor * u.pct / 100)::bigint as base,
        line_minor * u.pct / 100 - floor(line_minor * u.pct / 100) as frac
      from unnest(percents) with ordinality as u(pct, ord)
      where u.pct is not null
    loop
      amounts[pick.ord] := pick.base;
    end loop;
    select percent_minor - coalesce(sum(amounts[u.ord]), 0) into leftover
    from unnest(percents) with ordinality as u(pct, ord)
    where u.pct is not null;
    for pick in
      select u.ord
      from unnest(percents) with ordinality as u(pct, ord)
      where u.pct is not null
      order by line_minor * u.pct / 100 - floor(line_minor * u.pct / 100) desc, u.ord
      limit leftover
    loop
      amounts[pick.ord] := amounts[pick.ord] + 1;
    end loop;
    if exists (
      select 1 from unnest(percents) with ordinality as u(pct, ord)
      where u.pct is not null and amounts[u.ord] = 0
    ) then
      raise exception 'a part rounds to zero';
    end if;
  end if;

  if fixed_total + percent_minor > line_minor then
    raise exception 'parts exceed the line';
  end if;
  if rest_at is null then
    if fixed_total + percent_minor <> line_minor then
      raise exception 'parts must sum to the line';
    end if;
  else
    rest_minor := line_minor - fixed_total - percent_minor;
    amounts[rest_at] := rest_minor;
    -- Nothing left: the rest part is dropped, and the others must still be a split.
    if rest_minor = 0 and n - 1 < 2 then
      raise exception 'nothing is left for the rest';
    end if;
  end if;

  -- A preview returns what a save would store, with each part's percent and rest marker,
  -- and writes nothing.
  if p_preview then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', categories[u.i],
        'project_id', projects[u.i],
        'amount_minor', amounts[u.i],
        'percent', percents[u.i],
        'rest', coalesce(u.i = rest_at, false)
      ) order by u.i)
      from generate_series(1, n) as u(i)
      where amounts[u.i] > 0
    ), '[]'::jsonb);
  end if;

  delete from public.line_splits where transaction_id = p_transaction_id and company_id = cid;
  for i in 1..n
  loop
    continue when amounts[i] = 0;
    ord := ord + 1;
    insert into public.line_splits (
      company_id, transaction_id, ordinal, category_id, project_id, amount_minor, percent, is_rest
    )
    values (
      cid, p_transaction_id, ord, categories[i], projects[i], amounts[i], percents[i],
      coalesce(i = rest_at, false)
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

revoke all on function public.save_line_split(uuid, jsonb, boolean) from public, anon, authenticated, service_role;
grant execute on function public.save_line_split(uuid, jsonb, boolean) to authenticated;

-- Lines that already mismatch get their review now.
select private.line_split_review_sync(d.transaction_id)
from (select distinct s.transaction_id from public.line_splits s) d;

commit;
