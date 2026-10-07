-- FLOW-104 review. set_transaction_category must leave the same stored role and shares
-- as reassign_transaction when the new category's kind differs from the line's own kind
-- (decision 0102: role and project follow the category kind). Invented data only.

begin;

select plan(8);

do $users$
begin
  perform tests.create_supabase_user('rk_owner', 'rk-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('rk_owner'), 'Example Role Reversals LLC', false);

create temp table rk_ref (label text primary key, id uuid);
grant all on rk_ref to authenticated, service_role;

insert into rk_ref (label, id)
select 'co', id from public.companies where name = 'Example Role Reversals LLC';

insert into public.projects (company_id, name, status)
values ((select id from rk_ref where label = 'co'), 'Site One', 'active');

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select (select id from rk_ref where label = 'co'), v.name, v.kind::public.category_kind, 60, false, false
from (values ('Rent income', 'income'), ('Materials', 'expense')) v(name, kind);

insert into rk_ref (label, id)
select 'p1', id from public.projects where company_id = (select id from rk_ref where label = 'co');
insert into rk_ref (label, id)
select case name when 'Rent income' then 'rent' else 'materials' end, id
from public.categories
where company_id = (select id from rk_ref where label = 'co') and name in ('Rent income', 'Materials');

create function pg_temp.mk(
  p_key text, p_direction text, p_doc_kind text, p_role text, p_net bigint, p_cat text
) returns void
language plpgsql
as $$
begin
  insert into public.transactions (
    company_id, direction, doc_kind, pnl_role, line_status, currency,
    amount_gross, amount_net, vat_amount, vat_status,
    doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
    user_assigned
  ) values (
    (select id from rk_ref where label = 'co'),
    p_direction::public.txn_direction, p_doc_kind::public.doc_kind,
    p_role::public.pnl_role, 'posted', 'ILS',
    p_net, p_net, 0, 'source',
    '2026-06-10', '2026-06-10', 'manual', 'rk:' || p_key,
    (select id from rk_ref where label = 'p1'),
    (select id from rk_ref where label = p_cat),
    'example ' || p_key, true
  );
  insert into rk_ref (label, id)
  select p_key, id from public.transactions where idempotency_key = 'rk:' || p_key;
end
$$;

select pg_temp.mk('t1', 'expense', 'expense', 'project', -10000, 'materials');
select pg_temp.mk('t2', 'income',  'receipt', null,        5000, 'rent');

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
values ((select id from rk_ref where label = 'co'), (select id from rk_ref where label = 't1'),
  (select id from rk_ref where label = 'p1'), 10000, -10000);

create function pg_temp.state(p_label text) returns jsonb language sql as $$
  select jsonb_build_object(
    'role', t.pnl_role,
    'shares', (select count(*) from public.allocations a where a.transaction_id = t.id))
  from public.transactions t where t.id = (select id from rk_ref where label = p_label);
$$;
grant execute on function pg_temp.state(text) to authenticated;

select tests.authenticate_as('rk_owner');

select lives_ok(
  format('select public.set_transaction_category(%L::uuid, %L::uuid, false)',
    (select id from rk_ref where label = 't1'), (select id from rk_ref where label = 'rent')),
  'set_transaction_category: an outflow takes an income category'
);
select is(
  pg_temp.state('t1'),
  '{"role": null, "shares": 0}'::jsonb,
  'the income-kind outflow has no cost role and no share, as after reassign_transaction'
);
select lives_ok(
  format('select public.set_transaction_category(%L::uuid, %L::uuid, false)',
    (select id from rk_ref where label = 't2'), (select id from rk_ref where label = 'materials')),
  'set_transaction_category: an inflow takes an expense category'
);
select is(
  pg_temp.state('t2'),
  '{"role": "project", "shares": 1}'::jsonb,
  'the expense-kind inflow is a project cost with one share'
);
select is(
  (select a.amount_net from public.allocations a
   where a.transaction_id = (select id from rk_ref where label = 't2')),
  5000::bigint,
  'the share carries the line amount'
);

-- Undo restores what was there before.
select lives_ok(
  format('select public.undo_reassign(public.set_transaction_category(%L::uuid, %L::uuid, false))',
    (select id from rk_ref where label = 't1'), (select id from rk_ref where label = 'materials')),
  'undo after a second change lives'
);
select is(
  pg_temp.state('t1'),
  '{"role": null, "shares": 0}'::jsonb,
  'undo restores the state from before that change'
);

-- Putting the line back under its own kind restores the cost role.
select lives_ok(
  format('select public.set_transaction_category(%L::uuid, %L::uuid, false)',
    (select id from rk_ref where label = 't1'), (select id from rk_ref where label = 'materials')),
  'the outflow goes back under an expense category'
);

select * from finish();
rollback;
