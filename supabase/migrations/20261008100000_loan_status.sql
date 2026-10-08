-- FLOW-106 part 1. A loan can be paid off or closed. Decision 0122.
-- loans.status is open, paid_off or closed; closed_on is set exactly when it is not open.
-- A closed loan takes only payments dated on or before closed_on, so its history can
-- still be attached. Closing a loan with a payment attached after closed_on is refused.
-- mcp_update_loan sets both, and undo restores them. mcp_list_loans returns them.
-- mcp_undo is as in 20261008043000_loan_attach_lock_retry.sql otherwise.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create type public.loan_status as enum ('open', 'paid_off', 'closed');

alter table public.loans
  add column status public.loan_status not null default 'open',
  add column closed_on date,
  add constraint loans_closed_chk check ((status = 'open') = (closed_on is null));

comment on column public.loans.status is
  'open, paid_off or closed. A loan that is not open takes only payments dated on or before closed_on. Decision 0122.';

comment on column public.loans.closed_on is
  'The day the loan was paid off or closed. Set exactly when status is not open.';

-- Closing a loan must not leave a payment attached after the day it closed.
create or replace function private.loans_close_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'open'::public.loan_status
     and (
       old.status is distinct from new.status
       or old.closed_on is distinct from new.closed_on
     )
     and exists (
       select 1
       from public.loan_splits s
       join public.transactions t
         on t.company_id = s.company_id
        and t.id = s.transaction_id
       where s.company_id = new.company_id
         and s.loan_id = new.id
         and t.removed_at is null
         and t.doc_date > new.closed_on
     )
  then
    raise exception 'loan_payments_after_close' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.loans_close_check() from public, anon, authenticated;

create trigger loans_close_check
  before update of status, closed_on on public.loans
  for each row execute function private.loans_close_check();

-- A payment dated after a closed loan's closed_on is refused, from MCP and the app alike.
create or replace function private.loan_splits_closed_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.loans l
    join public.transactions t
      on t.company_id = new.company_id
     and t.id = new.transaction_id
    where l.company_id = new.company_id
      and l.id = new.loan_id
      and l.status <> 'open'::public.loan_status
      and t.doc_date > l.closed_on
  ) then
    raise exception 'loan_closed' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.loan_splits_closed_check() from public, anon, authenticated;

create trigger loan_splits_closed_check
  before insert or update of loan_id, transaction_id on public.loan_splits
  for each row execute function private.loan_splits_closed_check();

-- private.mcp_refused: as in 20261007210000_line_pnl_override.sql, plus the refusals of a
-- closed loan.
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
        'line has an open review',
        'payment below interest',
        'invalid loan parts',
        'loan line is fixed',
        'closed_on required',
        'loan is open',
        'payments after closed_on',
        'loan closed'
      ) then p_message
      -- The trigger on loan_splits raises this from the attach and the app alike.
      when p_message = 'loan_closed' then 'loan closed'
      else 'The write was refused.'
    end
  );
$$;


-- mcp_update_loan: as in 20261008050000_mcp_lock_retry.sql, plus status and closed_on.
create or replace function public.mcp_update_loan(
  p_idempotency_key text,
  p_loan_id uuid,
  p_patch jsonb
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
  before jsonb;
  after jsonb;
  cur record;
  key text;
  allowed constant text[] := array[
    'name', 'principal_minor', 'annual_rate_ppm', 'term_months',
    'start_date', 'payment_minor', 'escrow_minor', 'project_id',
    'status', 'closed_on'
  ];
  new_project uuid;
  set_project boolean;
  new_status public.loan_status;
  new_closed date;
  set_closed boolean;
  balance bigint;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_loan_id is null
    or p_patch is null
    or jsonb_typeof(p_patch) <> 'object'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  for key in select jsonb_object_keys(p_patch)
  loop
    if key = 'currency' or not (key = any(allowed)) then
      return private.mcp_error('validation', 'validation');
    end if;
    -- An explicit null would keep the old value and still log an edit.
    -- project_id and closed_on are the exceptions: null clears them.
    if key not in ('project_id', 'closed_on') and jsonb_typeof(p_patch->key) = 'null' then
      return private.mcp_error('validation', 'validation');
    end if;
  end loop;

  if p_patch = '{}'::jsonb then
    return private.mcp_error('validation', 'validation');
  end if;

  -- project_id is a uuid string, or JSON null to clear it. An absent key leaves it.
  set_project := p_patch ? 'project_id';
  if set_project then
    if jsonb_typeof(p_patch->'project_id') not in ('null', 'string')
      or (
        jsonb_typeof(p_patch->'project_id') = 'string'
        and p_patch->>'project_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
    then
      return private.mcp_error('validation', 'validation');
    end if;
    new_project := (p_patch->>'project_id')::uuid;
  end if;

  -- status is one of the three words. closed_on is YYYY-MM-DD, or JSON null to clear it.
  if p_patch ? 'status' and (
    jsonb_typeof(p_patch->'status') <> 'string'
    or p_patch->>'status' not in ('open', 'paid_off', 'closed')
  ) then
    return private.mcp_error('validation', 'validation');
  end if;
  set_closed := p_patch ? 'closed_on';
  if set_closed then
    if jsonb_typeof(p_patch->'closed_on') not in ('null', 'string')
      or (
        jsonb_typeof(p_patch->'closed_on') = 'string'
        and (
          p_patch->>'closed_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          or pg_input_is_valid(p_patch->>'closed_on', 'date') is not true
        )
      )
    then
      return private.mcp_error('validation', 'validation');
    end if;
    new_closed := (p_patch->>'closed_on')::date;
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_update|' || p_loan_id::text || '|' || p_patch::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  response := private.mcp_error('refused', 'The write was refused.');
  begin
    select l.name, l.principal_minor, l.annual_rate_ppm, l.term_months,
           l.start_date, l.payment_minor, l.escrow_minor, l.project_id,
           l.status, l.closed_on
    into cur
    from public.loans l
    where l.id = p_loan_id
      and l.company_id = cid
    for update;

    if found then
      -- Reopening clears the date unless the patch names one, which is then refused.
      new_status := coalesce((p_patch->>'status')::public.loan_status, cur.status);
      if not set_closed then
        new_closed := case when new_status = 'open'::public.loan_status then null else cur.closed_on end;
      end if;
    end if;

    if not found then
      response := private.mcp_refused('loan not found');
    elsif new_project is not null and not exists (
      select 1 from public.projects p where p.id = new_project and p.company_id = cid
    ) then
      response := private.mcp_refused('project not found');
    elsif new_status <> 'open'::public.loan_status and new_closed is null then
      response := private.mcp_refused('closed_on required');
    elsif new_status = 'open'::public.loan_status and new_closed is not null then
      response := private.mcp_refused('loan is open');
    else
      before := jsonb_build_object(
        'name', cur.name,
        'principal_minor', cur.principal_minor,
        'annual_rate_ppm', cur.annual_rate_ppm,
        'term_months', cur.term_months,
        'start_date', cur.start_date,
        'payment_minor', cur.payment_minor,
        'escrow_minor', cur.escrow_minor,
        'project_id', cur.project_id,
        'status', cur.status,
        'closed_on', cur.closed_on
      );

      update public.loans l
      set
        name = coalesce(btrim(p_patch->>'name'), l.name),
        principal_minor = coalesce((p_patch->>'principal_minor')::bigint, l.principal_minor),
        annual_rate_ppm = coalesce((p_patch->>'annual_rate_ppm')::integer, l.annual_rate_ppm),
        term_months = coalesce((p_patch->>'term_months')::integer, l.term_months),
        start_date = coalesce((p_patch->>'start_date')::date, l.start_date),
        payment_minor = coalesce((p_patch->>'payment_minor')::bigint, l.payment_minor),
        escrow_minor = coalesce((p_patch->>'escrow_minor')::bigint, l.escrow_minor),
        project_id = case when set_project then new_project else l.project_id end,
        status = new_status,
        closed_on = new_closed
      where l.id = p_loan_id
        and l.company_id = cid;

      select l.name, l.principal_minor, l.annual_rate_ppm, l.term_months,
             l.start_date, l.payment_minor, l.escrow_minor, l.project_id,
             l.status, l.closed_on
      into cur
      from public.loans l
      where l.id = p_loan_id;

      select b.balance_minor into balance
      from public.loan_balances b
      where b.company_id = cid and b.loan_id = p_loan_id;

      after := jsonb_build_object(
        'name', cur.name,
        'principal_minor', cur.principal_minor,
        'annual_rate_ppm', cur.annual_rate_ppm,
        'term_months', cur.term_months,
        'start_date', cur.start_date,
        'payment_minor', cur.payment_minor,
        'escrow_minor', cur.escrow_minor,
        'project_id', cur.project_id,
        'status', cur.status,
        'closed_on', cur.closed_on
      );

      insert into private.mcp_writes (token_id, user_id, kind, loan_id, prior, created_at)
      values (
        token, auth.uid(), 'loan_update', p_loan_id,
        jsonb_build_object('before', before, 'after', after), clock_timestamp()
      );

      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'id', p_loan_id,
          'project_id', cur.project_id,
          'status', cur.status,
          'closed_on', cur.closed_on,
          -- A loan marked paid off can still show principal Flow never saw paid.
          'balance_left', case when cur.status <> 'open'::public.loan_status then balance end,
          'undo_kind', 'loan_update'
        )
      );
    end if;
  exception
    when check_violation then
      if sqlerrm = 'loan_payment_below_interest' then
        response := private.mcp_refused('payment below interest');
      elsif sqlerrm = 'loan_payments_after_close' then
        response := private.mcp_refused('payments after closed_on');
      else
        response := private.mcp_refused('invalid loan terms');
      end if;
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_update_loan(text, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_update_loan(text, uuid, jsonb) to authenticated;

-- mcp_list_loans: as in 20261008080000_list_loans_flagged.sql, plus status and closed_on.
create or replace function public.mcp_list_loans()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'name', l.name,
    'currency', l.currency,
    'principal_minor', l.principal_minor,
    'annual_rate_ppm', l.annual_rate_ppm,
    'term_months', l.term_months,
    'start_date', l.start_date,
    'payment_minor', l.payment_minor,
    'escrow_minor', l.escrow_minor,
    'balance_minor', b.balance_minor,
    'flagged_parts', b.flagged_parts,
    'flagged_transaction_ids', coalesce((
      select jsonb_agg(f.transaction_id order by f.transaction_id)
      from (
        select distinct s.transaction_id
        from public.loan_splits s
        where s.company_id = l.company_id
          and s.loan_id = l.id
          and s.needs_review
      ) f
    ), '[]'::jsonb),
    'project_id', l.project_id,
    'project_name', pr.name,
    'status', l.status,
    'closed_on', l.closed_on
  ) order by l.name), '[]'::jsonb)
  from public.loans l
  join public.loan_balances b
    on b.company_id = l.company_id
   and b.loan_id = l.id
  left join public.projects pr
    on pr.company_id = l.company_id
   and pr.id = l.project_id
  where l.company_id = (select private.current_company_id());
$$;

revoke all on function public.mcp_list_loans() from public, anon;
grant execute on function public.mcp_list_loans() to authenticated, service_role;

-- mcp_undo: loan_update compares and restores status and closed_on when the edit kept them.
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
  restored boolean;
  cur_override boolean;
  attach_reassign uuid;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_id is null
    or p_kind is null
    or p_kind not in (
      'review', 'reassign', 'project', 'category', 'category_hidden', 'category_pnl',
      'loan', 'loan_update', 'loan_split', 'overhead_project', 'company', 'line_split',
      'line_pnl'
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
        or (p_kind = 'line_pnl' and w.kind = 'line_pnl' and w.transaction_id = p_id)
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
      elsif rec.prior->>'before' is not null and not exists (
        -- Key-share lock: a delete of that project waits until this undo commits, so it
        -- cannot slip in between this check and set_overhead_project.
        select 1 from public.projects p
        where p.id = (rec.prior->>'before')::uuid and p.company_id = cid
        for key share
      ) then
        -- The project it was before has been deleted since: nothing to go back to.
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
    elsif p_kind = 'line_pnl' then
      select t.in_pnl_override into cur_override
      from public.transactions t
      where t.id = p_id and t.company_id = cid and t.removed_at is null
      for update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      elsif cur_override is distinct from (rec.prior->>'written')::boolean then
        response := private.mcp_error('conflict', 'conflict');
      else
        perform public.set_transaction_pnl(p_id, (rec.prior->>'before')::boolean);
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
             l.start_date, l.payment_minor, l.escrow_minor, l.project_id,
             l.status, l.closed_on
      into cur_loan
      from public.loans l
      where l.id = p_id and l.company_id = cid
      for update;
      if not found or written is null or before is null then
        response := private.mcp_error('not_found', 'not found');
      elsif (
        -- Compare only the fields the edit snapshotted. An edit written before FLOW-105
        -- has no project_id, and one written before FLOW-106 has no status or closed_on.
        select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
        from jsonb_each(jsonb_build_object(
          'name', cur_loan.name,
          'principal_minor', cur_loan.principal_minor,
          'annual_rate_ppm', cur_loan.annual_rate_ppm,
          'term_months', cur_loan.term_months,
          'start_date', cur_loan.start_date,
          'payment_minor', cur_loan.payment_minor,
          'escrow_minor', cur_loan.escrow_minor,
          'project_id', cur_loan.project_id,
          'status', cur_loan.status,
          'closed_on', cur_loan.closed_on
        )) f
        where written ? f.key
      ) is distinct from written then
        response := private.mcp_error('conflict', 'conflict');
      elsif before->>'project_id' is not null and not exists (
        select 1 from public.projects p
        where p.id = (before->>'project_id')::uuid and p.company_id = cid
      ) then
        response := private.mcp_refused('project not found');
      else
        update public.loans l
        set
          name = (before->>'name')::text,
          principal_minor = (before->>'principal_minor')::bigint,
          annual_rate_ppm = (before->>'annual_rate_ppm')::integer,
          term_months = (before->>'term_months')::integer,
          start_date = (before->>'start_date')::date,
          payment_minor = (before->>'payment_minor')::bigint,
          escrow_minor = (before->>'escrow_minor')::bigint,
          project_id = case when before ? 'project_id'
            then (before->>'project_id')::uuid else l.project_id end,
          status = case when before ? 'status'
            then (before->>'status')::public.loan_status else l.status end,
          closed_on = case when before ? 'status'
            then (before->>'closed_on')::date else l.closed_on end
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
      elsif (
        -- Corrected in the app after the MCP wrote it: leave the owner's version.
        rec.prior->'parts' is not null
        and rec.prior->'parts' is distinct from (
          select jsonb_agg(jsonb_build_object(
            'part', s.part,
            'amount_minor', s.amount_minor,
            'category_id', s.category_id
          ) order by s.part)
          from public.loan_splits s
          where s.company_id = cid
            and s.transaction_id = p_id
            and s.loan_id = rec.loan_id
        )
      ) or (
        -- Written before the parts were kept: any later touch counts as a correction.
        rec.prior->'parts' is null
        and exists (
          select 1 from public.loan_splits s
          where s.company_id = cid
            and s.transaction_id = p_id
            and s.loan_id = rec.loan_id
            and s.updated_at > rec.created_at
        )
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.loan_splits s
        where s.company_id = cid
          and s.transaction_id = p_id
          and s.loan_id = rec.loan_id;
        -- Give the line back the project it had before the attach, but only if
        -- nobody has changed it since. A line that was changed is left as it is.
        restored := false;
        -- Since FLOW-120 the reassign id is in its column; older writes kept it in prior.
        attach_reassign := coalesce(rec.reassign_id, (rec.prior->>'reassign_id')::uuid);
        if attach_reassign is not null then
          select t.project_id, t.category_id, t.pnl_role
          into cur_project, cur_category, cur_role
          from public.transactions t
          where t.id = p_id and t.company_id = cid and t.removed_at is null
          for update;
          if found
            and cur_project::text is not distinct from rec.prior->>'project_id'
            and cur_category::text is not distinct from rec.prior->>'category_id'
            -- The role the attach gave the line. Writes before FLOW-120 did not keep
            -- it; reassign_transaction gave project for an expense category and none
            -- for an income (reversal) one, and the category is unchanged here.
            and (
              (rec.prior ? 'pnl_role'
                and cur_role::text is not distinct from rec.prior->>'pnl_role')
              or (not (rec.prior ? 'pnl_role')
                and cur_role is not distinct from (
                  case when exists (
                    select 1 from public.categories c
                    where c.id = cur_category
                      and c.company_id = cid
                      and c.kind = 'income'::public.category_kind
                  ) then null::public.pnl_role
                  else 'project'::public.pnl_role end
                ))
            )
            and exists (
              select 1 from public.reassign_undo u
              where u.id = attach_reassign
                and u.company_id = cid
                and u.undone_at is null
            )
          then
            perform public.undo_reassign(attach_reassign);
            restored := true;
          end if;
        end if;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', case when attach_reassign is not null
            then jsonb_build_object('kind', p_kind, 'id', p_id, 'project_restored', restored)
            else jsonb_build_object('kind', p_kind, 'id', p_id) end
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
      ) or exists (
        select 1 from public.loans l
        where l.company_id = cid and l.project_id = p_id
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
    when check_violation then
      if sqlerrm = 'loan_payment_below_interest' then
        response := private.mcp_refused('payment below interest');
      elsif sqlerrm = 'loan_payments_after_close' then
        response := private.mcp_refused('payments after closed_on');
      else
        response := private.mcp_refused(sqlerrm);
      end if;
    when deadlock_detected or serialization_failure or lock_not_available then
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
