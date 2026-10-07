-- FLOW-104 review. A shared or overhead outflow moved to an income category counts as
-- company income with no project (decision 0103). No read may still count it as a
-- shared cost or as overhead. Invented data only. Amounts are minor units.

begin;

select plan(10);

do $users$
begin
  perform tests.create_supabase_user('rs_owner', 'rs-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('rs_owner'), 'Example Shared Reversals LLC', false);

create temp table rs_ref (label text primary key, id uuid);
grant all on rs_ref to authenticated, service_role;

insert into rs_ref (label, id)
select 'co', id from public.companies where name = 'Example Shared Reversals LLC';

insert into public.projects (company_id, name, status)
select (select id from rs_ref where label = 'co'), v.name, 'active'
from (values ('Site One'), ('Site Two')) v(name);

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select (select id from rs_ref where label = 'co'), v.name, v.kind::public.category_kind, 60, false, false
from (values ('Rent income', 'income'), ('Materials', 'expense')) v(name, kind);

insert into rs_ref (label, id)
select case name when 'Site One' then 'p1' else 'p2' end, id
from public.projects where company_id = (select id from rs_ref where label = 'co');
insert into rs_ref (label, id)
select case name when 'Rent income' then 'rent' else 'materials' end, id
from public.categories
where company_id = (select id from rs_ref where label = 'co') and name in ('Rent income', 'Materials');

create function pg_temp.mk(
  p_key text, p_direction text, p_doc_kind text, p_role text, p_currency text,
  p_net bigint, p_cat text, p_project text
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
    (select id from rs_ref where label = 'co'),
    p_direction::public.txn_direction, p_doc_kind::public.doc_kind,
    p_role::public.pnl_role, 'posted', p_currency,
    p_net, p_net, 0, 'source',
    '2026-06-10', '2026-06-10', 'manual', 'rs:' || p_key,
    (select id from rs_ref where label = p_project),
    (select id from rs_ref where label = p_cat),
    'example ' || p_key, true
  );
  insert into rs_ref (label, id)
  select p_key, id from public.transactions where idempotency_key = 'rs:' || p_key;
end
$$;

select pg_temp.mk('s1', 'income',  'invoice_receipt', null,       'ILS', 100000, 'rent',      'p2');
select pg_temp.mk('s2', 'expense', 'expense',         'shared',   'ILS', -20000, 'materials', null);
select pg_temp.mk('s3', 'expense', 'expense',         'overhead', 'ILS',  -6000, 'materials', null);
select pg_temp.mk('s4', 'expense', 'expense',         'overhead', 'ILS',  -4000, 'materials', null);
select pg_temp.mk('s5', 'expense', 'expense',         'shared',   'ILS',  -8000, 'materials', null);
select pg_temp.mk('s6', 'expense', 'expense',         'shared',   'USD',  -2000, 'materials', null);

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from rs_ref where label = 'co'), (select id from rs_ref where label = v.t),
  (select id from rs_ref where label = v.p), 5000, v.amount
from (values
  ('s2', 'p1', -10000), ('s2', 'p2', -10000),
  ('s5', 'p1', -4000), ('s5', 'p2', -4000),
  ('s6', 'p1', -1000), ('s6', 'p2', -1000)
) v(t, p, amount);

insert into public.overhead (company_id, transaction_id)
select (select id from rs_ref where label = 'co'), id from rs_ref where label in ('s3', 's4');

select tests.authenticate_as('rs_owner');

select lives_ok(
  format('select public.set_transaction_category(%L::uuid, %L::uuid, false)',
    (select id from rs_ref where label = 's2'), (select id from rs_ref where label = 'rent')),
  'a shared outflow takes an income category'
);
select lives_ok(
  format('select public.set_transaction_category(%L::uuid, %L::uuid, false); '
    || 'select public.set_transaction_category(%L::uuid, %L::uuid, false)',
    (select id from rs_ref where label = 's4'), (select id from rs_ref where label = 'rent'),
    (select id from rs_ref where label = 's6'), (select id from rs_ref where label = 'rent')),
  'an overhead outflow and a USD shared outflow take an income category'
);

create function pg_temp.pnl() returns jsonb language sql as $$
  select public.company_pnl((select id from rs_ref where label = 'co'), null, null, 'cash');
$$;
create function pg_temp.proj(p_label text) returns jsonb language sql as $$
  select public.get_project((select id from rs_ref where label = p_label), 'cash');
$$;
grant execute on function pg_temp.pnl() to authenticated;
grant execute on function pg_temp.proj(text) to authenticated;

select is(
  (select jsonb_build_object('income', j->'income_agorot', 'shared', j->'shared_agorot', 'overhead', j->'overhead_agorot')
   from (select pg_temp.pnl() j) s),
  '{"income": 76000, "shared": 8000, "overhead": 6000}'::jsonb,
  'company_pnl: the moved lines are company income, not shared cost or overhead'
);
select is(
  pg_temp.proj('p1')->'shared_agorot',
  '4000'::jsonb,
  'get_project: only the expense-kind shared line counts as a shared cost'
);
select is(
  pg_temp.proj('p1')->'shared_agorot',
  (select x->'shared_agorot' from jsonb_array_elements(pg_temp.pnl()->'projects') x where x->>'name' = 'Site One'),
  'get_project agrees with the company_pnl project row'
);
select is(
  (select x->'shared_minor' from jsonb_array_elements(pg_temp.proj('p1')->'by_currency') x where x->>'currency' = 'ILS'),
  '4000'::jsonb,
  'get_project by_currency: the same shared amount'
);
select is(
  (select count(*)::integer from jsonb_array_elements(pg_temp.proj('p1')->'by_currency') x where x->>'currency' = 'USD'),
  0,
  'get_project by_currency: the USD income-kind shared line is not a shared cost'
);
select is(
  pg_temp.proj('p1')->'other_currencies',
  '[]'::jsonb,
  'get_project other_currencies: nothing in USD'
);
select is(
  pg_temp.proj('p2')->'overhead_share_agorot',
  pg_temp.pnl()->'overhead_agorot',
  'overhead share: the only weighted project carries the company overhead, without the moved line'
);
select is(
  pg_temp.proj('p2')->'overhead_share_agorot',
  '6000'::jsonb,
  'overhead share is 60.00'
);

select * from finish();
rollback;
