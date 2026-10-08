-- FLOW-701 part 2 (Jev phase 1). Decision 0126.
-- Jev learns from what the owner confirms. When a review line that carries a Jev suggestion
-- is approved or changed, from the app, MCP or a batch, the outcome is recorded: what Jev
-- suggested, what the line was filed as, and whether each field matched. Undo or a reopen
-- removes it. A deferred trigger reads the line at commit, after every write of the approval.
-- The shadow accuracy report (MCP get_jev_accuracy) is SQL over these rows.
-- Jev still never approves a line (decision 0084).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create table public.jev_outcomes (
  company_id uuid not null,
  transaction_id uuid not null,
  suggestion_id uuid not null references public.tag_suggestions (id) on delete cascade,
  model_version text not null,
  confidence numeric not null,
  suggested_project_id uuid,
  suggested_category_id uuid,
  final_project_id uuid,
  final_category_id uuid,
  project_match boolean,
  category_match boolean,
  review_status public.review_status not null,
  resolved_at timestamptz not null default now(),
  primary key (transaction_id),
  constraint jev_outcomes_status_chk check (review_status in ('approved', 'changed')),
  foreign key (company_id, transaction_id)
    references public.transactions (company_id, id)
    on delete cascade
);
comment on table public.jev_outcomes is
  'Jev suggestion against the filed result, one row per resolved line. Written by a trigger. Decision 0126.';
comment on column public.jev_outcomes.project_match is
  'Null when Jev did not suggest a project or the line is shared, overhead or split across projects.';
comment on column public.jev_outcomes.category_match is
  'Null when Jev did not suggest a category or the line is split by category.';
create index jev_outcomes_company_resolved_idx on public.jev_outcomes (company_id, resolved_at);
create index jev_outcomes_suggestion_idx on public.jev_outcomes (suggestion_id);

alter table public.jev_outcomes enable row level security;
create policy jev_outcomes_member_select on public.jev_outcomes
  for select to authenticated
  using (company_id = (select private.readable_company_id()));
revoke all on public.jev_outcomes from public, anon, authenticated;
grant select on public.jev_outcomes to authenticated;
grant select, insert, update, delete on public.jev_outcomes to service_role;

create or replace function private.jev_uuid_or_null(p_value text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_value::uuid
  end;
$$;

-- Record or remove the outcome of one line from its current state.
create or replace function private.jev_outcome_sync(p_company uuid, p_transaction uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  review public.review_status;
  sugg public.tag_suggestions%rowtype;
  line public.transactions%rowtype;
  s_project uuid;
  s_category uuid;
  f_project uuid;
  project_comparable boolean;
  category_comparable boolean;
begin
  select q.status into review
  from public.review_queue q
  where q.company_id = p_company and q.transaction_id = p_transaction
  order by q.created_at desc, q.updated_at desc, q.id desc
  limit 1;

  select * into sugg
  from public.tag_suggestions s
  where s.company_id = p_company and s.transaction_id = p_transaction
  order by s.created_at desc
  limit 1;

  select * into line
  from public.transactions t
  where t.company_id = p_company and t.id = p_transaction;

  if review is null or review not in ('approved', 'changed') or sugg.id is null or line.id is null
     or line.removed_at is not null then
    delete from public.jev_outcomes o where o.transaction_id = p_transaction;
    return;
  end if;

  s_project := private.jev_uuid_or_null(sugg.answers -> 'project' ->> 'choice');
  s_category := private.jev_uuid_or_null(sugg.answers -> 'category' ->> 'choice');

  project_comparable := s_project is not null
    and coalesce(line.pnl_role::text, '') not in ('shared', 'overhead')
    and (select count(*) from public.allocations a
         where a.company_id = p_company and a.transaction_id = p_transaction) <= 1
    and (select count(distinct ls.project_id) from public.line_splits ls
         where ls.company_id = p_company and ls.transaction_id = p_transaction) <= 1;
  f_project := case when project_comparable then coalesce(line.project_id, (
    select a.project_id from public.allocations a
    where a.company_id = p_company and a.transaction_id = p_transaction
    limit 1
  ), (
    select ls.project_id from public.line_splits ls
    where ls.company_id = p_company and ls.transaction_id = p_transaction and ls.project_id is not null
    limit 1
  )) end;
  category_comparable := s_category is not null
    and not exists (
      select 1 from public.line_splits ls
      where ls.company_id = p_company and ls.transaction_id = p_transaction
    );

  insert into public.jev_outcomes (
    company_id, transaction_id, suggestion_id, model_version, confidence,
    suggested_project_id, suggested_category_id, final_project_id, final_category_id,
    project_match, category_match, review_status, resolved_at
  ) values (
    p_company, p_transaction, sugg.id, sugg.model_version, sugg.confidence,
    s_project, s_category, f_project, line.category_id,
    case when project_comparable then f_project is not distinct from s_project end,
    case when category_comparable then line.category_id is not distinct from s_category end,
    review, now()
  )
  on conflict (transaction_id) do update
    set suggestion_id = excluded.suggestion_id,
        model_version = excluded.model_version,
        confidence = excluded.confidence,
        suggested_project_id = excluded.suggested_project_id,
        suggested_category_id = excluded.suggested_category_id,
        final_project_id = excluded.final_project_id,
        final_category_id = excluded.final_category_id,
        project_match = excluded.project_match,
        category_match = excluded.category_match,
        review_status = excluded.review_status,
        resolved_at = case
          when public.jev_outcomes.review_status = excluded.review_status
           and public.jev_outcomes.suggestion_id = excluded.suggestion_id
          then public.jev_outcomes.resolved_at
          else excluded.resolved_at
        end;
end;
$$;

revoke all on function private.jev_uuid_or_null(text) from public, anon, authenticated;
revoke all on function private.jev_outcome_sync(uuid, uuid) from public, anon, authenticated;

create or replace function private.jev_outcome_review_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.transaction_id is not null then
    perform private.jev_outcome_sync(new.company_id, new.transaction_id);
  end if;
  return null;
end;
$$;

revoke all on function private.jev_outcome_review_trigger() from public, anon, authenticated;

-- Deferred, so the approval's own writes to the line (project, category, splits) are in place.
-- A new review row (a sync reopening the line) fires it too: the newest row is the current review.
create constraint trigger jev_outcome_review
  after insert or update of status on public.review_queue
  deferrable initially deferred
  for each row
  execute function private.jev_outcome_review_trigger();

-- Edits after the approval (removal, a later split or allocation, a category merge) keep the
-- outcome in step. Only lines Jev suggested on are synced, so SUMIT upserts stay cheap.
create or replace function private.jev_outcome_line_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  tid uuid;
begin
  if tg_table_name = 'transactions' then
    cid := coalesce(new.company_id, old.company_id);
    tid := coalesce(new.id, old.id);
  elsif tg_op = 'DELETE' then
    cid := old.company_id;
    tid := old.transaction_id;
  else
    cid := new.company_id;
    tid := new.transaction_id;
  end if;
  if exists (select 1 from public.tag_suggestions s where s.company_id = cid and s.transaction_id = tid) then
    perform private.jev_outcome_sync(cid, tid);
  end if;
  return null;
end;
$$;

revoke all on function private.jev_outcome_line_trigger() from public, anon, authenticated;

create constraint trigger jev_outcome_line
  after update of removed_at, project_id, category_id, pnl_role on public.transactions
  deferrable initially deferred
  for each row
  when (old.removed_at is distinct from new.removed_at
     or old.project_id is distinct from new.project_id
     or old.category_id is distinct from new.category_id
     or old.pnl_role is distinct from new.pnl_role)
  execute function private.jev_outcome_line_trigger();

create constraint trigger jev_outcome_split
  after insert or update or delete on public.line_splits
  deferrable initially deferred
  for each row
  execute function private.jev_outcome_line_trigger();

create constraint trigger jev_outcome_allocation
  after insert or update or delete on public.allocations
  deferrable initially deferred
  for each row
  execute function private.jev_outcome_line_trigger();

-- Lines approved before this migration. Their resolved_at is the review's resolved_at.
do $backfill$
declare
  r record;
begin
  for r in
    select distinct q.company_id, q.transaction_id
    from public.review_queue q
    join public.tag_suggestions s
      on s.company_id = q.company_id and s.transaction_id = q.transaction_id
    where q.status in ('approved', 'changed')
  loop
    perform private.jev_outcome_sync(r.company_id, r.transaction_id);
  end loop;
  update public.jev_outcomes o
  set resolved_at = coalesce(q.resolved_at, q.updated_at)
  from (
    select distinct on (rq.transaction_id) rq.transaction_id, rq.company_id, rq.resolved_at, rq.updated_at
    from public.review_queue rq
    where rq.transaction_id is not null
    order by rq.transaction_id, rq.created_at desc, rq.updated_at desc, rq.id desc
  ) q
  where q.company_id = o.company_id
    and q.transaction_id = o.transaction_id;
end
$backfill$;

-- MCP get_jev_accuracy. The company is the token's company. Counts only.
-- Dates bound resolved_at (inclusive, UTC days). Null dates mean all time.
create or replace function public.mcp_jev_accuracy(p_from date default null, p_to date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  cut numeric;
  result jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'validation';
  end if;
  select coalesce(ci.threshold, 0.90) into cut
  from public.company_integrations ci
  where ci.company_id = cid and ci.provider = 'jev';
  cut := coalesce(cut, 0.90);

  with o as (
    select *,
      (coalesce(project_match, true) and coalesce(category_match, true)
        and (project_match is not null or category_match is not null)) as all_match,
      case
        when confidence >= 0.9 then 'high'
        when confidence >= 0.7 then 'medium'
        else 'low'
      end as band
    from public.jev_outcomes
    where company_id = cid
      and (p_from is null or resolved_at >= p_from::timestamp at time zone 'utc')
      and (p_to is null or resolved_at < (p_to + 1)::timestamp at time zone 'utc')
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'threshold', cut,
    'lines', count(*),
    'all_matched', count(*) filter (where all_match),
    'project_compared', count(*) filter (where project_match is not null),
    'project_matched', count(*) filter (where project_match),
    'category_compared', count(*) filter (where category_match is not null),
    'category_matched', count(*) filter (where category_match),
    'at_threshold', jsonb_build_object(
      'lines', count(*) filter (where confidence >= cut),
      'all_matched', count(*) filter (where confidence >= cut and all_match)
    ),
    'bands', jsonb_build_array(
      jsonb_build_object('band', 'high', 'min', 0.9,
        'lines', count(*) filter (where band = 'high'),
        'all_matched', count(*) filter (where band = 'high' and all_match)),
      jsonb_build_object('band', 'medium', 'min', 0.7,
        'lines', count(*) filter (where band = 'medium'),
        'all_matched', count(*) filter (where band = 'medium' and all_match)),
      jsonb_build_object('band', 'low', 'min', 0,
        'lines', count(*) filter (where band = 'low'),
        'all_matched', count(*) filter (where band = 'low' and all_match))
    )
  ) into result
  from o;
  return result;
end;
$$;

revoke all on function public.mcp_jev_accuracy(date, date) from public, anon;
grant execute on function public.mcp_jev_accuracy(date, date) to authenticated, service_role;

commit;
