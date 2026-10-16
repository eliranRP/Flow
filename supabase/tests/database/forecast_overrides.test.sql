-- FLOW-141 server: the month-end forecast overrides. The app's RPCs (set, reset, read), the cross-
-- tenant and viewer rules, expiry with the month (a past month is read by no one and refused for
-- writes), and the MCP writes (idempotency, conflicts, undo of one item and of a month's reset).
-- Invented data only.

begin;

select plan(23);

do $users$
begin
  perform tests.create_supabase_user('fc_owner', 'fc-owner@example.com');
  perform tests.create_supabase_user('fc_viewer', 'fc-viewer@example.com');
  perform tests.create_supabase_user('fc_other', 'fc-other@example.com');
end
$users$;

create temp table fc (label text primary key, id uuid);
grant all on fc to authenticated, service_role;
create temp table fc_month (label text primary key, m text);
grant all on fc_month to authenticated, service_role;
create temp table fc_out (label text primary key, body jsonb);
grant all on fc_out to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from fc where label = p_label;
$$;
create function pg_temp.m(p_label text) returns text language sql stable as $$
  select m from fc_month where label = p_label;
$$;
create function pg_temp.out_of(p_label text) returns jsonb language sql stable as $$
  select body from fc_out where label = p_label;
$$;
grant execute on function pg_temp.id(text), pg_temp.m(text), pg_temp.out_of(text) to authenticated, service_role;

-- This month and the month before (Israel time), as the functions compare them.
insert into fc_month (label, m) values
  ('now', to_char(private.flow_today(), 'YYYY-MM')),
  ('past', to_char(private.flow_today() - interval '1 month', 'YYYY-MM'));

-- The other company first, so the owner's company is the one the rest of the file uses.
select tests.authenticate_as('fc_other');
select public.create_company('Other Forecast Co', true);
insert into fc (label, id) select 'other', id from public.companies where name = 'Other Forecast Co';
select public.set_forecast_item(
  (select m from fc_month where label = 'now'), 'party:expense:other-supplier:ILS', '{"amount_minor": 4000}'
);

select tests.authenticate_as('fc_owner');
select public.create_company('Forecast Books', true);
insert into fc (label, id) select 'co', id from public.companies where name = 'Forecast Books';

-- The viewer reads the company but cannot write it.
reset role;
insert into public.company_members (company_id, user_id, role)
values (pg_temp.id('co'), tests.get_supabase_uid('fc_viewer'), 'viewer');

-- An override for the month before: it must not show in this month, and no write may reach it.
insert into public.forecast_overrides (company_id, month, item_key, amount_minor)
values (pg_temp.id('co'), pg_temp.m('past'), 'party:expense:supplier-a:ILS', 9000);

-- The app's write: an amount for one item.
select tests.authenticate_as('fc_owner');
select is(
  public.set_forecast_item(pg_temp.m('now'), 'party:expense:supplier-a:ILS', '{"amount_minor": 12000}')->>'amount_minor',
  '12000',
  'the app sets an amount and gets the item back'
);
select is(
  jsonb_array_length(public.forecast_overrides_for(pg_temp.m('now'))),
  1,
  'the month lists its one override'
);
select is(
  jsonb_array_length(public.forecast_overrides_for(pg_temp.m('past'))),
  1,
  'the past month still holds its own row, read only for that month'
);
select is(
  (select count(*)::int from jsonb_array_elements(public.forecast_overrides_for(pg_temp.m('now'))) x where x->>'item_key' = 'party:expense:supplier-a:ILS'),
  1,
  'the item key is listed for the current month only'
);
select throws_ok(
  format($$select public.set_forecast_item(%L, 'party:expense:supplier-a:ILS', '{"amount_minor": 1}')$$, pg_temp.m('past')),
  '22023',
  'month ended',
  'a write to a month that has ended is refused'
);

-- The viewer reads but cannot write.
select tests.authenticate_as('fc_viewer');
select is(
  jsonb_array_length(public.forecast_overrides_for(pg_temp.m('now'))),
  1,
  'a viewer reads the month''s overrides'
);
select throws_ok(
  format($$select public.set_forecast_item(%L, 'party:expense:supplier-b:ILS', '{"moved_out": true}')$$, pg_temp.m('now')),
  '42501',
  null,
  'a viewer cannot set an item'
);

-- Another company reads nothing and writes nothing of this one's.
select tests.authenticate_as('fc_other');
select is(
  jsonb_array_length(public.forecast_overrides_for(pg_temp.m('now'))),
  1,
  'another company reads only its own override for the month'
);
select is(
  (select count(*)::int from public.forecast_overrides f where f.company_id = pg_temp.id('co')),
  0,
  'another company cannot read this company''s rows'
);

-- Back to the owner: a day for one item, a move to next month, a reset of one item.
select tests.authenticate_as('fc_owner');
select is(
  public.set_forecast_item(pg_temp.m('now'), 'invoice:open-1', '{"moved_out": true}')->>'moved_out',
  'true',
  'an item moved out of this month'
);
select is(
  public.set_forecast_item(pg_temp.m('now'), 'invoice:open-1', '{"reset": true}'),
  null,
  'a reset of one item returns Flow''s number (null)'
);
select is(
  public.reset_forecast_month(pg_temp.m('now')),
  1,
  'איפוס of the month removes its overrides and counts them'
);

-- MCP writes, with a write token for the owner.
reset role;
select public.store_mcp_credential(tests.get_supabase_uid('fc_owner'), 'hash-fc-write-0001', array['read','write'],
  now() + interval '90 days', 'pepper-fc');
insert into fc (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-fc-write-0001';

create function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('fc_owner');
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
insert into fc_out (label, body)
values ('set1', public.mcp_set_forecast_item('fc-s-1', pg_temp.m('now'), 'party:expense:supplier-c:ILS', '{"amount_minor": 7500}'));
select is(
  pg_temp.out_of('set1') -> 'data' ->> 'undo_kind',
  'forecast_item',
  'mcp set returns the forecast_item undo kind'
);
select is(
  public.mcp_set_forecast_item('fc-s-1', pg_temp.m('now'), 'party:expense:supplier-c:ILS', '{"amount_minor": 7500}'),
  pg_temp.out_of('set1'),
  'the same key and the same call replays the response'
);
select is(
  public.mcp_set_forecast_item('fc-s-1', pg_temp.m('now'), 'party:expense:supplier-c:ILS', '{"amount_minor": 1}')->'error'->>'code',
  'conflict',
  'the same key with another amount is a conflict'
);
select is(
  public.mcp_set_forecast_item('fc-s-2', pg_temp.m('now'), 'party:expense:supplier-c:ILS', '{"colour": "red"}')->'error'->>'code',
  'validation',
  'an unknown field is a validation error'
);
select is(
  public.mcp_set_forecast_item('fc-s-3', pg_temp.m('past'), 'party:expense:supplier-c:ILS', '{"amount_minor": 1}')->'error'->>'code',
  'refused',
  'the MCP set refuses a month that has ended'
);

-- Undo of the item puts back what was there before (nothing).
select is(
  public.mcp_undo('fc-u-1', 'forecast_item', (pg_temp.out_of('set1') -> 'data' ->> 'id')::uuid)->>'ok',
  'true',
  'undo of an item write succeeds'
);
select is(
  (select count(*)::int from public.forecast_overrides f
   where f.company_id = pg_temp.id('co') and f.item_key = 'party:expense:supplier-c:ILS'),
  0,
  'the undone item is back at Flow''s number'
);

-- A reset of the month, then undo brings the rows back.
insert into fc_out (label, body)
values ('set2', public.mcp_set_forecast_item('fc-s-4', pg_temp.m('now'), 'party:expense:supplier-d:ILS', ('{"due_on": "' || pg_temp.m('now') || '-20"}')::jsonb));
insert into fc_out (label, body)
values ('reset1', public.mcp_reset_forecast('fc-r-1', pg_temp.m('now')));
select is(
  pg_temp.out_of('reset1') -> 'data' ->> 'removed',
  '1',
  'mcp reset removes the month''s overrides and says how many'
);
select is(
  public.mcp_undo('fc-u-2', 'forecast_reset', (pg_temp.out_of('reset1') -> 'data' ->> 'id')::uuid)->>'ok',
  'true',
  'undo of a reset puts the month''s overrides back'
);
select is(
  (select count(*)::int from public.forecast_overrides f
   where f.company_id = pg_temp.id('co') and f.month = pg_temp.m('now')),
  1,
  'the reset month has its override again'
);
select isnt(
  public.mcp_undo('fc-u-3', 'forecast_reset', (pg_temp.out_of('reset1') -> 'data' ->> 'id')::uuid)->'error'->>'code',
  null,
  'a second undo of the same reset is refused'
);

select * from finish();

rollback;
