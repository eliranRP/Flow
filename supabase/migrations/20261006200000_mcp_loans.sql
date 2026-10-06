-- MCP cycle 5. Loan reads and writes with undo.
-- Decision 0092.

begin;

alter table private.mcp_writes drop constraint mcp_writes_kind_check;

alter table private.mcp_writes
  add constraint mcp_writes_kind_check check (
    kind in (
      'review', 'reassign', 'project', 'category', 'category_hidden',
      'loan', 'loan_update', 'loan_split'
    )
  );

alter table private.mcp_writes
  add column if not exists loan_id uuid,
  add column prior jsonb;

alter table private.mcp_writes drop constraint mcp_writes_target;

alter table private.mcp_writes add constraint mcp_writes_target check (
  (kind = 'review' and review_id is not null)
  or (kind = 'reassign' and transaction_id is not null and reassign_id is not null)
  or (kind = 'project' and project_id is not null)
  or (kind in ('category', 'category_hidden') and category_id is not null)
  or (kind = 'loan' and loan_id is not null)
  or (kind = 'loan_update' and loan_id is not null and prior is not null)
  or (kind = 'loan_split' and loan_id is not null and transaction_id is not null)
);

create unique index mcp_writes_loan_open_idx
  on private.mcp_writes (user_id, loan_id)
  where kind = 'loan' and undone_at is null;

create unique index mcp_writes_loan_update_open_idx
  on private.mcp_writes (user_id, loan_id)
  where kind = 'loan_update' and undone_at is null;

create unique index mcp_writes_loan_split_open_idx
  on private.mcp_writes (user_id, transaction_id)
  where kind = 'loan_split' and undone_at is null;

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
        'invalid loan terms'
      ) then p_message
      else 'The write was refused.'
    end
  );
$$;

revoke all on function private.mcp_refused(text) from public, anon, authenticated;

create or replace function public.mcp_company_loan_currency()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  with lines as (
    select distinct t.currency
    from public.transactions t
    where t.company_id = (select private.current_company_id())
      and t.removed_at is null
  )
  select case
    when not exists (select 1 from lines) then 'ILS'
    when exists (select 1 from lines where currency <> 'USD') then 'ILS'
    else 'USD'
  end;
$$;

revoke all on function public.mcp_company_loan_currency() from public, anon;
grant execute on function public.mcp_company_loan_currency() to authenticated, service_role;

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
    'balance_minor', b.balance_minor
  ) order by l.name), '[]'::jsonb)
  from public.loans l
  join public.loan_balances b
    on b.company_id = l.company_id
   and b.loan_id = l.id
  where l.company_id = (select private.current_company_id());
$$;

revoke all on function public.mcp_list_loans() from public, anon;
grant execute on function public.mcp_list_loans() to authenticated, service_role;

create or replace function public.get_transaction(p_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'description', t.description,
    'direction', t.direction,
    'doc_kind', t.doc_kind,
    'doc_date', t.doc_date,
    'amount_gross', t.amount_gross,
    'amount_net', t.amount_net,
    'amount_original', t.amount_original,
    'vat_amount', t.vat_amount,
    'vat_status', t.vat_status,
    'currency', t.currency,
    'source', t.source,
    'pnl_role', t.pnl_role,
    'project_id', t.project_id,
    'project_name', p.name,
    'category_id', t.category_id,
    'category_name', c.name,
    'supplier_name', s.name,
    'customer_name', cu.name,
    'review_status', (
      select q.status
      from public.review_queue q
      where q.transaction_id = t.id and q.company_id = t.company_id
      order by case when q.status = 'open' then 0 else 1 end, q.created_at desc
      limit 1
    ),
    'review_reason', (
      select q.reason
      from public.review_queue q
      where q.transaction_id = t.id and q.company_id = t.company_id and q.status = 'open'
      order by q.created_at desc
      limit 1
    ),
    'paid', t.cash_date is not null,
    'open_gross_agorot', case
      when t.doc_kind = 'invoice' and t.external_id is not null then
        t.amount_gross
        + coalesce((
          select sum(cred.amount_gross)::bigint
          from public.transactions cred
          where cred.company_id = t.company_id
            and cred.removed_at is null
            and cred.doc_kind = 'credit'
            and cred.linked_external_id = t.external_id
        ), 0)
        - coalesce((
          select sum(rec.amount_gross)::bigint
          from public.transactions rec
          where rec.company_id = t.company_id
            and rec.removed_at is null
            and rec.doc_kind = 'receipt'
            and rec.linked_external_id = t.external_id
        ), 0)
      else null
    end,
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', a.project_id,
        'project_name', ap.name,
        'share_bp', a.share_bp,
        'amount_net', a.amount_net
      ) order by ap.name)
      from public.allocations a
      join public.projects ap on ap.id = a.project_id
      where a.transaction_id = t.id
    ), '[]'::jsonb)
  )
  from public.transactions t
  left join public.projects p on p.id = t.project_id
  left join public.categories c on c.id = t.category_id
  left join public.suppliers s on s.id = t.supplier_id
  left join public.customers cu on cu.id = t.customer_id
  where t.id = p_id
    and t.removed_at is null
    and t.company_id = (select private.current_company_id());
$$;

revoke all on function public.get_transaction(uuid) from public, anon;
grant execute on function public.get_transaction(uuid) to authenticated, service_role;

create or replace function public.mcp_add_loan(
  p_idempotency_key text,
  p_name text,
  p_principal_minor bigint,
  p_annual_rate_ppm integer,
  p_term_months integer,
  p_start_date date,
  p_payment_minor bigint,
  p_escrow_minor bigint,
  p_currency text
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
  rid uuid;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_name is null
    or p_principal_minor is null
    or p_annual_rate_ppm is null
    or p_term_months is null
    or p_start_date is null
    or p_payment_minor is null
    or p_escrow_minor is null
    or p_currency is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan|' || btrim(p_name) || '|' || p_principal_minor::text || '|' || p_annual_rate_ppm::text
    || '|' || p_term_months::text || '|' || p_start_date::text || '|' || p_payment_minor::text
    || '|' || p_escrow_minor::text || '|' || p_currency;
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
    insert into public.loans (
      company_id, name, principal_minor, annual_rate_ppm, term_months,
      start_date, payment_minor, escrow_minor, currency
    )
    values (
      cid, btrim(p_name), p_principal_minor, p_annual_rate_ppm, p_term_months,
      p_start_date, p_payment_minor, p_escrow_minor, p_currency
    )
    returning id into rid;

    insert into private.mcp_writes (token_id, user_id, kind, loan_id)
    values (token, auth.uid(), 'loan', rid);

    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object('id', rid, 'undo_kind', 'loan')
    );
  exception
    when check_violation then
      response := private.mcp_refused('invalid loan terms');
    when deadlock_detected or serialization_failure then
      return private.mcp_error('unavailable', 'retry');
    when others then
      response := private.mcp_refused(sqlerrm);
  end;

  perform private.mcp_idempotency_store(token, p_idempotency_key, hash, response);
  return response;
end;
$$;

revoke all on function public.mcp_add_loan(text, text, bigint, integer, integer, date, bigint, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_add_loan(text, text, bigint, integer, integer, date, bigint, bigint, text)
  to authenticated;

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
    'start_date', 'payment_minor', 'escrow_minor'
  ];
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
  end loop;

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
           l.start_date, l.payment_minor, l.escrow_minor
    into cur
    from public.loans l
    where l.id = p_loan_id
      and l.company_id = cid
    for update;

    if not found then
      response := private.mcp_refused('loan not found');
    else
      before := jsonb_build_object(
        'name', cur.name,
        'principal_minor', cur.principal_minor,
        'annual_rate_ppm', cur.annual_rate_ppm,
        'term_months', cur.term_months,
        'start_date', cur.start_date,
        'payment_minor', cur.payment_minor,
        'escrow_minor', cur.escrow_minor
      );

      update public.loans l
      set
        name = coalesce((p_patch->>'name')::text, l.name),
        principal_minor = coalesce((p_patch->>'principal_minor')::bigint, l.principal_minor),
        annual_rate_ppm = coalesce((p_patch->>'annual_rate_ppm')::integer, l.annual_rate_ppm),
        term_months = coalesce((p_patch->>'term_months')::integer, l.term_months),
        start_date = coalesce((p_patch->>'start_date')::date, l.start_date),
        payment_minor = coalesce((p_patch->>'payment_minor')::bigint, l.payment_minor),
        escrow_minor = coalesce((p_patch->>'escrow_minor')::bigint, l.escrow_minor)
      where l.id = p_loan_id
        and l.company_id = cid;

      select l.name, l.principal_minor, l.annual_rate_ppm, l.term_months,
             l.start_date, l.payment_minor, l.escrow_minor
      into cur
      from public.loans l
      where l.id = p_loan_id;

      after := jsonb_build_object(
        'name', cur.name,
        'principal_minor', cur.principal_minor,
        'annual_rate_ppm', cur.annual_rate_ppm,
        'term_months', cur.term_months,
        'start_date', cur.start_date,
        'payment_minor', cur.payment_minor,
        'escrow_minor', cur.escrow_minor
      );

      insert into private.mcp_writes (token_id, user_id, kind, loan_id, prior)
      values (token, auth.uid(), 'loan_update', p_loan_id, jsonb_build_object('before', before, 'after', after));

      response := jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object('id', p_loan_id, 'undo_kind', 'loan_update')
      );
    end if;
  exception
    when check_violation then
      response := private.mcp_refused('invalid loan terms');
    when deadlock_detected or serialization_failure then
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

create or replace function public.mcp_attach_loan_payment(
  p_idempotency_key text,
  p_transaction_id uuid,
  p_loan_id uuid,
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
  txn record;
  loan record;
  balance bigint;
  part jsonb;
  part_sum bigint := 0;
  principal_amt bigint := 0;
  cat_interest uuid;
  cat_escrow uuid;
  cat_principal uuid;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or p_loan_id is null
    or p_parts is null
    or jsonb_typeof(p_parts) <> 'array'
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'loan_split|' || p_transaction_id::text || '|' || p_loan_id::text || '|' || p_parts::text;
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
    select t.currency, t.amount_original
    into txn
    from public.transactions t
    where t.id = p_transaction_id
      and t.company_id = cid
      and t.removed_at is null
    for update;

    if not found then
      response := private.mcp_refused('transaction not found');
    elsif exists (
      select 1 from public.loan_splits s where s.transaction_id = p_transaction_id
    ) then
      response := private.mcp_refused('loan already attached');
    else
      select l.currency
      into loan
      from public.loans l
      where l.id = p_loan_id
        and l.company_id = cid
      for update;

      if not found then
        response := private.mcp_refused('loan not found');
      elsif loan.currency is distinct from txn.currency then
        response := private.mcp_refused('loan currency mismatch');
      else
        select b.balance_minor into balance
        from public.loan_balances b
        where b.company_id = cid and b.loan_id = p_loan_id;

        if coalesce(balance, 0) <= 0 then
          response := private.mcp_refused('loan balance exceeded');
        else
          for part in select value from jsonb_array_elements(p_parts)
          loop
            part_sum := part_sum + coalesce((part->>'amount_minor')::bigint, 0);
            if part->>'part' = 'principal' then
              principal_amt := coalesce((part->>'amount_minor')::bigint, 0);
            end if;
          end loop;

          if part_sum is distinct from txn.amount_original then
            response := private.mcp_refused('The write was refused.');
          elsif principal_amt > balance then
            response := private.mcp_refused('loan balance exceeded');
          else
            select c.id into cat_interest
            from public.categories c
            where c.company_id = cid and c.kind = 'expense' and c.name = 'ריבית משכנתא';
            select c.id into cat_escrow
            from public.categories c
            where c.company_id = cid and c.kind = 'expense' and c.name = 'מסים וביטוח';
            select c.id into cat_principal
            from public.categories c
            where c.company_id = cid and c.kind = 'expense' and c.name = 'תשלומי הלוואה';

            if cat_interest is null or cat_escrow is null or cat_principal is null then
              response := private.mcp_refused('loan categories missing');
            else
              for part in select value from jsonb_array_elements(p_parts)
              loop
                insert into public.loan_splits (
                  company_id, loan_id, transaction_id, part,
                  amount_minor, scheduled_minor, category_id
                )
                values (
                  cid,
                  p_loan_id,
                  p_transaction_id,
                  (part->>'part')::public.loan_split_part,
                  (part->>'amount_minor')::bigint,
                  (part->>'scheduled_minor')::bigint,
                  case (part->>'part')
                    when 'interest' then cat_interest
                    when 'escrow' then cat_escrow
                    when 'principal' then cat_principal
                  end
                );
              end loop;

              perform private.loan_splits_check(p_transaction_id);

              insert into private.mcp_writes (token_id, user_id, kind, loan_id, transaction_id)
              values (token, auth.uid(), 'loan_split', p_loan_id, p_transaction_id);

              response := jsonb_build_object(
                'ok', true,
                'data', jsonb_build_object(
                  'loan_id', p_loan_id,
                  'transaction_id', p_transaction_id,
                  'undo_kind', 'loan_split'
                )
              );
            end if;
          end if;
        end if;
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

revoke all on function public.mcp_attach_loan_payment(text, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_attach_loan_payment(text, uuid, uuid, jsonb) to authenticated;

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
  cur_loan record;
  written jsonb;
  before jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_id is null
    or p_kind is null
    or p_kind not in (
      'review', 'reassign', 'project', 'category', 'category_hidden',
      'loan', 'loan_update', 'loan_split'
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
        or (p_kind in ('category', 'category_hidden') and w.kind = p_kind and w.category_id = p_id)
        or (p_kind = 'loan' and w.kind = 'loan' and w.loan_id = p_id)
        or (p_kind = 'loan_update' and w.kind = 'loan_update' and w.loan_id = p_id)
        or (p_kind = 'loan_split' and w.kind = 'loan_split' and w.transaction_id = p_id)
      )
    for update;

    if not found then
      response := private.mcp_error('not_found', 'not found');
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
