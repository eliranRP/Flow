-- FLOW-957 fix: the transaction-files bucket checked the request's company, but storage calls do not
-- send x-flow-company (FLOW-601). An owner of two companies, showing one while the server's last
-- opened was the other, had every upload refused. The rules now read the company from the path
-- (<company>/<transaction>/<name>): a member reads its companies' folders, a writer (owner or editor)
-- uploads under its company and one of that company's lines. add_transaction_file still records the
-- file only under the request's company.

-- The company a path names, or null when its first folder is not a uuid.
create function private.thread_folder_company(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select f::uuid
  from (select (storage.foldername(p_name))[1] as f) s
  where f ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

-- A writer of the path's company, and the path's second folder is one of that company's lines.
create function private.can_upload_thread_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.company_role(c.id, (select auth.uid())) in ('owner', 'editor')
      and exists (
        select 1 from public.transactions t
        where t.company_id = c.id and t.id::text = (storage.foldername(p_name))[2]
      ),
    false)
  from (select private.thread_folder_company(p_name) as id) c;
$$;

-- A member of the path's company, or the demo viewer of it.
create function private.can_read_thread_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.company_role(c.id, (select auth.uid())) is not null
      or c.id = (select private.readable_company_id()),
    false)
  from (select private.thread_folder_company(p_name) as id) c;
$$;

revoke all on function private.thread_folder_company(text) from public;
revoke all on function private.can_upload_thread_file(text) from public;
revoke all on function private.can_read_thread_file(text) from public;
grant execute on function private.thread_folder_company(text) to authenticated;
grant execute on function private.can_upload_thread_file(text) to authenticated;
grant execute on function private.can_read_thread_file(text) to authenticated;

drop policy transaction_files_read on storage.objects;
drop policy transaction_files_upload on storage.objects;

create policy transaction_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'transaction-files' and private.can_read_thread_file(name));

create policy transaction_files_upload on storage.objects
  for insert to authenticated
  with check (bucket_id = 'transaction-files' and private.can_upload_thread_file(name));
