-- FLOW-369 server: the add (+) sheet's writes. A cash or cheque line, and a document attached to an
-- existing line without making a second line.
-- - public.transactions.attachments: the documents attached to a line, a JSON array of
--   { name, mime, bytes, sha256, attached_at } (at most 10). No file is stored: a document is its
--   metadata, and the receipt reading (FLOW-306) is not built.
-- - public.create_manual_line: a manual line with a project, a category and a method (cash or
--   cheque, with the cheque number). It is public.create_manual_entry with the payee as the
--   description and the method in provider_meta. The app calls it directly.
-- - public.attach_line_document / detach_line_document: add or remove one document on a line.
-- - public.receipt_match: the bank line a receipt matches (payee, amount, within 3 days), or none.
-- - MCP: mcp_create_manual_entry (undo kind manual_entry: deletes the line while it is unchanged)
--   and mcp_attach_document (undo kind document_attach: restores the list while it is unchanged).
--   Decision 0080 rules apply: idempotency key, write rate limit (in the handler), undo.
-- The undo function and the mcp_writes constraints are patched from their current definitions,
-- with counted anchors, as in 20261010230000_line_split_undo_check.sql.

begin;

set local lock_timeout = '5s';

create function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

alter table public.transactions
  add column attachments jsonb not null default '[]'::jsonb,
  add constraint transactions_attachments_shape
    check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10);

comment on column public.transactions.attachments is
  'FLOW-369: the documents attached to a line (name, mime, bytes, sha256, attached_at), at most 10. Metadata only: no file is stored yet (FLOW-306).';

-- A manual line from the add sheet or MCP. The payee is the description; method (cash or cheque)
-- and the cheque number go in provider_meta. The category is required and must be of the line's
-- direction. The project is optional: none files the line as overhead (the sheet's בלי פרויקט).
create function public.create_manual_line(
  p_direction text,
  p_amount_minor bigint,
  p_doc_date date,
  p_payee text,
  p_project_id uuid,
  p_category_id uuid,
  p_method text,
  p_cheque_number text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  payee text := btrim(coalesce(p_payee, ''));
  cheque text := btrim(coalesce(p_cheque_number, ''));
  rid uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_direction not in ('income', 'expense') then
    raise exception 'direction must be income or expense';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 or p_amount_minor > 999999999999 then
    raise exception 'amount must be above zero';
  end if;
  if p_doc_date is null then
    raise exception 'date is required';
  end if;
  if char_length(payee) < 2 or char_length(payee) > 120 or private.name_has_hidden_char(payee) then
    raise exception 'payee is invalid';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects p where p.id = p_project_id and p.company_id = cid
  ) then
    raise exception 'project not found';
  end if;
  if p_category_id is null or not exists (
    select 1 from public.categories c
    where c.id = p_category_id and c.company_id = cid and c.kind::text = p_direction
  ) then
    raise exception 'category not found';
  end if;
  if p_method not in ('cash', 'cheque') then
    raise exception 'method must be cash or cheque';
  end if;
  if p_method = 'cheque' and cheque !~ '^[0-9A-Za-z-]{1,20}$' then
    raise exception 'cheque number is invalid';
  end if;

  rid := public.create_manual_entry(p_direction, 'receipt', p_amount_minor, p_doc_date, payee,
    p_project_id, p_category_id, false);
  update public.transactions t
  set provider_meta = jsonb_strip_nulls(jsonb_build_object(
    'method', p_method,
    'cheque_number', case when p_method = 'cheque' then cheque end
  ))
  where t.id = rid and t.company_id = cid;
  return rid;
end;
$$;

revoke all on function public.create_manual_line(text, bigint, date, text, uuid, uuid, text, text)
  from public, anon, service_role;
grant execute on function public.create_manual_line(text, bigint, date, text, uuid, uuid, text, text)
  to authenticated;

-- One document on a line. Returns before and after (the whole list) for undo. A document with the
-- same sha256 is refused, so a second attach of one file adds nothing.
create function public.attach_line_document(p_transaction_id uuid, p_document jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  name text;
  mime text;
  sha text;
  before jsonb;
  item jsonb;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  if p_document is null or jsonb_typeof(p_document) <> 'object' then
    raise exception 'document is required';
  end if;
  name := btrim(coalesce(p_document->>'name', ''));
  mime := p_document->>'mime';
  sha := lower(coalesce(p_document->>'sha256', ''));
  if char_length(name) < 1 or char_length(name) > 200 or private.name_has_hidden_char(name) then
    raise exception 'document name is invalid';
  end if;
  if mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf') then
    raise exception 'document type is not allowed';
  end if;
  if jsonb_typeof(p_document->'bytes') is distinct from 'number'
    or (p_document->>'bytes')::numeric % 1 <> 0
    or (p_document->>'bytes')::numeric < 1
    or (p_document->>'bytes')::numeric > 26214400
  then
    raise exception 'document size is invalid';
  end if;
  if sha !~ '^[0-9a-f]{64}$' then
    raise exception 'document sha256 is invalid';
  end if;

  select t.attachments into before
  from public.transactions t
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;
  if exists (select 1 from jsonb_array_elements(before) a where a->>'sha256' = sha) then
    raise exception 'document already attached';
  end if;
  if jsonb_array_length(before) >= 10 then
    raise exception 'too many documents';
  end if;

  item := jsonb_build_object(
    'name', name,
    'mime', mime,
    'bytes', (p_document->>'bytes')::bigint,
    'sha256', sha,
    'attached_at', clock_timestamp()
  );
  update public.transactions t
  set attachments = before || jsonb_build_array(item),
      updated_at = now()
  where t.id = p_transaction_id and t.company_id = cid;

  return jsonb_build_object('before', before, 'after', before || jsonb_build_array(item));
end;
$$;

revoke all on function public.attach_line_document(uuid, jsonb) from public, anon, service_role;
grant execute on function public.attach_line_document(uuid, jsonb) to authenticated;

-- The app's undo of an attach: removes the document with that sha256 from the line.
create function public.detach_line_document(p_transaction_id uuid, p_sha256 text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
begin
  cid := private.current_company_id();
  if cid is null then
    raise exception 'no company';
  end if;
  update public.transactions t
  set attachments = coalesce((
        select jsonb_agg(a.value order by a.ordinality)
        from jsonb_array_elements(t.attachments) with ordinality a(value, ordinality)
        where a.value->>'sha256' <> lower(p_sha256)
      ), '[]'::jsonb),
      updated_at = now()
  where t.id = p_transaction_id and t.company_id = cid and t.removed_at is null;
  if not found then
    raise exception 'transaction not found';
  end if;
end;
$$;

revoke all on function public.detach_line_document(uuid, text) from public, anon, service_role;
grant execute on function public.detach_line_document(uuid, text) to authenticated;

-- The bank line a receipt matches: an expense from the bank or a provider (not a manual line) of
-- the same amount, dated within three days, whose description holds the payee or sits in it. The
-- nearest by date. Empty when none.
create function public.receipt_match(p_amount_minor bigint, p_doc_date date, p_payee text)
returns table (id uuid, description text, doc_date date, amount_minor bigint, source text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.description, t.doc_date, -t.amount_gross, t.source::text
  from public.transactions t
  where t.company_id = private.current_company_id()
    and t.removed_at is null
    and t.direction = 'expense'
    and t.source <> 'manual'
    and -t.amount_gross = p_amount_minor
    and t.doc_date between p_doc_date - 3 and p_doc_date + 3
    and char_length(btrim(coalesce(p_payee, ''))) >= 2
    and char_length(t.description) >= 2
    and (
      position(lower(btrim(p_payee)) in lower(t.description)) > 0
      or position(lower(t.description) in lower(btrim(p_payee))) > 0
    )
  order by abs(t.doc_date - p_doc_date), t.id
  limit 1;
$$;

revoke all on function public.receipt_match(bigint, date, text) from public, anon, service_role;
grant execute on function public.receipt_match(bigint, date, text) to authenticated;

-- MCP create_manual_entry: the same write with an idempotency key and an undo row.
create function public.mcp_create_manual_entry(
  p_idempotency_key text,
  p_direction text,
  p_amount_minor bigint,
  p_doc_date date,
  p_payee text,
  p_project_id uuid,
  p_category_id uuid,
  p_method text,
  p_cheque_number text
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
  rid uuid;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_direction is null
    or p_amount_minor is null
    or p_doc_date is null
    or p_payee is null
    or p_category_id is null
    or p_method is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'manual_entry|' || p_direction || '|' || p_amount_minor::text || '|' || p_doc_date::text
    || '|' || btrim(p_payee) || '|' || coalesce(p_project_id::text, '') || '|' || p_category_id::text
    || '|' || p_method || '|' || coalesce(btrim(p_cheque_number), '');
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  response := private.mcp_error('refused', 'The write was refused.');
  begin
    rid := public.create_manual_line(p_direction, p_amount_minor, p_doc_date, p_payee, p_project_id,
      p_category_id, p_method, p_cheque_number);
    insert into private.mcp_writes (token_id, user_id, kind, transaction_id, prior)
    values (token, auth.uid(), 'manual_entry', rid, jsonb_build_object('after', (
      select jsonb_build_object(
        'project_id', t.project_id, 'category_id', t.category_id,
        'amount_gross', t.amount_gross, 'doc_date', t.doc_date
      )
      from public.transactions t
      where t.id = rid
    )));
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'id', rid,
        'direction', p_direction,
        'amount_minor', p_amount_minor,
        'doc_date', p_doc_date,
        'undo_kind', 'manual_entry'
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

revoke all on function public.mcp_create_manual_entry(text, text, bigint, date, text, uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.mcp_create_manual_entry(text, text, bigint, date, text, uuid, uuid, text, text)
  to authenticated;

-- MCP attach_document: one document on an existing line. No line is made.
create function public.mcp_attach_document(p_idempotency_key text, p_transaction_id uuid, p_document jsonb)
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
  step jsonb;
  response jsonb;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_transaction_id is null
    or p_document is null
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'document_attach|' || p_transaction_id::text || '|' || lower(coalesce(p_document->>'sha256', ''));
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  response := private.mcp_error('refused', 'The write was refused.');
  begin
    step := public.attach_line_document(p_transaction_id, p_document);
    insert into private.mcp_writes (token_id, user_id, kind, transaction_id, prior)
    values (token, auth.uid(), 'document_attach', p_transaction_id,
      jsonb_build_object('before', step->'before', 'after', step->'after'));
    response := jsonb_build_object(
      'ok', true,
      'data', jsonb_build_object(
        'id', p_transaction_id,
        'documents', jsonb_array_length(step->'after'),
        'undo_kind', 'document_attach'
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

revoke all on function public.mcp_attach_document(text, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.mcp_attach_document(text, uuid, jsonb) to authenticated;

-- private.mcp_writes: the two kinds, and what each undo reads.
do $kinds$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'project_delete'::text])$a$;
  if position(anchor in def) = 0 or position(anchor in substr(def, position(anchor in def) + 1)) > 0 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, $n$'project_delete'::text, 'manual_entry'::text, 'document_attach'::text])$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' or position($a$(kind = 'project_delete'::text)$a$ in def) = 0 then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = 'manual_entry'::text) AND (transaction_id IS NOT NULL) AND (prior ? 'after'::text)) OR ((kind = 'document_attach'::text) AND (transaction_id IS NOT NULL) AND (prior ? 'before'::text) AND (prior ? 'after'::text))))$n$;
end
$kinds$;

-- mcp_undo: the two kinds in the allowed list and the lookup, and their branches.
do $undo$
declare
  def text;
  a_kinds constant text := $a$'project_update', 'project_delete'
    )
  then$a$;
  a_lookup constant text := $a$        or (p_kind = 'index_rate' and w.kind = 'index_rate' and w.id = p_id)
      )$a$;
  a_branch constant text := $a$    elsif p_kind = 'project_update' then$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_kinds) <> 1 or pg_temp.anchor_count(def, a_lookup) <> 1
    or pg_temp.anchor_count(def, a_branch) <> 1 then
    raise exception 'mcp_undo is not the expected definition';
  end if;

  def := replace(def, a_kinds, $n$'project_update', 'project_delete', 'manual_entry', 'document_attach'
    )
  then$n$);
  def := replace(def, a_lookup, $n$        or (p_kind = 'index_rate' and w.kind = 'index_rate' and w.id = p_id)
        or (p_kind = 'manual_entry' and w.kind = 'manual_entry' and w.transaction_id = p_id)
        or (p_kind = 'document_attach' and w.kind = 'document_attach' and w.transaction_id = p_id)
      )$n$);
  def := replace(def, a_branch, $n$    elsif p_kind = 'manual_entry' then
      -- FLOW-369. The line is deleted only while it is the one the write made: the same project,
      -- category, amount and date. A line with a split or a loan on it fails the delete (conflict).
      perform 1 from public.transactions t
      where t.id = rec.transaction_id and t.company_id = cid and t.removed_at is null
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      elsif (
        select jsonb_build_object(
          'project_id', t.project_id, 'category_id', t.category_id,
          'amount_gross', t.amount_gross, 'doc_date', t.doc_date
        )
        from public.transactions t
        where t.id = rec.transaction_id and t.company_id = cid
      ) is distinct from rec.prior->'after' then
        response := private.mcp_error('conflict', 'conflict');
      else
        begin
          delete from public.transactions t
          where t.id = rec.transaction_id and t.company_id = cid and t.source = 'manual';
          update private.mcp_writes
          set undone_at = clock_timestamp()
          where id = rec.id and user_id = auth.uid() and undone_at is null;
          response := jsonb_build_object(
            'ok', true,
            'data', jsonb_build_object('kind', p_kind, 'id', p_id)
          );
        exception
          when sqlstate '23503' then
            response := private.mcp_error('conflict', 'conflict');
        end;
      end if;
    elsif p_kind = 'document_attach' then
      -- FLOW-369. The list goes back to what it was, while it is still the list the write made.
      perform 1 from public.transactions t
      where t.id = p_id and t.company_id = cid and t.removed_at is null
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      elsif (
        select t.attachments from public.transactions t where t.id = p_id and t.company_id = cid
      ) is distinct from rec.prior->'after' then
        response := private.mcp_error('conflict', 'conflict');
      else
        update public.transactions t
        set attachments = rec.prior->'before', updated_at = now()
        where t.id = p_id and t.company_id = cid;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object(
          'ok', true,
          'data', jsonb_build_object('kind', p_kind, 'id', p_id)
        );
      end if;
$n$ || a_branch);
  execute def;
end
$undo$;

-- private.mcp_refused: the new refusal messages, so a client sees them and not "The write was refused."
do $refused$
declare
  def text;
  a_last constant text := $a$        'member not found'
      ) then p_message$a$;
begin
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  if pg_temp.anchor_count(def, a_last) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  def := replace(def, a_last, $n$        'member not found',
        -- FLOW-369 (manual entry and documents).
        'direction must be income or expense',
        'amount must be above zero',
        'date is required',
        'payee is invalid',
        'method must be cash or cheque',
        'cheque number is invalid',
        'document is required',
        'document name is invalid',
        'document type is not allowed',
        'document size is invalid',
        'document sha256 is invalid',
        'document already attached',
        'too many documents'
      ) then p_message$n$);
  execute def;
end
$refused$;

drop function pg_temp.anchor_count(text, text);

commit;
