-- FLOW-174 (MCP/data agent request, decision 0234): correct a posted journal entry in place, with its
-- history.
-- 1. public.journal_entries gains version (1 when booked, one more per edit), updated_by, updated_at
--    and reason (why the current version was written). public.journal_entry_versions keeps every
--    version an edit replaced: its legs, date, currency, description, reference and P&L effect, who
--    wrote it and when, why, and who replaced it and when.
-- 2. private.journal_entry_apply re-books an entry in place: private.post_journal_entry books the new
--    version as a scratch line (create_journal_entry's rules, refusals and self-check), whose part legs,
--    counter legs and header then move onto the entry's own line, and the scratch line is deleted. The
--    entry keeps its id, notes, files and thread. journal_entry_line_fixed lets that one write through
--    (flow.journal_entry_edit); every other change of a posted entry is still refused.
-- 3. MCP update_journal_entry (owner or editor, any member's entry): expected_version must be the
--    current version ('entry changed'); the line must be a journal entry ('not a journal entry'), not a
--    prepaid schedule's; neither the old nor the new date may be on or before the books-closed date.
--    Logged in private.mcp_writes as journal_entry_update; undo puts the version before back while the
--    entry still reads as the edit left it, and records that as a version too.
-- 4. MCP get_journal_entry_history (any member) reads the versions; get_line_legs, get_expense
--    (get_transaction) and create_journal_entry give the entry's version.
-- mcp_refused, the mcp_writes kind and target checks, mcp_undo and the reads are patched in place with
-- counted anchors, as 20261028102302_prepaid_schedules.sql does.
-- CLI 2.118.0 runs each statement on its own. This file is one transaction.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

-- ---------------------------------------------------------------------------
-- 1. The version and the history.
-- ---------------------------------------------------------------------------
alter table public.journal_entries
  add column version integer not null default 1 check (version >= 1),
  add column updated_by uuid references auth.users (id) on delete set null,
  add column updated_at timestamptz,
  add column reason text check (reason is null or char_length(reason) between 1 and 200);

comment on column public.journal_entries.version is
  'FLOW-174: the entry''s version, 1 when booked and one more per update_journal_entry or its undo. update_journal_entry takes it as expected_version.';
comment on column public.journal_entries.reason is
  'FLOW-174: why the current version was written (null for the version booked).';

create table public.journal_entry_versions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid not null references public.journal_entries (transaction_id) on delete cascade,
  version integer not null check (version >= 1),
  doc_date date not null,
  currency text not null,
  description text not null,
  reference text,
  legs jsonb not null check (jsonb_typeof(legs) = 'array'),
  pnl_minor bigint not null,
  written_by uuid references auth.users (id) on delete set null,
  written_at timestamptz not null,
  reason text,
  replaced_by uuid references auth.users (id) on delete set null,
  replaced_at timestamptz not null default now(),
  replaced_reason text not null check (char_length(replaced_reason) between 1 and 200),
  constraint journal_entry_versions_one unique (transaction_id, version)
);

comment on table public.journal_entry_versions is
  'FLOW-174: a version of a journal entry that an edit replaced: its legs ([{account_id, project_id, amount_minor}], signed), date, description, reference, who wrote it and why, and who replaced it, when and why. Decision 0234.';

create index journal_entry_versions_company_idx on public.journal_entry_versions (company_id, transaction_id);
create index journal_entry_versions_written_by_idx on public.journal_entry_versions (written_by) where written_by is not null;
create index journal_entry_versions_replaced_by_idx on public.journal_entry_versions (replaced_by) where replaced_by is not null;
create index journal_entries_updated_by_idx on public.journal_entries (updated_by) where updated_by is not null;

alter table public.journal_entry_versions enable row level security;
create policy journal_entry_versions_select on public.journal_entry_versions
  for select to authenticated
  using (company_id = (select private.readable_company_id()));
revoke all on table public.journal_entry_versions from anon, authenticated;
grant select on table public.journal_entry_versions to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The entry as it reads now, and re-booking it in place.
-- ---------------------------------------------------------------------------
-- The entry's legs on the books, as create_journal_entry takes them: the P&L legs on their category
-- accounts and the balance-sheet legs, signed, in posting order.
create function private.journal_entry_snapshot(p_company uuid, p_txn uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', j.version,
    'doc_date', t.doc_date,
    'currency', t.currency,
    'description', t.description,
    'reference', j.reference,
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'account_id', l.account_id, 'project_id', l.project_id, 'amount_minor', l.amount_minor
        ) order by l.ordinal)
      from public.legs l
      where l.company_id = p_company and l.transaction_id = t.id and not l.draft
        and l.leg_kind in ('item', 'journal') and l.amount_minor <> 0
    ), '[]'::jsonb),
    'pnl_minor', coalesce((
      select -sum(l.amount_minor)
      from public.legs l
      join public.accounts a on a.id = l.account_id and a.company_id = l.company_id
      where l.company_id = p_company and l.transaction_id = t.id and not l.draft
        and a.type in ('income', 'expense')
    ), 0)::bigint,
    'written_by', coalesce(j.updated_by, j.created_by),
    'written_at', coalesce(j.updated_at, j.created_at),
    'reason', j.reason
  )
  from public.transactions t
  join public.journal_entries j on j.transaction_id = t.id and j.company_id = t.company_id
  where t.id = p_txn and t.company_id = p_company;
$$;

revoke all on function private.journal_entry_snapshot(uuid, uuid) from public, anon, authenticated, service_role;

-- What an undo compares: the line's fingerprint (amount, date, legs) with its description and reference.
create function private.journal_entry_print(p_company uuid, p_txn uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.booked_line_print(p_company, p_txn)
    || jsonb_build_object('description', t.description, 'reference', j.reference)
  from public.transactions t
  join public.journal_entries j on j.transaction_id = t.id and j.company_id = t.company_id
  where t.id = p_txn and t.company_id = p_company;
$$;

revoke all on function private.journal_entry_print(uuid, uuid) from public, anon, authenticated, service_role;

-- Re-books p_txn, a journal entry, as p_legs with the given header. The caller holds the line, has
-- checked it may change, and writes the history. Raises what post_journal_entry raises.
create function private.journal_entry_apply(
  p_company uuid,
  p_txn uuid,
  p_doc_date date,
  p_currency text,
  p_description text,
  p_reference text,
  p_legs jsonb,
  out pnl_minor bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  scratch uuid;
  src public.transactions%rowtype;
begin
  -- The new version through create_journal_entry's own core, on a scratch line.
  select j.line_id, j.pnl_minor into scratch, pnl_minor
  from private.post_journal_entry(p_company, p_doc_date, p_currency, p_description, p_reference, p_legs) j;
  select * into src from public.transactions t where t.id = scratch and t.company_id = p_company;

  -- Its parts and balance-sheet legs replace the entry's, and its header becomes the entry's.
  perform set_config('flow.journal_entry_edit', 'on', true);
  delete from public.legs l
  where l.company_id = p_company and l.transaction_id = p_txn and l.split_part;
  delete from public.journal_counter_legs c
  where c.company_id = p_company and c.transaction_id = p_txn;
  update public.legs l set transaction_id = p_txn
  where l.company_id = p_company and l.transaction_id = scratch and l.split_part;
  update public.journal_counter_legs c set transaction_id = p_txn
  where c.company_id = p_company and c.transaction_id = scratch;
  update public.transactions t
  set direction = src.direction,
      doc_kind = src.doc_kind,
      amount_gross = src.amount_gross,
      amount_net = src.amount_net,
      amount_original = src.amount_original,
      vat_amount = src.vat_amount,
      category_id = src.category_id,
      category_suggested = src.category_suggested,
      project_id = src.project_id,
      pnl_role = src.pnl_role,
      in_pnl_override = src.in_pnl_override,
      in_cash_override = src.in_cash_override,
      doc_date = src.doc_date,
      cash_date = src.cash_date,
      description = src.description,
      user_assigned = src.user_assigned
  where t.id = p_txn and t.company_id = p_company;
  update public.journal_entries j
  set reference = nullif(btrim(p_reference), '')
  where j.transaction_id = p_txn and j.company_id = p_company;
  -- The scratch line goes, with its entry and its remaining legs.
  delete from public.transactions t where t.id = scratch and t.company_id = p_company;
  perform set_config('flow.journal_entry_edit', '', true);

  perform private.post_lines(p_company, array[p_txn]);
end;
$$;

revoke all on function private.journal_entry_apply(uuid, uuid, date, text, text, text, jsonb) from public, anon, authenticated, service_role;

comment on function private.journal_entry_apply(uuid, uuid, date, text, text, text, jsonb) is
  'FLOW-174: re-books a journal entry in place with create_journal_entry''s rules (post_journal_entry on a scratch line whose legs and header move onto the entry). Decision 0234.';

-- The one write that may change a posted entry's line.
create or replace function private.journal_entry_line_fixed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.journal_entries j where j.transaction_id = old.id)
    and coalesce(current_setting('flow.journal_entry_edit', true), '') <> 'on'
  then
    raise exception 'journal entry is fixed' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Holds the entry and checks it may change: a journal entry of this company, not a prepaid schedule's,
-- and dated after the books-closed date (old and new date). Raises the refusal.
create function private.journal_entry_editable(p_company uuid, p_txn uuid, p_new_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  line public.transactions%rowtype;
  closed date;
begin
  select * into line from public.transactions t
  where t.id = p_txn and t.company_id = p_company and t.removed_at is null
  for update;
  if not found then
    raise exception 'transaction not found';
  end if;
  if not exists (select 1 from public.journal_entries j where j.transaction_id = p_txn and j.company_id = p_company) then
    raise exception 'not a journal entry';
  end if;
  if exists (select 1 from public.prepaid_rows r where r.company_id = p_company and r.entry_id = p_txn) then
    raise exception 'the entry belongs to a prepaid schedule';
  end if;
  select c.books_closed_through into closed from public.companies c where c.id = p_company;
  if closed is not null and (line.doc_date <= closed or p_new_date <= closed) then
    raise exception '%', private.prepaid_closed_reason(closed);
  end if;
end;
$$;

revoke all on function private.journal_entry_editable(uuid, uuid, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. update_journal_entry.
-- ---------------------------------------------------------------------------
create function public.mcp_update_journal_entry(
  p_idempotency_key text,
  p_journal_entry_id uuid,
  p_expected_version text,
  p_reason text,
  p_doc_date date default null,
  p_description text default null,
  p_set_reference boolean default false,
  p_reference text default null,
  p_legs jsonb default null
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
  new_date date;
  new_description text;
  new_reference text;
  new_legs jsonb;
  pnl bigint;
  new_version integer;
begin
  if p_idempotency_key is null
    or char_length(p_idempotency_key) < 1
    or char_length(p_idempotency_key) > 128
    or p_journal_entry_id is null
    or p_expected_version is null or p_expected_version !~ '^[1-9][0-9]{0,8}$'
    or p_reason is null or char_length(btrim(p_reason)) not between 1 and 200
    or (p_description is not null and char_length(btrim(p_description)) not between 1 and 120)
    or p_set_reference is null
    or (p_reference is not null and (not p_set_reference or char_length(btrim(p_reference)) not between 1 and 60))
    or (p_legs is not null and (jsonb_typeof(p_legs) <> 'array' or jsonb_array_length(p_legs) not between 2 and 50))
  then
    return private.mcp_error('validation', 'validation');
  end if;

  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'journal_entry_update|' || p_journal_entry_id::text || '|' || p_expected_version || '|' || btrim(p_reason)
    || '|' || coalesce(p_doc_date::text, '') || '|' || coalesce(btrim(p_description), '')
    || '|' || p_set_reference::text || '|' || coalesce(btrim(p_reference), '') || '|' || coalesce(p_legs::text, '');
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
    -- Held first: the line, then (in post_journal_entry) the accounts its legs name.
    perform private.journal_entry_editable(cid, p_journal_entry_id, coalesce(p_doc_date, (
      select t.doc_date from public.transactions t where t.id = p_journal_entry_id and t.company_id = cid)));
    before := private.journal_entry_snapshot(cid, p_journal_entry_id);
    if (before->>'version') is distinct from p_expected_version then
      raise exception 'entry changed';
    end if;

    new_date := coalesce(p_doc_date, (before->>'doc_date')::date);
    new_description := coalesce(btrim(p_description), before->>'description');
    new_reference := case when p_set_reference then nullif(btrim(p_reference), '') else before->>'reference' end;
    new_legs := coalesce(p_legs, before->'legs');

    select a.pnl_minor into pnl
    from private.journal_entry_apply(cid, p_journal_entry_id, new_date, before->>'currency', new_description,
      new_reference, new_legs) a;

    insert into public.journal_entry_versions (
      company_id, transaction_id, version, doc_date, currency, description, reference, legs, pnl_minor,
      written_by, written_at, reason, replaced_by, replaced_reason
    )
    values (
      cid, p_journal_entry_id, (before->>'version')::integer, (before->>'doc_date')::date, before->>'currency',
      before->>'description', before->>'reference', before->'legs', (before->>'pnl_minor')::bigint,
      (before->>'written_by')::uuid, (before->>'written_at')::timestamptz, before->>'reason', auth.uid(), btrim(p_reason)
    );
    update public.journal_entries j
    set version = j.version + 1, updated_by = auth.uid(), updated_at = now(), reason = btrim(p_reason)
    where j.transaction_id = p_journal_entry_id and j.company_id = cid
    returning j.version into new_version;

    insert into private.mcp_writes (token_id, user_id, company_id, kind, transaction_id, prior)
    values (token, auth.uid(), cid, 'journal_entry_update', p_journal_entry_id, jsonb_build_object(
      'before', before,
      'after', private.journal_entry_print(cid, p_journal_entry_id),
      'version', new_version,
      'reason', btrim(p_reason)
    ));

    response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'id', p_journal_entry_id,
      'version', new_version::text,
      'previous_version', before->>'version',
      'doc_date', new_date,
      'currency', before->>'currency',
      'description', new_description,
      'reference', new_reference,
      'pnl_minor', pnl,
      'previous_pnl_minor', (before->>'pnl_minor')::bigint,
      'legs', (private.journal_entry_snapshot(cid, p_journal_entry_id))->'legs',
      'reason', btrim(p_reason),
      'undo_kind', 'journal_entry_update'
    ));
  exception
    when deadlock_detected or serialization_failure or lock_not_available then
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

revoke all on function public.mcp_update_journal_entry(text, uuid, text, text, date, text, boolean, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.mcp_update_journal_entry(text, uuid, text, text, date, text, boolean, text, jsonb) to authenticated;

comment on function public.mcp_update_journal_entry(text, uuid, text, text, date, text, boolean, text, jsonb) is
  'FLOW-174: MCP update_journal_entry. Re-books a journal entry in place (same id) with create_journal_entry''s rules, saving the version it replaces. Undo kind journal_entry_update. Decision 0234.';

-- Undo: the version before comes back while the entry reads as the edit left it, as a new version.
create function private.undo_journal_entry_update(p_company uuid, p_write private.mcp_writes)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := p_company;
  rec private.mcp_writes := p_write;
  target jsonb := p_write.prior->'before';
  cur jsonb;
  why text;
begin
  begin
    perform private.journal_entry_editable(cid, rec.transaction_id, (target->>'doc_date')::date);
  exception
    when others then
      if sqlerrm in ('transaction not found', 'not a journal entry') then
        return private.mcp_error('conflict', 'conflict');
      end if;
      raise;
  end;
  if private.journal_entry_print(cid, rec.transaction_id) is distinct from rec.prior->'after' then
    return private.mcp_error('conflict', 'conflict');
  end if;
  cur := private.journal_entry_snapshot(cid, rec.transaction_id);
  why := left('undo: ' || coalesce(rec.prior->>'reason', 'edit'), 200);

  perform private.journal_entry_apply(cid, rec.transaction_id, (target->>'doc_date')::date, target->>'currency',
    target->>'description', target->>'reference', target->'legs');

  insert into public.journal_entry_versions (
    company_id, transaction_id, version, doc_date, currency, description, reference, legs, pnl_minor,
    written_by, written_at, reason, replaced_by, replaced_reason
  )
  values (
    cid, rec.transaction_id, (cur->>'version')::integer, (cur->>'doc_date')::date, cur->>'currency',
    cur->>'description', cur->>'reference', cur->'legs', (cur->>'pnl_minor')::bigint,
    (cur->>'written_by')::uuid, (cur->>'written_at')::timestamptz, cur->>'reason', auth.uid(), why
  );
  update public.journal_entries j
  set version = j.version + 1, updated_by = auth.uid(), updated_at = now(), reason = why
  where j.transaction_id = rec.transaction_id and j.company_id = cid;
  update private.mcp_writes set undone_at = clock_timestamp() where id = rec.id and undone_at is null;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'kind', 'journal_entry_update', 'id', rec.transaction_id,
    'version', (select j.version::text from public.journal_entries j where j.transaction_id = rec.transaction_id)
  ));
end;
$$;

revoke all on function private.undo_journal_entry_update(uuid, private.mcp_writes) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The reads.
-- ---------------------------------------------------------------------------
create function public.mcp_journal_entry_history(p_journal_entry_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid;
  cur jsonb;
begin
  cid := private.readable_company_id();
  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.transactions t
    where t.id = p_journal_entry_id and t.company_id = cid and t.removed_at is null
  ) then
    return null;
  end if;
  cur := private.journal_entry_snapshot(cid, p_journal_entry_id);
  if cur is null then
    return jsonb_build_object('journal_entry_id', p_journal_entry_id, 'is_journal_entry', false);
  end if;
  return jsonb_build_object(
    'journal_entry_id', p_journal_entry_id,
    'is_journal_entry', true,
    'version', cur->>'version',
    'created_by', (select j.created_by from public.journal_entries j where j.transaction_id = p_journal_entry_id),
    'created_by_name', (select private.user_display_name(j.created_by) from public.journal_entries j
                        where j.transaction_id = p_journal_entry_id),
    'created_at', (select j.created_at from public.journal_entries j where j.transaction_id = p_journal_entry_id),
    'versions', jsonb_build_array(
      (cur - 'version') || jsonb_build_object(
        'version', cur->>'version', 'current', true,
        'written_by_name', private.user_display_name((cur->>'written_by')::uuid),
        'replaced_by', null, 'replaced_by_name', null, 'replaced_at', null, 'replaced_reason', null)
    ) || coalesce((
      select jsonb_agg(jsonb_build_object(
          'version', v.version::text, 'current', false,
          'doc_date', v.doc_date, 'currency', v.currency, 'description', v.description, 'reference', v.reference,
          'legs', v.legs, 'pnl_minor', v.pnl_minor,
          'written_by', v.written_by, 'written_by_name', private.user_display_name(v.written_by),
          'written_at', v.written_at, 'reason', v.reason,
          'replaced_by', v.replaced_by, 'replaced_by_name', private.user_display_name(v.replaced_by),
          'replaced_at', v.replaced_at, 'replaced_reason', v.replaced_reason
        ) order by v.version desc)
      from public.journal_entry_versions v
      where v.company_id = cid and v.transaction_id = p_journal_entry_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.mcp_journal_entry_history(uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_journal_entry_history(uuid) to authenticated;

comment on function public.mcp_journal_entry_history(uuid) is
  'FLOW-174: MCP get_journal_entry_history. The entry''s versions, the current one first. Any member reads it. Decision 0234.';

-- The version beside the reference in get_line_legs and get_transaction (get_expense), and in
-- create_journal_entry's answer.
do $reads$
declare
  def text;
  anchor constant text := $a$jsonb_build_object('reference', j.reference)$a$;
  a_create constant text := $a$      'undo_kind', 'journal_entry'
    ));$a$;
  fn text;
begin
  foreach fn in array array['public.mcp_line_legs(uuid)', 'public.get_transaction(uuid)'] loop
    def := pg_get_functiondef(fn::regprocedure);
    if pg_temp.anchor_count(def, anchor) <> 1 then
      raise exception '% is not the expected definition', fn;
    end if;
    execute replace(def, anchor, $n$jsonb_build_object('reference', j.reference, 'version', j.version::text)$n$);
  end loop;

  def := pg_get_functiondef('public.mcp_create_journal_entry(text,date,text,text,text,jsonb)'::regprocedure);
  if pg_temp.anchor_count(def, a_create) <> 1 then
    raise exception 'mcp_create_journal_entry is not the expected definition';
  end if;
  execute replace(def, a_create, $n$      'version', '1',
      'undo_kind', 'journal_entry'
    ));$n$);
end
$reads$;

-- ---------------------------------------------------------------------------
-- 5. The write kind: the check constraints, mcp_refused, mcp_undo.
-- ---------------------------------------------------------------------------
do $kinds$
declare
  def text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  if pg_temp.anchor_count(def, ']))') <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, ']))', ', ''journal_entry_update''::text]))');

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 1) <> ')' then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 1)
    || ' OR ((kind = ''journal_entry_update''::text) AND (transaction_id IS NOT NULL) AND (prior ? ''before''::text) AND (prior ? ''after''::text)))';
end
$kinds$;

do $refused$
declare
  def text;
  anchor constant text := $a$      when p_message = 'loan_closed' then 'loan closed'$a$;
begin
  def := pg_get_functiondef('private.mcp_refused(text)'::regprocedure);
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_refused is not the expected definition';
  end if;
  def := replace(def, anchor, $n$      -- FLOW-174: update_journal_entry.
      when p_message in ('entry changed', 'not a journal entry') then p_message
$n$ || anchor);
  execute def;
end
$refused$;

do $undo$
declare
  def text;
  a_kinds constant text := $a$p_kind not in ($a$;
  a_lookup constant text := $a$(p_kind = 'supplier_category' and w.kind = 'supplier_category' and w.transaction_id = p_id)$a$;
  a_branch constant text := $a$    elsif p_kind = 'supplier_category' then$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_kinds) <> 1 or pg_temp.anchor_count(def, a_lookup) <> 1
    or pg_temp.anchor_count(def, a_branch) <> 1 then
    raise exception 'mcp_undo is not the expected definition';
  end if;
  def := replace(def, a_kinds, $n$p_kind not in ('journal_entry_update', $n$);
  def := replace(def, a_lookup, a_lookup || $n$
        or (p_kind = 'journal_entry_update' and w.kind = 'journal_entry_update' and w.transaction_id = p_id)$n$);
  def := replace(def, a_branch, $n$    elsif p_kind = 'journal_entry_update' then
      -- FLOW-174: the version before comes back while the entry reads as the edit left it.
      response := private.undo_journal_entry_update(cid, rec);
$n$ || a_branch);
  execute def;
end
$undo$;

commit;
