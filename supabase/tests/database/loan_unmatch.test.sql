-- FLOW-114 (decision 0136). The owner takes a loan payment off its loan (clear_loan_split), MCP
-- does the same with detach_loan_payment and undo kind loan_detach, and get_transaction returns
-- the loan split. Invented data only. Amounts are agorot.

begin;

select plan(31);

do $users$
begin
  perform tests.create_supabase_user('lun_owner', 'lun-owner@example.com');
  perform tests.create_supabase_user('lun_viewer', 'lun-viewer@example.com');
  perform tests.create_supabase_user('lun_other', 'lun-other@example.com');
end
$users$;

create temp table lun (label text primary key, id uuid);
grant all on lun to authenticated, service_role;

insert into lun (label, id) values ('co', tests.fixture_company('lun_owner', 'Example Unmatch LLC', true));
insert into lun (label, id) values ('other_co', tests.fixture_company('lun_other', 'Example Other LLC'));
insert into lun (label, id) values ('materials', tests.fixture_category((select id from lun where label = 'co'), 'Materials'));
insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('lun_viewer'), (select id from lun where label = 'co'));

insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency
)
values ((select id from lun where label = 'co'), 'Example mortgage', 12000000, 60000, 360, '2026-01-01', 100000, 20000, 'ILS');
insert into lun (label, id) select 'loan', id from public.loans where company_id = (select id from lun where label = 'co');
insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months,
  start_date, payment_minor, escrow_minor, currency, kind
)
values ((select id from lun where label = 'co'), 'Example demand loan', 5000000, 60000, null, '2026-01-01', null, 0, 'ILS', 'demand');
insert into lun (label, id) select 'demand', id from public.loans where name = 'Example demand loan';

-- Four payments of 1000.00 and one plain line; one line in the other company.
insert into lun (label, id)
select 'txn_' || v.k, tests.fixture_line((select id from lun where label = 'co'), 'lun:' || v.k, 100000,
  p_category => (select id from lun where label = 'materials'), p_doc_date => v.d::date,
  p_doc_kind => 'expense', p_pnl_role => null)
from (values ('app', '2026-06-01'), ('mcp', '2026-06-02'), ('again', '2026-06-03'),
  ('gone', '2026-06-04'), ('plain', '2026-06-05'), ('fit', '2026-06-06'),
  ('dem1', '2026-06-10'), ('dem2', '2026-06-20')) as v(k, d);
insert into lun (label, id) values ('txn_other', tests.fixture_line(
  (select id from lun where label = 'other_co'), 'lun:other', 100000, p_doc_kind => 'expense', p_pnl_role => null));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.lun where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- Interest 700.00, escrow 200.00, principal 100.00 on the company's loan-part categories.
-- A demand loan has no escrow, so its escrow part is zero and its principal 300.00.
create or replace function pg_temp.attach(p_label text, p_loan text default 'loan')
returns void
language sql
as $$
  insert into public.loan_splits (
    company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id, needs_review
  )
  select pg_temp.id('co'), pg_temp.id(p_loan), pg_temp.id(p_label), v.part::public.loan_split_part, v.amount, v.amount,
    (select c.id from public.categories c where c.company_id = pg_temp.id('co') and c.loan_part = v.part::public.loan_split_part),
    false
  from (values ('interest', 70000), ('escrow', case when p_loan = 'demand' then 0 else 20000 end),
    ('principal', case when p_loan = 'demand' then 30000 else 10000 end)) as v(part, amount);
$$;

create or replace function pg_temp.parts(p_label text)
returns text
language sql
as $$
  select coalesce(string_agg(s.part || ':' || s.amount_minor || ':' || s.needs_review, ',' order by s.part), '')
  from public.loan_splits s where s.transaction_id = pg_temp.id(p_label);
$$;
grant execute on function pg_temp.parts(text) to authenticated, service_role;

select pg_temp.attach('txn_app');
select pg_temp.attach('txn_mcp');
select pg_temp.attach('txn_again');
select pg_temp.attach('txn_gone');
select pg_temp.attach('txn_fit');
select pg_temp.attach('txn_dem1', 'demand');

-- MCP tokens: write and read.
select public.store_mcp_credential(tests.get_supabase_uid('lun_owner'), 'hash-lun-write01', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into lun (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-lun-write01';
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('lun_owner'), pg_temp.id('co'), 'hash-lun-read001', 'pepper-1', array['read'], now() + interval '90 days');
insert into lun (label, id) select 'read', id from private.mcp_credentials where token_hash = 'hash-lun-read001';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('lun_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id(p_label))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

create temp table lun_out (label text primary key, body jsonb);
grant all on lun_out to authenticated, service_role;

-- get_transaction carries the loan split.
select tests.authenticate_as('lun_owner');
select is(public.get_transaction(pg_temp.id('txn_app'))->'loan_split', public.get_loan_split(pg_temp.id('txn_app')),
  'get_transaction returns the loan split, as get_loan_split does');
select is((public.get_transaction(pg_temp.id('txn_app'))->'loan_split'->>'by_parts')::boolean, true,
  'and it counts by parts');
select is(public.get_transaction(pg_temp.id('txn_plain'))->'loan_split', 'null'::jsonb,
  'a line with no loan split has loan_split null');

-- The app: clear_loan_split.
insert into lun_out (label, body) select 'clear', public.clear_loan_split(pg_temp.id('txn_app'));
select is((select body->>'loan_id' from lun_out where label = 'clear'), pg_temp.id('loan')::text,
  'clear_loan_split names the loan');
select is((select jsonb_array_length(body->'parts') from lun_out where label = 'clear'), 3,
  'and returns the three removed parts');
select is(pg_temp.parts('txn_app'), '', 'the parts are gone');
select is(public.get_transaction(pg_temp.id('txn_app'))->'loan_split', 'null'::jsonb,
  'the line has no loan split any more');
select is(
  (select row(project_id is null, category_id = pg_temp.id('materials'))::text from public.transactions where id = pg_temp.id('txn_app')),
  '(t,t)', 'the line keeps its project and category');
select is((public.get_transaction(pg_temp.id('txn_app'))->>'in_pnl')::boolean, true, 'and counts whole again');
select throws_ok($$select public.clear_loan_split(pg_temp.id('txn_plain'))$$, 'P0001', 'line has no loan split',
  'a line with no loan split is refused');
select throws_ok($$select public.clear_loan_split(pg_temp.id('txn_other'))$$, 'P0001', 'transaction not found',
  'another company''s line is not found');

select tests.authenticate_as('lun_viewer');
select throws_ok($$select public.clear_loan_split(pg_temp.id('txn_mcp'))$$, '42501', 'forbidden',
  'a viewer cannot unmatch');
reset role;
select is(pg_temp.parts('txn_mcp'), 'interest:70000:false,escrow:20000:false,principal:10000:false',
  'and the parts stay');

-- MCP: detach_loan_payment and undo.
do $$ begin perform pg_temp.as_mcp('write'); end $$;
insert into lun_out (label, body) select 'detach', public.mcp_detach_loan_payment('lun-d1', pg_temp.id('txn_mcp'));
select is((select body->'data'->>'undo_kind' from lun_out where label = 'detach'), 'loan_detach',
  'detach_loan_payment: undo kind loan_detach');
select is(
  (select body->'data'->'parts' from lun_out where label = 'detach'),
  '[{"part": "interest", "amount_minor": 70000}, {"part": "escrow", "amount_minor": 20000}, {"part": "principal", "amount_minor": 10000}]'::jsonb,
  'and returns the parts it took off');
select is(pg_temp.parts('txn_mcp'), '', 'the parts are gone');
select is(public.mcp_detach_loan_payment('lun-d1', pg_temp.id('txn_mcp')), (select body from lun_out where label = 'detach'),
  'the same key replays the answer');
select is(public.mcp_detach_loan_payment('lun-d2', pg_temp.id('txn_plain'))->'error'->>'message', 'line has no loan split',
  'a line with no loan split is refused with its reason');

select is(public.mcp_undo('lun-u1', 'loan_detach', pg_temp.id('txn_mcp'))->>'ok', 'true', 'undo puts the payment back');
select is(pg_temp.parts('txn_mcp'), 'interest:70000:false,escrow:20000:false,principal:10000:false',
  'with the same parts');
select is((public.get_loan_split(pg_temp.id('txn_mcp'))->>'by_parts')::boolean, true, 'counted by parts again');
select lives_ok('set constraints all immediate', 'the restored parts pass the deferred loan checks');
select is(public.mcp_undo('lun-u2', 'loan_detach', pg_temp.id('txn_mcp'))->'error'->>'code', 'not_found',
  'a second undo finds nothing to undo');

-- Matched again since: undo is a conflict and leaves the new match.
select public.mcp_detach_loan_payment('lun-d3', pg_temp.id('txn_again'));
reset role;
select pg_temp.attach('txn_again');
do $$ begin perform pg_temp.as_mcp('write'); end $$;
select is(public.mcp_undo('lun-u3', 'loan_detach', pg_temp.id('txn_again'))->'error'->>'code', 'conflict',
  'undo after the line was matched again is a conflict');

-- The line was removed since: not found.
select public.mcp_detach_loan_payment('lun-d4', pg_temp.id('txn_gone'));
reset role;
update public.transactions set removed_at = now() where id = pg_temp.id('txn_gone');
do $$ begin perform pg_temp.as_mcp('write'); end $$;
select is(public.mcp_undo('lun-u4', 'loan_detach', pg_temp.id('txn_gone'))->'error'->>'code', 'not_found',
  'undo after the line was removed is not found');

-- The parts no longer fit the line: undo is a conflict and puts nothing back.
select public.mcp_detach_loan_payment('lun-d5', pg_temp.id('txn_fit'));
reset role;
update public.transactions set amount_gross = -90000, amount_net = -90000, amount_original = 90000
where id = pg_temp.id('txn_fit');
do $$ begin perform pg_temp.as_mcp('write'); end $$;
select is(public.mcp_undo('lun-u5', 'loan_detach', pg_temp.id('txn_fit'))->'error'->>'code', 'conflict',
  'undo after the line amount changed is a conflict');
select is(pg_temp.parts('txn_fit'), '', 'and puts no parts back');

-- A demand loan takes its payments in date order: once a later payment is matched, the
-- earlier one cannot come back.
select public.mcp_detach_loan_payment('lun-d6', pg_temp.id('txn_dem1'));
reset role;
select pg_temp.attach('txn_dem2', 'demand');
do $$ begin perform pg_temp.as_mcp('write'); end $$;
select is(public.mcp_undo('lun-u6', 'loan_detach', pg_temp.id('txn_dem1'))->'error'->>'code', 'conflict',
  'undo of an earlier demand-loan payment after a later one is matched is a conflict');
select is(pg_temp.parts('txn_dem1'), '', 'and puts no parts back');

-- A read token cannot detach.
do $$ begin perform pg_temp.as_mcp('read'); end $$;
select is(public.mcp_detach_loan_payment('lun-r1', pg_temp.id('txn_again'))->'error'->>'code', 'forbidden',
  'a read token cannot detach');
reset role;
select is(pg_temp.parts('txn_again'), 'interest:70000:false,escrow:20000:false,principal:10000:false',
  'and the parts stay');

select * from finish();
rollback;
