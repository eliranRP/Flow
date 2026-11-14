-- FLOW-1168 (decision 0266): the server jobs get the end states they were missing. Nothing valid
-- today is refused, and every function an edge function calls keeps its old arguments and old
-- fields, so the edge functions deployed before this file (mercury-sync) and the ones deployed
-- after it (flow-mcp, jev-tag, push-send, invite-email) both keep working through the deploy.
--
-- A. Jev tagging: a failure the provider says can never pass for this input stops spending a call.
--    jev_line_failures.refused_at: set when Jev answered invalid_request (HTTP 400 or 422, or the
--    request the edge function built failed its own check before it was sent), and only when the
--    same run got an answer for another line of the same company, at most 3 lines of a company a
--    run (jev_tag.ts decides; a rate limit, an overload, a timeout, a 5xx, a missing or rejected key
--    is never a refusal). A refused line waits 30 days
--    (jev_line_failures_refused_chk ties retry_after to refused_at), so every reader that already
--    skips a failure until retry_after (the run's work list in jev_tag_rest.ts, private.jev_has_work)
--    skips it with no change. What brings it back sooner:
--    - the line itself changes: a write to any column the request is built from (description,
--      doc_date, direction, supplier_id, customer_id, the four amounts, currency, pnl_role,
--      provider_meta, which holds the card and the account) deletes its refused rows (the trigger
--      transactions_jev_refusal_reset);
--    - a new model version: the row's key is (transaction_id, model_version), so a new pin has none;
--    - a later suggestion: jev_finish_usage deletes the failure rows of lines that have one (part 5);
--    - FLOW-1174: the company's projects or categories change: the refusal stores
--      private.jev_inputs_key (refused_inputs); jev_has_work and get_jev_status ignore a refusal whose
--      key is no longer the company's, and the run deletes it (jev_refusals_reset) before it lists
--      the company's lines. No trigger on categories or projects;
--    - the 30 days pass (a safety net for the inputs that are neither the line's nor the company's:
--      the supplier's history, the flags, the forecast line).
--    Writers of jev_line_failures, all traced: jev_mark_failed (this file adds p_refused, default
--    false, so the old three-argument call is the same call), jev_finish_usage (deletes), the
--    trigger and jev_refusals_reset (delete refused rows only), the line's delete (cascade),
--    delete_company (cascade).
--    get_jev_status (mcp_jev_status) adds lines_not_retried: open lines without a suggestion whose
--    failure is a refusal; they stay counted in lines_without_suggestion.
-- B. Push: a new-lines or weekly claim can be given back. push_claim_targets returns each row's
--    claim ({mark, prev} for new, {day, prev} for weekly); push_release_claims puts the mark back
--    when no device of the user accepted the push and at least one failed for a reason that can pass
--    (push_send.ts decides). It moves a mark back only from the value that claim set, so a later
--    claim is never undone. A push service that took a send but whose answer was lost counts as
--    failed, so the push can go out again (the device's tag replaces it): FLOW-1174 bounds that. A
--    new-lines mark is moved back to the same value at most twice (notification_prefs.new_releases,
--    notification_prefs_new_releases_chk), so the same lines go out at most three times; a released
--    weekly summary is tried again by the hourly gate until 11:59 on the same Sunday
--    (notification_prefs.weekly_released_on, notification_prefs_weekly_released_chk), at most four
--    sends. claim_push_test returns its claim's id; release_push_test gives a test claim back under
--    the same rule (or when the user has no device: nothing was posted).
-- C. Invite email: release_invite_email gives back the claim of a send Resend refused (a 4xx but 408,
--    409 and 429: nothing was sent). A 5xx or a timeout keeps its claim (it may have been sent), so
--    an invite never gets more than 3 real emails. company_invites_emailed_chk ties emailed_at to
--    email_sends. FLOW-1174: at most 3 claims of an invite are given back (email_releases,
--    company_invites_email_releases_chk), so Resend hears at most 6 tries for it.
-- D. Thread purge: a listed name that the purge cannot remove is recorded by thread_files_purge_skip
--    and left off the list, so the job moves past it instead of stopping on it every hour: a day when
--    it fails the path rule in thread_purge.ts, an hour when Storage kept it (FLOW-1174: Storage does
--    not say why, and the reason may pass). The path rule
--    and every other condition of the list stay; the skip only ever takes a name off the list.
-- E. sync_bank: mcp_sync_bank_finish stores a pull that did not read everything (its page cap, or one
--    of several connections failed: mcp_sync_jobs.complete false, set only on
--    done, mcp_sync_jobs_complete_chk) and the reason a pull did not run (error.reason: busy or
--    rate_limited, error.retry_at), and the token that started a job may finish it after it was
--    revoked, expired or narrowed. A job left running past 5 minutes reads as failed with reason
--    unknown. get_sync_status keeps every field it had.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- Replaces each anchor (found exactly once) in a function's definition and runs the result.
create or replace function pg_temp.patch(p_fn text, p_from text[], p_to text[])
returns void
language plpgsql
as $$
declare
  def text := pg_get_functiondef(p_fn::regprocedure);
  i integer;
begin
  for i in 1 .. cardinality(p_from) loop
    if pg_temp.anchor_count(def, p_from[i]) <> 1 then
      raise exception '% is not the expected definition (anchor %)', p_fn, i;
    end if;
    def := replace(def, p_from[i], p_to[i]);
  end loop;
  execute def;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- A. Jev: a refused line
-- ---------------------------------------------------------------------------------------------

alter table public.jev_line_failures add column refused_at timestamptz;
alter table public.jev_line_failures add column refused_inputs text;
alter table public.jev_line_failures
  add constraint jev_line_failures_refused_chk
  check (
    (refused_at is null and refused_inputs is null)
    or (refused_at is not null and refused_inputs is not null and retry_after = refused_at + interval '30 days')
  );
comment on column public.jev_line_failures.refused_at is
  'FLOW-1168: Jev refused this line''s request as invalid (it can never pass as it is); not sent again '
  'for 30 days unless the line changes (transactions_jev_refusal_reset), its company''s projects or '
  'categories change (refused_inputs) or the model version does. Null: a failure that can pass, retried '
  'at retry_after.';
comment on column public.jev_line_failures.refused_inputs is
  'FLOW-1174: private.jev_inputs_key of the company when the line was refused. A refusal whose key is no '
  'longer the company''s holds nothing: jev_has_work and get_jev_status ignore it, jev_refusals_reset deletes it.';

-- FLOW-1174: what a Jev request takes from the company rather than the line: its projects (as
-- jev_projects gives them) and its categories. A refusal is kept only while this is unchanged.
create function private.jev_inputs_key(p_company uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(jsonb_build_array(
    (select coalesce(jsonb_agg(jsonb_build_array(
        p.id, p.name, p.status, p.id is not distinct from co.overhead_project_id,
        case when p.status = 'finished' then (
          select max(t.doc_date) from public.transactions t
          where t.company_id = p_company and t.project_id = p.id and t.removed_at is null
        ) end
      ) order by p.id), '[]'::jsonb)
     from public.projects p
     join public.companies co on co.id = p.company_id
     where p.company_id = p_company),
    (select coalesce(jsonb_agg(jsonb_build_array(c.id, c.name, c.kind, c.hidden, c.loan_part) order by c.id), '[]'::jsonb)
     from public.categories c
     where c.company_id = p_company)
  )::text);
$$;

revoke all on function private.jev_inputs_key(uuid) from public, anon, authenticated;

drop function public.jev_mark_failed(uuid, uuid, text);

-- A failed line waits 6 hours; the third failure and later wait a day. A refused one waits 30 days.
create function public.jev_mark_failed(
  p_company uuid,
  p_transaction uuid,
  p_model text,
  p_refused boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  insert into public.jev_line_failures (company_id, transaction_id, model_version, attempts, retry_after, refused_at, refused_inputs)
  select t.company_id, t.id, p_model, 1,
    now() + case when coalesce(p_refused, false) then interval '30 days' else interval '6 hours' end,
    case when coalesce(p_refused, false) then now() end,
    case when coalesce(p_refused, false) then private.jev_inputs_key(t.company_id) end
  from public.transactions t
  where t.company_id = p_company and t.id = p_transaction
  on conflict (transaction_id, model_version) do update
    set attempts = public.jev_line_failures.attempts + 1,
        refused_at = excluded.refused_at,
        refused_inputs = excluded.refused_inputs,
        retry_after = now() + case
          when coalesce(p_refused, false) then interval '30 days'
          when public.jev_line_failures.attempts + 1 >= 3 then interval '24 hours'
          else interval '6 hours'
        end,
        updated_at = now();
end;
$$;

revoke all on function public.jev_mark_failed(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.jev_mark_failed(uuid, uuid, text, boolean) to service_role;

comment on function public.jev_mark_failed(uuid, uuid, text, boolean) is
  'Decision 0124, FLOW-1168: records a line Jev failed on. p_refused: Jev refused the request as invalid; '
  'the line waits 30 days or until it, or its company''s projects or categories, change.';

-- FLOW-1174: the run calls this for each company before it lists the company's lines, so a line
-- refused before a project or category changed is sent again. Returns how many were cleared.
create function public.jev_refusals_reset(p_company uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_key text;
  cleared integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  current_key := private.jev_inputs_key(p_company);
  delete from public.jev_line_failures f
  where f.company_id = p_company
    and f.refused_at is not null
    and f.refused_inputs is distinct from current_key;
  get diagnostics cleared = row_count;
  return cleared;
end;
$$;

revoke all on function public.jev_refusals_reset(uuid) from public, anon, authenticated;
grant execute on function public.jev_refusals_reset(uuid) to service_role;

comment on function public.jev_refusals_reset(uuid) is
  'FLOW-1174: deletes the company''s Jev refusals made before its projects or categories changed. jev-tag only.';

-- The cron's gate reads a stale refusal as work, so a fixed category is tried without waiting for a new line.
select pg_temp.patch('private.jev_has_work()',
  array[$a$          and f.retry_after > now()$a$],
  array[$n$          and f.retry_after > now()
          -- FLOW-1174: a refusal made before the company's projects or categories changed holds nothing.
          and (f.refused_at is null or f.refused_inputs = private.jev_inputs_key(f.company_id))$n$]);
revoke all on function private.jev_has_work() from public, anon, authenticated;

-- A line whose request changes is asked again: its refusal no longer says anything about it.
create function private.jev_refusal_reset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.jev_line_failures f
  where f.transaction_id = new.id
    and f.refused_at is not null;
  return null;
end;
$$;

revoke all on function private.jev_refusal_reset() from public, anon, authenticated;

create trigger transactions_jev_refusal_reset
  after update of description, doc_date, direction, supplier_id, customer_id, amount_gross, amount_net,
    vat_amount, amount_original, currency, pnl_role, provider_meta
  on public.transactions
  for each row
  when (
    old.description is distinct from new.description
    or old.doc_date is distinct from new.doc_date
    or old.direction is distinct from new.direction
    or old.supplier_id is distinct from new.supplier_id
    or old.customer_id is distinct from new.customer_id
    or old.amount_gross is distinct from new.amount_gross
    or old.amount_net is distinct from new.amount_net
    or old.vat_amount is distinct from new.vat_amount
    or old.amount_original is distinct from new.amount_original
    or old.currency is distinct from new.currency
    or old.pnl_role is distinct from new.pnl_role
    or old.provider_meta is distinct from new.provider_meta
  )
  execute function private.jev_refusal_reset();

select pg_temp.patch('public.mcp_jev_status()',
  array[$a$'prefilled_open', filled_open$a$],
  array[$n$'prefilled_open', filled_open,
    -- FLOW-1168: open lines Jev refused as invalid; not sent again until they change (30 days at most).
    'lines_not_retried', (
      select count(*)::integer
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
        )
        and exists (
          select 1 from public.jev_line_failures f
          where f.transaction_id = t.id
            and f.model_version = 'jev-1.13.0'
            and f.refused_at is not null
            and f.retry_after > now()
            and f.refused_inputs = private.jev_inputs_key(cid)
        )
    )$n$]);
revoke all on function public.mcp_jev_status() from public, anon;
grant execute on function public.mcp_jev_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- B. Push: a claim that can be given back
-- ---------------------------------------------------------------------------------------------

alter table public.notification_prefs add column weekly_released_on date;
alter table public.notification_prefs
  add constraint notification_prefs_weekly_released_chk
  check (weekly_released_on is null or weekly_released_on is distinct from weekly_sent_on);
comment on column public.notification_prefs.weekly_released_on is
  'FLOW-1168: the Israel date a סיכום שבועי claim was given back because no device took it; the hourly '
  'gate tries again until 11:59 that Sunday. Cleared by the next weekly claim.';

-- FLOW-1174: a send whose answer was lost may have reached the device, so a new-lines claim is given
-- back at most twice from the same mark: the same lines go out at most three times.
alter table public.notification_prefs
  add column new_released_mark timestamptz,
  add column new_releases smallint not null default 0;
alter table public.notification_prefs
  add constraint notification_prefs_new_releases_chk check (new_releases between 0 and 2);
comment on column public.notification_prefs.new_releases is
  'FLOW-1174: how many new-lines claims were given back to new_released_mark (the mark they moved from); '
  'at most 2, then the claim is kept. A release to another mark starts again at 1.';

-- The return type gains `claim`, so the function is made again with its grants.
drop function public.push_claim_targets(text);

-- The send function claims a kind's targets in one call: the claim moves the user's mark (new)
-- or stamps today (weekly) before the push goes out, so two runs in flight never send the same
-- lines. Each row carries its claim; push_release_claims gives it back when no device took the
-- push. created_at is when the inserting transaction began, so a line from a sync that commits
-- after a later-started sync was claimed is not pushed: it is missed rather than pushed late;
-- accepted.
-- The weekly claim does not check the day: the cron's gate does (only a cron or service caller
-- reaches it).
create function public.push_claim_targets(p_kind text)
returns table (user_id uuid, endpoint text, p256dh text, auth text, fresh integer, waiting integer, claim jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind = 'new' then
    return query
    with due as (
      select d.user_id, d.fresh, d.upto, d.waiting from private.push_new_due_users() d
    ), locked as (
      -- The row as it is once locked, so `prev` is the mark this claim moves from.
      select p.user_id, p.new_line_mark as prev
      from public.notification_prefs p
      join due on due.user_id = p.user_id
      for update of p
    ), claimed as (
      update public.notification_prefs p
      set new_line_mark = due.upto
      from due, locked
      where p.user_id = due.user_id
        and locked.user_id = due.user_id
        -- Rechecked on the locked row: a run that waited on another's claim skips the user.
        and (p.new_line_mark is null or p.new_line_mark < due.upto)
      returning p.user_id, due.fresh, due.waiting,
        jsonb_build_object('mark', due.upto, 'prev', locked.prev) as claim
    )
    select c.user_id, s.endpoint, s.p256dh, s.auth, c.fresh, c.waiting, c.claim
    from claimed c
    cross join lateral (
      select k.endpoint, k.p256dh, k.auth
      from public.push_subscriptions k
      where k.user_id = c.user_id
      order by k.updated_at desc, k.id
      limit 10
    ) s
    order by c.user_id;
  elsif p_kind = 'weekly' then
    return query
    with due as (
      select d.user_id, d.fresh, d.waiting from private.push_weekly_due_users() d
    ), locked as (
      select p.user_id, p.weekly_sent_on as prev
      from public.notification_prefs p
      join due on due.user_id = p.user_id
      for update of p
    ), claimed as (
      update public.notification_prefs p
      set weekly_sent_on = private.israel_now()::date,
          weekly_released_on = null
      from due, locked
      where p.user_id = due.user_id
        and locked.user_id = due.user_id
        and p.weekly_sent_on is distinct from private.israel_now()::date
      returning p.user_id, due.fresh, due.waiting,
        jsonb_build_object('day', private.israel_now()::date, 'prev', locked.prev) as claim
    )
    select c.user_id, s.endpoint, s.p256dh, s.auth, c.fresh, c.waiting, c.claim
    from claimed c
    cross join lateral (
      select k.endpoint, k.p256dh, k.auth
      from public.push_subscriptions k
      where k.user_id = c.user_id
      order by k.updated_at desc, k.id
      limit 10
    ) s
    order by c.user_id;
  else
    raise exception 'unknown push kind' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.push_claim_targets(text) from public, anon, authenticated;
grant execute on function public.push_claim_targets(text) to service_role;

-- Gives claims back: p_claims is [{user_id, claim}] as push_claim_targets returned them. A mark
-- moves back only from the value that claim set, and only to an earlier one, so a claim made since
-- is never undone. A new-lines mark moves back to the same value at most twice (FLOW-1174); a weekly
-- claim is bounded by its gate (until 11:59). Returns how many users were given back.
create function public.push_release_claims(p_kind text, p_claims jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  released integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_kind not in ('new', 'weekly') then
    raise exception 'unknown push kind' using errcode = '22023';
  end if;
  if p_claims is null or jsonb_typeof(p_claims) <> 'array' or jsonb_array_length(p_claims) > 1000 then
    raise exception 'validation' using errcode = '22023';
  end if;
  with given as (
    select distinct on (e->>'user_id')
      (e->>'user_id')::uuid as user_id,
      case when pg_input_is_valid(e->'claim'->>'mark', 'timestamptz')
        then (e->'claim'->>'mark')::timestamptz end as mark,
      case when p_kind = 'new' and pg_input_is_valid(e->'claim'->>'prev', 'timestamptz')
        then (e->'claim'->>'prev')::timestamptz end as prev_mark,
      case when pg_input_is_valid(e->'claim'->>'day', 'date') then (e->'claim'->>'day')::date end as day,
      case when p_kind = 'weekly' and pg_input_is_valid(e->'claim'->>'prev', 'date')
        then (e->'claim'->>'prev')::date end as prev_day
    from jsonb_array_elements(p_claims) e
    where jsonb_typeof(e) = 'object'
      and e->>'user_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and jsonb_typeof(e->'claim') = 'object'
  ), back as (
    update public.notification_prefs p
    set new_line_mark = case when p_kind = 'new' then g.prev_mark else p.new_line_mark end,
        new_releases = case
          when p_kind <> 'new' then p.new_releases
          when p.new_released_mark is not distinct from g.prev_mark then p.new_releases + 1
          else 1
        end,
        new_released_mark = case when p_kind = 'new' then g.prev_mark else p.new_released_mark end,
        weekly_sent_on = case when p_kind = 'weekly' then g.prev_day else p.weekly_sent_on end,
        weekly_released_on = case when p_kind = 'weekly' then g.day else p.weekly_released_on end
    from given g
    where p.user_id = g.user_id
      and (
        (p_kind = 'new' and g.mark is not null and p.new_line_mark = g.mark
          and (g.prev_mark is null or g.prev_mark < g.mark)
          -- FLOW-1174: twice from the same mark at most, then the claim is kept.
          and (p.new_released_mark is distinct from g.prev_mark or p.new_releases < 2))
        or (p_kind = 'weekly' and g.day is not null and p.weekly_sent_on = g.day
          and (g.prev_day is null or g.prev_day < g.day))
      )
    returning p.user_id
  )
  select count(*)::integer into released from back;
  return released;
end;
$$;

revoke all on function public.push_release_claims(text, jsonb) from public, anon, authenticated;
grant execute on function public.push_release_claims(text, jsonb) to service_role;

comment on function public.push_release_claims(text, jsonb) is
  'FLOW-1168: gives back new-lines or weekly push claims no device took, so the next run sends them. push-send only.';

-- The hourly weekly gate: Sunday 08:00-08:59, and until 11:59 for a summary given back today.
select pg_temp.patch('private.push_weekly_due()',
  array[$a$    and extract(hour from private.israel_now()) = 8
    and exists (select 1 from private.push_weekly_due_users());$a$],
  array[$n$    and (
      (extract(hour from private.israel_now()) = 8
        and exists (select 1 from private.push_weekly_due_users()))
      -- FLOW-1168: a summary no device took was given back; the next hours try it again.
      or (extract(hour from private.israel_now()) between 9 and 11
        and exists (
          select 1
          from private.push_weekly_due_users() d
          join public.notification_prefs p on p.user_id = d.user_id
          where p.weekly_released_on = private.israel_now()::date
        ))
    );$n$]);
revoke all on function private.push_weekly_due() from public, anon, authenticated;

-- The test push's claim names its row, so a send no device took can give it back.
select pg_temp.patch('public.claim_push_test()',
  array[
    $a$  devices integer;
begin$a$,
    $a$  insert into private.push_test_sends (user_id) values (uid);
  return jsonb_build_object('user_id', uid, 'devices', least(devices, 10));$a$
  ],
  array[
    $n$  devices integer;
  claimed bigint;
begin$n$,
    $n$  insert into private.push_test_sends (user_id) values (uid) returning id into claimed;
  return jsonb_build_object('user_id', uid, 'devices', least(devices, 10), 'claim', claimed);$n$
  ]);
revoke all on function public.claim_push_test() from public, anon, authenticated;
grant execute on function public.claim_push_test() to authenticated;

create function public.release_push_test(p_user uuid, p_claim bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from private.push_test_sends t where t.id = p_claim and t.user_id = p_user;
  return found;
end;
$$;

revoke all on function public.release_push_test(uuid, bigint) from public, anon, authenticated;
grant execute on function public.release_push_test(uuid, bigint) to service_role;

comment on function public.release_push_test(uuid, bigint) is
  'FLOW-1168: gives a test push claim back when no device took the push. push-send only.';

-- ---------------------------------------------------------------------------------------------
-- C. Invite email: a send Resend refused gives its claim back
-- ---------------------------------------------------------------------------------------------

alter table public.company_invites
  add constraint company_invites_emailed_chk check ((email_sends = 0) = (emailed_at is null));
-- FLOW-1174: claims given back, at most 3, so Resend hears at most 6 tries per invite (3 kept sends
-- and 3 refused ones), however often a client asks.
alter table public.company_invites
  add column email_releases smallint not null default 0;
alter table public.company_invites
  add constraint company_invites_email_releases_chk check (email_releases between 0 and 3);
comment on column public.company_invites.email_releases is
  'FLOW-1174: email claims given back because Resend refused the send (release_invite_email); at most 3.';

-- p_send is the claim's number (claim_invite_email's email_sends). Only the latest claim is given
-- back, so two sends in flight cannot both lower the count past what was claimed; and at most 3
-- claims of an invite are ever given back (FLOW-1174).
create function public.release_invite_email(p_invite_id uuid, p_send integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.company_invites i
  set email_sends = i.email_sends - 1,
      emailed_at = case when i.email_sends = 1 then null else i.emailed_at end,
      email_releases = i.email_releases + 1
  where i.id = p_invite_id
    and p_send between 1 and 3
    and i.email_sends = p_send
    and i.email_releases < 3;
  return found;
end;
$$;

revoke all on function public.release_invite_email(uuid, integer) from public, anon, authenticated;
grant execute on function public.release_invite_email(uuid, integer) to service_role;

comment on function public.release_invite_email(uuid, integer) is
  'FLOW-1168: gives back an invite email claim whose send Resend answered with an error. invite-email only.';

-- ---------------------------------------------------------------------------------------------
-- D. Thread purge: a name that cannot be removed leaves the list for a day
-- ---------------------------------------------------------------------------------------------

create table private.thread_purge_skips (
  name text primary key,
  skipped_at timestamptz not null default now(),
  -- FLOW-1174: a name that fails the path rule waits a day; one Storage kept (it may pass) an hour.
  retry_at timestamptz not null,
  constraint thread_purge_skips_wait_chk
    check (retry_at in (skipped_at + interval '1 hour', skipped_at + interval '1 day'))
);
alter table private.thread_purge_skips enable row level security;
revoke all on private.thread_purge_skips from public, anon, authenticated;

comment on table private.thread_purge_skips is
  'FLOW-1168: transaction-files names the purge listed and could not remove; left off the list until '
  'retry_at (a day for a name that fails the path rule, an hour for one Storage kept). Written by '
  'thread_files_purge_skip, which drops rows past their retry_at.';

create function public.thread_files_purge_skip(p_names jsonb, p_for_good boolean default true)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  kept integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_names is null or jsonb_typeof(p_names) <> 'array' or jsonb_array_length(p_names) > 1000 then
    raise exception 'validation' using errcode = '22023';
  end if;
  delete from private.thread_purge_skips s where s.retry_at <= now();
  insert into private.thread_purge_skips (name, skipped_at, retry_at)
  select distinct e #>> '{}', now(),
    now() + case when coalesce(p_for_good, true) then interval '1 day' else interval '1 hour' end
  from jsonb_array_elements(p_names) e
  where jsonb_typeof(e) = 'string'
  on conflict (name) do update set skipped_at = excluded.skipped_at, retry_at = excluded.retry_at;
  get diagnostics kept = row_count;
  return kept;
end;
$$;

revoke all on function public.thread_files_purge_skip(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.thread_files_purge_skip(jsonb, boolean) to service_role;

comment on function public.thread_files_purge_skip(jsonb, boolean) is
  'FLOW-1168: names the purge could not remove; thread_files_to_purge leaves them out for a day (p_for_good: '
  'they fail the path rule), or an hour (Storage kept them, FLOW-1174). mercury-sync only.';

select pg_temp.patch('public.thread_files_to_purge(integer)',
  array[$a$      and not exists (select 1 from public.transaction_files f where f.storage_path = o.name)$a$],
  array[$n$      and not exists (select 1 from public.transaction_files f where f.storage_path = o.name)
      -- FLOW-1168: a name the purge could not remove waits (a day, or an hour when Storage kept it),
      -- so the list moves past it. An object uploaded again under that name since is listed.
      and not exists (
        select 1 from private.thread_purge_skips s
        where s.name = o.name
          and s.retry_at > now()
          and s.skipped_at >= o.created_at
      )$n$]);
revoke all on function public.thread_files_to_purge(integer) from public, anon, authenticated;
grant execute on function public.thread_files_to_purge(integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- E. sync_bank: an incomplete pull, why a pull did not run, and a finish that is not lost
-- ---------------------------------------------------------------------------------------------

alter table private.mcp_sync_jobs add column complete boolean;
alter table private.mcp_sync_jobs
  add constraint mcp_sync_jobs_complete_chk check (complete is null or state = 'done');
comment on column private.mcp_sync_jobs.complete is
  'FLOW-1168: false when the pull did not read everything (its page cap, or a connection failed); null on a '
  'job that is not done, and on jobs stored before this column.';

create or replace function public.mcp_sync_bank_finish(
  p_job_id uuid,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gate jsonb;
  token uuid;
  next_state text;
  next_result jsonb;
  next_error jsonb;
  next_complete boolean;
  reason text;
  updated uuid;
begin
  if p_job_id is null then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' = 'true' then
    token := (gate->>'token_id')::uuid;
  else
    -- FLOW-1168: the token that started the job still records its end after it was revoked,
    -- expired or lost the write scope while the pull ran. The end is not a new write, and refused
    -- it left the job reading as running until it went stale. Only its own running job (below).
    begin
      token := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'mcp_tid', '')::uuid;
    exception
      when others then
        token := null;
    end;
    if token is null or auth.uid() is null then
      return gate;
    end if;
  end if;

  if p_response is not null
    and jsonb_typeof(p_response) = 'object'
    and p_response->'ok' = 'true'::jsonb
    and private.mcp_sync_result_valid(p_response->'data')
  then
    next_state := 'done';
    next_result := p_response->'data';
    -- FLOW-1168: false when the pull did not read everything. Beside `data`, so the four counts
    -- keep their shape for a reader of the stored result.
    if jsonb_typeof(p_response->'complete') = 'boolean' then
      next_complete := (p_response->>'complete')::boolean;
    end if;
  elsif p_response is not null
    and jsonb_typeof(p_response) = 'object'
    and p_response->'ok' = 'false'::jsonb
    and jsonb_typeof(p_response->'error') = 'object'
    and jsonb_typeof(p_response->'error'->'message') = 'string'
    -- Only the fixed failures flow-mcp's pullBank sends (FLOW-207), so a caller cannot
    -- store its own text for get_sync_status to show.
    and (p_response->'error'->>'code', p_response->'error'->>'message') in (
      ('unavailable', 'retry'),
      ('unavailable', 'unavailable'),
      ('not_found', 'bank is not connected'),
      ('refused', 'bank key was rejected; reconnect in Settings'),
      ('refused', 'The bank sync failed.')
    )
  then
    next_state := 'failed';
    next_error := jsonb_build_object(
      'code', p_response->'error'->>'code',
      'message', p_response->'error'->>'message'
    );
    -- FLOW-1168: why a retry was asked for: busy (the bank sync ran a moment ago or is running) or
    -- rate_limited (the bank asked to wait; retry_at when it said until when).
    reason := p_response->'error'->>'reason';
    if next_error->>'message' = 'retry' and reason in ('busy', 'rate_limited') then
      next_error := next_error || jsonb_build_object('reason', reason);
      if reason = 'rate_limited'
        and jsonb_typeof(p_response->'error'->'retry_at') = 'string'
        and pg_input_is_valid(p_response->'error'->>'retry_at', 'timestamptz')
      then
        next_error := next_error || jsonb_build_object('retry_at', (p_response->'error'->>'retry_at')::timestamptz);
      end if;
    end if;
  else
    next_state := 'failed';
    next_error := jsonb_build_object('code', 'refused', 'message', 'The bank sync failed.');
  end if;

  update private.mcp_sync_jobs j
  set state = next_state,
      result = next_result,
      error = next_error,
      complete = next_complete,
      finished_at = now()
  where j.id = p_job_id
    and j.token_id = token
    and j.user_id = auth.uid()
    and j.state = 'running'
    -- Past the stale window the job already reads as failed (reason unknown); it stays that way.
    and j.started_at >= now() - interval '5 minutes'
  returning j.id into updated;

  if updated is null then
    return private.mcp_error('not_found', 'not found');
  end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('job_id', updated, 'state', next_state));
end;
$$;

revoke all on function public.mcp_sync_bank_finish(uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.mcp_sync_bank_finish(uuid, jsonb) to authenticated;

select pg_temp.patch('private.mcp_sync_job_view(private.mcp_sync_jobs)',
  array[
    $a$'error', jsonb_build_object('code', 'unavailable', 'message', 'retry')$a$,
    $a$      ) || p_job.result$a$
  ],
  array[
    -- FLOW-1168: the run that held it ended without a word; the pull may or may not have run.
    $n$'error', jsonb_build_object('code', 'unavailable', 'message', 'retry', 'reason', 'unknown')$n$,
    $n$      ) || p_job.result
        || case when p_job.complete is null then '{}'::jsonb else jsonb_build_object('complete', p_job.complete) end$n$
  ]);
revoke all on function private.mcp_sync_job_view(private.mcp_sync_jobs) from public, anon, authenticated;

-- The helpers are session-wide: a later migration in the same session can make its own.
drop function pg_temp.patch(text, text[], text[]);
drop function pg_temp.anchor_count(text, text);

commit;
