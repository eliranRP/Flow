-- FLOW-311. Split one bank line into parts, each with its own category, optional project,
-- and an exact amount in minor units. The parts sum to the line. Decision 0104.

begin;

-- The new table and the trigger on public.loan_splits take short locks. Give up after
-- five seconds rather than queue every read behind the migration.
set local lock_timeout = '5s';

create table public.line_splits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid not null,
  ordinal smallint not null check (ordinal between 1 and 50),
  category_id uuid not null,
  project_id uuid,
  amount_minor bigint not null check (amount_minor > 0),
  created_at timestamptz not null default now(),
  unique (transaction_id, ordinal),
  unique nulls not distinct (transaction_id, category_id, project_id),
  foreign key (company_id, transaction_id)
    references public.transactions (company_id, id)
    on delete cascade,
  foreign key (company_id, category_id)
    references public.categories (company_id, id),
  foreign key (company_id, project_id)
    references public.projects (company_id, id)
);

comment on table public.line_splits is
  'Parts of one bank line, each with its own category, optional project and exact minor-unit amount. The parts sum to abs(amount_net). Decision 0104.';

comment on column public.line_splits.project_id is
  'Null keeps the line''s own project and P&L role for this part.';

create index line_splits_company_txn_idx on public.line_splits (company_id, transaction_id);
create index line_splits_category_idx on public.line_splits (category_id);
create index line_splits_project_idx on public.line_splits (project_id);

alter table public.line_splits enable row level security;

create policy line_splits_select on public.line_splits
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

revoke all on public.line_splits from public, anon, authenticated;
grant select on public.line_splits to authenticated;
grant select, insert, update, delete on public.line_splits to service_role;

-- A line takes either a loan split or a split by category, never both.
create or replace function private.line_splits_exclusive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'line_splits' then
    if exists (select 1 from public.loan_splits s where s.transaction_id = new.transaction_id) then
      raise exception 'line has a loan split' using errcode = '23514';
    end if;
  elsif exists (select 1 from public.line_splits s where s.transaction_id = new.transaction_id) then
    raise exception 'line has a split by category' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.line_splits_exclusive() from public, anon, authenticated;

create trigger line_splits_exclusive
  before insert or update on public.line_splits
  for each row execute function private.line_splits_exclusive();

create trigger loan_splits_line_exclusive
  before insert or update on public.loan_splits
  for each row execute function private.line_splits_exclusive();

-- pnl_lines: a line with a valid split by category (two or more parts that sum to the
-- line, and no loan split) counts once per part. A part with a project counts under that
-- project with the project role (overhead when it is the overhead project). A part with no
-- project keeps the line's project and role, so a shared line's part is shared by the
-- line's allocations in proportion. A split that no longer sums to the line counts whole.

create or replace view private.pnl_lines
with (security_invoker = true) as
with split as (
  select
    s.transaction_id,
    count(*) as parts,
    sum(s.amount_minor) as parts_minor,
    bool_or(s.needs_review) as flagged
  from public.loan_splits s
  group by s.transaction_id
),
lsplit as (
  select
    s.transaction_id,
    count(*) as parts,
    sum(s.amount_minor) as parts_minor
  from public.line_splits s
  group by s.transaction_id
)
select
  t.company_id,
  t.id as transaction_id,
  t.project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and t.pnl_role = 'project' and t.project_id is not null
      and t.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    else t.pnl_role
  end as pnl_role,
  t.direction,
  t.doc_kind,
  t.doc_date,
  t.cash_date,
  coalesce(t.currency, 'ILS') as currency,
  s.category_id,
  s.part,
  case when t.direction = 'expense' then -s.amount_minor else s.amount_minor end as amount_net,
  t.amount_net as line_amount_net,
  not coalesce(c.excluded_from_pnl, false) as in_pnl,
  false as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then t.project_id is null
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind
from public.transactions t
join split sp on sp.transaction_id = t.id and sp.parts = 3 and not sp.flagged
  and sp.parts_minor = abs(t.amount_net)
join public.loan_splits s on s.transaction_id = t.id
left join public.categories c on c.id = s.category_id
left join public.companies co on co.id = t.company_id
where t.removed_at is null
  and t.line_status = 'posted'
  and t.vat_amount = 0
union all
select
  t.company_id,
  t.id as transaction_id,
  coalesce(s.project_id, t.project_id) as project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and s.project_id is not null
      and s.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    when coalesce(c.kind::text, t.direction::text) = 'expense' and s.project_id is not null
      then 'project'::public.pnl_role
    when coalesce(c.kind::text, t.direction::text) = 'expense' and t.pnl_role = 'project' and t.project_id is not null
      and t.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    else t.pnl_role
  end as pnl_role,
  t.direction,
  t.doc_kind,
  t.doc_date,
  t.cash_date,
  coalesce(t.currency, 'ILS') as currency,
  s.category_id,
  null::public.loan_split_part as part,
  case when t.direction = 'expense' then -s.amount_minor else s.amount_minor end as amount_net,
  t.amount_net as line_amount_net,
  not coalesce(c.excluded_from_pnl, false) as in_pnl,
  false as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then coalesce(s.project_id, t.project_id) is null
    when s.project_id is not null then false
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind
from public.transactions t
join lsplit lp on lp.transaction_id = t.id and lp.parts >= 2
  and lp.parts_minor = abs(t.amount_net)
join public.line_splits s on s.transaction_id = t.id
left join public.categories c on c.id = s.category_id
left join public.companies co on co.id = t.company_id
where t.removed_at is null
  and t.line_status = 'posted'
  and not exists (select 1 from public.loan_splits ls where ls.transaction_id = t.id)
union all
select
  t.company_id,
  t.id as transaction_id,
  t.project_id,
  case
    when coalesce(c.kind::text, t.direction::text) = 'expense' and t.pnl_role = 'project' and t.project_id is not null
      and t.project_id = co.overhead_project_id
      then 'overhead'::public.pnl_role
    else t.pnl_role
  end as pnl_role,
  t.direction,
  t.doc_kind,
  t.doc_date,
  t.cash_date,
  coalesce(t.currency, 'ILS') as currency,
  t.category_id,
  null::public.loan_split_part as part,
  t.amount_net,
  t.amount_net as line_amount_net,
  not coalesce(c.excluded_from_pnl, false) as in_pnl,
  sp.transaction_id is not null as loan_split_fallback,
  case
    when coalesce(c.kind::text, t.direction::text) = 'income' then t.project_id is null
    else t.pnl_role is null or (t.pnl_role = 'project' and t.project_id is null)
      or (t.pnl_role = 'shared' and not exists (select 1 from public.allocations a where a.transaction_id = t.id))
  end as unassigned,
  coalesce(c.kind::text, t.direction::text) as kind
from public.transactions t
left join public.categories c on c.id = t.category_id
left join public.companies co on co.id = t.company_id
left join split sp on sp.transaction_id = t.id
left join lsplit lp on lp.transaction_id = t.id
where t.removed_at is null
  and t.line_status = 'posted'
  and (
    sp.transaction_id is null or sp.parts <> 3 or sp.flagged or t.vat_amount <> 0
    or sp.parts_minor <> abs(t.amount_net)
  )
  and (
    sp.transaction_id is not null or lp.transaction_id is null or lp.parts < 2
    or lp.parts_minor <> abs(t.amount_net)
  );

revoke all on private.pnl_lines from public, anon;
grant select on private.pnl_lines to authenticated, service_role;

-- The shared share of a part scales by the part, like a loan split part. Only a whole line
-- takes the allocation amount as stored.
create or replace function private.project_category_entries_by_currency(p_project uuid)
returns table (
  category_id uuid,
  transaction_id uuid,
  description text,
  doc_date date,
  amount_net bigint,
  created_at timestamptz,
  shared boolean,
  currency text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select l.category_id, l.transaction_id, t.description, l.doc_date, l.amount_net, t.created_at, false, l.currency
  from private.pnl_lines l
  join public.transactions t on t.id = l.transaction_id
  where l.project_id = p_project
    and l.company_id = (select private.current_company_id())
    and l.kind = 'expense'
    and l.pnl_role = 'project'
    and not t.category_suggested
    and not exists (
      select 1
      from public.review_queue q
      where q.transaction_id = t.id
        and q.company_id = t.company_id
        and q.status = 'open'
    )
  union all
  select l.category_id, l.transaction_id, t.description, l.doc_date,
    case
      when l.part is null and l.amount_net = l.line_amount_net then a.amount_net
      else coalesce(private.div_half_even(a.amount_net::numeric * l.amount_net, l.line_amount_net), 0)
    end,
    t.created_at, true, l.currency
  from public.allocations a
  join private.pnl_lines l on l.transaction_id = a.transaction_id
  join public.transactions t on t.id = l.transaction_id
  where a.project_id = p_project
    and l.company_id = (select private.current_company_id())
    and l.kind = 'expense'
    and l.pnl_role = 'shared'
    and not t.category_suggested
    and l.category_id is not null;
$$;
revoke all on function private.project_category_entries_by_currency(uuid) from public, anon;
grant execute on function private.project_category_entries_by_currency(uuid) to authenticated, service_role;

-- The parts of one line in input order, as stored.
create or replace function private.line_split_parts(p_transaction_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'category_id', s.category_id,
    'project_id', s.project_id,
    'amount_minor', s.amount_minor
  ) order by s.ordinal), '[]'::jsonb)
  from public.line_splits s
  where s.transaction_id = p_transaction_id;
$$;

revoke all on function private.line_split_parts(uuid) from public, anon, authenticated;

-- Read the parts of one line for the owner or a viewer.
create or replace function public.get_line_split(p_transaction_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'transaction_id', t.id,
    'currency', coalesce(t.currency, 'ILS'),
    'line_minor', abs(t.amount_net),
    'parts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', s.category_id,
        'category_name', c.name,
        'project_id', s.project_id,
        'project_name', p.name,
        'amount_minor', s.amount_minor
      ) order by s.ordinal)
      from public.line_splits s
      join public.categories c on c.id = s.category_id
      left join public.projects p on p.id = s.project_id
      where s.transaction_id = t.id
    ), '[]'::jsonb),
    'parts_match', coalesce((
      select count(*) >= 2 and sum(s.amount_minor) = abs(t.amount_net)
      from public.line_splits s
      where s.transaction_id = t.id
      having count(*) > 0
    ), true)
  )
  from public.transactions t
  where t.id = p_transaction_id
    and t.removed_at is null
    and t.company_id = (select private.readable_company_id());
$$;

revoke all on function public.get_line_split(uuid) from public, anon;
grant execute on function public.get_line_split(uuid) to authenticated;

-- Replace the parts of one line. An empty array clears the split. Each part needs a
-- category of the line's kind, an optional project, and a whole minor-unit amount above
-- zero; the parts sum to the line. A line with a loan split or an open review is refused.
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

-- Merging a category moves the parts that use it too. A line with a part in each category
-- for the same project is refused, so the owner fixes that split first.
create or replace function public.merge_category(p_from uuid, p_into uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  from_kind public.category_kind;
  into_kind public.category_kind;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_from = p_into then
    raise exception 'pick a different category';
  end if;
  select kind into from_kind from public.categories where company_id = cid and id = p_from;
  select kind into into_kind from public.categories where company_id = cid and id = p_into and hidden = false;
  if from_kind is null or into_kind is null then
    raise exception 'category not found';
  end if;
  if from_kind is distinct from into_kind then
    raise exception 'categories must be the same kind';
  end if;
  if exists (
    select 1
    from public.line_splits f
    join public.line_splits s
      on s.transaction_id = f.transaction_id
      and s.category_id = p_into
      and s.project_id is not distinct from f.project_id
    where f.company_id = cid and f.category_id = p_from
  ) then
    raise exception 'a split line has both categories';
  end if;
  update public.transactions
  set category_id = p_into,
      user_assigned = true
  where company_id = cid and category_id = p_from;
  update public.line_splits
  set category_id = p_into
  where company_id = cid and category_id = p_from;
  update public.categories
  set hidden = true
  where id = p_from and company_id = cid;
end;
$$;

-- MCP write: split_line. Undo kind line_split takes the transaction id.

alter table private.mcp_writes drop constraint mcp_writes_kind_check;
alter table private.mcp_writes
  add constraint mcp_writes_kind_check check (
    kind in (
      'review', 'reassign', 'project', 'category', 'category_hidden', 'category_pnl',
      'loan', 'loan_update', 'loan_split', 'overhead_project', 'company', 'line_split'
    )
  );

alter table private.mcp_writes drop constraint mcp_writes_target;
alter table private.mcp_writes add constraint mcp_writes_target check (
  (kind = 'review' and review_id is not null)
  or (kind = 'reassign' and transaction_id is not null and reassign_id is not null)
  or (kind = 'project' and project_id is not null)
  or (kind in ('category', 'category_hidden') and category_id is not null)
  or (kind = 'category_pnl' and category_id is not null and prior is not null)
  or (kind = 'loan' and loan_id is not null)
  or (kind = 'loan_update' and loan_id is not null and prior is not null)
  or (kind = 'loan_split' and loan_id is not null and transaction_id is not null)
  or (kind = 'overhead_project' and prior ? 'company_id')
  or (kind = 'company' and company_id is not null and prior is not null)
  or (kind = 'line_split' and transaction_id is not null and prior ? 'written')
);

create or replace function private.mcp_refused(p_message text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select private.mcp_error(
    'refused',
    case
      when p_message in (
        'no company',
        'unknown review action',
        'review item not found',
        'shared costs are split, not assigned to one project',
        'category is required',
        'project or category not found',
        'category kind must match the direction',
        'project and category are required',
        'transaction not found',
        'category not found',
        'project name is too short',
        'project already exists',
        'category name is too short',
        'category already exists',
        'unknown category kind',
        'in use',
        'loan not found',
        'loan currency mismatch',
        'loan already attached',
        'loan balance exceeded',
        'no schedule row for this date',
        'loan categories missing',
        'invalid loan terms',
        'loan category is fixed',
        'project not found',
        'parts must sum to the line',
        'line has a loan split',
        'line has a split by category',
        'line has an open review'
      ) then p_message
      else 'The write was refused.'
    end
  );
$$;

create or replace function public.mcp_split_line(
  p_idempotency_key text,
  p_transaction_id uuid,
  p_parts jsonb
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
  response jsonb;
  before_parts jsonb;
  written jsonb;
  prior_assigned boolean;
  prior_suggested boolean;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or p_parts is null
    or jsonb_typeof(p_parts) <> 'array'
    or jsonb_array_length(p_parts) = 1
    or jsonb_array_length(p_parts) > 50
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'line_split|' || p_transaction_id::text || '|' || md5(p_parts::text);
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  begin
    select t.user_assigned, t.category_suggested
    into prior_assigned, prior_suggested
    from public.transactions t
    where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
    for update;

    if not found then
      if exists (
        select 1 from public.review_queue q
        where q.id = p_transaction_id and q.company_id = cid
      ) then
        response := private.mcp_error(
          'validation',
          'id is not a transaction; list_review.id is the review id'
        );
      else
        response := private.mcp_refused('transaction not found');
      end if;
    else
      before_parts := private.line_split_parts(p_transaction_id);
      written := public.save_line_split(p_transaction_id, p_parts);
      -- clock_timestamp, so two splits of one line in one transaction still undo newest first.
      insert into private.mcp_writes (token_id, user_id, transaction_id, kind, prior, created_at)
      values (
        token, auth.uid(), p_transaction_id, 'line_split',
        jsonb_build_object(
          'before', before_parts,
          'written', written,
          'user_assigned', coalesce(prior_assigned, false),
          'category_suggested', coalesce(prior_suggested, false)
        ),
        clock_timestamp()
      );
      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'transaction_id', p_transaction_id,
          'parts', written,
          'undo_kind', 'line_split',
          'id', p_transaction_id
        )
      );
    end if;
  exception
    when deadlock_detected or serialization_failure then
      return private.mcp_error('unavailable', 'retry');
    when others then
      if sqlerrm = 'validation' then
        response := private.mcp_error('validation', 'validation');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_split_line(text, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_split_line(text, uuid, jsonb) to authenticated;

create or replace function public.mcp_undo(
  p_idempotency_key text,
  p_kind text,
  p_id uuid
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
  rec private.mcp_writes%rowtype;
  txn uuid;
  cur_project uuid;
  cur_category uuid;
  cur_role public.pnl_role;
  response jsonb;
  cur_hidden boolean;
  cur_excluded boolean;
  written_excluded boolean;
  cur_loan record;
  written jsonb;
  before jsonb;
  cur_overhead uuid;
  cur_name text;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_id is null
    or p_kind is null
    or p_kind not in (
      'review', 'reassign', 'project', 'category', 'category_hidden', 'category_pnl',
      'loan', 'loan_update', 'loan_split', 'overhead_project', 'company', 'line_split'
    )
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'undo|' || p_kind || '|' || p_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('not_found', 'not found');
  begin
    select * into rec
    from private.mcp_writes w
    where w.user_id = auth.uid()
      and w.undone_at is null
      and (
        (p_kind = 'review' and w.kind = 'review' and w.review_id = p_id)
        or (p_kind = 'reassign' and w.kind = 'reassign' and w.reassign_id = p_id)
        or (p_kind = 'project' and w.kind = 'project' and w.project_id = p_id)
        or (p_kind in ('category', 'category_hidden', 'category_pnl') and w.kind = p_kind and w.category_id = p_id)
        or (p_kind = 'loan' and w.kind = 'loan' and w.loan_id = p_id)
        or (p_kind = 'loan_update' and w.kind = 'loan_update' and w.loan_id = p_id)
        or (p_kind = 'loan_split' and w.kind = 'loan_split' and w.transaction_id = p_id)
        or (p_kind = 'overhead_project' and w.kind = 'overhead_project' and w.prior->>'company_id' = p_id::text)
        or (p_kind = 'company' and w.kind = 'company' and w.company_id = p_id)
        or (p_kind = 'line_split' and w.kind = 'line_split' and w.transaction_id = p_id)
      )
    order by w.created_at desc
    limit 1
    for update;

    if not found then
      response := private.mcp_error('not_found', 'not found');
    elsif p_kind = 'company' then
      select c.name into cur_name
      from public.companies c
      where c.id = p_id and c.id = cid
      for update;
      if not found or rec.prior->>'before' is null then
        response := private.mcp_error('not_found', 'not found');
      elsif cur_name is distinct from rec.prior->>'after' then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.companies c
        set name = rec.prior->>'before'
        where c.id = p_id and c.id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'overhead_project' then
      select c.overhead_project_id into cur_overhead
      from public.companies c
      where c.id = p_id and c.id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif cur_overhead::text is distinct from rec.prior->>'written' then
        response := private.mcp_error('conflict', 'conflict');
      else
        perform public.set_overhead_project((rec.prior->>'before')::uuid);
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'line_split' then
      perform 1 from public.transactions t
      where t.id = p_id and t.company_id = cid and t.removed_at is null
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif private.line_split_parts(p_id) is distinct from rec.prior->'written' then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.line_splits where transaction_id = p_id and company_id = cid;
        insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
        select cid, p_id, b.ord::smallint, (b.part->>'category_id')::uuid, (b.part->>'project_id')::uuid,
          (b.part->>'amount_minor')::bigint
        from jsonb_array_elements(rec.prior->'before') with ordinality as b(part, ord);
        update public.transactions
        set user_assigned = (rec.prior->>'user_assigned')::boolean,
            category_suggested = (rec.prior->>'category_suggested')::boolean
        where id = p_id and company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'loan' then
      perform 1 from public.loans l
      where l.id = p_id and l.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif exists (
        select 1 from public.loan_splits s
        where s.company_id = cid and s.loan_id = p_id
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.loans where id = p_id and company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'loan_update' then
      written := rec.prior->'after';
      before := rec.prior->'before';
      select l.name, l.principal_minor, l.annual_rate_ppm, l.term_months,
             l.start_date, l.payment_minor, l.escrow_minor
      into cur_loan
      from public.loans l
      where l.id = p_id and l.company_id = cid
      for update;
      if not found or written is null or before is null then
        response := private.mcp_error('not_found', 'not found');
      elsif jsonb_build_object(
        'name', cur_loan.name,
        'principal_minor', cur_loan.principal_minor,
        'annual_rate_ppm', cur_loan.annual_rate_ppm,
        'term_months', cur_loan.term_months,
        'start_date', cur_loan.start_date,
        'payment_minor', cur_loan.payment_minor,
        'escrow_minor', cur_loan.escrow_minor
      ) is distinct from written then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.loans l
        set
          name = (before->>'name')::text,
          principal_minor = (before->>'principal_minor')::bigint,
          annual_rate_ppm = (before->>'annual_rate_ppm')::integer,
          term_months = (before->>'term_months')::integer,
          start_date = (before->>'start_date')::date,
          payment_minor = (before->>'payment_minor')::bigint,
          escrow_minor = (before->>'escrow_minor')::bigint
        where l.id = p_id and l.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'loan_split' then
      perform 1 from public.loan_splits s
      where s.company_id = cid
        and s.transaction_id = p_id
        and s.loan_id = rec.loan_id
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.loan_splits s
        where s.company_id = cid
          and s.transaction_id = p_id
          and s.loan_id = rec.loan_id;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'project' then
      perform 1 from public.projects p
      where p.id = p_id and p.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif exists (
        select 1 from public.transactions t
        where t.company_id = cid and t.project_id = p_id and t.removed_at is null
      ) or exists (
        select 1 from public.allocations a
        where a.company_id = cid and a.project_id = p_id
      ) or exists (
        select 1 from public.split_rule_targets s
        where s.company_id = cid and s.project_id = p_id
      ) or exists (
        select 1 from public.line_splits lsp
        where lsp.company_id = cid and lsp.project_id = p_id
      ) or exists (
        select 1 from public.suppliers sup
        where sup.company_id = cid and sup.remembered_project_id = p_id
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.projects
        where id = p_id and company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'category' then
      perform 1 from public.categories c
      where c.id = p_id and c.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif exists (
        select 1 from public.transactions t
        where t.company_id = cid and t.category_id = p_id and t.removed_at is null
      ) or exists (
        select 1 from public.suppliers sup
        where sup.company_id = cid and sup.remembered_category_id = p_id
      ) or exists (
        select 1 from public.loan_splits ls
        where ls.company_id = cid and ls.category_id = p_id
      ) or exists (
        select 1 from public.line_splits lsp
        where lsp.company_id = cid and lsp.category_id = p_id
      ) or exists (
        select 1 from public.review_queue q
        where q.company_id = cid
          and (q.prior_remembered_category_id = p_id or q.written_remembered_category_id = p_id)
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.categories
        where id = p_id and company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'category_hidden' then
      select c.hidden into cur_hidden
      from public.categories c
      where c.id = p_id and c.company_id = cid
      for update;
      if not found or cur_hidden is distinct from true then
        response := private.mcp_error('conflict', 'conflict');
      else
        perform public.set_category_hidden(p_id, rec.prior_hidden);
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'category_pnl' then
      select c.excluded_from_pnl into cur_excluded
      from public.categories c
      where c.id = p_id and c.company_id = cid
      for update;
      written_excluded := (rec.prior->>'written')::boolean;
      if not found or cur_excluded is distinct from written_excluded then
        response := private.mcp_error('conflict', 'conflict');
      else
        perform public.set_category_excluded_from_pnl(p_id, (rec.prior->>'excluded_from_pnl')::boolean);
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    else
      txn := rec.transaction_id;
      select t.project_id, t.category_id, t.pnl_role
      into cur_project, cur_category, cur_role
      from public.transactions t
      where t.id = txn
        and t.company_id = cid
        and t.removed_at is null
      for update;

      if not found
        or cur_project is distinct from rec.project_id
        or cur_category is distinct from rec.category_id
        or cur_role is distinct from rec.pnl_role
        or private.mcp_shares(txn) is distinct from rec.shares
      then
        response := private.mcp_error('conflict', 'conflict');
      else
        if p_kind = 'review' then
          perform public.reopen_review(p_id);
        else
          perform public.undo_reassign(p_id);
        end if;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id
          and user_id = auth.uid()
          and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    end if;
  exception
    when deadlock_detected or serialization_failure then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;
revoke all on function public.mcp_undo(text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_undo(text, text, uuid) to authenticated;

commit;
