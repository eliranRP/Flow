-- FLOW-116. The overhead project is left out of the after-overhead weights, so the overhead
-- is spread only over the other projects and the overhead project's share is 0
-- (decision 0117). Invented data only.

begin;

select plan(6);

do $users$
begin
  perform tests.create_supabase_user('opw_owner', 'opw-owner@example.com');
end
$users$;

create temp table opw_ref (label text primary key, id uuid);
grant all on opw_ref to authenticated;

select tests.authenticate_as('opw_owner');
select public.create_company('Example Overhead Weights LLC', true);
select public.upsert_project(null, 'Site Alpha', null, 'active');
select public.upsert_project(null, 'Site Beta', null, 'active');
select public.upsert_project(null, 'Office', null, 'active');
insert into opw_ref (label, id) select 'co', id from public.companies where name = 'Example Overhead Weights LLC';
insert into opw_ref (label, id) select 'alpha', id from public.projects where name = 'Site Alpha';
insert into opw_ref (label, id) select 'beta', id from public.projects where name = 'Site Beta';
insert into opw_ref (label, id) select 'office', id from public.projects where name = 'Office';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description, user_assigned
)
select
  (select id from opw_ref where label = 'co'),
  v.direction::public.txn_direction,
  v.doc_kind::public.doc_kind,
  v.pnl_role::public.pnl_role,
  'posted', 'ILS',
  v.amount, v.amount, abs(v.amount), 0, 'source',
  '2026-06-10', '2026-06-10', 'manual', 'opw:' || v.ikey,
  (select id from opw_ref where label = v.proj),
  v.ikey, true
from (values
  ('income',  'invoice_receipt', null,       300000, 'alpha',  'in-alpha'),
  ('income',  'invoice_receipt', null,       100000, 'beta',   'in-beta'),
  ('income',  'invoice_receipt', null,       400000, 'office', 'in-office'),
  ('expense', 'expense',         'project',  -40000, 'office', 'ex-office')
) as v(direction, doc_kind, pnl_role, amount, proj, ikey);

select tests.authenticate_as('opw_owner');

-- Positive control: with no overhead project the office line is direct cost, so there is no
-- overhead to spread and every share is 0.
select is(
  (public.get_project((select id from opw_ref where label = 'alpha'), 'invoiced') ->> 'overhead_share_agorot')::bigint,
  0::bigint,
  'no overhead project: no overhead to spread'
);

select public.set_overhead_project((select id from opw_ref where label = 'office'));

select is(
  (public.get_project((select id from opw_ref where label = 'office'), 'invoiced') ->> 'overhead_share_agorot')::bigint,
  0::bigint,
  'the overhead project gets no share of overhead, even with the most income'
);

select is(
  (public.get_project((select id from opw_ref where label = 'alpha'), 'invoiced') ->> 'overhead_share_agorot')::bigint,
  30000::bigint,
  'the other projects are weighted by their own income only (3 of 4)'
);

select is(
  (public.get_project((select id from opw_ref where label = 'beta'), 'invoiced') ->> 'overhead_share_agorot')::bigint,
  10000::bigint,
  'the other projects are weighted by their own income only (1 of 4)'
);

select is(
  (public.get_project((select id from opw_ref where label = 'alpha'), 'invoiced') ->> 'overhead_share_agorot')::bigint
  + (public.get_project((select id from opw_ref where label = 'beta'), 'invoiced') ->> 'overhead_share_agorot')::bigint,
  (public.get_dashboard(null, null, 'invoiced') ->> 'overhead_agorot')::bigint,
  'the shares add up to the company overhead'
);

select is(
  (public.get_project((select id from opw_ref where label = 'office'), 'invoiced') ->> 'income_agorot')::bigint,
  400000::bigint,
  'the overhead project keeps its income'
);

select * from finish();
rollback;
