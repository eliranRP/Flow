-- FLOW-957: notes and files on a transaction, with Mercury's note and attachments.
-- - public.transaction_notes: the owner's notes on a line (source flow) and Mercury's note (source
--   mercury, at most one a line). A Mercury note edited in Flow waits to be sent (mercury_push
--   'pending') until mercury-note or the next Mercury sync sends it; a key that may not write keeps it
--   in Flow ('denied'). A sync never overwrites a note that waits. Removed notes are kept (removed_at)
--   so undo can bring them back.
-- - public.transaction_files: files on a line, in the private bucket transaction-files at
--   <company>/<transaction>/<name>. The owner's (source flow) are uploaded by the app; Mercury's
--   attachments are copied by mercury-sync (their links expire). Removed files are kept (removed_at).
-- - The app's RPCs: get_transaction_thread, transaction_thread_counts, add_transaction_note,
--   edit_transaction_note, remove_transaction_note, add_transaction_file, remove_transaction_file.
-- - The sync's (service role): sync_mercury_threads, record_mercury_file, mercury_note_pushes,
--   mercury_note_pushed; the app's push target: mercury_note_push_target.
-- - MCP (decision 0095): mcp_add_transaction_note (undo kind note_add), mcp_edit_transaction_note
--   (note_edit), mcp_remove_transaction_note (note_remove), mcp_remove_transaction_file (file_remove).
--   A file is uploaded from the app only: MCP has no file bytes to send.
-- mcp_undo and the mcp_writes constraints are patched in place with counted anchors, as in
-- 20261016191719_manual_entry.sql.

begin;

set local lock_timeout = '5s';

create or replace function pg_temp.anchor_count(p_def text, p_anchor text)
returns integer
language sql
immutable
as $$ select (length(p_def) - length(replace(p_def, p_anchor, ''))) / length(p_anchor); $$;

create table public.transaction_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  source text not null check (source in ('flow', 'mercury')),
  author_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  mercury_push text check (mercury_push in ('pending', 'denied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint transaction_notes_push_mercury check (mercury_push is null or source = 'mercury')
);

create unique index transaction_notes_one_mercury on public.transaction_notes (transaction_id)
  where source = 'mercury';
create index transaction_notes_company on public.transaction_notes (company_id, transaction_id);
create index transaction_notes_line on public.transaction_notes (transaction_id);
create index transaction_notes_author on public.transaction_notes (author_id);
create index transaction_notes_pending on public.transaction_notes (company_id)
  where mercury_push = 'pending';

alter table public.transaction_notes enable row level security;
revoke all on public.transaction_notes from public, anon, authenticated;

comment on table public.transaction_notes is
  'FLOW-957: notes on a line. source flow: the owner''s; source mercury: Mercury''s note (one a line), pending while an edit made in Flow waits to be sent to Mercury, denied when the key may not write. Read and written through the RPCs only.';

create table public.transaction_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  note_id uuid references public.transaction_notes (id) on delete set null,
  source text not null check (source in ('flow', 'mercury')),
  storage_path text not null unique check (char_length(storage_path) between 1 and 400),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 200),
  mime text not null check (char_length(mime) between 1 and 120),
  bytes bigint not null check (bytes > 0 and bytes <= 20971520),
  mercury_key text check (mercury_key is null or char_length(mercury_key) between 1 and 300),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint transaction_files_mercury_key check ((source = 'mercury') = (mercury_key is not null))
);

create unique index transaction_files_one_mercury on public.transaction_files (transaction_id, mercury_key)
  where mercury_key is not null;
create index transaction_files_company on public.transaction_files (company_id, transaction_id);
create index transaction_files_line on public.transaction_files (transaction_id);
create index transaction_files_note on public.transaction_files (note_id);
create index transaction_files_uploader on public.transaction_files (uploaded_by);

alter table public.transaction_files enable row level security;
revoke all on public.transaction_files from public, anon, authenticated;

comment on table public.transaction_files is
  'FLOW-957: files on a line, in the private bucket transaction-files at <company>/<transaction>/<name>. source mercury: an attachment copied from Mercury (mercury_key is its file name). Read and written through the RPCs only.';

-- The bucket: private, 20 MB a file, pictures and PDF. A member reads its company's files; a writer
-- (owner or editor) uploads under its company and one of its lines. Nothing is updated or deleted
-- through the API: a removed file is kept (removed_at) so undo can bring it back.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('transaction-files', 'transaction-files', false, 20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'application/pdf'])
on conflict (id) do nothing;

create policy transaction_files_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'transaction-files'
    and (storage.foldername(name))[1] = (select private.readable_company_id())::text
  );

create policy transaction_files_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'transaction-files'
    and (storage.foldername(name))[1] = (select private.current_company_id())::text
    and exists (
      select 1 from public.transactions t
      where t.company_id = (select private.current_company_id())
        and t.id::text = (storage.foldername(name))[2]
    )
  );

-- One note as the thread shows it.
create function private.thread_note_json(n public.transaction_notes)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', n.id,
    'source', n.source,
    'body', n.body,
    'mine', n.author_id is not distinct from (select auth.uid()) and n.source = 'flow',
    'created_at', n.created_at,
    'updated_at', n.updated_at,
    'edited', n.updated_at > n.created_at + interval '1 second',
    'mercury_push', n.mercury_push
  );
$$;

revoke all on function private.thread_note_json(public.transaction_notes) from public, anon, authenticated, service_role;

-- The thread of one line: its notes and files, oldest first. Null when the line is not the caller's.
create function public.get_transaction_thread(p_transaction_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cid uuid := private.readable_company_id();
begin
  if cid is null or p_transaction_id is null or not exists (
    select 1 from public.transactions t where t.id = p_transaction_id and t.company_id = cid
  ) then
    return null;
  end if;
  return jsonb_build_object(
    'transaction_id', p_transaction_id,
    'company_id', cid,
    'notes', coalesce((
      select jsonb_agg(private.thread_note_json(n) order by n.source desc, n.created_at, n.id)
      from public.transaction_notes n
      where n.company_id = cid and n.transaction_id = p_transaction_id and n.removed_at is null
    ), '[]'::jsonb),
    'files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'note_id', f.note_id,
        'source', f.source,
        'file_name', f.file_name,
        'mime', f.mime,
        'bytes', f.bytes,
        'path', f.storage_path,
        'mine', f.uploaded_by is not distinct from (select auth.uid()) and f.source = 'flow',
        'created_at', f.created_at
      ) order by f.created_at, f.id)
      from public.transaction_files f
      where f.company_id = cid and f.transaction_id = p_transaction_id and f.removed_at is null
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_transaction_thread(uuid) from public, anon, service_role;
grant execute on function public.get_transaction_thread(uuid) to authenticated;

-- How many notes and files each line has, for the approval card's badge. Lines with none are left out.
create function public.transaction_thread_counts(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with cid as (select private.readable_company_id() as id),
  ids as (select distinct unnest(coalesce(p_ids, '{}'::uuid[])) as id limit 200),
  notes as (
    select n.transaction_id, count(*)::int as n
    from public.transaction_notes n, cid
    where n.company_id = cid.id and n.removed_at is null and n.transaction_id in (select id from ids)
    group by n.transaction_id
  ),
  files as (
    select f.transaction_id, count(*)::int as n
    from public.transaction_files f, cid
    where f.company_id = cid.id and f.removed_at is null and f.transaction_id in (select id from ids)
    group by f.transaction_id
  )
  select coalesce(jsonb_object_agg(i.id, jsonb_build_object(
    'notes', coalesce(notes.n, 0), 'files', coalesce(files.n, 0)
  )), '{}'::jsonb)
  from ids i
  left join notes on notes.transaction_id = i.id
  left join files on files.transaction_id = i.id
  where notes.n is not null or files.n is not null;
$$;

revoke all on function public.transaction_thread_counts(uuid[]) from public, anon, service_role;
grant execute on function public.transaction_thread_counts(uuid[]) to authenticated;

create function private.thread_body(p_body text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  body text := btrim(coalesce(p_body, ''));
begin
  if char_length(body) < 1 or char_length(body) > 5000 then
    raise exception 'note is invalid';
  end if;
  return body;
end;
$$;

revoke all on function private.thread_body(text) from public, anon, authenticated, service_role;

-- A note on a line of the caller's company (an owner or an editor).
create function public.add_transaction_note(p_transaction_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.current_company_id();
  v_body text := private.thread_body(p_body);
  nid uuid;
begin
  if cid is null then
    raise exception 'no company';
  end if;
  if p_transaction_id is null or not exists (
    select 1 from public.transactions t where t.id = p_transaction_id and t.company_id = cid
  ) then
    raise exception 'line not found';
  end if;
  insert into public.transaction_notes (company_id, transaction_id, source, author_id, body)
  values (cid, p_transaction_id, 'flow', auth.uid(), v_body)
  returning id into nid;
  return nid;
end;
$$;

revoke all on function public.add_transaction_note(uuid, text) from public, anon, service_role;
grant execute on function public.add_transaction_note(uuid, text) to authenticated;

-- A note's new text: the author's own note, or Mercury's note (then it waits to be sent to Mercury).
-- Returns the line and the text before and after, for undo.
create function public.edit_transaction_note(p_note_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.current_company_id();
  v_body text := private.thread_body(p_body);
  rec public.transaction_notes%rowtype;
begin
  if cid is null then
    raise exception 'no company';
  end if;
  select * into rec from public.transaction_notes n
  where n.id = p_note_id and n.company_id = cid and n.removed_at is null
  for update;
  if not found or (rec.source = 'flow' and rec.author_id is distinct from auth.uid()) then
    raise exception 'note not found';
  end if;
  update public.transaction_notes n
  set body = v_body,
      updated_at = clock_timestamp(),
      mercury_push = case when n.source = 'mercury' and v_body is distinct from rec.body then 'pending' else n.mercury_push end
  where n.id = rec.id;
  return jsonb_build_object('transaction_id', rec.transaction_id, 'before', rec.body, 'after', v_body,
    'source', rec.source);
end;
$$;

revoke all on function public.edit_transaction_note(uuid, text) from public, anon, service_role;
grant execute on function public.edit_transaction_note(uuid, text) to authenticated;

-- The author removes their own note. Mercury's note is edited, never removed here. Its files stay on
-- the line. Returns the line, for undo.
create function public.remove_transaction_note(p_note_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.current_company_id();
  txn uuid;
begin
  if cid is null then
    raise exception 'no company';
  end if;
  update public.transaction_notes n
  set removed_at = clock_timestamp()
  where n.id = p_note_id and n.company_id = cid and n.removed_at is null
    and n.source = 'flow' and n.author_id is not distinct from auth.uid()
  returning n.transaction_id into txn;
  if txn is null then
    raise exception 'note not found';
  end if;
  return txn;
end;
$$;

revoke all on function public.remove_transaction_note(uuid) from public, anon, service_role;
grant execute on function public.remove_transaction_note(uuid) to authenticated;

-- A file the app uploaded to <company>/<line>/..., recorded on the line (and on a note of it).
create function public.add_transaction_file(
  p_transaction_id uuid,
  p_note_id uuid,
  p_path text,
  p_file_name text,
  p_mime text,
  p_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.current_company_id();
  v_name text := btrim(coalesce(p_file_name, ''));
  fid uuid;
begin
  if cid is null then
    raise exception 'no company';
  end if;
  if p_transaction_id is null or not exists (
    select 1 from public.transactions t where t.id = p_transaction_id and t.company_id = cid
  ) then
    raise exception 'line not found';
  end if;
  if p_note_id is not null and not exists (
    select 1 from public.transaction_notes n
    where n.id = p_note_id and n.company_id = cid and n.transaction_id = p_transaction_id and n.removed_at is null
  ) then
    raise exception 'note not found';
  end if;
  if p_path is null or p_path !~ ('^' || cid::text || '/' || p_transaction_id::text || '/[A-Za-z0-9._-]{1,160}$')
    or p_path like '%..%' then
    raise exception 'path is invalid';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'transaction-files' and o.name = p_path) then
    raise exception 'file not uploaded';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 200 or private.name_has_hidden_char(v_name) then
    raise exception 'file name is invalid';
  end if;
  if p_mime is null or p_mime !~ '^(image/(jpeg|png|webp|heic|heif|gif)|application/pdf)$' then
    raise exception 'file type is invalid';
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 20971520 then
    raise exception 'file size is invalid';
  end if;
  insert into public.transaction_files (company_id, transaction_id, note_id, source, storage_path, file_name, mime, bytes, uploaded_by)
  values (cid, p_transaction_id, p_note_id, 'flow', p_path, v_name, p_mime, p_bytes, auth.uid())
  returning id into fid;
  return fid;
end;
$$;

revoke all on function public.add_transaction_file(uuid, uuid, text, text, text, bigint) from public, anon, service_role;
grant execute on function public.add_transaction_file(uuid, uuid, text, text, text, bigint) to authenticated;

-- The uploader removes their own file. The stored object stays, so undo can bring it back.
create function public.remove_transaction_file(p_file_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid := private.current_company_id();
  txn uuid;
begin
  if cid is null then
    raise exception 'no company';
  end if;
  update public.transaction_files f
  set removed_at = clock_timestamp()
  where f.id = p_file_id and f.company_id = cid and f.removed_at is null
    and f.source = 'flow' and f.uploaded_by is not distinct from auth.uid()
  returning f.transaction_id into txn;
  if txn is null then
    raise exception 'file not found';
  end if;
  return txn;
end;
$$;

revoke all on function public.remove_transaction_file(uuid) from public, anon, service_role;
grant execute on function public.remove_transaction_file(uuid) to authenticated;

-- Mercury sync: each line's note and attachments as Mercury lists them,
-- [{external_id, note, files: [file name, ...]}]. A note that waits to be sent, or that the key may
-- not write, is kept; any other follows Mercury (a cleared note is removed). Returns the attachments
-- not copied yet: [{transaction_id, external_id, file_name}].
create function public.sync_mercury_threads(p_company uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  txn uuid;
  remote text;
  missing jsonb := '[]'::jsonb;
  v_file text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_company is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'items are invalid';
  end if;
  for item in select value from jsonb_array_elements(p_items) limit 2000
  loop
    select t.id into txn from public.transactions t
    where t.company_id = p_company and t.source = 'mercury' and t.external_id = item->>'external_id'
    limit 1;
    continue when txn is null;

    remote := nullif(btrim(left(coalesce(item->>'note', ''), 5000)), '');
    if remote is null then
      delete from public.transaction_notes n
      where n.transaction_id = txn and n.source = 'mercury' and n.mercury_push is null;
    else
      insert into public.transaction_notes (company_id, transaction_id, source, body)
      values (p_company, txn, 'mercury', remote)
      on conflict (transaction_id) where source = 'mercury' do update
      set body = excluded.body, updated_at = now(), removed_at = null
      where transaction_notes.mercury_push is null and transaction_notes.body is distinct from excluded.body;
    end if;

    for v_file in
      select left(btrim(value), 200) from jsonb_array_elements_text(coalesce(item->'files', '[]'::jsonb)) limit 20
    loop
      continue when v_file = '';
      if not exists (
        select 1 from public.transaction_files f where f.transaction_id = txn and f.mercury_key = v_file
      ) then
        missing := missing || jsonb_build_array(jsonb_build_object(
          'transaction_id', txn, 'external_id', item->>'external_id', 'file_name', v_file
        ));
      end if;
    end loop;
  end loop;
  return missing;
end;
$$;

revoke all on function public.sync_mercury_threads(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_mercury_threads(uuid, jsonb) to service_role;

-- Mercury sync: an attachment it copied into the bucket.
create function public.record_mercury_file(
  p_company uuid,
  p_transaction_id uuid,
  p_path text,
  p_file_name text,
  p_mime text,
  p_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  fid uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if not exists (
    select 1 from public.transactions t where t.id = p_transaction_id and t.company_id = p_company
  ) then
    raise exception 'line not found';
  end if;
  if p_path is null or position(p_company::text || '/' || p_transaction_id::text || '/' in p_path) <> 1 then
    raise exception 'path is invalid';
  end if;
  insert into public.transaction_files (company_id, transaction_id, source, storage_path, file_name, mime, bytes, mercury_key)
  values (p_company, p_transaction_id, 'mercury', p_path, left(btrim(p_file_name), 200), p_mime, p_bytes, left(btrim(p_file_name), 200))
  on conflict (transaction_id, mercury_key) where mercury_key is not null do nothing
  returning id into fid;
  return fid;
end;
$$;

revoke all on function public.record_mercury_file(uuid, uuid, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.record_mercury_file(uuid, uuid, text, text, text, bigint) to service_role;

-- The Mercury notes that wait to be sent: [{note_id, external_id, account_id, body, updated_at}].
create function public.mercury_note_pushes(p_company uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'note_id', n.id,
      'external_id', t.external_id,
      'account_id', t.provider_meta->>'account_id',
      'body', n.body,
      'updated_at', n.updated_at
    ) order by n.updated_at)
    from public.transaction_notes n
    join public.transactions t on t.id = n.transaction_id
    where n.company_id = p_company and n.source = 'mercury' and n.mercury_push = 'pending'
      and n.removed_at is null and t.external_id is not null
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.mercury_note_pushes(uuid) from public, anon, authenticated;
grant execute on function public.mercury_note_pushes(uuid) to service_role;

-- A send's outcome: sent (back in step with Mercury) or denied (the key may not write). Only the
-- text that was sent is marked, so an edit made meanwhile still waits.
create function public.mercury_note_pushed(p_note_id uuid, p_updated_at timestamptz, p_state text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_state is null or p_state not in ('sent', 'denied') then
    raise exception 'state is invalid';
  end if;
  update public.transaction_notes n
  set mercury_push = case when p_state = 'sent' then null else 'denied' end
  where n.id = p_note_id and n.source = 'mercury' and n.mercury_push = 'pending'
    and n.updated_at = p_updated_at;
  return found;
end;
$$;

revoke all on function public.mercury_note_pushed(uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.mercury_note_pushed(uuid, timestamptz, text) to service_role;

-- The app's send right after an edit: the caller's own company's Mercury note that waits, with the
-- line's company, Mercury id and account, for mercury-note. Null when there is nothing to send.
create function public.mercury_note_push_target(p_note_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'note_id', n.id,
    'company_id', n.company_id,
    'external_id', t.external_id,
    'account_id', t.provider_meta->>'account_id',
    'body', n.body,
    'updated_at', n.updated_at
  )
  from public.transaction_notes n
  join public.transactions t on t.id = n.transaction_id
  where n.id = p_note_id
    and n.company_id = private.current_company_id()
    and n.source = 'mercury' and n.mercury_push = 'pending' and n.removed_at is null
    and t.external_id is not null;
$$;

revoke all on function public.mercury_note_push_target(uuid) from public, anon, service_role;
grant execute on function public.mercury_note_push_target(uuid) to authenticated;

-- MCP: the same writes, idempotent and undoable (decision 0080).
create function public.mcp_add_transaction_note(p_idempotency_key text, p_transaction_id uuid, p_body text)
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
  nid uuid;
  response jsonb;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 1 or char_length(p_idempotency_key) > 128
    or p_transaction_id is null or p_body is null then
    return private.mcp_error('validation', 'validation');
  end if;
  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'note_add|' || p_transaction_id::text || '|' || md5(btrim(p_body));
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  response := private.mcp_error('refused', 'The write was refused.');
  begin
    nid := public.add_transaction_note(p_transaction_id, p_body);
    insert into private.mcp_writes (token_id, user_id, kind, transaction_id, prior)
    values (token, auth.uid(), 'note_add', p_transaction_id,
      jsonb_build_object('note_id', nid, 'after', btrim(p_body)));
    response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'id', nid, 'transaction_id', p_transaction_id, 'undo_kind', 'note_add'));
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

revoke all on function public.mcp_add_transaction_note(text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mcp_add_transaction_note(text, uuid, text) to authenticated;

create function public.mcp_edit_transaction_note(p_idempotency_key text, p_note_id uuid, p_body text)
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
  if p_idempotency_key is null or char_length(p_idempotency_key) < 1 or char_length(p_idempotency_key) > 128
    or p_note_id is null or p_body is null then
    return private.mcp_error('validation', 'validation');
  end if;
  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'note_edit|' || p_note_id::text || '|' || md5(btrim(p_body));
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  response := private.mcp_error('refused', 'The write was refused.');
  begin
    step := public.edit_transaction_note(p_note_id, p_body);
    insert into private.mcp_writes (token_id, user_id, kind, transaction_id, prior)
    values (token, auth.uid(), 'note_edit', (step->>'transaction_id')::uuid,
      jsonb_build_object('note_id', p_note_id, 'before', step->'before', 'after', step->'after'));
    response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'id', p_note_id, 'source', step->>'source',
      'mercury', case when step->>'source' = 'mercury' then 'waits to be sent' end,
      'undo_kind', 'note_edit'));
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

revoke all on function public.mcp_edit_transaction_note(text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.mcp_edit_transaction_note(text, uuid, text) to authenticated;

create function public.mcp_remove_transaction_note(p_idempotency_key text, p_note_id uuid)
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
  txn uuid;
  response jsonb;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 1 or char_length(p_idempotency_key) > 128
    or p_note_id is null then
    return private.mcp_error('validation', 'validation');
  end if;
  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'note_remove|' || p_note_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  response := private.mcp_error('refused', 'The write was refused.');
  begin
    txn := public.remove_transaction_note(p_note_id);
    insert into private.mcp_writes (token_id, user_id, kind, transaction_id, prior)
    values (token, auth.uid(), 'note_remove', txn, jsonb_build_object('note_id', p_note_id));
    response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'id', p_note_id, 'transaction_id', txn, 'undo_kind', 'note_remove'));
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

revoke all on function public.mcp_remove_transaction_note(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_remove_transaction_note(text, uuid) to authenticated;

create function public.mcp_remove_transaction_file(p_idempotency_key text, p_file_id uuid)
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
  txn uuid;
  response jsonb;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) < 1 or char_length(p_idempotency_key) > 128
    or p_file_id is null then
    return private.mcp_error('validation', 'validation');
  end if;
  gate := private.mcp_require_writer();
  if gate->>'ok' is distinct from 'true' then
    return gate;
  end if;
  token := (gate->>'token_id')::uuid;
  hash := 'file_remove|' || p_file_id::text;
  prior := private.mcp_idempotency_lookup(token, p_idempotency_key, hash);
  if prior->>'state' = 'replay' then
    return prior->'response';
  end if;
  if prior->>'state' = 'conflict' then
    return private.mcp_error('conflict', 'conflict');
  end if;

  response := private.mcp_error('refused', 'The write was refused.');
  begin
    txn := public.remove_transaction_file(p_file_id);
    insert into private.mcp_writes (token_id, user_id, kind, transaction_id, prior)
    values (token, auth.uid(), 'file_remove', txn, jsonb_build_object('file_id', p_file_id));
    response := jsonb_build_object('ok', true, 'data', jsonb_build_object(
      'id', p_file_id, 'transaction_id', txn, 'undo_kind', 'file_remove'));
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

revoke all on function public.mcp_remove_transaction_file(text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.mcp_remove_transaction_file(text, uuid) to authenticated;

-- private.mcp_writes: the four kinds, and what each undo reads.
do $kinds$
declare
  def text;
  anchor text;
begin
  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_kind_check');
  anchor := $a$'book_line'::text])$a$;
  if pg_temp.anchor_count(def, anchor) <> 1 then
    raise exception 'mcp_writes_kind_check is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_kind_check';
  execute 'alter table private.mcp_writes add constraint mcp_writes_kind_check '
    || replace(def, anchor, $n$'book_line'::text, 'note_add'::text, 'note_edit'::text, 'note_remove'::text, 'file_remove'::text])$n$);

  def := (select pg_get_constraintdef(oid) from pg_constraint
          where conrelid = 'private.mcp_writes'::regclass and conname = 'mcp_writes_target');
  if right(def, 2) <> '))' or position($a$(kind = 'book_line'::text)$a$ in def) = 0 then
    raise exception 'mcp_writes_target is not the expected definition';
  end if;
  execute 'alter table private.mcp_writes drop constraint mcp_writes_target';
  execute 'alter table private.mcp_writes add constraint mcp_writes_target '
    || left(def, length(def) - 2)
    || $n$ OR ((kind = ANY (ARRAY['note_add'::text, 'note_edit'::text, 'note_remove'::text])) AND (transaction_id IS NOT NULL) AND (prior ? 'note_id'::text)) OR ((kind = 'file_remove'::text) AND (transaction_id IS NOT NULL) AND (prior ? 'file_id'::text))))$n$;
end
$kinds$;

-- mcp_undo: the four kinds in the allowed list and the lookup, and their branches.
do $undo$
declare
  def text;
  a_kinds constant text := $a$'manual_entry', 'document_attach', 'book_line'
    )$a$;
  a_lookup constant text := $a$        or (p_kind = 'book_line' and w.kind = 'book_line' and w.transaction_id = p_id)
      )$a$;
  a_branch constant text := $a$    elsif p_kind = 'book_line' then$a$;
begin
  def := pg_get_functiondef('public.mcp_undo(text,text,uuid)'::regprocedure);
  if pg_temp.anchor_count(def, a_kinds) <> 1 or pg_temp.anchor_count(def, a_lookup) <> 1
    or pg_temp.anchor_count(def, a_branch) <> 1 then
    raise exception 'mcp_undo is not the expected definition';
  end if;

  def := replace(def, a_kinds, $n$'manual_entry', 'document_attach', 'book_line', 'note_add', 'note_edit', 'note_remove', 'file_remove'
    )$n$);
  def := replace(def, a_lookup, $n$        or (p_kind = 'book_line' and w.kind = 'book_line' and w.transaction_id = p_id)
        or (p_kind in ('note_add', 'note_edit', 'note_remove') and w.kind = p_kind and w.prior->>'note_id' = p_id::text)
        or (p_kind = 'file_remove' and w.kind = 'file_remove' and w.prior->>'file_id' = p_id::text)
      )$n$);
  def := replace(def, a_branch, $n$    elsif p_kind in ('note_add', 'note_edit', 'note_remove') then
      -- FLOW-957. note_add removes the note while it still has the text the write gave it; note_edit
      -- puts the text back while it is still the text the write left (a Mercury note then waits to be
      -- sent again); note_remove brings the note back while it is still removed.
      perform 1 from public.transaction_notes n
      where n.id = p_id and n.company_id = cid
      for update;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      elsif p_kind = 'note_add' and not exists (
        select 1 from public.transaction_notes n
        where n.id = p_id and n.company_id = cid and n.removed_at is null and n.body = rec.prior->>'after'
      ) then
        response := private.mcp_error('conflict', 'conflict');
      elsif p_kind = 'note_edit' and not exists (
        select 1 from public.transaction_notes n
        where n.id = p_id and n.company_id = cid and n.removed_at is null and n.body = rec.prior->>'after'
      ) then
        response := private.mcp_error('conflict', 'conflict');
      elsif p_kind = 'note_remove' and not exists (
        select 1 from public.transaction_notes n
        where n.id = p_id and n.company_id = cid and n.removed_at is not null
      ) then
        response := private.mcp_error('conflict', 'conflict');
      else
        if p_kind = 'note_add' then
          update public.transaction_notes n set removed_at = clock_timestamp()
          where n.id = p_id and n.company_id = cid;
        elsif p_kind = 'note_edit' then
          update public.transaction_notes n
          set body = rec.prior->>'before',
              updated_at = clock_timestamp(),
              mercury_push = case when n.source = 'mercury' then 'pending' else n.mercury_push end
          where n.id = p_id and n.company_id = cid;
        else
          update public.transaction_notes n set removed_at = null
          where n.id = p_id and n.company_id = cid;
        end if;
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
      end if;
    elsif p_kind = 'file_remove' then
      -- FLOW-957. The file comes back while it is still removed.
      update public.transaction_files f set removed_at = null
      where f.id = p_id and f.company_id = cid and f.removed_at is not null;
      if not found then
        response := private.mcp_error('conflict', 'conflict');
      else
        update private.mcp_writes
        set undone_at = clock_timestamp()
        where id = rec.id and user_id = auth.uid() and undone_at is null;
        response := jsonb_build_object('ok', true, 'data', jsonb_build_object('kind', p_kind, 'id', p_id));
      end if;
$n$ || a_branch);
  execute def;
end
$undo$;

drop function pg_temp.anchor_count(text, text);

commit;
