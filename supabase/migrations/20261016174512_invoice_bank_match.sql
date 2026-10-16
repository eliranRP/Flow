-- FLOW-367, server part: the open-invoices screen's bank match and totals. Decision 0133 family.
-- 1. Two tables. invoice_payment_links: an open customer invoice linked to the Mercury deposit that
--    paid it (it leaves the list, as a receipt would). invoice_match_dismissals: a deposit the owner
--    said is not this invoice's payment, so list_unpaid stops offering it for that invoice.
-- 2. private.invoice_match_id: the deposit that matches an open invoice: a Mercury income line of
--    the same gross amount and the same customer, dated on or after the invoice, not linked to
--    another invoice and not dismissed for this one. The earliest such line.
-- 3. private.open_invoice_gross: the amount still open of one invoice, as list_unpaid works it out
--    (credit notes add, receipts subtract), or null when the invoice is not listed (linked, not an
--    income invoice, removed, or nothing open).
-- 4. public.list_unpaid: each row gains days_open and match (null when no deposit matches or the
--    invoice is marked paid), and a linked invoice leaves the list. The rest is as before.
-- 5. public.unpaid_overview: the bar's totals for the company: issued_since (the 1st of last
--    month), billed_minor (income invoices issued since), open_minor (their open amount, not marked),
--    paid_minor (billed less open), last_sync_at (the SUMIT connection's last sync). Amounts are the
--    company's minor units; a company with two currencies sums them together (none does today).
--    Not in the export: due_on (the sync reads no due date) and the SUMIT document number (the sync
--    stores only the document's download link), so list_unpaid has no doc_number yet.
-- 6. public.link_invoice_payment and public.dismiss_invoice_match (owner only), each with an MCP
--    write: mcp_link_invoice_payment and mcp_dismiss_invoice_match, idempotency key, the write
--    bucket, and undo kinds invoice_link and invoice_dismiss. mcp_undo, mcp_writes and
--    mcp_refused are patched from their current definitions, with counted anchors, so changes
--    merged since stay. This file is one transaction.

begin;

set local lock_timeout = '5s';

-- or replace: an earlier migration may leave its copy in the session.
create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

create table public.invoice_payment_links (
  transaction_id uuid primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  bank_transaction_id uuid not null,
  linked_at timestamptz not null default now(),
  linked_by uuid,
  unique (company_id, bank_transaction_id),
  foreign key (company_id, transaction_id)
    references public.transactions (company_id, id)
    on delete cascade,
  foreign key (company_id, bank_transaction_id)
    references public.transactions (company_id, id)
    on delete cascade
);

comment on table public.invoice_payment_links is
  'FLOW-367. An open customer invoice the owner linked to the bank deposit that paid it. The invoice leaves list_unpaid; a deposit pays one invoice. link_invoice_payment adds a row, the mcp undo of invoice_link takes it away.';

create index invoice_payment_links_company_idx on public.invoice_payment_links (company_id);

create table public.invoice_match_dismissals (
  transaction_id uuid not null,
  bank_transaction_id uuid not null,
  company_id uuid not null references public.companies (id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  dismissed_by uuid,
  primary key (transaction_id, bank_transaction_id),
  foreign key (company_id, transaction_id)
    references public.transactions (company_id, id)
    on delete cascade,
  foreign key (company_id, bank_transaction_id)
    references public.transactions (company_id, id)
    on delete cascade
);

comment on table public.invoice_match_dismissals is
  'FLOW-367. A deposit the owner said is not the payment of one open invoice ("לא זה"): list_unpaid stops offering that deposit as that invoice''s match. dismiss_invoice_match adds a row.';

create index invoice_match_dismissals_company_idx on public.invoice_match_dismissals (company_id);
create index invoice_match_dismissals_bank_idx on public.invoice_match_dismissals (company_id, bank_transaction_id);

alter table public.invoice_payment_links enable row level security;
alter table public.invoice_match_dismissals enable row level security;

create policy invoice_payment_links_select on public.invoice_payment_links
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

create policy invoice_match_dismissals_select on public.invoice_match_dismissals
  for select to authenticated
  using (company_id = (select private.readable_company_id()));

-- Writes go through link_invoice_payment and dismiss_invoice_match only.
revoke all on public.invoice_payment_links from public, anon, authenticated;
grant select on public.invoice_payment_links to authenticated;
grant select, insert, update, delete on public.invoice_payment_links to service_role;

revoke all on public.invoice_match_dismissals from public, anon, authenticated;
grant select on public.invoice_match_dismissals to authenticated;
grant select, insert, update, delete on public.invoice_match_dismissals to service_role;

-- The open amount of one invoice, as list_unpaid works it out; null when it is not listed.
create function private.open_invoice_gross(p_company uuid, p_invoice uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select inv.amount_gross
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
    ), 0)
  from public.transactions inv
  where inv.id = p_invoice
    and inv.company_id = p_company
    and inv.removed_at is null
    and inv.doc_kind = 'invoice'
    and inv.direction = 'income'
    and inv.external_id is not null
    and not exists (
      select 1 from public.invoice_payment_links l
      where l.transaction_id = inv.id and l.company_id = inv.company_id
    );
$$;

-- The deposit that matches an open invoice: Mercury income of the same gross amount and customer,
-- dated on or after the invoice, not linked to another invoice and not dismissed for this one.
create function private.invoice_match_id(
  p_company uuid,
  p_invoice uuid,
  p_amount bigint,
  p_customer uuid,
  p_issued date
)
returns uuid
language sql
stable
set search_path = ''
as $$
  select b.id
  from public.transactions b
  where b.company_id = p_company
    and b.removed_at is null
    and b.source = 'mercury'
    and b.direction = 'income'
    and p_customer is not null
    and b.customer_id = p_customer
    and b.amount_gross = p_amount
    and b.doc_date >= p_issued
    and not exists (
      select 1 from public.invoice_payment_links l
      where l.company_id = p_company and l.bank_transaction_id = b.id
    )
    and not exists (
      select 1 from public.invoice_match_dismissals x
      where x.company_id = p_company and x.transaction_id = p_invoice and x.bank_transaction_id = b.id
    )
  order by b.doc_date, b.id
  limit 1;
$$;

revoke all on function private.open_invoice_gross(uuid, uuid) from public, anon;
grant execute on function private.open_invoice_gross(uuid, uuid) to authenticated, service_role;
revoke all on function private.invoice_match_id(uuid, uuid, bigint, uuid, date) from public, anon;
grant execute on function private.invoice_match_id(uuid, uuid, bigint, uuid, date) to authenticated, service_role;

-- list_unpaid: as in 20261012040000_unpaid_document_url.sql, plus days_open, match, and a linked
-- invoice leaves the list. A match is offered for an unmarked income invoice that is still open.
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
      inv.company_id,
      inv.description,
      inv.doc_date,
      inv.external_id,
      inv.customer_id,
      coalesce(inv.currency, 'ILS') as currency,
      inv.direction,
      inv.provider_meta->>'document_url' as document_url,
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
      and not exists (
        select 1 from public.invoice_payment_links l
        where l.transaction_id = inv.id and l.company_id = inv.company_id
      )
  ),
  matched as (
    select d.id, mt.bank_id
    from open_docs d
    left join lateral (
      select private.invoice_match_id(d.company_id, d.id, d.open_gross::bigint, d.customer_id, d.doc_date) as bank_id
      where d.direction = 'income' and d.open_gross > 0 and d.marked_at is null
    ) mt on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id,
    'description', d.description,
    'doc_date', d.doc_date,
    'currency', d.currency,
    'direction', d.direction,
    'project_name', d.project_name,
    'customer_name', d.customer_name,
    'open_gross_agorot', d.open_gross::bigint,
    'open_net_agorot', case
      when d.billed_gross = 0 then 0::bigint
      else (d.open_gross * d.amount_net) / d.billed_gross
    end,
    'marked_paid_at', d.marked_at,
    'document_url', d.document_url,
    'days_open', current_date - d.doc_date,
    'match', case
      when b.id is null then null
      else jsonb_build_object(
        'transaction_id', b.id,
        'date', b.doc_date,
        'account_name', acct.name,
        'raw_description', b.description,
        'amount_minor', b.amount_gross
      )
    end
  ) order by d.doc_date, d.description), '[]'::jsonb)
  from open_docs d
  left join matched mt on mt.id = d.id
  left join public.transactions b on b.id = mt.bank_id
  left join lateral (
    select nullif(btrim(regexp_replace(
      regexp_replace(label.value->>'label', '\s*(••|\*\*)[*0-9]*', '', 'g'),
      '[0-9]{5,}', '', 'g'
    )), '') as name
    from public.connector_connections cc
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(cc.account_labels) = 'array' then cc.account_labels else '[]'::jsonb end
    ) as label(value)
    where b.id is not null
      and cc.company_id = b.company_id
      and cc.provider::text = b.source::text
      and label.value->>'id' = b.provider_meta->>'account_id'
    limit 1
  ) acct on true
  where d.open_gross <> 0;
$$;

comment on function public.list_unpaid() is
  'Open SUMIT invoices for the Unpaid screen, oldest first, with the document''s download link (document_url), days_open, and the Mercury deposit that matches it (match) when one does. A linked invoice leaves the list. FLOW-335, FLOW-367.';

revoke all on function public.list_unpaid() from public, anon;
grant execute on function public.list_unpaid() to authenticated, service_role;

-- The bar's totals for the company (see the header). Read only, as list_unpaid.
create function public.unpaid_overview()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with cid as (
    select private.readable_company_id() as id
  ),
  since as (
    select (date_trunc('month', current_date) - interval '1 month')::date as issued_since
  ),
  issued as (
    select inv.amount_gross
    from public.transactions inv, since s
    where inv.company_id = (select id from cid)
      and inv.removed_at is null
      and inv.doc_kind = 'invoice'
      and inv.external_id is not null
      and inv.direction = 'income'
      and inv.doc_date >= s.issued_since
  ),
  open_now as (
    select (r->>'open_gross_agorot')::bigint as open_gross
    from jsonb_array_elements(public.list_unpaid()) r, since s
    where r->>'direction' = 'income'
      and r->'marked_paid_at' = 'null'::jsonb
      and (r->>'doc_date')::date >= s.issued_since
  ),
  totals as (
    select
      coalesce((select sum(amount_gross) from issued), 0)::bigint as billed,
      coalesce((select sum(open_gross) from open_now), 0)::bigint as open
  )
  select jsonb_build_object(
    'issued_since', (select issued_since from since),
    'billed_minor', t.billed,
    'open_minor', t.open,
    'paid_minor', t.billed - t.open,
    'last_sync_at', (
      select max(cc.last_sync_at)
      from public.connector_connections cc
      where cc.company_id = (select id from cid) and cc.provider::text = 'sumit'
    )
  )
  from totals t;
$$;

revoke all on function public.unpaid_overview() from public, anon;
grant execute on function public.unpaid_overview() to authenticated, service_role;

-- Owner only, as set_invoice_paid. Links an open income invoice to a Mercury deposit of the same
-- amount and customer, dated on or after the invoice. Refused when the deposit is linked already.
create function public.link_invoice_payment(p_invoice uuid, p_transaction uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  inv_customer uuid;
  inv_date date;
  open_amount bigint;
  bank_amount bigint;
  bank_customer uuid;
  bank_date date;
  bank_source public.txn_source;
  bank_direction public.txn_direction;
  linked timestamptz;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (
      select 1 from public.company_viewers v where v.user_id = (select auth.uid())
    ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_invoice is null or p_transaction is null then
    raise exception 'invoice not found';
  end if;

  -- The invoice row is the lock, so two links of one invoice queue.
  select t.customer_id, t.doc_date into inv_customer, inv_date
  from public.transactions t
  where t.id = p_invoice and t.company_id = cid and t.removed_at is null
    and t.doc_kind = 'invoice' and t.direction = 'income' and t.external_id is not null
  for update of t;
  if not found then
    raise exception 'invoice not found';
  end if;
  open_amount := private.open_invoice_gross(cid, p_invoice);
  if open_amount is null or open_amount = 0 then
    raise exception 'invoice not found';
  end if;

  -- The deposit row is the lock, so two links of one deposit queue.
  select b.amount_gross, b.customer_id, b.doc_date, b.source, b.direction
    into bank_amount, bank_customer, bank_date, bank_source, bank_direction
  from public.transactions b
  where b.id = p_transaction and b.company_id = cid and b.removed_at is null
  for update of b;
  if not found
    or bank_source <> 'mercury'
    or bank_direction <> 'income'
    or inv_customer is null
    or bank_customer is distinct from inv_customer
    or bank_amount <> open_amount
    or bank_date < inv_date
  then
    raise exception 'payment not matched';
  end if;
  if exists (
    select 1 from public.invoice_payment_links l
    where l.company_id = cid and l.bank_transaction_id = p_transaction
  ) then
    raise exception 'payment already linked';
  end if;

  insert into public.invoice_payment_links (transaction_id, company_id, bank_transaction_id, linked_by)
  values (p_invoice, cid, p_transaction, (select auth.uid()))
  returning invoice_payment_links.linked_at into linked;

  return jsonb_build_object(
    'id', p_invoice,
    'linked', true,
    'bank_transaction_id', p_transaction,
    'linked_at', linked
  );
end;
$$;

revoke all on function public.link_invoice_payment(uuid, uuid) from public, anon;
grant execute on function public.link_invoice_payment(uuid, uuid) to authenticated, service_role;

-- Owner only, as set_invoice_paid. Records that the deposit is not this invoice's payment. Dismissing
-- again keeps the first time. A deposit of the company is needed; the invoice must be listed.
create function public.dismiss_invoice_match(p_invoice uuid, p_transaction uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  open_amount bigint;
  dismissed timestamptz;
begin
  cid := private.current_company_id();
  if cid is null then
    if exists (
      select 1 from public.company_viewers v where v.user_id = (select auth.uid())
    ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    raise exception 'no company';
  end if;
  if p_invoice is null or p_transaction is null then
    raise exception 'invoice not found';
  end if;

  perform 1
  from public.transactions t
  where t.id = p_invoice and t.company_id = cid and t.removed_at is null
  for update of t;
  open_amount := private.open_invoice_gross(cid, p_invoice);
  if open_amount is null or open_amount = 0 then
    raise exception 'invoice not found';
  end if;
  if not exists (
    select 1 from public.transactions b
    where b.id = p_transaction and b.company_id = cid and b.removed_at is null and b.direction = 'income'
  ) then
    raise exception 'payment not matched';
  end if;

  insert into public.invoice_match_dismissals (transaction_id, bank_transaction_id, company_id, dismissed_by)
  values (p_invoice, p_transaction, cid, (select auth.uid()))
  on conflict (transaction_id, bank_transaction_id) do nothing;

  select x.dismissed_at into dismissed
  from public.invoice_match_dismissals x
  where x.transaction_id = p_invoice and x.bank_transaction_id = p_transaction and x.company_id = cid;

  return jsonb_build_object(
    'id', p_invoice,
    'bank_transaction_id', p_transaction,
    'dismissed', true,
    'dismissed_at', dismissed
  );
end;
$$;

revoke all on function public.dismiss_invoice_match(uuid, uuid) from public, anon;
grant execute on function public.dismiss_invoice_match(uuid, uuid) to authenticated, service_role;

-- One link. p_transaction is the deposit; the invoice is the document the write is about.
create function public.mcp_link_invoice_payment(
  p_idempotency_key text,
  p_invoice_id uuid,
  p_transaction_id uuid
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
  written jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_invoice_id is null
    or p_transaction_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'invoice_link|' || p_invoice_id::text || '|' || p_transaction_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  begin
    written := public.link_invoice_payment(p_invoice_id, p_transaction_id);
    -- clock_timestamp, so two writes to one invoice in one transaction still undo newest first.
    insert into private.mcp_writes (token_id, user_id, transaction_id, kind, prior, created_at)
    values (
      token, auth.uid(), p_invoice_id, 'invoice_link',
      jsonb_build_object(
        'before', null,
        'written', p_transaction_id,
        'written_at', written->'linked_at'
      ),
      clock_timestamp()
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'transaction_id', p_invoice_id,
        'bank_transaction_id', p_transaction_id,
        'linked', true,
        'linked_at', written->'linked_at',
        'undo_kind', 'invoice_link',
        'id', p_invoice_id
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

revoke all on function public.mcp_link_invoice_payment(text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_link_invoice_payment(text, uuid, uuid) to authenticated;

-- One dismissal. The invoice row is locked before the earlier dismissal is read, as in
-- mcp_set_invoice_paid, so the undo knows whether this write added the row.
create function public.mcp_dismiss_invoice_match(
  p_idempotency_key text,
  p_invoice_id uuid,
  p_transaction_id uuid
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
  before_at timestamptz;
  before_by uuid;
  written jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_invoice_id is null
    or p_transaction_id is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'invoice_dismiss|' || p_invoice_id::text || '|' || p_transaction_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  cid := private.current_company_id();
  begin
    perform 1
    from public.transactions t
    where t.id = p_invoice_id and t.company_id = cid and t.removed_at is null
    for update of t;
    select x.dismissed_at, x.dismissed_by into before_at, before_by
    from public.invoice_match_dismissals x
    where x.transaction_id = p_invoice_id and x.bank_transaction_id = p_transaction_id and x.company_id = cid;

    written := public.dismiss_invoice_match(p_invoice_id, p_transaction_id);
    insert into private.mcp_writes (token_id, user_id, transaction_id, kind, prior, created_at)
    values (
      token, auth.uid(), p_invoice_id, 'invoice_dismiss',
      jsonb_build_object(
        'before', before_at,
        'before_by', before_by,
        'written', p_transaction_id,
        'written_at', written->'dismissed_at'
      ),
      clock_timestamp()
    );
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'transaction_id', p_invoice_id,
        'bank_transaction_id', p_transaction_id,
        'dismissed', true,
        'dismissed_at', written->'dismissed_at',
        'undo_kind', 'invoice_dismiss',
        'id', p_invoice_id
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

revoke all on function public.mcp_dismiss_invoice_match(text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_dismiss_invoice_match(text, uuid, uuid) to authenticated;

-- Patches to the MCP write plumbing, from the current definitions.
do $patch$
declare
  def text;
  anchor text;
begin
  -- private.mcp_writes: the two kinds.
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'project_delete'::text]$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, $n$'project_delete'::text, 'invoice_link'::text, 'invoice_dismiss'::text]$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if pg_temp.anchor_count(def, $a$kind = 'invoice_paid'::text$a$) <> 1 or right(def, 2) <> '))' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'invoice_link'::text) AND (transaction_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'written'::text) AND (prior ? 'written_at'::text)) OR ((kind = 'invoice_dismiss'::text) AND (transaction_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'written'::text) AND (prior ? 'written_at'::text)))$n$;

  -- private.mcp_refused: the two refusals.
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  anchor := $a$'invoice not found'$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  execute replace(def, anchor, anchor || $n$,
        -- FLOW-367.
        'payment not matched', 'payment already linked'$n$);

  -- public.mcp_undo: kinds, lookup, declarations and the two branches.
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);

  anchor := $a$'loan_index', 'index_rate', 'project_update', 'project_delete'$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo kinds are not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$, 'invoice_link', 'invoice_dismiss'$n$);

  anchor := $a$or (p_kind in ('project_update', 'project_delete') and w.kind = p_kind and w.project_id = p_id)$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo lookup is not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
        or (p_kind in ('invoice_link', 'invoice_dismiss') and w.kind = p_kind and w.transaction_id = p_id)$n$);

  anchor := $a$  cur_project_row public.projects%rowtype;$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo declarations are not the expected definition';
  end if;
  def := replace(def, anchor, anchor || $n$
  cur_linked timestamptz;
  cur_dismissed timestamptz;$n$);

  anchor := $a$    elsif p_kind = 'recurring_match' then$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_undo recurring_match branch is not the expected definition';
  end if;
  def := replace(def, anchor, $n$    elsif p_kind = 'invoice_link' then
      -- The invoice row is the lock, as in set_invoice_paid.
      perform 1
      from public.transactions t
      where t.id = p_id and t.company_id = cid and t.removed_at is null
      for update of t;
      cur_found := found;
      select l.linked_at into cur_linked
      from public.invoice_payment_links l
      where l.transaction_id = p_id and l.company_id = cid
        and l.bank_transaction_id = (rec.prior->>'written')::uuid;
      if not cur_found then
        response := private.mcp_error('not_found', 'not found');
      elsif cur_linked is distinct from (rec.prior->>'written_at')::timestamptz then
        response := private.mcp_error('conflict', 'conflict');
      else
        delete from public.invoice_payment_links l
        where l.transaction_id = p_id and l.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
    elsif p_kind = 'invoice_dismiss' then
      perform 1
      from public.transactions t
      where t.id = p_id and t.company_id = cid and t.removed_at is null
      for update of t;
      cur_found := found;
      select x.dismissed_at into cur_dismissed
      from public.invoice_match_dismissals x
      where x.transaction_id = p_id and x.company_id = cid
        and x.bank_transaction_id = (rec.prior->>'written')::uuid;
      if not cur_found then
        response := private.mcp_error('not_found', 'not found');
      elsif cur_dismissed is distinct from (rec.prior->>'written_at')::timestamptz then
        response := private.mcp_error('conflict', 'conflict');
      else
        -- A dismissal that was there before stays; only one this write added is taken away.
        if rec.prior->>'before' is null then
          delete from public.invoice_match_dismissals x
          where x.transaction_id = p_id and x.company_id = cid
            and x.bank_transaction_id = (rec.prior->>'written')::uuid;
        end if;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
$n$ || anchor);

  execute def;
end
$patch$;

drop function pg_temp.anchor_count(text, text);

commit;
