-- FLOW-965 (decision 0216): remember_line_category files a supplier's next lines in the line's
-- category; forget_line_category and MCP undo put the prior one back. Invented data only.

begin;

select plan(35);

do $users$
begin
  perform tests.create_supabase_user('scr_owner', 'scr-owner@example.com');
  perform tests.create_supabase_user('scr_other', 'scr-other@example.com');
  perform tests.create_supabase_user('scr_viewer', 'scr-viewer@example.com');
end
$users$;

create temp table scr (label text primary key, id uuid);
grant all on scr to authenticated, service_role;
insert into scr (label, id) values ('co', tests.fixture_company('scr_owner', 'Example Supplier Rule LLC'));
insert into scr (label, id) values ('other_co', tests.fixture_company('scr_other', 'Example Other Rule LLC'));
insert into scr (label, id) select 'proj', tests.fixture_project(id, 'Example Cedar St') from scr where label = 'co';
insert into scr (label, id) select 'tools', tests.fixture_category(id, 'Example tools') from scr where label = 'co';
insert into scr (label, id) select 'rent', tests.fixture_category(id, 'Example rent') from scr where label = 'co';
insert into scr (label, id) select 'fees', tests.fixture_category(id, 'Example fees', 'income') from scr where label = 'co';
insert into scr (label, id) select 'principal', c.id from public.categories c
  where c.company_id = (select id from scr where label = 'co') and c.loan_part is not null limit 1;

insert into public.suppliers (company_id, name, remembered_category_id)
select id, 'Example Depot', (select id from scr where label = 'rent') from scr where label = 'co';
insert into scr (label, id) select 'depot', s.id from public.suppliers s where s.name = 'Example Depot';

insert into scr (label, id)
select 'line', tests.fixture_line(id, 'scr:line', 120000, 'expense', (select id from scr where label = 'proj'), (select id from scr where label = 'tools'), '2026-10-05') from scr where label = 'co';
insert into scr (label, id)
select 'no_supplier', tests.fixture_line(id, 'scr:no-supplier', 50000, 'expense', (select id from scr where label = 'proj'), (select id from scr where label = 'tools'), '2026-10-06') from scr where label = 'co';
insert into scr (label, id)
select 'income', tests.fixture_line(id, 'scr:income', 90000, 'income', (select id from scr where label = 'proj'), (select id from scr where label = 'fees'), '2026-10-07') from scr where label = 'co';
insert into scr (label, id)
select 'no_category', tests.fixture_line(id, 'scr:no-category', 30000, 'expense', (select id from scr where label = 'proj'), null, '2026-10-08') from scr where label = 'co';
insert into scr (label, id)
select 'loan_line', tests.fixture_line(id, 'scr:loan', 70000, 'expense', (select id from scr where label = 'proj'), (select id from scr where label = 'principal'), '2026-10-09') from scr where label = 'co';
insert into scr (label, id)
select 'split_line', tests.fixture_line(id, 'scr:split', 60000, 'expense', (select id from scr where label = 'proj'), (select id from scr where label = 'tools'), '2026-10-10') from scr where label = 'co';
insert into scr (label, id)
select 'shared_line', tests.fixture_line(id, 'scr:shared', 40000, 'expense', (select id from scr where label = 'proj'), (select id from scr where label = 'tools'), '2026-10-11') from scr where label = 'co';
update public.transactions set supplier_id = (select id from scr where label = 'depot')
where id in (select id from scr where label in ('line', 'no_category', 'loan_line', 'split_line', 'shared_line'));
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
values
  ((select id from scr where label = 'co'), (select id from scr where label = 'split_line'), 1, (select id from scr where label = 'tools'), null, 40000),
  ((select id from scr where label = 'co'), (select id from scr where label = 'split_line'), 2, (select id from scr where label = 'rent'), null, 20000);
update public.transactions set pnl_role = 'shared' where id = (select id from scr where label = 'shared_line');

insert into public.company_members (company_id, user_id, role)
select id, tests.get_supabase_uid('scr_viewer'), 'viewer' from scr where label = 'co';
insert into public.active_companies (user_id, company_id)
select tests.get_supabase_uid('scr_viewer'), id from scr where label = 'co';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
select tests.get_supabase_uid('scr_owner'), id, 'hash-scr-owner-write', 'kid', array['write']::text[], '2099-01-01'::timestamptz
from scr where label = 'co';
insert into scr (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-scr-owner-write';

create or replace function pg_temp.as_mcp(p_user text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  select id into tid from pg_temp.scr where label = 'write';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

create or replace function pg_temp.remembered()
returns uuid
language sql
as $$ select s.remembered_category_id from public.suppliers s where s.id = (select id from pg_temp.scr where label = 'depot'); $$;
grant execute on function pg_temp.remembered() to authenticated, service_role;

create or replace function pg_temp.id_of(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.scr where label = p_label; $$;
grant execute on function pg_temp.id_of(text) to authenticated, service_role;

-- The app's write.
select tests.authenticate_as('scr_owner');
select is(
  public.remember_line_category(pg_temp.id_of('line'), pg_temp.id_of('tools')) ->> 'prior_category_id',
  pg_temp.id_of('rent')::text,
  'remember returns the category the supplier had'
);
select is(pg_temp.remembered(), pg_temp.id_of('tools'), 'the supplier now remembers the line''s category');
select is(
  public.remember_line_category(pg_temp.id_of('line'), pg_temp.id_of('tools')) ->> 'supplier_name',
  'Example Depot',
  'and names the supplier'
);
select throws_ok(
  format('select public.remember_line_category(%L, %L)', pg_temp.id_of('no_supplier'), pg_temp.id_of('tools')),
  'P0001', 'the line has no supplier', 'a line with no supplier is refused'
);
select throws_ok(
  format('select public.remember_line_category(%L, %L)', pg_temp.id_of('income'), pg_temp.id_of('fees')),
  'P0001', 'the line has no supplier', 'an income line is refused'
);
select throws_ok(
  format('select public.remember_line_category(%L, %L)', pg_temp.id_of('no_category'), pg_temp.id_of('tools')),
  'P0001', 'the line has no category', 'a line with no category is refused'
);
select throws_ok(
  format('select public.remember_line_category(%L, %L)', pg_temp.id_of('loan_line'), pg_temp.id_of('principal')),
  'P0001', 'a loan category is not remembered', 'a loan category is refused'
);
select throws_ok(
  format('select public.remember_line_category(%L, %L)', pg_temp.id_of('split_line'), pg_temp.id_of('tools')),
  'P0001', 'a split line is not remembered', 'a line split into parts is refused'
);
select throws_ok(
  format('select public.remember_line_category(%L, %L)', pg_temp.id_of('shared_line'), pg_temp.id_of('tools')),
  'P0001', 'a split line is not remembered', 'a shared line is refused'
);
select throws_ok(
  format('select public.remember_line_category(%L, %L)', pg_temp.id_of('line'), pg_temp.id_of('rent')),
  'P0001', 'conflict', 'a category the line no longer holds is a conflict'
);
select is(pg_temp.remembered(), pg_temp.id_of('tools'), 'the conflict left the supplier as it was');

-- Undo: back to the prior, and a conflict once it changed since.
select is(
  public.forget_line_category(pg_temp.id_of('depot'), pg_temp.id_of('tools'), pg_temp.id_of('rent')) ->> 'remembered_category_id',
  pg_temp.id_of('rent')::text,
  'forget puts the prior category back'
);
select is(pg_temp.remembered(), pg_temp.id_of('rent'), 'the supplier remembers the prior again');
select throws_ok(
  format('select public.forget_line_category(%L, %L, %L)', pg_temp.id_of('depot'), pg_temp.id_of('tools'), pg_temp.id_of('rent')),
  'P0001', 'conflict', 'forget is a conflict once the supplier remembers something else'
);
select is(
  public.forget_line_category(pg_temp.id_of('depot'), pg_temp.id_of('rent'), pg_temp.id_of('fees')) ->> 'remembered_category_id',
  null,
  'a prior that is not an expense category comes back as none'
);
select is(pg_temp.remembered(), null::uuid, 'the supplier remembers no category');
reset role;
update public.suppliers set remembered_category_id = pg_temp.id_of('tools') where id = pg_temp.id_of('depot');
select tests.authenticate_as('scr_owner');
select is(
  public.forget_line_category(pg_temp.id_of('depot'), pg_temp.id_of('tools'), pg_temp.id_of('principal')) ->> 'remembered_category_id',
  null,
  'a loan category as the prior comes back as none'
);
select lives_ok(
  format('select public.remember_line_category(%L, %L)', pg_temp.id_of('line'), pg_temp.id_of('tools')),
  'remember again from none'
);
select is(
  public.forget_line_category(pg_temp.id_of('depot'), pg_temp.id_of('tools'), null) ->> 'remembered_category_id',
  null,
  'forget from none puts none back'
);

-- Another company and a viewer.
select tests.authenticate_as('scr_other');
select throws_ok(
  format('select public.remember_line_category(%L, %L)', pg_temp.id_of('line'), pg_temp.id_of('tools')),
  'P0001', 'transaction not found', 'another company''s line is not found'
);
select throws_ok(
  format('select public.forget_line_category(%L, %L, %L)', pg_temp.id_of('depot'), pg_temp.id_of('tools'), pg_temp.id_of('rent')),
  'P0001', 'supplier not found', 'another company''s supplier is not found'
);
select tests.authenticate_as('scr_viewer');
select throws_ok(
  format('select public.remember_line_category(%L, %L)', pg_temp.id_of('line'), pg_temp.id_of('tools')),
  '42501', 'forbidden', 'a viewer cannot remember'
);
select throws_ok(
  format('select public.forget_line_category(%L, %L, %L)', pg_temp.id_of('depot'), pg_temp.id_of('tools'), pg_temp.id_of('rent')),
  '42501', 'forbidden', 'a viewer cannot forget'
);
reset role;
select is(pg_temp.remembered(), null::uuid, 'neither changed the supplier');

-- MCP: the write, its replay, its undo and the undo's conflict.
select pg_temp.as_mcp('scr_owner');
select is(
  public.mcp_remember_supplier_category('scr-1', pg_temp.id_of('line'), pg_temp.id_of('tools')) -> 'data' ->> 'undo_kind',
  'supplier_category',
  'MCP remembers with undo kind supplier_category'
);
select is(
  public.mcp_remember_supplier_category('scr-1', pg_temp.id_of('line'), pg_temp.id_of('tools')) -> 'data' ->> 'category_id',
  pg_temp.id_of('tools')::text,
  'a repeated key replays the stored response'
);
reset role;
select is(pg_temp.remembered(), pg_temp.id_of('tools'), 'MCP wrote the remembered category');
select pg_temp.as_mcp('scr_owner');
select is(
  public.mcp_remember_supplier_category('scr-2', pg_temp.id_of('no_supplier'), pg_temp.id_of('tools')) -> 'error' ->> 'message',
  'the line has no supplier',
  'MCP says why a line cannot be remembered'
);
select is(
  public.mcp_remember_supplier_category('scr-2c', pg_temp.id_of('line'), pg_temp.id_of('rent')) -> 'error' ->> 'code',
  'conflict',
  'MCP is a conflict when the line holds another category'
);
reset role;
select is(
  (select count(*)::int from private.mcp_writes w where w.kind = 'supplier_category'),
  1,
  'a refused MCP write records nothing to undo'
);
select pg_temp.as_mcp('scr_owner');
select is(
  public.mcp_undo('scr-undo-1', 'supplier_category', pg_temp.id_of('line')) ->> 'ok',
  'true',
  'MCP undo puts the prior back'
);
reset role;
select is(pg_temp.remembered(), null::uuid, 'the supplier remembers none again');
select pg_temp.as_mcp('scr_owner');
select is(
  public.mcp_remember_supplier_category('scr-3', pg_temp.id_of('line'), pg_temp.id_of('tools')) ->> 'ok',
  'true',
  'MCP remembers again'
);
reset role;
update public.suppliers set remembered_category_id = pg_temp.id_of('rent') where id = pg_temp.id_of('depot');
select pg_temp.as_mcp('scr_owner');
select is(
  public.mcp_undo('scr-undo-2', 'supplier_category', pg_temp.id_of('line')) -> 'error' ->> 'code',
  'conflict',
  'MCP undo is a conflict once the supplier remembers something else'
);
reset role;
select is(pg_temp.remembered(), pg_temp.id_of('rent'), 'the later change stays');

select * from finish();
rollback;
