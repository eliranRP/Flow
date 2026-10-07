-- FLOW-104 with FLOW-102. On the overhead project a reversal income line (an outflow under an
-- income category) is income, not overhead, and a refund of a cost (an inflow under an expense
-- category) lowers overhead (decisions 0101 and 0103). Invented data only. Amounts are minor units.

begin;

select plan(5);

do $users$
begin
  perform tests.create_supabase_user('rop_owner', 'rop-owner@example.com');
end
$users$;

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('rop_owner'), 'Example Reversal Overhead LLC', false);

create temp table rop_ref (label text primary key, id uuid);
grant all on rop_ref to authenticated, service_role;

insert into rop_ref (label, id) select 'co', id from public.companies where name = 'Example Reversal Overhead LLC';
insert into public.projects (company_id, name, status)
values ((select id from rop_ref where label = 'co'), 'Office', 'active');
insert into rop_ref (label, id) select 'office', id from public.projects where name = 'Office';

insert into public.categories (company_id, name, kind, sort_order, is_default, excluded_from_pnl)
select (select id from rop_ref where label = 'co'), v.name, v.kind::public.category_kind, 60, false, false
from (values ('Rent income', 'income'), ('Materials', 'expense')) v(name, kind);
insert into rop_ref (label, id)
select case name when 'Rent income' then 'rent' else 'materials' end, id
from public.categories
where company_id = (select id from rop_ref where label = 'co') and name in ('Rent income', 'Materials');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select
  (select id from rop_ref where label = 'co'),
  v.direction::public.txn_direction, v.doc_kind::public.doc_kind, v.role::public.pnl_role,
  'posted', 'ILS', v.net, v.net, 0, 'source',
  '2026-06-10', '2026-06-10', 'manual', 'rop:' || v.key,
  (select id from rop_ref where label = 'office'),
  (select id from rop_ref where label = v.cat),
  'example ' || v.key, true
from (values
  ('income',  'invoice_receipt', null,       60000, 'rent',      'in-rent'),
  ('expense', 'expense',         null,      -40000, 'rent',      'reversal-income'),
  ('expense', 'expense',         'project', -20000, 'materials', 'cost'),
  ('income',  'invoice_receipt', 'project',   5000, 'materials', 'refund')
) as v(direction, doc_kind, role, net, cat, key);

select tests.authenticate_as('rop_owner');
select public.set_overhead_project((select id from rop_ref where label = 'office'));

select is(
  (public.get_project((select id from rop_ref where label = 'office'), 'cash') ->> 'income_agorot')::bigint,
  20000::bigint,
  'a reversal income line on the overhead project lowers its income'
);
select is(
  (public.get_dashboard(null, null, 'cash') ->> 'overhead_agorot')::bigint,
  15000::bigint,
  'the reversal is not overhead, and the cost refund lowers the overhead project cost'
);
select is(
  (public.get_dashboard(null, null, 'cash') ->> 'unassigned_income_agorot')::bigint,
  0::bigint,
  'the reversal income line has a project, so it is not unassigned'
);
select is(
  (public.get_dashboard(null, null, 'cash') ->> 'income_agorot')::bigint,
  20000::bigint,
  'company income counts the reversal as negative income'
);
select is(
  (public.get_dashboard(null, null, 'cash') ->> 'net_profit_agorot')::bigint,
  5000::bigint,
  'net profit is income 200.00 less overhead 150.00 less nothing else'
);

select * from finish();
rollback;
