-- mcp_undo undoes only a write made in the caller's current company. A user who reset a forecast
-- month (or set an item) in company B, then lost B, cannot replay the undo with a token for their
-- own company A: it is not found, and neither company's overrides change. The same user, still in
-- B, undoes with a B token as before. Every other undo kind refuses a write from another company
-- the same way, and every write records its token's company. Invented data only.

begin;

select plan(24);

do $users$
begin
  perform tests.create_supabase_user('muc_user', 'muc-user@example.com');
  perform tests.create_supabase_user('muc_b_owner', 'muc-b-owner@example.com');
end
$users$;

create temp table muc (label text primary key, id uuid);
grant all on muc to authenticated, service_role;
create temp table muc_out (label text primary key, body jsonb);
grant all on muc_out to authenticated, service_role;

create function pg_temp.id(p_label text) returns uuid language sql stable as $$
  select id from muc where label = p_label;
$$;
create function pg_temp.out_of(p_label text) returns jsonb language sql stable as $$
  select body from muc_out where label = p_label;
$$;
create function pg_temp.write_id(p_label text) returns uuid language sql stable as $$
  select (body -> 'data' ->> 'id')::uuid from muc_out where label = p_label;
$$;
-- This month and the month before (Israel time), as the forecast functions compare them.
create temp table muc_month (label text primary key, m text);
grant all on muc_month to authenticated, service_role;
insert into muc_month (label, m) values
  ('now', to_char(private.flow_today(), 'YYYY-MM')),
  ('past', to_char(private.flow_today() - interval '1 month', 'YYYY-MM'));
create function pg_temp.month() returns text language sql stable as $$
  select m from muc_month where label = 'now';
$$;
create function pg_temp.past_month() returns text language sql stable as $$
  select m from muc_month where label = 'past';
$$;
grant execute on function pg_temp.id(text), pg_temp.out_of(text), pg_temp.write_id(text),
  pg_temp.month(), pg_temp.past_month() to authenticated, service_role;

-- Company B, owned by someone else; then the user's own company A.
select tests.authenticate_as('muc_b_owner');
select public.create_company('Birch Ledger Co', true);
insert into muc (label, id) select 'b', id from public.companies where name = 'Birch Ledger Co';

select tests.authenticate_as('muc_user');
select public.create_company('Aspen Books Co', true);
insert into muc (label, id) select 'a', id from public.companies where name = 'Aspen Books Co';

reset role;
insert into public.company_members (company_id, user_id, role)
values (pg_temp.id('b'), tests.get_supabase_uid('muc_user'), 'editor');

-- One write token per company for the user.
insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values
  (tests.get_supabase_uid('muc_user'), pg_temp.id('a'), 'hash-muc-a-write-01', 'pepper-muc', array['read','write'], now() + interval '90 days'),
  (tests.get_supabase_uid('muc_user'), pg_temp.id('b'), 'hash-muc-b-write-01', 'pepper-muc', array['read','write'], now() + interval '90 days');
insert into muc (label, id)
select 'tok_a', id from private.mcp_credentials where token_hash = 'hash-muc-a-write-01';
insert into muc (label, id)
select 'tok_b', id from private.mcp_credentials where token_hash = 'hash-muc-b-write-01';

-- A's own override in the month before, so "A unchanged" has a row to compare.
insert into public.forecast_overrides (company_id, month, item_key, amount_minor)
values (pg_temp.id('a'), pg_temp.past_month(), 'party:expense:aspen-rent:ILS', 2500);

create function pg_temp.as_mcp(p_token text)
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('muc_user');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', pg_temp.id(p_token))::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

-- The overrides of a company, as one comparable value.
create function pg_temp.overrides(p_company uuid) returns jsonb language sql stable security definer as $$
  select coalesce(jsonb_agg(jsonb_build_array(f.month, f.item_key, f.amount_minor, f.due_on, f.moved_out)
    order by f.month, f.item_key), '[]'::jsonb)
  from public.forecast_overrides f where f.company_id = p_company;
$$;
grant execute on function pg_temp.overrides(uuid) to authenticated, service_role;

-- In B: two items set, then the month reset.
select pg_temp.as_mcp('tok_b');
insert into muc_out (label, body) values
  ('item1', public.mcp_set_forecast_item('muc-s-1', pg_temp.month(), 'party:expense:birch-supplier-1:ILS', '{"amount_minor": 5000}')),
  ('item2', public.mcp_set_forecast_item('muc-s-2', pg_temp.month(), 'party:expense:birch-supplier-2:ILS', '{"amount_minor": 3000}'));
insert into muc_out (label, body) values
  ('reset', public.mcp_reset_forecast('muc-r-1', pg_temp.month()));

reset role;
select is(
  (select count(*)::int from private.mcp_writes w
   where w.id in (pg_temp.write_id('item1'), pg_temp.write_id('item2'), pg_temp.write_id('reset'))
     and w.company_id = pg_temp.id('b')),
  3,
  'the forecast writes record the company of the token they were made with'
);
select is(
  pg_temp.out_of('reset') -> 'data' ->> 'removed',
  '2',
  'the reset removed both of B''s overrides'
);
insert into muc_out (label, body) values
  ('a_before', pg_temp.overrides(pg_temp.id('a'))),
  ('b_before', pg_temp.overrides(pg_temp.id('b')));

-- Still a member of B, but calling with A's token: B's write is not found in A.
select pg_temp.as_mcp('tok_a');
select is(
  public.mcp_undo('muc-u-1', 'forecast_reset', pg_temp.write_id('reset'))->'error'->>'code',
  'not_found',
  'a member of B cannot undo B''s reset with a token for A'
);

-- The user leaves B.
reset role;
delete from public.company_members
where company_id = pg_temp.id('b') and user_id = tests.get_supabase_uid('muc_user');

-- With A's token, neither forecast undo reaches B's writes.
select pg_temp.as_mcp('tok_a');
select is(
  public.mcp_undo('muc-u-2', 'forecast_reset', pg_temp.write_id('reset')),
  jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'not_found', 'message', 'not found')),
  'a removed member''s undo of B''s reset with A''s token is not found'
);
reset role;
select is(pg_temp.overrides(pg_temp.id('a')), pg_temp.out_of('a_before'), 'A''s overrides are unchanged after the refused reset undo');
select is(pg_temp.overrides(pg_temp.id('b')), pg_temp.out_of('b_before'), 'B''s overrides are unchanged after the refused reset undo');

-- A holds the same item B's write left, so an undo applied to A would delete it.
insert into public.forecast_overrides (company_id, month, item_key, amount_minor)
values (pg_temp.id('a'), pg_temp.month(), 'party:expense:birch-supplier-2:ILS', 3000);
update muc_out set body = pg_temp.overrides(pg_temp.id('a')) where label = 'a_before';

select pg_temp.as_mcp('tok_a');
select is(
  public.mcp_undo('muc-u-3', 'forecast_item', pg_temp.write_id('item2'))->'error'->>'code',
  'not_found',
  'a removed member''s undo of B''s item with A''s token is not found'
);
reset role;
select is(pg_temp.overrides(pg_temp.id('a')), pg_temp.out_of('a_before'), 'A''s overrides are unchanged after the refused item undo');
select is(pg_temp.overrides(pg_temp.id('b')), pg_temp.out_of('b_before'), 'B''s overrides are unchanged after the refused item undo');
select is(
  (select count(*)::int from private.mcp_writes w
   where w.id in (pg_temp.write_id('item1'), pg_temp.write_id('item2'), pg_temp.write_id('reset'))
     and w.undone_at is null),
  3,
  'the refused undos left B''s writes open'
);

-- B's token no longer works for the removed user.
select pg_temp.as_mcp('tok_b');
select is(
  public.mcp_undo('muc-u-4', 'forecast_reset', pg_temp.write_id('reset'))->'error'->>'code',
  'forbidden',
  'the removed member''s B token is refused'
);

-- Back in B: the same user undoes with the B token, as before.
reset role;
delete from public.forecast_overrides
where company_id = pg_temp.id('a') and month = pg_temp.month();
update muc_out set body = pg_temp.overrides(pg_temp.id('a')) where label = 'a_before';
insert into public.company_members (company_id, user_id, role)
values (pg_temp.id('b'), tests.get_supabase_uid('muc_user'), 'editor');

select pg_temp.as_mcp('tok_b');
select is(
  public.mcp_undo('muc-u-5', 'forecast_reset', pg_temp.write_id('reset'))->>'ok',
  'true',
  'a member of B undoes B''s reset with a B token'
);
reset role;
select is(
  (select count(*)::int from public.forecast_overrides f
   where f.company_id = pg_temp.id('b') and f.month = pg_temp.month()),
  2,
  'B''s month has both overrides back'
);
select pg_temp.as_mcp('tok_b');
select is(
  public.mcp_undo('muc-u-6', 'forecast_item', pg_temp.write_id('item2'))->>'ok',
  'true',
  'a member of B undoes B''s item with a B token'
);
reset role;
select is(
  (select array_agg(f.item_key order by f.item_key) from public.forecast_overrides f
   where f.company_id = pg_temp.id('b') and f.month = pg_temp.month()),
  array['party:expense:birch-supplier-1:ILS'],
  'the undone item is gone from B and the other stays'
);
select is(pg_temp.overrides(pg_temp.id('a')), pg_temp.out_of('a_before'), 'A''s overrides are unchanged by B''s undos');

-- A write stored without a company gets its token's company; the column is never empty.
with w as (
  insert into private.mcp_writes (token_id, user_id, kind, prior)
  values (pg_temp.id('tok_a'), tests.get_supabase_uid('muc_user'), 'forecast_reset',
    jsonb_build_object('month', pg_temp.month(), 'rows', '[]'::jsonb))
  returning id
)
insert into muc (label, id) select 'bare_write', id from w;
select is(
  (select company_id from private.mcp_writes where id = pg_temp.id('bare_write')),
  pg_temp.id('a'),
  'a write inserted without a company takes its token''s company'
);
select col_not_null('private', 'mcp_writes', 'company_id', 'mcp_writes.company_id is not null');

-- Every other undo kind: a write from B is not found with A's token, and stays open. One write
-- per kind, every target column and prior key pointing at one id, so each kind's own lookup
-- matches; only the company differs.
insert into muc (label, id) values ('target', gen_random_uuid());
create temp table muc_sweep (kind text primary key, write_id uuid, p_id uuid, result jsonb);
grant all on muc_sweep to authenticated, service_role;
insert into muc_sweep (kind, write_id, p_id)
select k, gen_random_uuid(),
  case
    when k in ('project_forecast', 'index_rate', 'loan_part_category', 'loan_category_from') then null
    when k in ('cash_basis', 'company', 'loan_order', 'company_currency', 'jev_mode') then pg_temp.id('b')
    else pg_temp.id('target')
  end
from unnest(array[
  'supplier_category', 'recurring_match', 'line_pace', 'line_recurring', 'line_amount', 'category_cash', 'line_cash',
  'cash_basis', 'invite', 'member_role', 'member_remove', 'review', 'reassign', 'project',
  'category', 'category_hidden', 'category_pnl', 'loan', 'loan_update', 'loan_split',
  'overhead_project', 'company', 'line_split', 'line_pnl', 'loan_rate', 'invoice_paid',
  'loan_detach', 'loan_delete', 'loan_order', 'project_investment', 'category_rehab',
  'category_delete', 'category_move', 'company_currency', 'category_group', 'category_parent',
  'project_group', 'project_group_member', 'category_name', 'jev_mode', 'loan_index', 'loan_refinance',
  'index_rate', 'project_update', 'project_delete', 'project_forecast', 'invoice_link',
  'invoice_dismiss', 'manual_entry', 'document_attach', 'bank_accounts', 'transfer_match',
  'book_line', 'note_add', 'note_edit', 'note_remove', 'file_remove', 'loan_part_category',
  'loan_category_from', 'journal_entry'
]) k;
update muc_sweep set p_id = write_id where p_id is null;

insert into private.mcp_writes (
  id, token_id, user_id, company_id, kind, transaction_id, review_id, reassign_id, project_id,
  category_id, loan_id, prior
)
select s.write_id, pg_temp.id('tok_b'), tests.get_supabase_uid('muc_user'),
  pg_temp.id('b'), s.kind, t.id, t.id, t.id, t.id, t.id, t.id,
  jsonb_build_object(
    'before', 'null'::jsonb, 'after', 'null'::jsonb, 'written', 'null'::jsonb, 'rows', '[]'::jsonb,
    'company_id', t.id, 'invite_id', t.id, 'user_id', t.id, 'rate_id', t.id, 'group_id', t.id,
    'party_id', t.id, 'match_party_id', t.id, 'project_id', t.id, 'deletion_id', t.id,
    'move_id', t.id, 'effective_date', '2026-01-01', 'written_at', null, 'parts', '[]'::jsonb,
    'undo', '[]'::jsonb, 'row', '{}'::jsonb, 'direction', 'expense', 'connection_id', t.id,
    'in_transaction_id', t.id, 'note_id', t.id, 'file_id', t.id, 'supplier_id', t.id,
    'part', 'interest', 'moved', '[]'::jsonb
  )
from muc_sweep s cross join (select pg_temp.id('target') as id) t;

select pg_temp.as_mcp('tok_a');
update muc_sweep s set result = public.mcp_undo('muc-sweep-' || s.kind, s.kind, s.p_id);
reset role;

select is(
  (select array_agg(s.kind order by s.kind) from muc_sweep s
   where s.result is distinct from jsonb_build_object(
     'ok', false, 'error', jsonb_build_object('code', 'not_found', 'message', 'not found'))),
  null,
  'every other undo kind finds no write from another company'
);
select is(
  (select count(*)::int from private.mcp_writes w join muc_sweep s on s.write_id = w.id where w.undone_at is null),
  (select count(*)::int from muc_sweep),
  'every swept write from B is still open'
);
select is(
  (select count(*)::int from muc_sweep),
  60,
  'the sweep covers every undo kind but the two forecast ones'
);

-- The writes kept B's company; with the kind list in mcp_undo, nothing else is undoable.
select is(
  (select count(*)::int from private.mcp_writes w join muc_sweep s on s.write_id = w.id
   where w.company_id = pg_temp.id('b')),
  60,
  'the swept writes keep the company they were stored with'
);
select is(
  (select count(*)::int from private.mcp_writes where company_id is null),
  0,
  'no write is left without a company'
);

-- The sweep and the forecast tests cover every kind mcp_writes allows.
select is(
  (select array_agg(s.kind order by s.kind) from muc_sweep s),
  (select array_agg(m[1] order by m[1])
   from regexp_matches(
     (select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conname = 'mcp_writes_kind_check' and c.conrelid = 'private.mcp_writes'::regclass),
     '''([a-z_]+)''', 'g') m
   where m[1] not in ('forecast_item', 'forecast_reset')),
  'the sweep and the forecast tests cover every kind mcp_writes allows'
);

select * from finish();

rollback;
