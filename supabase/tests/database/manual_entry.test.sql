-- FLOW-369 server: the add sheet's writes. create_manual_line and mcp_create_manual_entry (a cash
-- or cheque line, idempotent, undo removes it), attach_line_document and mcp_attach_document (a
-- document on an existing line, no second line), receipt_match, and the refusals across companies.
-- Invented names and amounts only.

begin;

select plan(54);

do $users$
begin
  perform tests.create_supabase_user('me_owner', 'me-owner@example.com');
  perform tests.create_supabase_user('me_other', 'me-other@example.com');
end
$users$;

create temp table me (label text primary key, id uuid);
grant all on me to authenticated, service_role;
create temp table me_out (label text primary key, body jsonb);
grant all on me_out to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from me where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create function pg_temp.out_of(p_label text) returns jsonb language sql stable as $$
  select body from me_out where label = p_label;
$$;
grant execute on function pg_temp.out_of(text) to authenticated, service_role;

create function pg_temp.err(p_body jsonb) returns text language sql immutable as $$
  select coalesce(p_body->'error'->>'code', '') || ' ' || coalesce(p_body->'error'->>'message', '');
$$;
grant execute on function pg_temp.err(jsonb) to authenticated, service_role;

-- The other company first, so the owner's company is the one the rest of the file uses.
select tests.authenticate_as('me_other');
select public.create_company('Other Entry Co', true);
insert into me (label, id) select 'other_co', id from public.companies where name = 'Other Entry Co';
select public.upsert_project(null, 'Other Site', null, 'active', null);
insert into me (label, id) select 'other_proj', id from public.projects where name = 'Other Site';
insert into me (label, id) select 'other_cat', id from public.categories
  where company_id = pg_temp.id('other_co') and kind = 'expense' order by name limit 1;

select tests.authenticate_as('me_owner');
select public.create_company('Entry Books', true);
insert into me (label, id) select 'co', id from public.companies where name = 'Entry Books';
select public.upsert_project(null, 'Harbor Rd', null, 'active', 'flip');
select public.upsert_project(null, 'Ferry Ln', null, 'active', 'rental');
insert into me (label, id) select 'harbor', id from public.projects where name = 'Harbor Rd';
insert into me (label, id) select 'ferry', id from public.projects where name = 'Ferry Ln';
insert into me (label, id) select 'cat_out', id from public.categories
  where company_id = pg_temp.id('co') and kind = 'expense' order by name limit 1;
insert into me (label, id) select 'cat_in', id from public.categories
  where company_id = pg_temp.id('co') and kind = 'income' order by name limit 1;

-- A bank line in the owner's company (a provider line, not manual), and one in the other company.
reset role;
insert into me (label, id) values
  ('bank_line', tests.fixture_line(pg_temp.id('co'), 'me:bank-line', 40900, 'expense', pg_temp.id('harbor'),
    pg_temp.id('cat_out'), '2026-10-10', 'ILS', 'posted', 'sumit', 'project', 'invoice_receipt')),
  ('other_bank', tests.fixture_line(pg_temp.id('other_co'), 'me:other-bank', 40900, 'expense', pg_temp.id('other_proj'),
    pg_temp.id('other_cat'), '2026-10-10', 'ILS', 'posted', 'sumit', 'project', 'invoice_receipt'));

-- MCP: a write token for the owner, and one for the other company's owner.
select public.store_mcp_credential(tests.get_supabase_uid('me_owner'), 'hash-me-write-0001', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into me (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-me-write-0001';
select public.store_mcp_credential(tests.get_supabase_uid('me_other'), 'hash-me-write-0002', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into me (label, id) select 'other_write', id from private.mcp_credentials where token_hash = 'hash-me-write-0002';

create function pg_temp.as_mcp(p_label text, p_user text default 'me_owner')
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

-- The app's path (no MCP token): create_manual_line.
select tests.authenticate_as('me_owner');
select lives_ok(
  $$select public.create_manual_line('expense', 35000, '2026-10-11', 'Ajax Hardware', (select id from me where label = 'harbor'), (select id from me where label = 'cat_out'), 'cash', null)$$,
  'the app adds a cash line'
);
insert into me (label, id) select 'cash_line', id from public.transactions
  where company_id = pg_temp.id('co') and description = 'Ajax Hardware';

select is((select source::text from public.transactions where id = pg_temp.id('cash_line')), 'manual', 'a cash line is a manual line');
select is((select amount_gross from public.transactions where id = pg_temp.id('cash_line')), -35000::bigint, 'an expense is stored negative');
select is((select provider_meta->>'method' from public.transactions where id = pg_temp.id('cash_line')), 'cash', 'the method is kept');
select is((select pnl_role::text from public.transactions where id = pg_temp.id('cash_line')), 'project', 'a line with a project is a project line');

select lives_ok(
  $$select public.create_manual_line('expense', 240000, '2026-10-11', 'Rivera Drywall', (select id from me where label = 'ferry'), (select id from me where label = 'cat_out'), 'cheque', '1048')$$,
  'the app adds a cheque line with its number'
);
insert into me (label, id) select 'cheque_line', id from public.transactions
  where company_id = pg_temp.id('co') and description = 'Rivera Drywall';
select is((select provider_meta->>'cheque_number' from public.transactions where id = pg_temp.id('cheque_line')), '1048', 'the cheque number is kept');

select lives_ok(
  $$select public.create_manual_line('expense', 900, '2026-10-11', 'Overhead Stores', null, (select id from me where label = 'cat_out'), 'cash', null)$$,
  'a line with no project is overhead'
);
select is(
  (select pnl_role::text from public.transactions where company_id = pg_temp.id('co') and description = 'Overhead Stores' and amount_gross = -900),
  'overhead',
  'no project files the line as overhead'
);
select throws_ok($$select public.create_manual_line('expense', 240000, '2026-10-11', 'Rivera Drywall', (select id from me where label = 'ferry'), (select id from me where label = 'cat_out'), 'cheque', '')$$,
  'cheque number is invalid', 'a cheque needs its number');
select throws_ok($$select public.create_manual_line('transfer', 1000, '2026-10-11', 'Ajax Hardware', (select id from me where label = 'harbor'), (select id from me where label = 'cat_out'), 'cash', null)$$,
  'direction must be income or expense', 'the direction is income or expense');
select throws_ok($$select public.create_manual_line('expense', 0, '2026-10-11', 'Ajax Hardware', (select id from me where label = 'harbor'), (select id from me where label = 'cat_out'), 'cash', null)$$,
  'amount must be above zero', 'an amount of zero is refused');
select throws_ok($$select public.create_manual_line('expense', 1000, '2026-10-11', 'A', (select id from me where label = 'harbor'), (select id from me where label = 'cat_out'), 'cash', null)$$,
  'payee is invalid', 'a one-letter payee is refused');
select throws_ok($$select public.create_manual_line('expense', 1000, '2026-10-11', 'Ajax Hardware', (select id from me where label = 'harbor'), (select id from me where label = 'cat_in'), 'cash', null)$$,
  'category not found', 'an income category is refused on an expense');
select throws_ok($$select public.create_manual_line('expense', 1000, '2026-10-11', 'Ajax Hardware', (select id from me where label = 'other_proj'), (select id from me where label = 'cat_out'), 'cash', null)$$,
  'project not found', 'another company''s project is refused (cross-tenant)');
select throws_ok($$select public.create_manual_line('expense', 1000, '2026-10-11', 'Ajax Hardware', (select id from me where label = 'harbor'), (select id from me where label = 'other_cat'), 'cash', null)$$,
  'category not found', 'another company''s category is refused (cross-tenant)');

-- MCP create_manual_entry: the first write, its replay, a change under the same key, undo.
select pg_temp.as_mcp('write');
insert into me_out (label, body)
values ('m1', public.mcp_create_manual_entry('me-m-1', 'expense', 12500, '2026-10-12', 'Corner Supply',
  pg_temp.id('harbor'), pg_temp.id('cat_out'), 'cash', null));
select ok((pg_temp.out_of('m1')->>'ok')::boolean, 'mcp create_manual_entry writes a line');
select is(pg_temp.out_of('m1')->'data'->>'undo_kind', 'manual_entry', 'the write returns the manual_entry undo kind');
select is(
  (select count(*)::int from public.transactions where company_id = pg_temp.id('co') and description = 'Corner Supply'),
  1,
  'one line for the write'
);

insert into me_out (label, body)
values ('m1_replay', public.mcp_create_manual_entry('me-m-1', 'expense', 12500, '2026-10-12', 'Corner Supply',
  pg_temp.id('harbor'), pg_temp.id('cat_out'), 'cash', null));
select is(
  pg_temp.out_of('m1_replay')->'data'->>'id',
  pg_temp.out_of('m1')->'data'->>'id',
  'the same key and input replays the stored response'
);
select is(
  (select count(*)::int from public.transactions where company_id = pg_temp.id('co') and description = 'Corner Supply'),
  1,
  'a replay makes no second line'
);
select is(
  public.mcp_create_manual_entry('me-m-1', 'expense', 13000, '2026-10-12', 'Corner Supply',
    pg_temp.id('harbor'), pg_temp.id('cat_out'), 'cash', null)->'error'->>'code',
  'conflict',
  'the same key with another amount is a conflict'
);
select is(
  public.mcp_create_manual_entry('me-m-2', 'expense', 500, '2026-10-12', 'Corner Supply',
    pg_temp.id('other_proj'), pg_temp.id('cat_out'), 'cash', null)->'error'->>'message',
  'project not found',
  'mcp refuses another company''s project'
);
select is(
  public.mcp_create_manual_entry('me-m-3', 'expense', 500, '2026-10-12', 'Corner Supply',
    pg_temp.id('harbor'), pg_temp.id('cat_out'), 'card', null)->'error'->>'message',
  'method must be cash or cheque',
  'mcp refuses a method other than cash or cheque'
);
select is(
  public.mcp_create_manual_entry('', 'expense', 500, '2026-10-12', 'Corner Supply',
    pg_temp.id('harbor'), pg_temp.id('cat_out'), 'cash', null)->'error'->>'code',
  'validation',
  'mcp needs an idempotency key'
);
select is(
  public.mcp_create_manual_entry('me-m-4', 'expense', 500, '2026-10-12', 'Corner Supply',
    pg_temp.id('harbor'), pg_temp.id('cat_out'), 'cash', null)->'data'->>'undo_kind',
  'manual_entry',
  'mcp writes another line under a new key'
);

-- The other company's token cannot undo the owner's line, and sees nothing of it.
select pg_temp.as_mcp('other_write', 'me_other');
select is(
  public.mcp_undo('me-u-x', 'manual_entry', pg_temp.id('cash_line'))->'error'->>'code',
  'not_found',
  'another company cannot undo a manual line'
);

select pg_temp.as_mcp('write');
insert into me_out (label, body)
values ('undo1', public.mcp_undo('me-u-1', 'manual_entry', (pg_temp.out_of('m1')->'data'->>'id')::uuid));
select ok((pg_temp.out_of('undo1')->>'ok')::boolean, 'undo removes the manual line');
select is(
  (select count(*)::int from public.transactions where id = (pg_temp.out_of('m1')->'data'->>'id')::uuid),
  0,
  'the line is gone after undo'
);
select is(
  public.mcp_undo('me-u-2', 'manual_entry', (pg_temp.out_of('m1')->'data'->>'id')::uuid)->'error'->>'code',
  'not_found',
  'a second undo is not_found'
);

-- Undo refuses when the line changed since the write.
insert into me_out (label, body)
values ('m5', public.mcp_create_manual_entry('me-m-5', 'expense', 9100, '2026-10-12', 'Bayside Glass',
  pg_temp.id('harbor'), pg_temp.id('cat_out'), 'cash', null));
reset role;
update public.transactions set project_id = pg_temp.id('ferry')
where id = (pg_temp.out_of('m5')->'data'->>'id')::uuid;
select pg_temp.as_mcp('write');
select is(
  public.mcp_undo('me-u-3', 'manual_entry', (pg_temp.out_of('m5')->'data'->>'id')::uuid)->'error'->>'code',
  'conflict',
  'undo is a conflict when the line was moved to another project'
);

-- MCP attach_document: a document on the cash line, no second line.
insert into me_out (label, body)
values ('before_count', jsonb_build_object('n', (select count(*) from public.transactions where company_id = pg_temp.id('co'))));
select pg_temp.as_mcp('write');
insert into me_out (label, body)
values ('a1', public.mcp_attach_document('me-a-1', pg_temp.id('cash_line'),
  jsonb_build_object('name', 'receipt.pdf', 'mime', 'application/pdf', 'bytes', 20480,
    'sha256', repeat('a', 64))));
select ok((pg_temp.out_of('a1')->>'ok')::boolean, 'mcp attach_document attaches a document to a line');
select is(pg_temp.out_of('a1')->'data'->>'documents', '1', 'the line now holds one document');
select is(pg_temp.out_of('a1')->'data'->>'undo_kind', 'document_attach', 'the attach returns its undo kind');
select is(
  (select count(*) from public.transactions where company_id = pg_temp.id('co'))::int,
  (pg_temp.out_of('before_count')->>'n')::int,
  'attaching a document adds no line'
);
select is(
  public.mcp_attach_document('me-a-2', pg_temp.id('cash_line'),
    jsonb_build_object('name', 'again.pdf', 'mime', 'application/pdf', 'bytes', 20480,
      'sha256', repeat('a', 64)))->'error'->>'message',
  'document already attached',
  'the same file twice is refused'
);
select is(
  public.mcp_attach_document('me-a-3', pg_temp.id('cash_line'),
    jsonb_build_object('name', 'x.exe', 'mime', 'application/x-msdownload', 'bytes', 20, 'sha256', repeat('b', 64)))->'error'->>'message',
  'document type is not allowed',
  'a file type outside the list is refused'
);
select is(
  public.mcp_attach_document('me-a-4', pg_temp.id('cash_line'),
    jsonb_build_object('name', 'big.pdf', 'mime', 'application/pdf', 'bytes', 26214401, 'sha256', repeat('c', 64)))->'error'->>'message',
  'document size is invalid',
  'a file over 25 MB is refused'
);
select is(
  public.mcp_attach_document('me-a-5', pg_temp.id('other_bank'),
    jsonb_build_object('name', 'r.pdf', 'mime', 'application/pdf', 'bytes', 20, 'sha256', repeat('d', 64)))->'error'->>'message',
  'transaction not found',
  'another company''s line is refused'
);
select is(
  public.mcp_attach_document('me-a-6', pg_temp.id('bank_line'),
    jsonb_build_object('name', 'bank.jpg', 'mime', 'image/jpeg', 'bytes', 900, 'sha256', repeat('e', 64)))->'data'->>'documents',
  '1',
  'a bank line takes a document too'
);
select is(
  (select jsonb_array_length(attachments) from public.transactions where id = pg_temp.id('bank_line'))::int,
  1,
  'the bank line holds the document'
);

select pg_temp.as_mcp('other_write', 'me_other');
select is(
  public.mcp_attach_document('me-a-7', pg_temp.id('cash_line'),
    jsonb_build_object('name', 'r.pdf', 'mime', 'application/pdf', 'bytes', 20, 'sha256', repeat('f', 64)))->'error'->>'message',
  'transaction not found',
  'the other company cannot attach to the owner''s line'
);

select pg_temp.as_mcp('write');
insert into me_out (label, body)
values ('undo_a1', public.mcp_undo('me-u-a1', 'document_attach', pg_temp.id('cash_line')));
select ok((pg_temp.out_of('undo_a1')->>'ok')::boolean, 'undo of an attach works');
select is(
  (select jsonb_array_length(attachments) from public.transactions where id = pg_temp.id('cash_line'))::int,
  0,
  'undo puts the document list back'
);

-- The app's attach and detach (no MCP token), and the matched bank line.
select tests.authenticate_as('me_owner');
select lives_ok(
  $$select public.attach_line_document((select id from me where label = 'cheque_line'),
    '{"name":"cheque.jpg","mime":"image/jpeg","bytes":700,"sha256":"1111111111111111111111111111111111111111111111111111111111111111"}'::jsonb)$$,
  'the app attaches a document to a line'
);
select lives_ok(
  $$select public.detach_line_document((select id from me where label = 'cheque_line'), '1111111111111111111111111111111111111111111111111111111111111111')$$,
  'the app removes that document again'
);
select is(
  (select jsonb_array_length(attachments) from public.transactions where id = pg_temp.id('cheque_line'))::int,
  0,
  'the document is gone'
);

reset role;
update public.transactions set description = 'Harbor Hardware' where id = pg_temp.id('bank_line');
select tests.authenticate_as('me_owner');
select is(
  (select id from public.receipt_match(40900, '2026-10-12', 'Harbor Hardware')),
  pg_temp.id('bank_line'),
  'a receipt matches the bank line by amount, payee and date'
);
select is(
  (select id from public.receipt_match(40900, '2026-10-12', 'Harbor')),
  pg_temp.id('bank_line'),
  'a shorter payee name inside the line still matches'
);
select is(
  (select count(*)::int from public.receipt_match(40900, '2026-10-12', 'Corner Supply')),
  0,
  'a payee that is not in the line matches nothing'
);
select is(
  (select count(*)::int from public.receipt_match(40901, '2026-10-12', 'Harbor Hardware')),
  0,
  'another amount matches nothing'
);
select is(
  (select count(*)::int from public.receipt_match(40900, '2026-10-16', 'Harbor Hardware')),
  0,
  'a receipt more than 3 days away matches nothing'
);
select is(
  (select count(*)::int from public.receipt_match(35000, '2026-10-11', 'Ajax Hardware')),
  0,
  'a manual line is never a bank match'
);

select is(
  (select count(*)::int from public.transactions where company_id = pg_temp.id('co')),
  (pg_temp.out_of('before_count')->>'n')::int,
  'the owner''s line count is what it was before the attaches'
);

select * from finish();
rollback;
