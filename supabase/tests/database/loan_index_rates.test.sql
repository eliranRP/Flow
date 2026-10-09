-- FLOW-137 (decision 0160): prime-linked loan rates. set_loan_index links a loan to il_prime
-- with a margin; set_index_rate writes index plus margin on every linked loan from a date, with
-- one undo. Invented figures. Fixed dates. @example.com only.

begin;

select plan(38);

do $users$
begin
  perform tests.create_supabase_user('f137_owner', 'owner137@example.com');
  perform tests.create_supabase_user('f137_other', 'other137@example.com');
end
$users$;

create temp table f137 (label text primary key, id uuid);
grant all on f137 to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
set search_path = ''
as $$
  select id from pg_temp.f137 where label = p_label;
$$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_user text default 'f137_owner', p_token text default 'write')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id(p_token))::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated, service_role;

create or replace function pg_temp.add_demand(p_key text, p_start date)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_add_loan(
    p_key, 'Example ' || p_key, 5000000, 60000, null, p_start, null, 0, 'ILS', null, 'demand', null, null
  );
  reset role;
  return (result->'data'->>'id')::uuid;
end;
$$;
grant execute on function pg_temp.add_demand(text, date) to authenticated, service_role;

create or replace function pg_temp.link(p_key text, p_loan text, p_index text, p_margin integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_set_loan_index(p_key, pg_temp.id(p_loan), p_index, p_margin);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.link(text, text, text, integer) to authenticated, service_role;

create or replace function pg_temp.index_rate(p_key text, p_day date, p_ppm integer, p_user text default 'f137_owner', p_token text default 'write')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp(p_user, p_token);
  result := public.mcp_set_index_rate(p_key, 'il_prime', p_day, p_ppm);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.index_rate(text, date, integer, text, text) to authenticated, service_role;

create or replace function pg_temp.set_rate(p_key text, p_loan text, p_day date, p_ppm integer)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_set_loan_rate(p_key, pg_temp.id(p_loan), p_day, p_ppm);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.set_rate(text, text, date, integer) to authenticated, service_role;

create or replace function pg_temp.undo(p_key text, p_kind text, p_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  result := public.mcp_undo(p_key, p_kind, p_id);
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.undo(text, text, uuid) to authenticated, service_role;

create or replace function pg_temp.rate_on(p_loan text, p_day date)
returns integer
language sql
set search_path = ''
as $$
  select r.annual_rate_ppm from public.loan_rates r where r.loan_id = pg_temp.id(p_loan) and r.effective_date = p_day;
$$;
grant execute on function pg_temp.rate_on(text, date) to authenticated, service_role;

create or replace function pg_temp.listed(p_loan text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp();
  select l into result
  from jsonb_array_elements(public.mcp_list_loans()) l
  where l->>'id' = pg_temp.id(p_loan)::text;
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.listed(text) to authenticated, service_role;

select tests.authenticate_as('f137_owner');
select public.create_company('Example Prime Co', true);
reset role;
insert into f137 (label, id) select 'company', id from public.companies where name = 'Example Prime Co';
select public.store_mcp_credential(
  tests.get_supabase_uid('f137_owner'), 'hash-f137-write-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into f137 (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-f137-write-1';

select tests.authenticate_as('f137_other');
select public.create_company('Example Other Prime Co', true);
reset role;
select public.store_mcp_credential(
  tests.get_supabase_uid('f137_other'), 'hash-f137-other-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into f137 (label, id) select 'other_write', id from private.mcp_credentials where token_hash = 'hash-f137-other-1';

insert into f137 (label, id) values
  ('a', pg_temp.add_demand('f137-a', '2026-01-01')),
  ('b', pg_temp.add_demand('f137-b', '2026-01-01')),
  ('late', pg_temp.add_demand('f137-late', '2026-09-01')),
  ('plain', pg_temp.add_demand('f137-plain', '2026-01-01')),
  ('done', pg_temp.add_demand('f137-done', '2026-01-01'));

-- Link: validation, then the two partner loans and a late one.
select is(pg_temp.link('f137-bad-1', 'a', 'us_prime', 7500)->'error'->>'code', 'validation', 'an unknown index is validation');
select is(pg_temp.link('f137-bad-2', 'a', 'il_prime', null)->'error'->>'code', 'validation', 'an index without a margin is validation');
select is(pg_temp.link('f137-bad-3', 'a', null, 7500)->'error'->>'code', 'validation', 'a margin without an index is validation');
select is(pg_temp.link('f137-bad-4', 'a', 'il_prime', 1000001)->'error'->>'code', 'validation', 'a margin over 100% is validation');

select is(pg_temp.link('f137-link-a', 'a', 'il_prime', 7500)->'data'->>'undo_kind', 'loan_index', 'set_loan_index links a loan');
select is(pg_temp.link('f137-link-b', 'b', 'il_prime', 2500)->'data'->'previous', '{"rate_index": null, "rate_margin_ppm": null}'::jsonb, 'the reply carries what it was before');
select ok((pg_temp.link('f137-link-late', 'late', 'il_prime', -2500)->>'ok')::boolean, 'a negative margin is allowed');
select ok((pg_temp.link('f137-link-done', 'done', 'il_prime', 5000)->>'ok')::boolean, 'a loan that will be paid off is linked too');
update public.loans set status = 'paid_off', closed_on = '2026-05-31' where id = pg_temp.id('done');
select is(
  (select jsonb_build_array(rate_index, rate_margin_ppm) from public.loans where id = pg_temp.id('a')),
  '["il_prime", 7500]'::jsonb,
  'the loan stores its index and margin'
);
select is(
  (select jsonb_build_array(l->>'rate_index', (l->>'rate_margin_ppm')::int) from (select pg_temp.listed('a') l) x),
  '["il_prime", 7500]'::jsonb,
  'mcp_list_loans shows the index and margin'
);

-- Index rate: validation, then the fan-out.
select is(pg_temp.index_rate('f137-ir-bad', '2026-06-01', -1)->'error'->>'code', 'validation', 'a negative index rate is validation');
select is(pg_temp.index_rate('f137-ir-bad-2', '2026-06-01', null)->'error'->>'code', 'validation', 'a missing index rate is validation');
select is(
  pg_temp.index_rate('f137-ir-early', '2025-12-01', 60000)->'error'->>'message',
  'no linked loan is open on this date',
  'a date before every linked loan starts is refused'
);

-- Prime at 6.00% from June: A gets 6.75%, B 6.25%; the loan starting in September and the one
-- paid off in May are skipped.
create temp table f137_out (label text primary key, body jsonb);
grant all on f137_out to authenticated, service_role;
insert into f137_out values ('june', pg_temp.index_rate('f137-ir-june', '2026-06-01', 60000));
select ok(((select body from f137_out where label = 'june')->>'ok')::boolean, 'set_index_rate writes');
select is(pg_temp.rate_on('a', '2026-06-01'), 67500, 'loan A gets prime plus 0.75%');
select is(pg_temp.rate_on('b', '2026-06-01'), 62500, 'loan B gets prime plus 0.25%');
select is(pg_temp.rate_on('late', '2026-06-01'), null, 'a loan that starts after the date gets no row');
select is(pg_temp.rate_on('plain', '2026-06-01'), null, 'an unlinked loan gets no row');
select is(
  (select jsonb_array_length(body->'data'->'loans') from f137_out where label = 'june'),
  2,
  'the reply lists the two loans it wrote'
);
select is(
  (select jsonb_agg(s->>'reason' order by s->>'reason') from f137_out o, jsonb_array_elements(o.body->'data'->'skipped') s where o.label = 'june'),
  '["rate after the loan closed", "rate before the loan start"]'::jsonb,
  'the reply lists the skipped loans and why'
);
select is(pg_temp.rate_on('done', '2026-06-01'), null, 'a loan paid off before the date gets no row');
select is(
  pg_temp.index_rate('f137-ir-june', '2026-06-01', 60000),
  (select body from f137_out where label = 'june'),
  'the same key replays the same reply'
);

-- A margin that would go below zero is clamped at 0%.
select is((pg_temp.index_rate('f137-ir-oct', '2026-10-01', 1000)->>'ok')::boolean, true, 'an index rate of 0.10% from October');
select is(pg_temp.rate_on('late', '2026-10-01'), 0, 'index plus a negative margin stops at 0%');

-- Undo puts every row back, and an existing row comes back to its old value.
select is((pg_temp.set_rate('f137-own-rate', 'a', '2026-07-01', 70000)->>'ok')::boolean, true, 'a hand-set rate on a date');
insert into f137_out values ('july', pg_temp.index_rate('f137-ir-july', '2026-07-01', 65000));
select is(pg_temp.rate_on('a', '2026-07-01'), 72500, 'the index rate replaces the hand-set row on that date');
select is(
  (select jsonb_agg(l->'previous_rate_ppm' order by l->>'name') from f137_out o, jsonb_array_elements(o.body->'data'->'loans') l where o.label = 'july'),
  '[70000, null]'::jsonb,
  'the reply says what the row held before'
);
select is(
  pg_temp.undo('f137-undo-july', 'index_rate', ((select body from f137_out where label = 'july')->'data'->>'id')::uuid)->>'ok',
  'true',
  'undo index_rate'
);
select is(pg_temp.rate_on('a', '2026-07-01'), 70000, 'undo puts the hand-set rate back');
select is(pg_temp.rate_on('b', '2026-07-01'), null, 'undo removes the row it added');

-- A row changed since: the whole undo is a conflict and nothing moves.
select is((pg_temp.set_rate('f137-own-june', 'b', '2026-06-01', 50000)->>'ok')::boolean, true, 'a later hand change on one loan');
select is(
  pg_temp.undo('f137-undo-june', 'index_rate', ((select body from f137_out where label = 'june')->'data'->>'id')::uuid)->'error'->>'code',
  'conflict',
  'undo is a conflict once any row changed'
);
select is(pg_temp.rate_on('a', '2026-06-01'), 67500, 'and leaves the other loan''s row as it was');

-- Unlink and its undo.
select is(pg_temp.link('f137-unlink-b', 'b', null, null)->'data'->>'rate_index', null, 'set_loan_index with null unlinks');
select is(pg_temp.undo('f137-undo-unlink', 'loan_index', pg_temp.id('b'))->>'ok', 'true', 'undo loan_index');
select is(
  (select jsonb_build_array(rate_index, rate_margin_ppm) from public.loans where id = pg_temp.id('b')),
  '["il_prime", 2500]'::jsonb,
  'undo links it back with its margin'
);

-- Another company with nothing linked: refused, and it never touches these loans.
select is(
  pg_temp.index_rate('f137-other-ir', '2026-11-01', 60000, 'f137_other', 'other_write')->'error'->>'message',
  'no loan linked to this index',
  'another company with no linked loan is refused'
);
select is(pg_temp.rate_on('a', '2026-11-01'), null, 'and these loans get no row');

select * from finish();

rollback;
