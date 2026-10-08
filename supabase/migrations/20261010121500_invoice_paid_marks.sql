-- FLOW-330 and FLOW-412. Decision 0133.
-- 1. FLOW-330: "marked paid, waiting for sync" is stored. public.invoice_paid_marks holds one
--    row per open document the owner marked paid on Unpaid; set_invoice_paid adds or clears it.
--    list_unpaid keeps the row (so the screen can say it waits for the sync) and returns
--    marked_paid_at and currency; the mark stays until the document closes (a receipt or credit
--    note brings it to zero and it leaves the list) or the owner clears it.
-- 2. MCP: mcp_set_invoice_paid (idempotency key, write bucket through mcp_require_writer) and
--    undo kind invoice_paid. mcp_undo and private.mcp_writes are as in
--    20261010090000_loan_kinds_rates.sql plus that kind; mcp_refused adds 'invoice not found'.
-- 3. FLOW-412: list_project_category takes p_basis (default invoiced). On the cash basis it
--    leaves out unpaid supplier invoices and credit notes, as get_project's category rows do
--    (0118), so the drill-down total matches the row it opens from.

begin;

-- The new table's foreign key and the replaced functions take short locks. Give up after five
-- seconds rather than queue every read behind the migration.
set local lock_timeout = '5s';

create table public.invoice_paid_marks (
  transaction_id uuid primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  marked_at timestamptz not null default now(),
  marked_by uuid,
  foreign key (company_id, transaction_id)
    references public.transactions (company_id, id)
    on delete cascade
);

comment on table public.invoice_paid_marks is
  'FLOW-330. An open document (list_unpaid) the owner marked paid while SUMIT has no receipt for it yet. The row leaves the unpaid total and waits for the sync; set_invoice_paid adds or clears it. Decision 0133.';

create index invoice_paid_marks_company_idx on public.invoice_paid_marks (company_id);

alter table public.invoice_paid_marks enable row level security;

create policy invoice_paid_marks_select on public.invoice_paid_marks
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

-- Writes go through set_invoice_paid only.
revoke all on public.invoice_paid_marks from public, anon, authenticated;
grant select on public.invoice_paid_marks to authenticated;
grant select, insert, update, delete on public.invoice_paid_marks to service_role;

-- list_unpaid: as in 20260928210000_owner_ledger.sql, read for the owner or a viewer
-- (20261004010000_company_viewers.sql), plus currency and marked_paid_at.
create or replace function public.list_unpaid()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with cid as (
    select private.readable_company_id() as id
  ),
  open_docs as (
    select
      inv.id,
      inv.description,
      inv.doc_date,
      inv.external_id,
      coalesce(inv.currency, 'ILS') as currency,
      p.name as project_name,
      cu.name as customer_name,
      inv.amount_gross
        + coalesce((
          select sum(cred.amount_gross)::bigint
          from public.transactions cred
          where cred.company_id = inv.company_id
            and cred.removed_at is null
            and cred.doc_kind = 'credit'
            and cred.linked_external_id = inv.external_id
        ), 0)
        - coalesce((
          select sum(rec.amount_gross)::bigint
          from public.transactions rec
          where rec.company_id = inv.company_id
            and rec.removed_at is null
            and rec.doc_kind = 'receipt'
            and rec.linked_external_id = inv.external_id
        ), 0) as open_gross,
      inv.amount_net,
      inv.amount_gross as billed_gross,
      m.marked_at
    from public.transactions inv
    left join public.projects p on p.id = inv.project_id
    left join public.customers cu on cu.id = inv.customer_id
    left join public.invoice_paid_marks m on m.transaction_id = inv.id and m.company_id = inv.company_id
    where inv.company_id = (select id from cid)
      and inv.removed_at is null
      and inv.doc_kind = 'invoice'
      and inv.external_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'description', d.description,
    'doc_date', d.doc_date,
    'currency', d.currency,
    'project_name', d.project_name,
    'customer_name', d.customer_name,
    'open_gross_agorot', d.open_gross::bigint,
    'open_net_agorot', case
      when d.billed_gross = 0 then 0::bigint
      else (d.open_gross * d.amount_net) / d.billed_gross
    end,
    'marked_paid_at', d.marked_at
  ) order by d.doc_date, d.description), '[]'::jsonb)
  from open_docs d
  where d.open_gross <> 0;
$$;

revoke all on function public.list_unpaid() from public, anon;
grant execute on function public.list_unpaid() to authenticated, service_role;

-- Owner only. p_paid true marks an open document paid (a second mark keeps the first time),
-- false clears the mark. A document list_unpaid does not list is 'invoice not found'.
create or replace function public.set_invoice_paid(p_id uuid, p_paid boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  open_gross bigint;
  marked timestamptz;
begin
  -- The owner's own company comes first, so an owner who is also listed as a viewer is not refused.
  cid := private.current_company_id();
  if cid is null then
    if exists (
      select 1 from public.company_viewers v where v.user_id = (select auth.uid())
    ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_id is null or p_paid is null then
    raise exception 'invoice not found';
  end if;

  -- The document row is the lock, so two marks of one document queue.
  perform 1
  from public.transactions t
  where t.id = p_id and t.company_id = cid and t.removed_at is null
    and t.doc_kind = 'invoice' and t.external_id is not null
  for update of t;
  if not found then
    raise exception 'invoice not found';
  end if;

  if p_paid then
    select (u->>'open_gross_agorot')::bigint into open_gross
    from jsonb_array_elements(public.list_unpaid()) u
    where (u->>'id')::uuid = p_id;
    -- Not listed: closed already (nothing open) or listed for another company.
    if open_gross is null then
      raise exception 'invoice not found';
    end if;
    insert into public.invoice_paid_marks (transaction_id, company_id, marked_by)
    values (p_id, cid, (select auth.uid()))
    on conflict (transaction_id) do nothing;
  else
    delete from public.invoice_paid_marks m where m.transaction_id = p_id and m.company_id = cid;
  end if;

  select m.marked_at into marked
  from public.invoice_paid_marks m
  where m.transaction_id = p_id and m.company_id = cid;

  return jsonb_build_object('id', p_id, 'marked_paid', marked is not null, 'marked_paid_at', marked);
end;
$$;

revoke all on function public.set_invoice_paid(uuid, boolean) from public, anon;
grant execute on function public.set_invoice_paid(uuid, boolean) to authenticated, service_role;

-- private.mcp_writes: as in 20261010090000_loan_kinds_rates.sql, plus invoice_paid. Its prior
-- holds the mark's time before (null: not marked) and what was written (true or false).
alter table private.mcp_writes drop constraint mcp_writes_kind_check;
alter table private.mcp_writes
  add constraint mcp_writes_kind_check check (
    kind in (
      'review', 'reassign', 'project', 'category', 'category_hidden', 'category_pnl',
      'loan', 'loan_update', 'loan_split', 'overhead_project', 'company', 'line_split',
      'line_pnl', 'loan_rate', 'invoice_paid'
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
  or (kind = 'line_pnl' and transaction_id is not null and prior ? 'written' and prior ? 'before')
  or (kind = 'loan_rate' and loan_id is not null and prior ? 'rate_id' and prior ? 'effective_date')
  or (kind = 'invoice_paid' and transaction_id is not null and prior ? 'written' and prior ? 'before')
);

-- One document. p_paid true marks it paid, false clears the mark.
create or replace function public.mcp_set_invoice_paid(
  p_idempotency_key text,
  p_transaction_id uuid,
  p_paid boolean
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
  before_marked timestamptz;
  written jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or p_paid is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'invoice_paid|' || p_transaction_id::text || '|' || p_paid::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  begin
    select m.marked_at into before_marked
    from public.invoice_paid_marks m
    where m.transaction_id = p_transaction_id and m.company_id = cid;

    written := public.set_invoice_paid(p_transaction_id, p_paid);
    -- clock_timestamp, so two writes to one document in one transaction still undo newest first.
    insert into private.mcp_writes (token_id, user_id, transaction_id, kind, prior, created_at)
    values (
      token, auth.uid(), p_transaction_id, 'invoice_paid',
      jsonb_build_object('before', before_marked, 'written', p_paid),
      clock_timestamp()
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'transaction_id', p_transaction_id,
        'marked_paid', written->'marked_paid',
        'marked_paid_at', written->'marked_paid_at',
        'undo_kind', 'invoice_paid',
        'id', p_transaction_id
      )
    );
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_set_invoice_paid(text, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_set_invoice_paid(text, uuid, boolean) to authenticated;

-- private.mcp_refused: as in 20261010090000_loan_kinds_rates.sql, plus 'invoice not found'.
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
        'parts exceed the line',
        'a part rounds to zero',
        'nothing is left for the rest',
        'line has no category for the rest',
        'a reversal part needs a project',
        'same category and project twice',
        'line amount is zero',
        -- FLOW-106 parts 1 and 2 (decisions 0122 and 0128).
        'closed_on required',
        'loan is open',
        'payments after closed_on',
        'loan closed',
        'category does not fit the loan part',
        -- FLOW-106 part 3 (decision 0130).
        'fees category required',
        -- FLOW-106 part 4 (decision 0132).
        'rate before the loan start',
        'rate not found',
        -- FLOW-330 (decision 0133).
        'invoice not found'
      ) then p_message
      when p_message = 'loan_closed' then 'loan closed'
      else 'The write was refused.'
    end
  );
$$;

-- mcp_undo: as in 20261010090000_loan_kinds_rates.sql, plus kind invoice_paid (FLOW-330): it
-- puts the mark back as it was before the write (with its first time) or takes it away, or is
-- conflict when the mark changed since.
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
  cur_rate integer;
  cur_marked timestamptz;
  cur_found boolean;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_id is null
    or p_kind is null
    or p_kind not in (
      'review', 'reassign', 'project', 'category', 'category_hidden', 'category_pnl',
      'loan', 'loan_update', 'loan_split', 'overhead_project', 'company', 'line_split',
      'line_pnl', 'loan_rate', 'invoice_paid'
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
        or (p_kind = 'loan_rate' and w.kind = 'loan_rate' and w.prior->>'rate_id' = p_id::text)
        or (p_kind = 'invoice_paid' and w.kind = 'invoice_paid' and w.transaction_id = p_id)
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
    elsif p_kind = 'invoice_paid' then
      -- The document row is the lock, as in set_invoice_paid.
      perform 1
      from public.transactions t
      where t.id = p_id and t.company_id = cid and t.removed_at is null
      for update of t;
      cur_found := found;
      select m.marked_at into cur_marked
      from public.invoice_paid_marks m
      where m.transaction_id = p_id and m.company_id = cid;
      if not cur_found then
        response := private.mcp_error('not_found', 'not found');
      elsif (cur_marked is not null) is distinct from (rec.prior->>'written')::boolean then
        response := private.mcp_error('conflict', 'conflict');
      else
        -- Put the mark back as it was, with its first time, or take it away.
        delete from public.invoice_paid_marks m where m.transaction_id = p_id and m.company_id = cid;
        if rec.prior->>'before' is not null then
          insert into public.invoice_paid_marks (transaction_id, company_id, marked_at, marked_by)
          values (p_id, cid, (rec.prior->>'before')::timestamptz, auth.uid());
        end if;
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
        -- A write stored before FLOW-133 has no percent or rest in before: they stay empty.
        insert into public.line_splits (
          company_id, transaction_id, ordinal, category_id, project_id, amount_minor, percent, is_rest
        )
        select cid, p_id, b.ord::smallint, (b.part->>'category_id')::uuid, (b.part->>'project_id')::uuid,
          (b.part->>'amount_minor')::bigint, (b.part->>'percent')::numeric,
          coalesce((b.part->>'is_rest')::boolean, false)
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
             l.status, l.closed_on,
             l.interest_category_id, l.escrow_category_id, l.principal_category_id,
             l.fees_category_id, l.kind, l.interest_only_months, l.amortization_months
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
          'closed_on', cur_loan.closed_on,
          'interest_category_id', cur_loan.interest_category_id,
          'escrow_category_id', cur_loan.escrow_category_id,
          'principal_category_id', cur_loan.principal_category_id,
          'fees_category_id', cur_loan.fees_category_id,
          'kind', cur_loan.kind,
          'interest_only_months', cur_loan.interest_only_months,
          'amortization_months', cur_loan.amortization_months
        )) f
        where written ? f.key
      ) is distinct from written then
        response := private.mcp_error('conflict', 'conflict');
      elsif before->>'project_id' is not null and not exists (
        select 1 from public.projects p
        where p.id = (before->>'project_id')::uuid and p.company_id = cid
      ) then
        response := private.mcp_refused('project not found');
      elsif exists (
        select 1
        from (values ('interest_category_id'), ('escrow_category_id'), ('principal_category_id'), ('fees_category_id')) v(k)
        where before->>v.k is not null
          and not exists (
            select 1 from public.categories c
            where c.id = (before->>v.k)::uuid and c.company_id = cid
          )
      ) then
        -- A category the edit replaced was deleted since.
        response := private.mcp_refused('category not found');
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
            then (before->>'closed_on')::date else l.closed_on end,
          interest_category_id = case when before ? 'interest_category_id'
            then (before->>'interest_category_id')::uuid else l.interest_category_id end,
          escrow_category_id = case when before ? 'escrow_category_id'
            then (before->>'escrow_category_id')::uuid else l.escrow_category_id end,
          principal_category_id = case when before ? 'principal_category_id'
            then (before->>'principal_category_id')::uuid else l.principal_category_id end,
          fees_category_id = case when before ? 'fees_category_id'
            then (before->>'fees_category_id')::uuid else l.fees_category_id end,
          kind = case when before ? 'kind'
            then (before->>'kind')::public.loan_kind else l.kind end,
          interest_only_months = case when before ? 'kind'
            then (before->>'interest_only_months')::integer else l.interest_only_months end,
          amortization_months = case when before ? 'kind'
            then (before->>'amortization_months')::integer else l.amortization_months end
        where l.id = p_id and l.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'loan_rate' then
      -- The loan first, as every loan write does (0121); then the rate row by its date.
      perform 1 from public.loans l
      where l.id = rec.loan_id and l.company_id = cid
      for no key update;
      if not found then
        response := private.mcp_error('not_found', 'not found');
      else
        select r.annual_rate_ppm into cur_rate
        from public.loan_rates r
        where r.loan_id = rec.loan_id
          and r.effective_date = (rec.prior->>'effective_date')::date
        for update;
        if not found then
          cur_rate := null;
        end if;
        if cur_rate is distinct from (rec.prior->>'written')::integer then
          -- Changed since: leave it.
          response := private.mcp_error('conflict', 'conflict');
        else
          if rec.prior->>'before' is null then
            delete from public.loan_rates r
            where r.loan_id = rec.loan_id
              and r.effective_date = (rec.prior->>'effective_date')::date;
          elsif rec.prior->>'written' is null then
            insert into public.loan_rates (id, company_id, loan_id, effective_date, annual_rate_ppm)
            values (
              (rec.prior->>'rate_id')::uuid, cid, rec.loan_id,
              (rec.prior->>'effective_date')::date, (rec.prior->>'before')::integer
            );
          else
            update public.loan_rates r
            set annual_rate_ppm = (rec.prior->>'before')::integer
            where r.loan_id = rec.loan_id
              and r.effective_date = (rec.prior->>'effective_date')::date;
          end if;
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        end if;
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
      elsif sqlerrm = 'loan_category_not_allowed' then
        response := private.mcp_refused('category does not fit the loan part');
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

-- FLOW-412. list_project_category: as in 20261009120000_profit_by_month.sql, plus p_basis
-- (cash or invoiced, default invoiced as before). On the cash basis an unpaid supplier invoice
-- or credit note is left out, as get_project's category rows leave it out (0118). The response
-- echoes the basis.
drop function public.list_project_category(uuid, uuid, integer, integer, date, date);

create function public.list_project_category(
  p_project uuid,
  p_category uuid,
  p_offset integer default 0,
  p_limit integer default 40,
  p_from date default null,
  p_to date default null,
  p_basis text default 'invoiced'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  off integer;
  lim integer;
  total bigint;
  n bigint;
  listed jsonb;
  basis text;
begin
  cid := private.current_company_id();
  if cid is null then
    return null;
  end if;
  if not exists (
    select 1 from public.projects p where p.id = p_project and p.company_id = cid
  ) or not exists (
    select 1 from public.categories c where c.id = p_category and c.company_id = cid
  ) then
    return null;
  end if;
  if (p_from is null) <> (p_to is null) or p_from > p_to then
    raise exception 'invalid range' using errcode = '22023';
  end if;
  basis := case when p_basis = 'cash' then 'cash' else 'invoiced' end;
  off := greatest(coalesce(p_offset, 0), 0);
  lim := least(greatest(coalesce(p_limit, 40), 1), 100);
  select coalesce((-sum(e.amount_net))::bigint, 0), count(*)::bigint
    into total, n
  from private.project_category_entries(p_project) e
  join public.transactions lt on lt.id = e.transaction_id
  where e.category_id = p_category
    and (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
    and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', page.transaction_id,
    'description', page.description,
    'doc_date', page.doc_date,
    'amount_net', page.amount_net
  ) order by page.doc_date desc, page.created_at desc, page.transaction_id), '[]'::jsonb)
  into listed
  from (
    select e.transaction_id, e.description, e.doc_date, e.amount_net, e.created_at
    from private.project_category_entries(p_project) e
    join public.transactions lt on lt.id = e.transaction_id
    where e.category_id = p_category
      and (basis = 'invoiced' or not private.line_unpaid(lt.direction, lt.doc_kind, lt.cash_date))
      and private.pnl_in_range('expense', basis, e.doc_date, null, p_from, p_to)
    order by e.doc_date desc, e.created_at desc, e.transaction_id
    offset off
    limit lim
  ) page;
  return jsonb_build_object(
    'category_name', (select c.name from public.categories c where c.id = p_category),
    'project_name', (select p.name from public.projects p where p.id = p_project),
    'from', case when p_from is null or p_to is null then null else p_from end,
    'to', case when p_from is null or p_to is null then null else p_to end,
    'basis', basis,
    'total_agorot', total,
    'rows', listed,
    'next_offset', case when n > off + lim then off + lim else null end
  );
end;
$$;

revoke all on function public.list_project_category(uuid, uuid, integer, integer, date, date, text) from public, anon;
grant execute on function public.list_project_category(uuid, uuid, integer, integer, date, date, text) to authenticated, service_role;

commit;
