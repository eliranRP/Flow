-- FLOW-957 follow-up: a line holds one note (owner, 2026-10-26). Mercury's note, when it has one, is
-- that note and is edited in Flow; otherwise a writer adds the line's note once and edits it after.
-- Files stay many. The note belongs to the line, so any writer (owner or editor) edits it, and removes
-- a Flow note; Mercury's note is edited, never removed. The sync brings Mercury's note only to a line
-- with no note yet.

begin;

-- Lines that already hold several notes keep one: Mercury's, else the newest. The rest are removed
-- (removed_at, as the app removes), not deleted.
update public.transaction_notes n
set removed_at = clock_timestamp()
where n.removed_at is null
  and exists (
    select 1 from public.transaction_notes k
    where k.transaction_id = n.transaction_id and k.removed_at is null and k.id <> n.id
      and (k.source = 'mercury', k.created_at, k.id) > (n.source = 'mercury', n.created_at, n.id)
  );

create unique index transaction_notes_one_note on public.transaction_notes (transaction_id)
  where removed_at is null;

-- The line's note, when it has none yet.
create or replace function public.add_transaction_note(p_transaction_id uuid, p_body text)
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
  if exists (
    select 1 from public.transaction_notes n where n.transaction_id = p_transaction_id and n.removed_at is null
  ) then
    raise exception 'line has a note';
  end if;
  insert into public.transaction_notes (company_id, transaction_id, source, author_id, body)
  values (cid, p_transaction_id, 'flow', auth.uid(), v_body)
  returning id into nid;
  return nid;
end;
$$;

-- The line's note, new text, by any writer of the company. Mercury's note is changed in Flow only.
-- Returns the line and the text before and after, for undo.
create or replace function public.edit_transaction_note(p_note_id uuid, p_body text)
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
  if not found then
    raise exception 'note not found';
  end if;
  update public.transaction_notes n
  set body = v_body,
      updated_at = clock_timestamp(),
      edited_in_flow = n.edited_in_flow or (n.source = 'mercury' and v_body is distinct from rec.body)
  where n.id = rec.id;
  return jsonb_build_object('transaction_id', rec.transaction_id, 'before', rec.body, 'after', v_body,
    'source', rec.source);
end;
$$;

-- A writer removes the line's Flow note. Mercury's note is edited, never removed here. Files stay on
-- the line. Returns the line, for undo.
create or replace function public.remove_transaction_note(p_note_id uuid)
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
  where n.id = p_note_id and n.company_id = cid and n.removed_at is null and n.source = 'flow'
  returning n.transaction_id into txn;
  if txn is null then
    raise exception 'note not found';
  end if;
  return txn;
end;
$$;

-- Mercury sync: each fetched line's note (whole) and the names of its attachments. A note edited in
-- Flow is kept, and a line that already has a Flow note keeps it. Returns the attachments not copied yet.
create or replace function public.sync_mercury_threads(p_company uuid, p_items jsonb)
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
      where n.transaction_id = txn and n.source = 'mercury' and not n.edited_in_flow;
    elsif not exists (
      select 1 from public.transaction_notes n
      where n.transaction_id = txn and n.source = 'flow' and n.removed_at is null
    ) then
      insert into public.transaction_notes (company_id, transaction_id, source, body)
      values (p_company, txn, 'mercury', remote)
      on conflict (transaction_id) where source = 'mercury' do update
      set body = excluded.body, updated_at = now(), removed_at = null
      where not transaction_notes.edited_in_flow and transaction_notes.body is distinct from excluded.body;
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

commit;
