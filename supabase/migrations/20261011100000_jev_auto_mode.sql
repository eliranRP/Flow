-- FLOW-702 (Jev auto mode, server side). Decision 0145.
-- Auto mode pre-fills what Jev is sure of, and the owner still approves every line (decision 0084).
-- 1. The anomaly gate: a line the SQL check flags is not pre-filled when Jev scored the flag at
--    0.5 or more, or did not score it. It keeps its suggestion on the card.
-- 2. Income: auto also pre-fills an income line's project (no allocation) and income category.
-- 3. Audit and undo: every pre-fill writes a jev_prefills row with the values it replaced, and
--    undo_jev_prefill (app) and mcp_undo_jev_prefill (MCP) put them back in one call while the
--    line is open and still holds Jev's values.
-- 4. get_jev_status adds prefilled_today and prefilled_open; jev_suggestions adds prefilled.
-- 5. #177 review follow-ups: jev_prefill checks a finished project's date in SQL; a line filed to
--    the overhead project matches a no-project suggestion; the one-call split approval refuses an
--    income or hidden category.
-- A pre-fill does not set pnl_role: a guessed line counts as unassigned until the owner approves.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- 3. The audit trail of Jev's pre-fills, one row per write.
create table public.jev_prefills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  transaction_id uuid not null,
  model_version text,
  confidence numeric,
  project_id uuid,
  category_id uuid,
  prior_project_id uuid,
  prior_category_id uuid,
  prior_category_suggested boolean not null default false,
  prior_allocations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid,
  constraint jev_prefills_wrote_chk check (project_id is not null or category_id is not null),
  foreign key (company_id, transaction_id)
    references public.transactions (company_id, id)
    on delete cascade
);
comment on table public.jev_prefills is
  'What Jev auto mode wrote on a line and the values it replaced, for the audit trail and one-tap undo. Decision 0145.';
create index jev_prefills_line_idx on public.jev_prefills (company_id, transaction_id, created_at desc);
create index jev_prefills_company_created_idx on public.jev_prefills (company_id, created_at);

alter table public.jev_prefills enable row level security;
create policy jev_prefills_member_select on public.jev_prefills
  for select to authenticated
  using (company_id = (select private.readable_company_id()));
revoke all on public.jev_prefills from public, anon, authenticated;
grant select on public.jev_prefills to authenticated;
grant select, insert, update, delete on public.jev_prefills to service_role;

-- 1, 2 and 5. The pre-fill, now with the anomaly gate, income lines and an audit row.
drop function public.jev_prefill(uuid, uuid, uuid, uuid);
create function public.jev_prefill(
  p_company uuid,
  p_transaction uuid,
  p_project uuid default null,
  p_category uuid default null,
  p_model text default null,
  p_confidence numeric default null
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
  score numeric;
  prior_shares jsonb;
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

  -- The anomaly gate: a flagged line is left for the owner unless Jev scored the flag below 0.5.
  if jsonb_array_length(private.line_anomalies(p_company, array[p_transaction])) > 0 then
    select case
        when jsonb_typeof(s.answers->'anomaly'->'noul') = 'number'
        then (s.answers->'anomaly'->>'noul')::numeric
      end
    into score
    from public.tag_suggestions s
    where s.company_id = p_company and s.transaction_id = p_transaction
    order by s.created_at desc, s.id desc
    limit 1;
    if score is null or score >= 0.5 then
      return jsonb_build_object('project', false, 'category', false, 'skipped', 'flagged');
    end if;
  end if;

  select count(*)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'project_id', a.project_id, 'share_bp', a.share_bp, 'amount_net', a.amount_net
    ) order by a.project_id), '[]'::jsonb)
  into shares, prior_shares
  from public.allocations a
  where a.company_id = p_company and a.transaction_id = p_transaction;

  -- One project, never on a shared, overhead or split line; a finished project only on a line
  -- dated on or before its last line.
  if p_project is not null
     and not line.project_assigned
     and coalesce(line.pnl_role::text, '') not in ('shared', 'overhead')
     and shares <= 1
     and exists (
       select 1 from public.projects p
       where p.company_id = p_company and p.id = p_project
         and (p.status = 'active' or line.doc_date <= (
           select max(t.doc_date) from public.transactions t
           where t.company_id = p_company and t.project_id = p.id and t.removed_at is null
             and t.id <> p_transaction
         ))
     )
  then
    update public.transactions
    set project_id = p_project
    where company_id = p_company and id = p_transaction;
    -- Expenses carry one allocation with the line's amount; income lines have none.
    if line.direction = 'expense' then
      delete from public.allocations
      where company_id = p_company and transaction_id = p_transaction;
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      values (p_company, p_transaction, p_project, 10000, line.amount_net);
    end if;
    wrote_project := true;
  end if;

  if p_category is not null
     and not line.category_assigned
     and exists (
       select 1 from public.categories c
       where c.company_id = p_company and c.id = p_category
         and c.kind::text = line.direction::text and not c.hidden
     )
  then
    update public.transactions
    set category_id = p_category,
        category_suggested = true
    where company_id = p_company and id = p_transaction;
    wrote_category := true;
  end if;

  if wrote_project or wrote_category then
    insert into public.jev_prefills (
      company_id, transaction_id, model_version, confidence, project_id, category_id,
      prior_project_id, prior_category_id, prior_category_suggested, prior_allocations
    ) values (
      p_company, p_transaction, p_model, p_confidence,
      case when wrote_project then p_project end, case when wrote_category then p_category end,
      line.project_id, line.category_id, coalesce(line.category_suggested, false),
      case when wrote_project then prior_shares else '[]'::jsonb end
    );
  end if;

  return jsonb_build_object('project', wrote_project, 'category', wrote_category);
end;
$$;

-- 3. One-tap undo of Jev's newest pre-fill on a line. Members who can write.
create or replace function public.undo_jev_prefill(p_transaction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  line public.transactions%rowtype;
  fill public.jev_prefills%rowtype;
  review public.review_status;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  select * into line
  from public.transactions t
  where t.company_id = cid and t.id = p_transaction_id and t.removed_at is null
  for update;
  if line.id is null then
    raise exception 'transaction not found';
  end if;
  select * into fill
  from public.jev_prefills jp
  where jp.company_id = cid and jp.transaction_id = p_transaction_id and jp.undone_at is null
  order by jp.created_at desc, jp.id desc
  limit 1;
  if fill.id is null then
    raise exception 'nothing to undo';
  end if;
  select q.status into review
  from public.review_queue q
  where q.company_id = cid and q.transaction_id = p_transaction_id
  order by q.created_at desc, q.updated_at desc, q.id desc
  limit 1;
  if review is distinct from 'open' then
    raise exception 'review item not found';
  end if;
  if line.user_assigned
     or (fill.project_id is not null and line.project_id is distinct from fill.project_id)
     or (fill.category_id is not null and line.category_id is distinct from fill.category_id)
  then
    raise exception 'line changed since';
  end if;

  if fill.project_id is not null then
    update public.transactions
    set project_id = fill.prior_project_id
    where company_id = cid and id = p_transaction_id;
    if line.direction = 'expense' then
      delete from public.allocations
      where company_id = cid and transaction_id = p_transaction_id;
      insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
      select cid, p_transaction_id, (a->>'project_id')::uuid, (a->>'share_bp')::integer, (a->>'amount_net')::bigint
      from jsonb_array_elements(fill.prior_allocations) a;
    end if;
  end if;
  if fill.category_id is not null then
    update public.transactions
    set category_id = fill.prior_category_id,
        category_suggested = fill.prior_category_suggested
    where company_id = cid and id = p_transaction_id;
  end if;
  update public.jev_prefills
  set undone_at = now(), undone_by = auth.uid()
  where id = fill.id;

  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'project_id', case when fill.project_id is not null then fill.prior_project_id else line.project_id end,
    'category_id', case when fill.category_id is not null then fill.prior_category_id else line.category_id end
  );
end;
$$;

-- MCP undo_jev_prefill: the same undo through a write token, with idempotency.
create or replace function public.mcp_undo_jev_prefill(p_idempotency_key text, p_transaction_id uuid)
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
  written jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'undo_jev_prefill|' || p_transaction_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    written := public.undo_jev_prefill(p_transaction_id);
    response := jsonb_build_object('ok', true, 'data', written);
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := case sqlerrm
        when 'nothing to undo' then private.mcp_error('not_found', 'nothing to undo')
        when 'line changed since' then private.mcp_error('conflict', 'line changed since')
        when 'transaction not found' then private.mcp_error('not_found', 'transaction not found')
        when 'review item not found' then private.mcp_error('already_closed', 'review item not found')
        else private.mcp_refused(sqlerrm)
      end;
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

-- 4. Jev status with the pre-fill counts.
create or replace function public.mcp_jev_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  integration public.company_integrations%rowtype;
  last_run timestamptz;
  waiting integer;
  filled_today integer;
  filled_open integer;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into integration
  from public.company_integrations ci
  where ci.company_id = cid and ci.provider = 'jev';
  select max(coalesce(u.finished_at, u.started_at)) into last_run
  from public.jev_usage u
  where u.company_id = cid;
  select count(*)::integer into waiting
  from public.transactions t
  join public.review_queue q
    on q.company_id = t.company_id
   and q.transaction_id = t.id
   and q.status = 'open'
  where t.company_id = cid
    and t.removed_at is null
    and not exists (
      select 1 from public.tag_suggestions s
      where s.transaction_id = t.id and s.model_version = 'jev-1.13.0'
    );
  select count(*)::integer into filled_today
  from public.jev_prefills jp
  where jp.company_id = cid and jp.undone_at is null
    and jp.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  select count(distinct jp.transaction_id)::integer into filled_open
  from public.jev_prefills jp
  join public.transactions t on t.company_id = jp.company_id and t.id = jp.transaction_id
  where jp.company_id = cid and jp.undone_at is null and t.removed_at is null
    and (
      select q.status from public.review_queue q
      where q.company_id = cid and q.transaction_id = jp.transaction_id
      order by q.created_at desc, q.updated_at desc, q.id desc
      limit 1
    ) = 'open';
  return jsonb_build_object(
    'enabled', coalesce(integration.enabled, false)
      and coalesce(integration.mode, 'off') in ('shadow', 'auto'),
    'mode', coalesce(integration.mode, 'off'),
    'threshold', coalesce(integration.threshold, 0.90),
    'daily_call_cap', coalesce(integration.daily_call_cap, 200),
    'calls_today', private.jev_calls_today(cid),
    'last_run_at', last_run,
    'lines_without_suggestion', waiting,
    'prefilled_today', filled_today,
    'prefilled_open', filled_open
  );
end;
$$;

-- 4 and 5. Suggestions with prefilled, and the overhead project as a no-project match.
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
           or f.project_id = (select co.overhead_project_id from public.companies co where co.id = p_company)
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
      'anomaly_score', s.anomaly_score,
      'prefilled', exists (
        select 1 from public.jev_prefills jp
        where jp.company_id = p_company and jp.transaction_id = s.transaction_id and jp.undone_at is null
      )
    ) order by s.transaction_id), '[]'::jsonb)
  from s
  join counted c2 on c2.transaction_id = s.transaction_id
  left join public.projects p on p.company_id = p_company and p.id = s.project_id
  left join public.categories c on c.company_id = p_company and c.id = s.category_id;
$$;

revoke all on function private.jev_suggestions_for(uuid, uuid[]) from public, anon, authenticated;

-- 5. The one-call split approval takes only a visible expense category.
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
  cat_kind text;
  cat_hidden boolean;
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
  select c.kind::text, c.hidden into cat_kind, cat_hidden
  from public.categories c
  where c.id = p_category_id and c.company_id = cid;
  if cat_kind is null or cat_hidden then
    raise exception 'category not found';
  end if;
  if cat_kind <> 'expense' then
    raise exception 'category kind must match the direction';
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

revoke all on function public.jev_prefill(uuid, uuid, uuid, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.jev_prefill(uuid, uuid, uuid, uuid, text, numeric) to service_role;
revoke all on function public.undo_jev_prefill(uuid) from public, anon;
grant execute on function public.undo_jev_prefill(uuid) to authenticated, service_role;
revoke all on function public.mcp_undo_jev_prefill(text, uuid) from public, anon;
grant execute on function public.mcp_undo_jev_prefill(text, uuid) to authenticated, service_role;
revoke all on function public.mcp_jev_status() from public, anon;
grant execute on function public.mcp_jev_status() to authenticated, service_role;
revoke all on function public.approve_split_review(uuid, uuid) from public, anon;
grant execute on function public.approve_split_review(uuid, uuid) to authenticated, service_role;

commit;
