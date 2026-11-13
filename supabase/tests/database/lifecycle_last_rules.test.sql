-- FLOW-1166 part 5 (20261113141500_lifecycle_last_rules.sql, B to D). B: loans_close_check fires on
-- an insert too, and every writer that inserts a loan (the app's forms, mcp_add_loan, restore_loan
-- of a closed loan) still does. C: company_integrations_on_chk (enabled only with a mode that is
-- on); set_company_integration and set_jev_mode store enabled false with mode off, the card's
-- remembered mode is kept, and an undo of a ticket from before the rule still works. D: a Jev
-- reservation its run never settled stops counting after 15 minutes, a live one keeps counting and a
-- late finish records its calls; a later success clears a line's failure rows, a line that keeps
-- failing keeps them and its backoff. These run with no vault: none of them reads the Jev key.
-- Invented names and figures, @example.com only.

begin;

select plan(30);

do $users$
begin
  perform tests.create_supabase_user('lr_owner', 'lr-owner@example.com');
end
$users$;

create temp table lr (label text primary key, id uuid);
grant all on lr to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid language sql set search_path = '' as $$ select id from pg_temp.lr where label = p_label; $$;

-- One flow-mcp call as the owner; a raised error comes back as {"raised": message}.
create or replace function pg_temp.mcp(p_sql text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  uid uuid := tests.get_supabase_uid('lr_owner');
  r jsonb;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1',
    'mcp_tid', pg_temp.id('tok'))::text, true);
  execute p_sql into r;
  reset role;
  return r;
exception when others then
  reset role;
  return jsonb_build_object('raised', sqlerrm);
end; $$;
-- The owner as the app calls an RPC.
create or replace function pg_temp.app(p_sql text)
returns jsonb language plpgsql set search_path = '' as $$
declare r jsonb;
begin
  perform tests.authenticate_as('lr_owner');
  execute p_sql into r;
  reset role;
  return r;
end; $$;
create or replace function pg_temp.jev()
returns text language sql set search_path = '' as $$
  select ci.enabled || ':' || ci.mode from public.company_integrations ci where ci.company_id = pg_temp.id('co');
$$;
-- As the jev-tag job: the service role's claims (the session stays postgres).
create or replace function pg_temp.svc()
returns void language sql set search_path = '' as $$
  select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claim.role', 'service_role', true),
    set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

-- The owner's company, made as the app makes it (Jev on, auto), and a flow-mcp credential.
select tests.authenticate_as('lr_owner');
insert into lr (label, id) select 'co', public.create_company('Example Last Rules Co', true);
reset role;
select public.store_mcp_credential(
  tests.get_supabase_uid('lr_owner'), 'hash-lr-write-001', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into lr (label, id) select 'tok', id from private.mcp_credentials where token_hash = 'hash-lr-write-001';

-- ---------------------------------------------------------------------------------------------
-- B. loans: the close check runs on an insert; every inserting writer still goes in.
-- ---------------------------------------------------------------------------------------------
select is((select pg_get_triggerdef(t.oid) like '%BEFORE INSERT OR UPDATE OF status, closed_on ON public.loans%'
  from pg_trigger t where t.tgrelid = 'public.loans'::regclass and t.tgname = 'loans_close_check'), true,
  'loans_close_check fires on an insert as on a close');
select tests.authenticate_as('lr_owner');
select lives_ok(format($$insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, start_date,
    escrow_minor, currency, term_months, payment_minor) values (%L, 'Example form loan', 15400000, 60000, '2025-03-01', 0,
    'ILS', 360, 135000)$$, pg_temp.id('co')),
  'the app''s new-loan form inserts an open loan');
select lives_ok(format($$insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, start_date,
    escrow_minor, currency, term_months, payment_minor, status, closed_on) values (%L, 'Example closed loan', 1000000, 50000,
    '2024-01-01', 0, 'ILS', 12, 90000, 'paid_off', '2025-01-01')$$, pg_temp.id('co')),
  'a loan inserted paid off runs the check and passes: a new loan has no payment');
reset role;
insert into lr (label, id) select 'closed_loan', id from public.loans where name = 'Example closed loan';
insert into lr (label, id) select 'mcp_loan', (pg_temp.mcp(format(
  'select public.mcp_add_loan(%L, %L, 5000000, 60000, null, %L::date, null, 0, %L, null, %L, null, null)',
  'lr-loan', 'Example assistant loan', '2026-01-01', 'ILS', 'demand'))->'data'->>'id')::uuid;
select isnt(pg_temp.id('mcp_loan'), null, 'add_loan inserts an open loan');
select ok((pg_temp.mcp(format('select public.delete_loan(%L)', pg_temp.id('closed_loan')))->>'loan_id') is not null,
  'a paid-off loan is deleted');
select is(pg_temp.mcp(format('select public.restore_loan(%L)', pg_temp.id('closed_loan')))->>'raised', null,
  'and restore_loan inserts it back paid off');
select is((select status::text || ':' || closed_on from public.loans where id = pg_temp.id('closed_loan')), 'paid_off:2025-01-01',
  'with its close date');
select throws_ok(format($$insert into public.loans (company_id, name, principal_minor, annual_rate_ppm, start_date,
    escrow_minor, currency, term_months, payment_minor, status) values (%L, 'Example dateless loan', 1000000, 50000,
    '2024-01-01', 0, 'ILS', 12, 90000, 'closed')$$, pg_temp.id('co')),
  '23514', null, 'a closed loan with no close date is still refused');

-- ---------------------------------------------------------------------------------------------
-- C. company_integrations: enabled only with a mode that is on.
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.jev(), 'true:auto', 'a new company starts on, auto');
select throws_ok(format($$update public.company_integrations set mode = 'off' where company_id = %L$$, pg_temp.id('co')),
  '23514', null, 'enabled with mode off is refused');
select is((select convalidated from pg_constraint where conname = 'company_integrations_on_chk'), true,
  'the rule holds for every stored row (the migration set enabled false where the mode was off)');
select is(pg_temp.app('select public.set_company_integration(false)')->>'mode', 'auto',
  'the card turns Jev off and keeps the mode it remembers');
select is(pg_temp.jev(), 'false:auto', 'enabled false with mode auto is stored');
select is(pg_temp.app('select public.set_company_integration(true, ''shadow'')') - 'company_id' - 'provider' - 'threshold',
  '{"enabled": true, "mode": "shadow"}'::jsonb, 'the card turns it on in shadow');
select is(pg_temp.app('select public.set_company_integration(true, ''off'')') - 'company_id' - 'provider' - 'threshold',
  '{"enabled": false, "mode": "off"}'::jsonb, 'asked for enabled with mode off, the setter stores it off');
select is(pg_temp.app('select public.set_company_integration(true)') - 'company_id' - 'provider' - 'threshold',
  '{"enabled": false, "mode": "off"}'::jsonb, 'enabled with the stored mode off stays off, as every reader read it');
select is(pg_temp.mcp('select public.mcp_set_jev_mode(''lr-jev-1'', true, ''auto'', null)')->'data'->>'enabled', 'true',
  'set_jev_mode turns it on in auto');
select is((pg_temp.mcp('select public.mcp_set_jev_mode(''lr-jev-2'', true, ''off'', null)')->'data') - 'id' - 'prior' - 'threshold' - 'undo_kind',
  '{"enabled": false, "mode": "off"}'::jsonb, 'set_jev_mode with enabled and mode off stores and answers off');
select is(pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'lr-jev-3', 'jev_mode', pg_temp.id('co')))->>'ok', 'true',
  'and its undo works');
select is(pg_temp.jev(), 'true:auto', 'putting auto back');

-- Tickets written before the rule: after or before may name enabled with mode off.
insert into private.mcp_writes (token_id, user_id, kind, company_id, prior, created_at)
values (pg_temp.id('tok'), tests.get_supabase_uid('lr_owner'), 'jev_mode', pg_temp.id('co'), jsonb_build_object(
  'before', jsonb_build_object('enabled', true, 'mode', 'off', 'threshold', 0.90),
  'after', jsonb_build_object('enabled', true, 'mode', 'auto', 'threshold', 0.90)), clock_timestamp());
select is(pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'lr-jev-4', 'jev_mode', pg_temp.id('co')))->>'ok', 'true',
  'an older undo whose before was enabled with mode off works');
select is(pg_temp.jev(), 'false:off', 'and stores it off');
insert into private.mcp_writes (token_id, user_id, kind, company_id, prior, created_at)
values (pg_temp.id('tok'), tests.get_supabase_uid('lr_owner'), 'jev_mode', pg_temp.id('co'), jsonb_build_object(
  'before', jsonb_build_object('enabled', true, 'mode', 'auto', 'threshold', 0.90),
  'after', jsonb_build_object('enabled', true, 'mode', 'off', 'threshold', 0.90)), clock_timestamp() + interval '1 second');
select is(pg_temp.mcp(format('select public.mcp_undo(%L, %L, %L::uuid)', 'lr-jev-5', 'jev_mode', pg_temp.id('co')))->>'ok', 'true',
  'an older undo whose after was enabled with mode off still reads the row as its write left it');
select is(pg_temp.jev(), 'true:auto', 'and puts auto back');

-- ---------------------------------------------------------------------------------------------
-- D. jev_usage: a reservation with no finish counts for 15 minutes; jev_line_failures cleared by a
-- later success only.
-- ---------------------------------------------------------------------------------------------
update public.company_integrations set daily_call_cap = 10 where company_id = pg_temp.id('co');
insert into lr (label, id) values ('run_dead', gen_random_uuid()), ('run_live', gen_random_uuid()), ('run_new', gen_random_uuid()),
  ('run_more', gen_random_uuid());
insert into public.jev_usage (company_id, run_id, reserved, started_at) values
  (pg_temp.id('co'), pg_temp.id('run_dead'), 8, now() - interval '16 minutes'),
  (pg_temp.id('co'), pg_temp.id('run_live'), 4, now() - interval '14 minutes');
select pg_temp.svc();
select is(public.jev_reserve_calls(pg_temp.id('co'), pg_temp.id('run_new'), 10), 6,
  'a run gets the cap less a live run''s 4, not the 8 of a run that never finished 16 minutes ago');
select lives_ok(format('select public.jev_finish_usage(%L, %L, 3, 10, 10, 1, 0)', pg_temp.id('co'), pg_temp.id('run_dead')),
  'the old run finishing late records its calls');
select is(public.jev_reserve_calls(pg_temp.id('co'), pg_temp.id('run_more'), 10), 0,
  'which count again: 3 + 4 + 6 is past the cap of 10');

insert into lr (label, id) values
  ('ok_line', tests.fixture_line(pg_temp.id('co'), 'lr:ok', 1000, 'expense', null, null, current_date)),
  ('bad_line', tests.fixture_line(pg_temp.id('co'), 'lr:bad', 2000, 'expense', null, null, current_date));
select public.jev_mark_failed(pg_temp.id('co'), pg_temp.id('ok_line'), 'jev-test-1');
select public.jev_mark_failed(pg_temp.id('co'), pg_temp.id('ok_line'), 'jev-test-1');
select public.jev_mark_failed(pg_temp.id('co'), pg_temp.id('bad_line'), 'jev-test-1');
-- The next run: the first line's suggestion is saved; the second line's fill fails, so its
-- suggestion is deleted and the line marked failed again (jev_tag.ts).
insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
values (pg_temp.id('co'), pg_temp.id('ok_line'), '{}', 0.95, 'jev-test-1', 'example-model'),
  (pg_temp.id('co'), pg_temp.id('bad_line'), '{}', 0.95, 'jev-test-1', 'example-model');
delete from public.tag_suggestions where transaction_id = pg_temp.id('bad_line');
select public.jev_mark_failed(pg_temp.id('co'), pg_temp.id('bad_line'), 'jev-test-1');
select public.jev_finish_usage(pg_temp.id('co'), pg_temp.id('run_new'), 2, 10, 10, 1, 1);
select is((select count(*)::integer from public.jev_line_failures where transaction_id = pg_temp.id('ok_line')), 0,
  'a line that now has a suggestion loses its failure rows when the run finishes');
select is((select attempts || ':' || (retry_after > now() + interval '5 hours')::text from public.jev_line_failures
  where transaction_id = pg_temp.id('bad_line')), '2:true', 'a line that failed again keeps its rows and its backoff');
select public.jev_mark_failed(pg_temp.id('co'), pg_temp.id('bad_line'), 'jev-test-1');
select public.jev_finish_usage(pg_temp.id('co'), pg_temp.id('run_more'), 0, 0, 0, 0, 1);
select is((select attempts || ':' || (retry_after > now() + interval '23 hours')::text from public.jev_line_failures
  where transaction_id = pg_temp.id('bad_line')), '3:true', 'so a line that keeps failing waits a day between tries');

select * from finish();
rollback;
