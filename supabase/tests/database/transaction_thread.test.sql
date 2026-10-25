-- FLOW-957: notes and files on a transaction. The app's RPCs (thread, counts, add, edit, remove, a
-- file uploaded to the bucket), the refusals across companies, Mercury's note and attachments from
-- the sync (a note that waits to be sent is kept), the sends, and the MCP writes with undo.
-- Invented names only.

begin;

select plan(45);

select tests.create_supabase_user('th_owner', 'th-owner@example.com');
select tests.create_supabase_user('th_other', 'th-other@example.com');

create temp table th (label text primary key, id uuid);
grant all on th to authenticated, service_role;
create temp table th_out (label text primary key, body jsonb);
grant all on th_out to authenticated, service_role;

insert into th (label, id) values
  ('co', tests.fixture_company('th_owner', 'Example Thread LLC')),
  ('other', tests.fixture_company('th_other', 'Example Thread Other LLC'));

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from pg_temp.th where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create function pg_temp.out_of(p_label text) returns jsonb language sql stable as $$
  select body from pg_temp.th_out where label = p_label;
$$;
grant execute on function pg_temp.out_of(text) to authenticated, service_role;

insert into th (label, id) values
  ('line', tests.fixture_line(pg_temp.id('co'), 'th:line', 128450, 'expense', null, null, '2026-10-12',
    p_currency => 'USD', p_source => 'mercury')),
  ('quiet', tests.fixture_line(pg_temp.id('co'), 'th:quiet', 5000, 'expense', null, null, '2026-10-12',
    p_currency => 'USD', p_source => 'mercury')),
  ('other_line', tests.fixture_line(pg_temp.id('other'), 'th:other', 900, 'expense', null, null, '2026-10-12',
    p_currency => 'USD', p_source => 'mercury'));
update public.transactions set external_id = 'merc-1' where id = pg_temp.id('line');
update public.transactions set external_id = 'merc-2' where id = pg_temp.id('quiet');
update public.transactions set external_id = 'merc-1' where id = pg_temp.id('other_line');

-- MCP write tokens for each owner.
select public.store_mcp_credential(tests.get_supabase_uid('th_owner'), 'hash-th-write-0001', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into th (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-th-write-0001';
select public.store_mcp_credential(tests.get_supabase_uid('th_other'), 'hash-th-write-0002', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into th (label, id) select 'other_write', id from private.mcp_credentials where token_hash = 'hash-th-write-0002';

create function pg_temp.as_mcp(p_label text, p_user text default 'th_owner')
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid(p_user);
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id(p_label))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated, service_role;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
end;
$$;
grant execute on function pg_temp.as_service() to authenticated, service_role;

-- 1-3. The tables are not read directly; the bucket is private.
select ok(not has_table_privilege('authenticated', 'public.transaction_notes', 'select'),
  'notes are read through the RPCs only');
select ok(not has_table_privilege('authenticated', 'public.transaction_files', 'select'),
  'files are read through the RPCs only');
select is((select public from storage.buckets where id = 'transaction-files'), false, 'the bucket is private');

-- 4-9. The app: a note, its thread, and an edit.
select tests.authenticate_as('th_owner');
insert into th (label, id) values ('n1', public.add_transaction_note(pg_temp.id('line'), '  Check against the quote  '));
select is(jsonb_array_length(public.get_transaction_thread(pg_temp.id('line'))->'notes'), 1, 'the thread holds the note');
select is(public.get_transaction_thread(pg_temp.id('line'))->'notes'->0->>'body', 'Check against the quote',
  'the note is trimmed');
select is((public.get_transaction_thread(pg_temp.id('line'))->'notes'->0->>'mine')::boolean, true, 'the author''s note is mine');
select throws_ok($$ select public.add_transaction_note(pg_temp.id('line'), '   ') $$, 'note is invalid',
  'an empty note is refused');
select throws_ok($$ select public.add_transaction_note(pg_temp.id('other_line'), 'Not mine') $$, 'line not found',
  'a note on another company''s line is refused');
select is(public.edit_transaction_note(pg_temp.id('n1'), 'Check against the second quote')->>'before',
  'Check against the quote', 'an edit returns the text before');

-- 10-12. Another company sees nothing and changes nothing.
select tests.authenticate_as('th_other');
select is(public.get_transaction_thread(pg_temp.id('line')), null, 'another company reads no thread');
select throws_ok($$ select public.edit_transaction_note(pg_temp.id('n1'), 'Taken over') $$, 'note not found',
  'another company cannot edit the note');
select is(public.transaction_thread_counts(array[pg_temp.id('line')]), '{}'::jsonb, 'another company counts nothing');

-- 13-18. A file: uploaded to <company>/<line>/..., then recorded. The bucket's rules: the company's
-- own folder and one of its lines only.
reset role;
insert into storage.objects (bucket_id, name, owner)
values ('transaction-files', pg_temp.id('co')::text || '/' || pg_temp.id('line')::text || '/receipt-1.pdf',
  tests.get_supabase_uid('th_owner'));
select tests.authenticate_as('th_owner');
insert into th (label, id) values ('f1', public.add_transaction_file(pg_temp.id('line'), pg_temp.id('n1'),
  pg_temp.id('co')::text || '/' || pg_temp.id('line')::text || '/receipt-1.pdf', 'receipt.pdf', 'application/pdf', 52000));
select is(public.get_transaction_thread(pg_temp.id('line'))->'files'->0->>'note_id', pg_temp.id('n1')::text,
  'the file is on its note');
select throws_ok(
  format($$ select public.add_transaction_file(%L, null, %L, 'x.pdf', 'application/pdf', 10) $$,
    pg_temp.id('line'), pg_temp.id('co')::text || '/' || pg_temp.id('line')::text || '/missing.pdf'),
  'file not uploaded', 'a file that was not uploaded is refused');
select throws_ok(
  format($$ select public.add_transaction_file(%L, null, %L, 'x.pdf', 'application/pdf', 10) $$,
    pg_temp.id('line'), pg_temp.id('other')::text || '/' || pg_temp.id('line')::text || '/receipt-1.pdf'),
  'path is invalid', 'a path outside the company is refused');
select throws_ok(
  format($$ select public.add_transaction_file(%L, null, %L, 'run.exe', 'application/x-msdownload', 10) $$,
    pg_temp.id('line'), pg_temp.id('co')::text || '/' || pg_temp.id('line')::text || '/receipt-1.pdf'),
  'file type is invalid', 'a file that is not a picture or a PDF is refused');
select lives_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('transaction-files', %L) $$,
    pg_temp.id('co')::text || '/' || pg_temp.id('line')::text || '/photo-2.jpg'),
  'a writer uploads under its company and line');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('transaction-files', %L) $$,
    pg_temp.id('other')::text || '/' || pg_temp.id('other_line')::text || '/photo-3.jpg'),
  '42501', null, 'a writer cannot upload under another company');

-- 19-20. Counts for the approval card.
select is(public.transaction_thread_counts(array[pg_temp.id('line'), pg_temp.id('quiet')]),
  jsonb_build_object(pg_temp.id('line')::text, jsonb_build_object('notes', 1, 'files', 1)),
  'the line with a note and a file is counted; the quiet line is left out');
select is((select count(*)::int from storage.objects where bucket_id = 'transaction-files'
  and name like pg_temp.id('other')::text || '/%'), 0, 'the writer reads none of another company''s files');

-- 21-27. Mercury: the sync brings the note and lists the attachments not copied yet.
select tests.authenticate_as('th_owner');
select throws_ok($$ select public.sync_mercury_threads(pg_temp.id('co'), '[]'::jsonb) $$, '42501', null,
  'only the sync writes Mercury''s threads');
select pg_temp.as_service();
insert into th_out (label, body) values ('sync1', public.sync_mercury_threads(pg_temp.id('co'), jsonb_build_array(
  jsonb_build_object('external_id', 'merc-1', 'note', 'Lumber for back deck, invoice #4471', 'files', jsonb_build_array('receipt-4471.pdf')),
  jsonb_build_object('external_id', 'merc-2', 'note', null, 'files', '[]'::jsonb),
  jsonb_build_object('external_id', 'unknown', 'note', 'Nobody''s', 'files', jsonb_build_array('x.pdf'))
)));
select is(jsonb_array_length(pg_temp.out_of('sync1')), 1, 'one attachment waits to be copied');
select is(pg_temp.out_of('sync1')->0->>'transaction_id', pg_temp.id('line')::text,
  'it is the owner''s line, not the other company''s line with the same Mercury id');
select is((select body from public.transaction_notes where transaction_id = pg_temp.id('line') and source = 'mercury'),
  'Lumber for back deck, invoice #4471', 'Mercury''s note comes in whole');
select is((select count(*)::int from public.transaction_notes where transaction_id = pg_temp.id('other_line')), 0,
  'the other company''s line gets nothing');
select isnt(public.record_mercury_file(pg_temp.id('co'), pg_temp.id('line'),
  pg_temp.id('co')::text || '/' || pg_temp.id('line')::text || '/m-receipt-4471.pdf', 'receipt-4471.pdf', 'application/pdf', 1200),
  null, 'the copied attachment is recorded');
select is(jsonb_array_length(public.sync_mercury_threads(pg_temp.id('co'), jsonb_build_array(
  jsonb_build_object('external_id', 'merc-1', 'note', 'Lumber for back deck, invoice #4471', 'files', jsonb_build_array('receipt-4471.pdf'))
))), 0, 'a copied attachment is not asked for again');
select throws_ok(
  format($$ select public.record_mercury_file(%L, %L, %L, 'x.pdf', 'application/pdf', 10) $$,
    pg_temp.id('co'), pg_temp.id('line'), pg_temp.id('other')::text || '/x.pdf'),
  'path is invalid', 'a copied file goes under its own company and line');

-- 28-33. An edit of Mercury's note in Flow waits to be sent, and the sync keeps it.
reset role;
insert into th (label, id) select 'mn', id from public.transaction_notes
  where transaction_id = pg_temp.id('line') and source = 'mercury';
select tests.authenticate_as('th_owner');
select public.edit_transaction_note(pg_temp.id('mn'), 'Lumber for back deck, invoice #4471, phase 2');
select is(public.get_transaction_thread(pg_temp.id('line'))->'notes'->0->>'mercury_push', 'pending',
  'an edit of Mercury''s note waits to be sent');
select is(public.mercury_note_push_target(pg_temp.id('mn'))->>'external_id', 'merc-1', 'the app finds what to send');
select pg_temp.as_service();
select public.sync_mercury_threads(pg_temp.id('co'), jsonb_build_array(
  jsonb_build_object('external_id', 'merc-1', 'note', 'Lumber for back deck, invoice #4471', 'files', '[]'::jsonb)));
select is((select body from public.transaction_notes where id = pg_temp.id('mn')),
  'Lumber for back deck, invoice #4471, phase 2', 'a sync does not overwrite an edit that waits');
select is(jsonb_array_length(public.mercury_note_pushes(pg_temp.id('co'))), 1, 'the sync finds the edit to send');
select is(public.mercury_note_pushed(pg_temp.id('mn'), '2000-01-01', 'sent'), false,
  'a send of an older text does not mark a newer one');
select is(public.mercury_note_pushed(pg_temp.id('mn'),
  (select updated_at from public.transaction_notes where id = pg_temp.id('mn')), 'sent'), true,
  'the sent text is back in step with Mercury');

-- 34. A note cleared in Mercury, in step, is removed.
select public.sync_mercury_threads(pg_temp.id('co'), jsonb_build_array(
  jsonb_build_object('external_id', 'merc-1', 'note', null, 'files', '[]'::jsonb)));
select is((select count(*)::int from public.transaction_notes where id = pg_temp.id('mn')), 0,
  'a note cleared in Mercury goes');

-- 35-44. MCP: add, edit, remove a note and remove a file, each undone.
select pg_temp.as_mcp('write');
insert into th_out (label, body) values ('m_add', public.mcp_add_transaction_note('th-a-1', pg_temp.id('line'), 'From the assistant'));
select is((pg_temp.out_of('m_add')->>'ok')::boolean, true, 'mcp adds a note');
select is(public.mcp_add_transaction_note('th-a-1', pg_temp.id('line'), 'From the assistant'), pg_temp.out_of('m_add'),
  'the same key replays the same answer');
select is(public.mcp_add_transaction_note('th-a-1', pg_temp.id('line'), 'Something else')->'error'->>'code', 'conflict',
  'the same key with other text is a conflict');
insert into th_out (label, body) values ('m_edit', public.mcp_edit_transaction_note('th-e-1',
  (pg_temp.out_of('m_add')->'data'->>'id')::uuid, 'From the assistant, edited'));
select is((public.mcp_undo('th-u-1', 'note_edit', (pg_temp.out_of('m_add')->'data'->>'id')::uuid)->>'ok')::boolean, true,
  'undo puts the text back');
select is((select n->>'body' from jsonb_array_elements(public.get_transaction_thread(pg_temp.id('line'))->'notes') n
  where n->>'id' = pg_temp.out_of('m_add')->'data'->>'id'), 'From the assistant', 'the note has its text before the edit');
select is((public.mcp_undo('th-u-2', 'note_add', (pg_temp.out_of('m_add')->'data'->>'id')::uuid)->>'ok')::boolean, true,
  'undo removes the added note');
select is((public.mcp_remove_transaction_note('th-r-1', pg_temp.id('n1'))->>'ok')::boolean, true,
  'mcp removes the owner''s note');
select is((public.mcp_undo('th-u-3', 'note_remove', pg_temp.id('n1'))->>'ok')::boolean, true, 'undo brings it back');
select is((public.mcp_remove_transaction_file('th-f-1', pg_temp.id('f1'))->>'ok')::boolean, true, 'mcp removes a file');
select pg_temp.as_mcp('other_write', 'th_other');
select is(public.mcp_undo('th-u-x', 'file_remove', pg_temp.id('f1'))->'error'->>'code', 'not_found',
  'another company cannot undo it');

select * from finish();
rollback;
