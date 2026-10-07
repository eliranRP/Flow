-- FLOW-102 review. Income filed to the overhead project stays the project's income,
-- even when it carries the project role, so the after-overhead shares add up to the
-- company overhead (decision 0101). Invented data only.

begin;

select plan(5);

do $users$
begin
  perform tests.create_supabase_user('opi_owner', 'opi-owner@example.com');
end
$users$;

create temp table opi_ref (label text primary key, id uuid);
grant all on opi_ref to authenticated;

select tests.authenticate_as('opi_owner');
select public.create_company('Example Overhead Income LLC', true);
select public.upsert_project(null, 'Site Alpha', null, 'active');
select public.upsert_project(null, 'Office', null, 'active');
insert into opi_ref (label, id) select 'co', id from public.companies where name = 'Example Overhead Income LLC';
insert into opi_ref (label, id) select 'alpha', id from public.projects where name = 'Site Alpha';
insert into opi_ref (label, id) select 'office', id from public.projects where name = 'Office';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description, user_assigned
)
select
  (select id from opi_ref where label = 'co'),
  v.direction::public.txn_direction,
  v.doc_kind::public.doc_kind,
  v.pnl_role::public.pnl_role,
  'posted', 'ILS',
  v.amount, v.amount, abs(v.amount), 0, 'source',
  '2026-06-10', '2026-06-10', 'manual', 'opi:' || v.ikey,
  (select id from opi_ref where label = v.proj),
  v.ikey, true
from (values
  ('income',  'invoice_receipt', null,       100000, 'alpha',  'in-alpha'),
  ('income',  'invoice_receipt', 'project',   50000, 'office', 'in-office-role'),
  ('expense', 'expense',         'overhead', -10000, null,     'ex-overhead'),
  ('expense', 'expense',         'project',  -20000, 'office', 'ex-office')
) as v(direction, doc_kind, pnl_role, amount, proj, ikey);

select tests.authenticate_as('opi_owner');
select public.set_overhead_project((select id from opi_ref where label = 'office'));

select is(
  (public.get_dashboard(null, null, 'invoiced') ->> 'overhead_agorot')::bigint,
  30000::bigint,
  'company overhead is the overhead role plus the overhead project''s cost'
);

select is(
  (public.get_project((select id from opi_ref where label = 'office'), 'invoiced') ->> 'income_agorot')::bigint,
  50000::bigint,
  'income on the overhead project stays the project''s income'
);

select is(
  (select l.pnl_role::text from private.pnl_lines l
   where l.transaction_id = (select t.id from public.transactions t where t.idempotency_key = 'opi:in-office-role')),
  'project',
  'an income line keeps its role on the overhead project'
);

select is(
  (public.get_project((select id from opi_ref where label = 'alpha'), 'invoiced') ->> 'overhead_share_agorot')::bigint
  + (public.get_project((select id from opi_ref where label = 'office'), 'invoiced') ->> 'overhead_share_agorot')::bigint,
  30000::bigint,
  'the after-overhead shares add up to the company overhead, overhead project cost included'
);

select ok(
  (public.get_project((select id from opi_ref where label = 'alpha'), 'invoiced') ->> 'overhead_share_agorot')::bigint >= 0,
  'no project gets a negative overhead share'
);

select * from finish();
rollback;
