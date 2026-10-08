-- FLOW-128: the after-overhead view on the cash basis spreads only paid overhead, so the
-- projects' shares add up to the cash overhead total (decision 0118).

begin;

select plan(4);

do $users$
begin
  perform tests.create_supabase_user('uos_owner', 'uos-owner@example.com');
end
$users$;

create temp table uos_ref (label text primary key, id uuid);
grant all on uos_ref to authenticated;

select tests.authenticate_as('uos_owner');
select public.create_company('Example Builders LLC', true);
select public.upsert_project(null, 'Site Alpha', null, 'active');
insert into uos_ref (label, id) select 'co', id from public.companies where name = 'Example Builders LLC';
insert into uos_ref (label, id) select 'alpha', id from public.projects where name = 'Site Alpha';

reset role;

-- Invented, round amounts. Alpha's income is the only weight, so it carries all overhead.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description, user_assigned
)
select
  (select id from uos_ref where label = 'co'),
  v.dir::public.txn_direction, v.doc_kind::public.doc_kind, v.role::public.pnl_role, 'posted', 'ILS',
  v.amount, v.amount, abs(v.amount), 0, 'source',
  '2026-06-10', v.cash_date::date,
  'manual', 'uos:' || v.ikey,
  case when v.role is null then (select id from uos_ref where label = 'alpha') end,
  v.ikey,
  true
from (values
  ('income', 'invoice_receipt', null, 50000, '2026-06-10', 'alpha-income'),
  ('expense', 'invoice', 'overhead', -1000, null, 'overhead-unpaid'),
  ('expense', 'expense', 'overhead', -400, '2026-06-10', 'overhead-paid')
) as v(dir, doc_kind, role, amount, cash_date, ikey);

select tests.authenticate_as('uos_owner');

select is((public.get_project((select id from uos_ref where label = 'alpha'), 'cash') ->> 'overhead_share_agorot')::bigint,
  (public.get_dashboard(null, null, 'cash') ->> 'overhead_agorot')::bigint,
  'cash: the overhead share matches the cash overhead total');
select is((public.get_project((select id from uos_ref where label = 'alpha'), 'cash') ->> 'overhead_share_agorot')::bigint, 400::bigint,
  'cash: the unpaid overhead invoice is not spread');
select is((public.get_project((select id from uos_ref where label = 'alpha'), 'invoiced') ->> 'overhead_share_agorot')::bigint, 1400::bigint,
  'invoiced: the unpaid overhead invoice is spread');
select is((select share_agorot from private.overhead_share((select id from uos_ref where label = 'alpha'))), 1400::bigint,
  'the one-argument form is the invoiced basis');

select * from finish();
rollback;
