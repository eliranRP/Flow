-- FLOW-413 + FLOW-103, server PR 2 (decision 0168). The cash view's MCP writes: each switch
-- with its idempotency key and undo, the batch with undo_batch, and conflicts when the value
-- changed since. Invented data only. Amounts are agorot.

begin;

select plan(22);

do $users$
begin
  perform tests.create_supabase_user('cfx_owner', 'cfx-owner@example.com');
end
$users$;

create temp table cfx (label text primary key, id uuid);
grant all on cfx to authenticated, service_role;

insert into cfx (label, id) values ('co', tests.fixture_company('cfx_owner', 'Example Cash Tools LLC'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.cfx where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into cfx (label, id) values
  ('transfers', (select id from public.categories where company_id = pg_temp.id('co') and name = 'העברות' and kind = 'expense')),
  ('other', (select id from public.categories where company_id = pg_temp.id('co') and name = 'אחר' and kind = 'expense'));

insert into cfx (label, id) values
  ('a', tests.fixture_line(pg_temp.id('co'), 'cfx:a', 10000, 'expense', null, pg_temp.id('other'), '2026-06-10', p_pnl_role => null)),
  ('b', tests.fixture_line(pg_temp.id('co'), 'cfx:b', 20000, 'expense', null, pg_temp.id('other'), '2026-06-11', p_pnl_role => null));

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (tests.get_supabase_uid('cfx_owner'), pg_temp.id('co'), 'hash-cfx-write', 'kid', array['write']::text[], '2099-01-01');
insert into cfx (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-cfx-write';

create or replace function pg_temp.as_mcp()
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := tests.get_supabase_uid('cfx_owner');
  tid uuid;
begin
  select id into tid from pg_temp.cfx where label = 'write';
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text, true);
end;
$$;
grant execute on function pg_temp.as_mcp() to authenticated, service_role;

select pg_temp.as_mcp();

-- 1-6. A category.
select is(
  public.mcp_set_category_cash('cfx-cat-1', pg_temp.id('transfers'), true) -> 'data',
  jsonb_build_object('id', pg_temp.id('transfers'), 'in_cash', true, 'undo_kind', 'category_cash'),
  'set_category_cash puts a category in cash'
);
select ok((select in_cash from public.categories where id = pg_temp.id('transfers')), 'the flag is written');
select is(
  public.mcp_set_category_cash('cfx-cat-1', pg_temp.id('transfers'), true) -> 'data' ->> 'undo_kind',
  'category_cash',
  'the same key replays'
);
select is(
  public.mcp_set_category_cash('cfx-cat-1', pg_temp.id('transfers'), false) -> 'error' ->> 'code',
  'conflict',
  'the same key with other arguments is a conflict'
);
select is(
  public.mcp_undo('cfx-undo-cat', 'category_cash', pg_temp.id('transfers')) ->> 'ok',
  'true',
  'undo category_cash'
);
select ok((select not in_cash from public.categories where id = pg_temp.id('transfers')), 'the category is out of cash again');

-- 7-12. One line.
select is(
  public.mcp_set_line_cash('cfx-line-1', pg_temp.id('a'), false) -> 'data' ->> 'cash_state',
  'out',
  'set_line_cash takes a line out'
);
select is(
  (select in_cash_override from public.transactions where id = pg_temp.id('a')),
  false,
  'the override is written'
);
select is(
  public.mcp_set_line_cash('cfx-line-2', pg_temp.id('a'), null) -> 'data' ->> 'cash_state',
  'in',
  'null follows the category again'
);
select is(
  public.mcp_undo('cfx-undo-line-1', 'line_cash', pg_temp.id('a')) ->> 'ok',
  'true',
  'undo takes back the newest write first'
);
select is(
  (select in_cash_override from public.transactions where id = pg_temp.id('a')),
  false,
  'the line is out again'
);
select is(
  public.mcp_set_line_cash('cfx-line-3', '00000000-0000-4000-8000-000000000000', false) -> 'error' ->> 'code',
  'refused',
  'an unknown line is refused'
);

-- 13-14. A value changed since the write is a conflict.
reset role;
update public.transactions set in_cash_override = true where id = pg_temp.id('a');
select pg_temp.as_mcp();
select is(
  public.mcp_undo('cfx-undo-line-2', 'line_cash', pg_temp.id('a')) -> 'error' ->> 'code',
  'conflict',
  'undo of a line changed since is a conflict'
);
select is(
  (select in_cash_override from public.transactions where id = pg_temp.id('a')),
  true,
  'and leaves the line as it is'
);

-- 15-18. A batch, and undo_batch.
select is(
  (public.mcp_set_lines_cash('cfx-batch', jsonb_build_array(
    jsonb_build_object('transaction_id', pg_temp.id('a'), 'in_cash', null),
    jsonb_build_object('transaction_id', pg_temp.id('b'), 'in_cash', false),
    jsonb_build_object('transaction_id', pg_temp.id('b'))
  )) -> 'error' ->> 'code'),
  'validation',
  'a line listed twice is refused'
);
insert into cfx (label, id)
select 'batch', (public.mcp_set_lines_cash('cfx-batch', jsonb_build_array(
  jsonb_build_object('transaction_id', pg_temp.id('a'), 'in_cash', null),
  jsonb_build_object('transaction_id', pg_temp.id('b'), 'in_cash', false)
)) -> 'data' ->> 'batch_key')::uuid;
select is(
  (select jsonb_agg(jsonb_build_array(in_cash_override) order by idempotency_key) from public.transactions where id in (pg_temp.id('a'), pg_temp.id('b'))),
  '[[null], [false]]'::jsonb,
  'set_lines_cash writes each line'
);
select is(
  public.mcp_undo_batch('cfx-undo-batch', pg_temp.id('batch')::text) -> 'data' ->> 'ok_count',
  '2',
  'undo_batch undoes both rows'
);
select is(
  (select jsonb_agg(jsonb_build_array(in_cash_override) order by idempotency_key) from public.transactions where id in (pg_temp.id('a'), pg_temp.id('b'))),
  '[[true], [null]]'::jsonb,
  'each line is back as it was'
);

-- 19-22. The basis.
select is(
  public.mcp_set_cash_basis('cfx-basis', 'invoice') -> 'data',
  jsonb_build_object('basis', 'invoice', 'prior_basis', 'paid', 'undo_kind', 'cash_basis', 'id', pg_temp.id('co')),
  'set_cash_basis switches to the invoice date'
);
select is(
  public.mcp_set_cash_basis('cfx-basis-bad', 'weekly') -> 'error' ->> 'code',
  'validation',
  'an unknown basis is refused'
);
select is(
  public.mcp_undo('cfx-undo-basis', 'cash_basis', pg_temp.id('co')) ->> 'ok',
  'true',
  'undo cash_basis'
);
select is(
  (select cash_basis from public.companies where id = pg_temp.id('co')),
  'paid',
  'the basis is back'
);

select * from finish();
rollback;
