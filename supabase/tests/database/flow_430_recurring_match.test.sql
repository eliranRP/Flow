-- FLOW-430 (decision 0178). A late recurring bill suggests a renamed supplier (missing_bills'
-- suggestion), and the user's answer (answer_recurring_match, mcp_answer_recurring_match) decides:
-- private.recurring_parties, private.recurring_arrivals and private.payment_party follow it.
-- Invented data only. Amounts are cents. "Today" is 2026-10-20.

begin;

select plan(16);

do $users$
begin
  perform tests.create_supabase_user('rm_owner', 'rm-owner@example.com');
  perform tests.create_supabase_user('rm_outsider', 'rm-outsider@example.com');
end
$users$;

create temp table rm (label text primary key, id uuid);
grant all on rm to authenticated, service_role;

insert into rm (label, id) values ('co', tests.fixture_company('rm_owner', 'Example Match LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.rm where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- water: the recurring one. works: its new name, first seen in October. hillcrest: a new name
-- not alike. gas: alike in name, but three times the amount. oldwater: alike, seen since May.
insert into public.suppliers (company_id, name)
select pg_temp.id('co'), n
from unnest(array['Riverside Water', 'Riverside Water Works', 'Hillcrest Utility', 'Riverside Gas', 'Riverside Waterworks Co']) n;
insert into rm (label, id)
select case s.name
    when 'Riverside Water' then 'water' when 'Riverside Water Works' then 'works'
    when 'Hillcrest Utility' then 'hillcrest' when 'Riverside Gas' then 'gas' else 'oldwater' end,
  s.id
from public.suppliers s where s.company_id = pg_temp.id('co');

-- label, party, date, amount
create temp table rm_lines (label text, party text, doc_date date, amount bigint);
insert into rm_lines
select 'water_' || to_char(d, 'MM'), 'water', d::date + 3, 4200
from generate_series('2026-04-01'::date, '2026-09-01'::date, interval '1 month') d;
insert into rm_lines values
  ('oldwater_05', 'oldwater', '2026-05-21', 4500),
  ('oldwater_10', 'oldwater', '2026-10-02', 4500),
  ('works_10', 'works', '2026-10-06', 5779),
  ('hillcrest_10', 'hillcrest', '2026-10-07', 4300),
  ('gas_10', 'gas', '2026-10-08', 12600);

insert into rm (label, id)
select l.label, tests.fixture_line(
  pg_temp.id('co'), 'rm:' || l.label, l.amount, 'expense', null, null, l.doc_date,
  p_currency => 'USD', p_pnl_role => null
)
from rm_lines l;
update public.transactions t
set supplier_id = pg_temp.id(l.party)
from rm_lines l
where t.id = pg_temp.id(l.label);

create or replace function pg_temp.water_row()
returns jsonb
language sql
as $$
  select e from jsonb_array_elements(public.missing_bills('2026-10-20')) e
  where (e ->> 'party_id')::uuid = pg_temp.id('water');
$$;
grant execute on function pg_temp.water_row() to authenticated, service_role;

-- 1-3. The suggestion.
select tests.authenticate_as('rm_owner');
select is(
  pg_temp.water_row() -> 'suggestion' - 'transaction_id',
  jsonb_build_object('party_id', pg_temp.id('works'), 'party_name', 'Riverside Water Works',
    'doc_date', '2026-10-06', 'amount_minor', -5779),
  'the late water bill suggests the new name with its amount and date'
);
select is(
  (pg_temp.water_row() -> 'suggestion' ->> 'transaction_id')::uuid,
  pg_temp.id('works_10'),
  'the suggestion names its line'
);
select is(
  (select count(*)::integer from jsonb_array_elements(public.missing_bills('2026-10-20')) e
   where e -> 'suggestion' <> 'null'::jsonb),
  1,
  'a name not alike, an amount three times the usual and a supplier seen since May are never suggested'
);

-- 4-6. No, taken back, and yes.
select is(
  public.answer_recurring_match('expense', pg_temp.id('water'), pg_temp.id('works'), false) - 'direction' - 'party_id' - 'match_party_id',
  '{"same": false, "prior_same": null}'::jsonb,
  'the owner says no'
);
select is(pg_temp.water_row() -> 'suggestion', 'null'::jsonb, 'after no, the pair is not suggested again');
select is(
  public.answer_recurring_match('expense', pg_temp.id('water'), pg_temp.id('works'), null) ->> 'prior_same',
  'false',
  'taking the answer back names the answer before'
);
select is(
  pg_temp.water_row() -> 'suggestion' ->> 'party_name',
  'Riverside Water Works',
  'taken back, the suggestion is back'
);
select is(
  public.answer_recurring_match('expense', pg_temp.id('water'), pg_temp.id('works'), true) ->> 'same',
  'true',
  'the owner says yes'
);

-- 7-9. Yes counts the new name's lines as the recurring one's.
select is(pg_temp.water_row(), null, 'the water bill is no longer late');
select is(
  (select e ->> 'amount_minor' from jsonb_array_elements(public.recurring_this_month('2026-10-20')) e
   where (e ->> 'party_id')::uuid = pg_temp.id('water')),
  '-5779',
  'הגיעו החודש shows the water bill with the new name''s amount'
);
select is(
  (public.payment_recurring(pg_temp.id('works_10'), '2026-10-20') -> 'party' ->> 'id')::uuid,
  pg_temp.id('water'),
  'the new name''s payment acts on the recurring supplier'
);

-- 10-12. One step only, and who may answer.
select throws_ok(
  format('select public.answer_recurring_match(%L, %L, %L, true)', 'expense', pg_temp.id('gas'), pg_temp.id('works')),
  'already matched',
  'a party already the same as one supplier cannot be the same as another'
);
select throws_ok(
  format('select public.answer_recurring_match(%L, %L, %L, true)', 'expense', pg_temp.id('works'), pg_temp.id('hillcrest')),
  'already matched',
  'a matched party cannot take matches of its own'
);
select tests.authenticate_as('rm_outsider');
select throws_ok(
  format('select public.answer_recurring_match(%L, %L, %L, false)', 'expense', pg_temp.id('water'), pg_temp.id('gas')),
  'no company',
  'another user cannot answer for the company'
);

-- 13-14. The MCP's answer and its undo.
select tests.clear_authentication();
reset role;
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('rm_owner'), pg_temp.id('co'), 'hash-rm-write', 'kid', array['write']::text[], '2099-01-01');
insert into rm (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-rm-write';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('rm_owner');
  tid uuid;
begin
  select id into tid from pg_temp.rm where label = 'write';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

select pg_temp.as_mcp();
select is(
  public.mcp_answer_recurring_match('rm-1', 'expense', pg_temp.id('water'), pg_temp.id('works'), null) -> 'data' ->> 'undo_kind',
  'recurring_match',
  'the MCP takes the answer back'
);
select is(
  public.mcp_undo('rm-undo-1', 'recurring_match', pg_temp.id('works')) ->> 'ok',
  'true',
  'undo recurring_match'
);

-- 15-16. The answer is back, and the table is read only through the functions.
reset role;
select is(
  (select same from public.recurring_matches where company_id = pg_temp.id('co') and match_party_id = pg_temp.id('works')),
  true,
  'the undo puts yes back'
);
select ok(
  not has_table_privilege('authenticated', 'public.recurring_matches', 'select')
  and not has_function_privilege('anon', 'public.answer_recurring_match(public.txn_direction, uuid, uuid, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.mcp_answer_recurring_match(text, text, uuid, uuid, boolean)', 'execute'),
  'the answers are read and written only through the functions'
);

select * from finish();
rollback;
