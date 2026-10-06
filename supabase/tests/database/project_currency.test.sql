-- get_project by_currency, categories_by_currency, and transaction currency.

begin;

select plan(12);

do $users$
begin
  perform tests.create_supabase_user('pc_owner', 'pc-owner@test.flow');
  perform tests.create_supabase_user('pc_other', 'pc-other@test.flow');
end
$users$;

create temp table pc_ref (label text primary key, id uuid);
grant all on pc_ref to authenticated;

select tests.authenticate_as('pc_owner');
select lives_ok($$select public.create_company('Harbor Sample Co', true)$$, 'owner creates company');
select lives_ok($$select public.upsert_project(null, 'Dock', null, 'active')$$, 'owner opens project');
insert into pc_ref (label, id) select 'co', id from public.companies where name = 'Harbor Sample Co';
insert into pc_ref (label, id) select 'dock', id from public.projects where name = 'Dock';

select tests.authenticate_as('pc_other');
select lives_ok($$select public.create_company('Other Harbor Co', true)$$, 'other owner creates company');
insert into pc_ref (label, id) select 'other', id from public.companies where name = 'Other Harbor Co';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description, removed_at, category_id
)
select c.id, v.direction::public.txn_direction, v.doc_kind::public.doc_kind, v.pnl_role::public.pnl_role,
  v.line_status::public.line_status, v.currency,
  v.amount, v.amount, abs(v.amount), 0, 'source',
  v.doc_date::date, v.cash_date::date, v.source::public.txn_source, v.ikey,
  (select id from pc_ref where label = 'dock'), v.ikey, null,
  (select id from public.categories where company_id = c.id and name = 'Utilities' limit 1)
from (values
  ('income',  'receipt', null,      'posted', 'USD', 300000, '2026-09-10', '2026-09-10', 'mercury', 'dock:income'),
  ('expense', 'expense', 'project', 'posted', 'USD', -125000, '2026-09-11', null, 'mercury', 'dock:direct')
) as v(direction, doc_kind, pnl_role, line_status, currency, amount, doc_date, cash_date, source, ikey)
join pc_ref c on c.label = 'co';

select tests.authenticate_as('pc_owner');

select is(
  (public.get_project((select id from pc_ref where label = 'dock')) -> 'by_currency' -> 0 ->> 'currency'),
  'USD',
  'usd-only project exposes USD by_currency'
);

select is(
  (public.get_project((select id from pc_ref where label = 'dock')) -> 'by_currency' -> 0 ->> 'income_minor')::bigint,
  300000::bigint,
  'usd income_minor matches posted income'
);

select is(
  (public.get_project((select id from pc_ref where label = 'dock')) -> 'categories_by_currency' -> 0 ->> 'currency'),
  'USD',
  'categories_by_currency carries currency'
);

select is(
  (public.get_project((select id from pc_ref where label = 'dock')) -> 'transactions' -> 0 ->> 'currency'),
  'USD',
  'transaction rows include currency'
);

select is(
  (public.get_project((select id from pc_ref where label = 'dock')) ->> 'income_agorot')::bigint,
  0::bigint,
  'ils income stays zero for usd-only project'
);

select is(
  public.get_project((select id from pc_ref where label = 'dock')::uuid) ->> 'id',
  (select id::text from pc_ref where label = 'dock'),
  'owner receives project payload'
);

select tests.authenticate_as('pc_other');
select is(
  public.get_project((select id from pc_ref where label = 'dock')),
  null,
  'another company owner gets null for this project'
);

select * from finish();
rollback;
