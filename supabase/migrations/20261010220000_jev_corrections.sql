-- FLOW-703 (Jev phase 1 follow-ups). Decision 0138.
-- 1. Corrections as signal: jev_supplier_history says, for each filed line, what Jev had
--    suggested and whether the owner changed it, so the next call sees its own past misses.
-- 2. One safe prefill write: jev_prefill sets the auto-mode project, allocation and category
--    in one transaction, and only while the line is still open and untouched by the owner.
--    The allocation amount comes from the line, not from the job.
-- 3. One safe split approval: approve_split_review(p_id, p_category_id) sets the category and
--    approves a split line in one call, replacing two calls from the app.
-- 4. "No project": the project question can be answered with none (overhead, or not one
--    project). jev_suggestions marks it as no_project and never pre-fills it.
-- 5. Finished projects: jev_projects lists active projects and finished ones with the date of
--    their last line, so an older line can still be filed to a project that has since finished.
-- Jev never approves a line and computes no number (decision 0084).
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- 1. The party history, now with Jev's suggestion on each filed line and whether the owner
-- corrected it (decision 0126 outcomes). Null jev ids: Jev did not suggest on that line.
create or replace function public.jev_supplier_history(
  p_company uuid,
  p_suppliers uuid[],
  p_per integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_company is null or p_per is null or p_per < 1 or p_per > 20
     or coalesce(cardinality(p_suppliers), 0) > 500 then
    raise exception 'validation';
  end if;

  with latest as (
    -- The current (newest) review row of each line of these parties, read once.
    select distinct on (q.transaction_id) q.transaction_id, q.status
    from public.review_queue q
    join public.transactions t on t.company_id = q.company_id and t.id = q.transaction_id
    where q.company_id = p_company
      and coalesce(t.supplier_id, t.customer_id) = any (p_suppliers)
    order by q.transaction_id, q.created_at desc, q.updated_at desc, q.id desc
  ),
  filed as (
    select coalesce(t.supplier_id, t.customer_id) as party_id, t.id, t.direction, t.doc_date,
      t.description, t.amount_net, t.project_id, t.category_id, t.pnl_role,
      exists (
        select 1 from public.line_splits ls
        where ls.company_id = t.company_id and ls.transaction_id = t.id
      ) as split,
      (select count(*) from public.allocations a
       where a.company_id = t.company_id and a.transaction_id = t.id) as allocation_count,
      row_number() over (
        partition by coalesce(t.supplier_id, t.customer_id), t.direction order by t.doc_date desc, t.id desc
      ) as n
    from public.transactions t
    join latest l on l.transaction_id = t.id and l.status in ('approved', 'changed')
    where t.company_id = p_company
      and coalesce(t.supplier_id, t.customer_id) = any (p_suppliers)
      and t.removed_at is null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'supplier_id', f.party_id,
      'direction', f.direction,
      'doc_date', f.doc_date,
      'description', left(coalesce(f.description, ''), 120),
      'amount_net', f.amount_net,
      'project_id', f.project_id,
      'category_id', f.category_id,
      'pnl_role', f.pnl_role,
      'split', f.split or f.allocation_count > 1,
      'jev_project_id', o.suggested_project_id,
      'jev_category_id', o.suggested_category_id,
      'jev_corrected', o.project_match is false or o.category_match is false
    ) order by f.party_id, f.direction, f.n), '[]'::jsonb)
  into result
  from filed f
  left join public.jev_outcomes o on o.company_id = p_company and o.transaction_id = f.id
  where f.n <= p_per;
  return result;
end;
$$;

-- 2. The auto-mode prefill, in one transaction. Service role only. Writes nothing (and says
-- so) when the line is gone, closed, or the owner already set the field.
create or replace function public.jev_prefill(
  p_company uuid,
  p_transaction uuid,
  p_project uuid default null,
  p_category uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  line public.transactions%rowtype;
  review public.review_status;
  shares integer;
  wrote_project boolean := false;
  wrote_category boolean := false;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_company is null or p_transaction is null then
    raise exception 'validation';
  end if;

  select * into line
  from public.transactions t
  where t.company_id = p_company and t.id = p_transaction and t.removed_at is null
  for update;
  if line.id is null then
    return jsonb_build_object('project', false, 'category', false, 'skipped', 'not_found');
  end if;

  select q.status into review
  from public.review_queue q
  where q.company_id = p_company and q.transaction_id = p_transaction
  order by q.created_at desc, q.updated_at desc, q.id desc
  limit 1;
  if review is distinct from 'open' or line.user_assigned then
    return jsonb_build_object('project', false, 'category', false, 'skipped', 'closed');
  end if;

  select count(*)::integer into shares
  from public.allocations a
  where a.company_id = p_company and a.transaction_id = p_transaction;

  -- Auto pre-fills expenses only (decision 0134), one project, never a shared or overhead line.
  if p_project is not null
     and line.direction = 'expense'
     and not line.project_assigned
     and coalesce(line.pnl_role::text, '') not in ('shared', 'overhead')
     and shares <= 1
     and exists (select 1 from public.projects p where p.company_id = p_company and p.id = p_project)
  then
    update public.transactions
    set project_id = p_project
    where company_id = p_company and id = p_transaction;
    delete from public.allocations
    where company_id = p_company and transaction_id = p_transaction;
    insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
    values (p_company, p_transaction, p_project, 10000, line.amount_net);
    wrote_project := true;
  end if;

  if p_category is not null
     and line.direction = 'expense'
     and not line.category_assigned
     and exists (
       select 1 from public.categories c
       where c.company_id = p_company and c.id = p_category and c.kind::text = 'expense' and not c.hidden
     )
  then
    update public.transactions
    set category_id = p_category,
        category_suggested = true
    where company_id = p_company and id = p_transaction;
    wrote_category := true;
  end if;

  return jsonb_build_object('project', wrote_project, 'category', wrote_category);
end;
$$;

-- 3. Set the category and approve a split line in one call. The same checks and undo rows as
-- set_transaction_category(p_resolve => false) followed by approve_split_review(p_id).
create or replace function public.approve_split_review(p_id uuid, p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  txn uuid;
  current_category uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_category_id is null then
    raise exception 'category is required';
  end if;
  select q.transaction_id into txn
  from public.review_queue q
  where q.id = p_id and q.company_id = cid and q.status = 'open';
  if txn is null then
    raise exception 'review item not found';
  end if;
  select t.category_id into current_category
  from public.transactions t
  where t.id = txn and t.company_id = cid and t.removed_at is null
  for update;
  if current_category is distinct from p_category_id then
    perform public.set_transaction_category(txn, p_category_id, false);
  end if;
  perform public.approve_split_review(p_id);
end;
$$;

-- 4. Jev's latest suggestion per line, now with no_project: Jev answered the project question
-- with none (overhead, or not one project).
drop function private.jev_suggestion_rows(uuid, uuid[]);
create function private.jev_suggestion_rows(p_company uuid, p_ids uuid[])
returns table (
  transaction_id uuid,
  project_id uuid,
  category_id uuid,
  confidence numeric,
  anomaly_score numeric,
  no_project boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.transaction_id,
    private.jev_uuid_or_null(s.answers->'project'->>'choice'),
    private.jev_uuid_or_null(s.answers->'category'->>'choice'),
    s.confidence,
    case
      when jsonb_typeof(s.answers->'anomaly'->'noul') = 'number'
       and (s.answers->'anomaly'->>'noul')::numeric between 0 and 1
      then round((s.answers->'anomaly'->>'noul')::numeric, 3)
    end,
    coalesce(s.answers->'project'->>'choice' = 'none', false)
  from (
    select distinct on (ts.transaction_id) ts.transaction_id, ts.answers, ts.confidence
    from public.tag_suggestions ts
    where ts.company_id = p_company and ts.transaction_id = any (p_ids)
    order by ts.transaction_id, ts.created_at desc, ts.id desc
  ) s;
$$;
revoke all on function private.jev_suggestion_rows(uuid, uuid[]) from public, anon, authenticated;

-- Reasons as in decision 0134. A no-project suggestion matches a filing with no project, or
-- one filed as shared or overhead.
create or replace function private.jev_suggestions_for(p_company uuid, p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with s as (
    select r.*, t.direction, coalesce(t.supplier_id, t.customer_id) as party_id
    from private.jev_suggestion_rows(p_company, p_ids) r
    join public.transactions t on t.company_id = p_company and t.id = r.transaction_id
    where r.project_id is not null or r.category_id is not null or r.no_project
  ),
  parties as (
    select distinct s.party_id, s.direction from s where s.party_id is not null
  ),
  candidates as (
    select t.id, coalesce(t.supplier_id, t.customer_id) as party_id, t.direction, t.doc_date,
      t.project_id, t.category_id, t.pnl_role
    from public.transactions t
    join parties p on p.party_id = coalesce(t.supplier_id, t.customer_id) and p.direction = t.direction
    where t.company_id = p_company and t.removed_at is null
  ),
  -- The current (newest) review row of each candidate, read once.
  latest as (
    select distinct on (q.transaction_id) q.transaction_id, q.status
    from public.review_queue q
    join candidates c on c.id = q.transaction_id
    where q.company_id = p_company
    order by q.transaction_id, q.created_at desc, q.updated_at desc, q.id desc
  ),
  -- The last 6 filed lines per party and direction: 5 once the line itself is left out.
  recent as (
    select r.* from (
      select c.*, row_number() over (
          partition by c.party_id, c.direction order by c.doc_date desc, c.id desc
        ) as rank
      from candidates c
      join latest l on l.transaction_id = c.id and l.status in ('approved', 'changed')
    ) r
    where r.rank <= 6
  ),
  filings as (
    select f.* from (
      select s.transaction_id, r.project_id, r.category_id, r.pnl_role,
        row_number() over (partition by s.transaction_id order by r.doc_date desc, r.id desc) as n
      from s
      join recent r on r.party_id = s.party_id and r.direction = s.direction and r.id <> s.transaction_id
    ) f
    where f.n <= 5
  ),
  matched as (
    select f.transaction_id, f.n,
      (case
         when s.no_project then f.project_id is null or f.pnl_role::text in ('shared', 'overhead')
         else s.project_id is null or f.project_id = s.project_id
       end)
      and (s.category_id is null or f.category_id = s.category_id) as hit
    from filings f
    join s on s.transaction_id = f.transaction_id
  ),
  counted as (
    select s.transaction_id,
      count(m.n) as party_filings,
      count(m.n) filter (where m.hit) as matching_filings,
      bool_or(m.n = 1 and m.hit) as last_matches
    from s
    left join matched m on m.transaction_id = s.transaction_id
    group by s.transaction_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'transaction_id', s.transaction_id,
      'direction', s.direction,
      'project_id', s.project_id,
      'project_name', p.name,
      'no_project', s.no_project,
      'category_id', s.category_id,
      'category_name', c.name,
      'confidence', s.confidence,
      'reason', case
        when c2.party_filings = 0 then 'new_party'
        when coalesce(c2.last_matches, false) then 'same_as_last'
        when c2.matching_filings >= 2 then 'usual_for_party'
        else 'model_only'
      end,
      'party_filings', c2.party_filings,
      'matching_filings', c2.matching_filings,
      'anomaly_score', s.anomaly_score
    ) order by s.transaction_id), '[]'::jsonb)
  from s
  join counted c2 on c2.transaction_id = s.transaction_id
  left join public.projects p on p.company_id = p_company and p.id = s.project_id
  left join public.categories c on c.company_id = p_company and c.id = s.category_id;
$$;
revoke all on function private.jev_suggestions_for(uuid, uuid[]) from public, anon, authenticated;

-- 5. The projects Jev may offer: active ones, and finished ones with their last line's date
-- (null when they have none), and which one is the company's overhead project.
create or replace function public.jev_projects(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_company is null then
    raise exception 'validation';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'status', p.status,
      'last_doc_date', case when p.status = 'finished' then (
        select max(t.doc_date) from public.transactions t
        where t.company_id = p_company and t.project_id = p.id and t.removed_at is null
      ) end,
      'overhead', p.id is not distinct from co.overhead_project_id
    ) order by p.status, p.name, p.id), '[]'::jsonb)
  into result
  from public.projects p
  join public.companies co on co.id = p.company_id
  where p.company_id = p_company;
  return result;
end;
$$;

revoke all on function public.jev_supplier_history(uuid, uuid[], integer) from public, anon, authenticated;
grant execute on function public.jev_supplier_history(uuid, uuid[], integer) to service_role;
revoke all on function public.jev_prefill(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.jev_prefill(uuid, uuid, uuid, uuid) to service_role;
revoke all on function public.jev_projects(uuid) from public, anon, authenticated;
grant execute on function public.jev_projects(uuid) to service_role;
revoke all on function public.approve_split_review(uuid, uuid) from public, anon;
grant execute on function public.approve_split_review(uuid, uuid) to authenticated, service_role;

commit;
