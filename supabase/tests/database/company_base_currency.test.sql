-- FLOW-504 (decision 0147). The company currency: set_company_currency and MCP
-- set_company_currency with undo kind company_currency, and where it leads (by_currency order,
-- prev_* per currency, get_home, get_project's and get_profit_months' overhead share, the loan
-- default, a new project's investment currency). Nothing is converted. Invented data only.
-- Amounts are minor units.

begin;

select plan(33);

do $users$
begin
  perform tests.create_supabase_user('cbc_owner', 'cbc-owner@example.com');
  perform tests.create_supabase_user('cbc_viewer', 'cbc-viewer@example.com');
end
$users$;

create temp table cbc (label text primary key, id uuid);
grant all on cbc to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.cbc where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into cbc (label, id) values ('co', tests.fixture_company('cbc_owner', 'Example Dollar LLC', true));
insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('cbc_viewer'), pg_temp.id('co'));
insert into cbc (label, id) values
  ('house', tests.fixture_project(pg_temp.id('co'), 'Example House')),
  ('barn', tests.fixture_project(pg_temp.id('co'), 'Example Barn')),
  ('office', tests.fixture_project(pg_temp.id('co'), 'Example Office')),
  ('materials', tests.fixture_category(pg_temp.id('co'), 'Materials')),
  ('rent', tests.fixture_category(pg_temp.id('co'), 'Rent', 'income'));
update public.companies set overhead_project_id = pg_temp.id('office') where id = pg_temp.id('co');

-- September: the house earns $3,000.00 and the barn $1,000.00, the office costs $400.00, and
-- the barn spends ₪5,000.00 (more than the house in shekels, less in dollars). August: the house
-- earns $1,000.00.
insert into cbc (label, id) values
  ('h_inc', tests.fixture_line(pg_temp.id('co'), 'cbc:h_inc', 300000, 'income', pg_temp.id('house'), pg_temp.id('rent'), '2026-09-05', 'USD')),
  ('b_inc', tests.fixture_line(pg_temp.id('co'), 'cbc:b_inc', 100000, 'income', pg_temp.id('barn'), pg_temp.id('rent'), '2026-09-06', 'USD')),
  ('o_exp', tests.fixture_line(pg_temp.id('co'), 'cbc:o_exp', 40000, 'expense', pg_temp.id('office'), pg_temp.id('materials'), '2026-09-07', 'USD')),
  ('b_ils', tests.fixture_line(pg_temp.id('co'), 'cbc:b_ils', 500000, 'expense', pg_temp.id('barn'), pg_temp.id('materials'), '2026-09-08', 'ILS')),
  ('h_aug', tests.fixture_line(pg_temp.id('co'), 'cbc:h_aug', 100000, 'income', pg_temp.id('house'), pg_temp.id('rent'), '2026-08-05', 'USD'));

create function pg_temp.dash() returns jsonb
language sql
as $$ select public.get_dashboard('2026-09-01', '2026-09-30', 'cash') $$;
grant execute on function pg_temp.dash() to authenticated;

create temp table cbc_out (label text primary key, body jsonb);
grant all on cbc_out to authenticated, service_role;

select tests.authenticate_as('cbc_owner');

-- Before: ILS.
select is(pg_temp.dash()->>'base_currency', 'ILS', 'a company starts in shekels');
select is(pg_temp.dash()->'by_currency'->0->>'currency', 'ILS', 'and lists shekels first');
select is(public.get_home()->>'base_currency', 'ILS', 'get_home says so too');
select is(public.mcp_company_loan_currency(), 'ILS', 'a new loan defaults to shekels');

-- The owner switches to dollars.
select is(public.set_company_currency('USD'), jsonb_build_object('id', pg_temp.id('co'), 'base_currency', 'USD', 'prior', 'ILS'),
  'set_company_currency returns the currency before and after');
select is(pg_temp.dash()->>'base_currency', 'USD', 'the dashboard says dollars');
select is(pg_temp.dash()->'by_currency'->0->>'currency', 'USD', 'and lists dollars first');
select is(pg_temp.dash()->'by_currency'->1->>'currency', 'ILS', 'shekels stay their own row, not converted');
select is((pg_temp.dash()->'by_currency'->0->>'net_profit_minor')::bigint, 360000::bigint, 'September in dollars: 4,000 less 400');
select is((pg_temp.dash()->'by_currency'->0->>'prev_net_profit_minor')::bigint, 100000::bigint,
  'the month before in dollars, for the change');
select is((pg_temp.dash()->'by_currency'->1->>'prev_net_profit_minor')::bigint, 0::bigint, 'and in shekels');
select is(public.get_dashboard(null, null, 'cash')->'by_currency'->0->'prev_net_profit_minor', 'null'::jsonb,
  'all time has no period before');
select is(pg_temp.dash()->'projects'->0->>'name', 'Example House', 'projects are ordered by their dollar figures');
select is((pg_temp.dash()->>'net_profit_agorot')::bigint, -500000::bigint, 'the *_agorot fields stay shekels');

select is(public.get_home()->>'base_currency', 'USD', 'get_home says dollars');
select is((public.get_home()->>'net_profit_minor')::bigint, 460000::bigint, 'with the all-time profit in dollars');

select is((public.get_project(pg_temp.id('house'), 'cash', '2026-09-01', '2026-09-30')->>'overhead_share_minor')::bigint, 30000::bigint,
  'the house carries three quarters of the $400.00 overhead');
select is(public.get_project(pg_temp.id('house'), 'cash', '2026-09-01', '2026-09-30')->'overhead_share_agorot', 'null'::jsonb,
  'there is no shekel overhead to share');
select is(public.get_project(pg_temp.id('house'), 'cash', '2026-09-01', '2026-09-30')->>'base_currency', 'USD', 'get_project says dollars');

select is(public.get_profit_months('2026-07-01', '2026-09-30', 'cash')->>'base_currency', 'USD', 'profit by month says dollars');
select is(jsonb_path_query_array(public.get_profit_months('2026-07-01', '2026-09-30', 'cash')->'months', '$[*].by_currency[0].currency'),
  '["USD", "USD", "USD"]'::jsonb, 'every month leads with a dollar row, July''s empty one too');
select is(jsonb_path_query_array(public.get_profit_months('2026-07-01', '2026-07-31', 'cash')->'months', '$[*].by_currency[*].currency'),
  '["USD"]'::jsonb, 'a month with nothing has no shekel row any more');
select is((public.get_profit_months('2026-09-01', '2026-09-30', 'cash', pg_temp.id('house'))->'months'->0->>'overhead_share_minor')::bigint,
  30000::bigint, 'a project''s month carries its dollar overhead share');

select is(public.company_pnl(pg_temp.id('co'), '2026-10-01', '2026-10-31', 'cash')->'by_currency'->0->>'currency', 'USD',
  'a quiet month still leads with a dollar row');
select is((public.company_pnl(pg_temp.id('co'), '2026-10-01', '2026-10-31', 'cash')->'by_currency'->0->>'prev_net_profit_minor')::bigint,
  360000::bigint, 'and keeps September''s dollar profit to compare with');

select is(public.mcp_company_loan_currency(), 'USD', 'a new loan defaults to dollars');
reset role;
insert into cbc (label, id) values ('shed', tests.fixture_project(pg_temp.id('co'), 'Example Shed'));
select is((select investment_currency from public.projects where id = pg_temp.id('shed')),
  'USD', 'a new project''s investment currency starts in dollars');
select tests.authenticate_as('cbc_owner');

select throws_ok($$select public.set_company_currency('usd')$$, 'P0001', 'validation', 'a currency is three capital letters');

select tests.authenticate_as('cbc_viewer');
select is(public.get_home()->>'base_currency', 'USD', 'a viewer reads the currency');
select throws_ok($$select public.set_company_currency('ILS')$$, '42501', 'forbidden', 'but cannot change it');

-- MCP.
reset role;
select public.store_mcp_credential(tests.get_supabase_uid('cbc_owner'), 'hash-cbc-write01', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into cbc (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-cbc-write01';

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('cbc_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id(p_label))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

select pg_temp.as_mcp('write');
insert into cbc_out (label, body) values ('mcp', public.mcp_set_company_currency('cbc-cur-1', 'EUR'));
select is((select body->'data'->>'undo_kind' || ':' || (body->'data'->>'prior') from cbc_out where label = 'mcp'),
  'company_currency:USD', 'MCP set_company_currency answers with its undo kind and the currency before');
select is(public.mcp_undo('cbc-undo-1', 'company_currency', pg_temp.id('co'))->>'ok', 'true', 'undo puts dollars back');
select is(public.get_home()->>'base_currency', 'USD', 'so the company is in dollars again');

select * from finish();
rollback;
