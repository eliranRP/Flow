-- company_pnl.by_currency and projects[].by_currency for non-ILS lines.

begin;

select plan(28);

do $users$
begin
  perform tests.create_supabase_user('usd_owner', 'usd-owner@test.flow');
  perform tests.create_supabase_user('usd_other', 'usd-other@test.flow');
  perform tests.create_supabase_user('usd_viewer', 'usd-viewer@test.flow');
  perform tests.create_supabase_user('mix_owner', 'mix-owner@test.flow');
end
$users$;

create temp table usd_ref (label text primary key, id uuid);
grant all on usd_ref to authenticated;

-- USD-only company
select tests.authenticate_as('usd_owner');
select lives_ok($$select public.create_company('Treasury Co', true)$$, 'usd owner creates a company');
select lives_ok($$select public.upsert_project(null, 'Alpha', null, 'active')$$, 'usd owner opens a project');

insert into usd_ref (label, id) select 'usd_company', id from public.companies where name = 'Treasury Co';
insert into usd_ref (label, id) select 'usd_project', id from public.projects where name = 'Alpha';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description
)
select c.id, 'income', 'receipt', 'posted', 'USD',
  100000, 100000, 100000, 0, 'source',
  '2026-09-10', '2026-09-10', 'mercury', 'usd:income', null, 'Wire in'
from usd_ref c where c.label = 'usd_company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select c.id, 'expense', 'expense', 'project', 'posted', 'USD',
  -30000, -30000, 30000, 0, 'source',
  '2026-09-11', 'mercury', 'usd:direct', p.id, 'Materials'
from usd_ref c
join usd_ref p on p.label = 'usd_project'
where c.label = 'usd_company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select c.id, 'expense', 'expense', 'shared', 'posted', 'USD',
  -50000, -50000, 50000, 0, 'source',
  '2026-09-12', 'mercury', 'usd:shared', 'Shared tools'
from usd_ref c where c.label = 'usd_company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select c.id, t.id, p.id, 10000, -50000
from usd_ref c
join usd_ref p on p.label = 'usd_project'
join public.transactions t on t.idempotency_key = 'usd:shared'
where c.label = 'usd_company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select c.id, 'expense', 'expense', 'overhead', 'posted', 'USD',
  -20000, -20000, 20000, 0, 'source',
  '2026-09-13', 'mercury', 'usd:overhead', 'SaaS'
from usd_ref c where c.label = 'usd_company';

select tests.authenticate_as('usd_owner');

select is(
  (public.company_pnl((select id from usd_ref where label = 'usd_company'), null, null, 'cash') ->> 'income_agorot')::bigint,
  0::bigint,
  'usd income does not land in income_agorot'
);

select is(
  (
    select (row ->> 'income_minor')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from usd_ref where label = 'usd_company'), null, null, 'cash') -> 'by_currency'
    ) row
    where row ->> 'currency' = 'USD'
  ),
  100000::bigint,
  'usd company income_minor'
);

select is(
  (
    select (row ->> 'direct_minor')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from usd_ref where label = 'usd_company'), null, null, 'cash') -> 'by_currency'
    ) row
    where row ->> 'currency' = 'USD'
  ),
  30000::bigint,
  'usd company direct_minor'
);

select is(
  (
    select (row ->> 'shared_minor')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from usd_ref where label = 'usd_company'), null, null, 'cash') -> 'by_currency'
    ) row
    where row ->> 'currency' = 'USD'
  ),
  50000::bigint,
  'usd company shared_minor'
);

select is(
  (
    select (row ->> 'overhead_minor')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from usd_ref where label = 'usd_company'), null, null, 'cash') -> 'by_currency'
    ) row
    where row ->> 'currency' = 'USD'
  ),
  20000::bigint,
  'usd company overhead_minor'
);

select is(
  (
    select (row ->> 'net_profit_minor')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from usd_ref where label = 'usd_company'), null, null, 'cash') -> 'by_currency'
    ) row
    where row ->> 'currency' = 'USD'
  ),
  0::bigint,
  'usd company net_profit_minor'
);

select is(
  (
    select (row ->> 'count')::integer
    from jsonb_array_elements(
      public.company_pnl((select id from usd_ref where label = 'usd_company'), null, null, 'cash') -> 'by_currency'
    ) row
    where row ->> 'currency' = 'USD'
  ),
  4,
  'usd company line count'
);

select is(
  (
    select (cur ->> 'profit_minor')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from usd_ref where label = 'usd_company'), null, null, 'cash') -> 'projects'
    ) proj,
    jsonb_array_elements(proj -> 'by_currency') cur
    where proj ->> 'name' = 'Alpha' and cur ->> 'currency' = 'USD'
  ),
  20000::bigint,
  'usd project profit_minor'
);

-- Mixed ILS + USD
select tests.authenticate_as('mix_owner');
select lives_ok($$select public.create_company('Mix Co', true)$$, 'mix owner creates a company');
select lives_ok($$select public.upsert_project(null, 'Beta', null, 'active')$$, 'mix owner opens a project');

insert into usd_ref (label, id) select 'mix_company', id from public.companies where name = 'Mix Co';
insert into usd_ref (label, id) select 'mix_project', id from public.projects where name = 'Beta';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description
)
select c.id, 'income', 'receipt', 'posted', 'ILS',
  7000, 7000, 7000, 0, 'unknown',
  '2026-09-05', '2026-09-05', 'manual', 'mix:ils', 'ILS receipt'
from usd_ref c where c.label = 'mix_company';

insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description
)
select c.id, 'income', 'receipt', 'posted', 'USD',
  4000, 4000, 4000, 0, 'source',
  '2026-09-06', '2026-09-06', 'mercury', 'mix:usd', p.id, 'USD receipt'
from usd_ref c
join usd_ref p on p.label = 'mix_project'
where c.label = 'mix_company';

select tests.authenticate_as('mix_owner');

select is(
  (
    select (row ->> 'income_minor')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from usd_ref where label = 'mix_company'), null, null, 'cash') -> 'by_currency'
    ) row
    where row ->> 'currency' = 'ILS'
  ),
  (public.company_pnl((select id from usd_ref where label = 'mix_company'), null, null, 'cash') ->> 'income_agorot')::bigint,
  'ils by_currency income matches income_agorot'
);

select is(
  (
    select (row ->> 'net_profit_minor')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from usd_ref where label = 'mix_company'), null, null, 'cash') -> 'by_currency'
    ) row
    where row ->> 'currency' = 'ILS'
  ),
  (public.company_pnl((select id from usd_ref where label = 'mix_company'), null, null, 'cash') ->> 'net_profit_agorot')::bigint,
  'ils by_currency net matches net_profit_agorot'
);

select is(
  (
    select (row ->> 'income_minor')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from usd_ref where label = 'mix_company'), null, null, 'cash') -> 'by_currency'
    ) row
    where row ->> 'currency' = 'USD'
  ),
  4000::bigint,
  'usd row is separate in a mixed company'
);

-- Basis and dates on the USD company
select is(
  (
    public.company_pnl(
      (select id from usd_ref where label = 'usd_company'),
      '2026-09-01',
      '2026-09-10',
      'cash'
    ) -> 'by_currency'
  ),
  '[]'::jsonb,
  'usd income after the period end is excluded'
);

insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select c.id, 'income', 'invoice', 'posted', 'USD',
  9000, 9000, 9000, 0, 'source',
  '2026-09-14', 'mercury', 'usd:invoice', 'Unpaid invoice'
from usd_ref c where c.label = 'usd_company';

select tests.authenticate_as('usd_owner');

select is(
  (
    select (row ->> 'income_minor')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from usd_ref where label = 'usd_company'), null, null, 'invoiced') -> 'by_currency'
    ) row
    where row ->> 'currency' = 'USD'
  ),
  109000::bigint,
  'invoiced basis counts the invoice'
);

select is(
  (
    select (row ->> 'income_minor')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from usd_ref where label = 'usd_company'), null, null, 'cash') -> 'by_currency'
    ) row
    where row ->> 'currency' = 'USD'
  ),
  100000::bigint,
  'cash basis keeps the invoice out'
);

-- Viewer on demo company (positive control: owner reads)
update public.companies set is_demo = true where id = (select id from usd_ref where label = 'usd_company');

insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('usd_viewer'), id from usd_ref where label = 'usd_company';

select tests.authenticate_as('usd_viewer');

select is(
  (
    select (row ->> 'currency')
    from jsonb_array_elements(
      public.company_pnl((select id from usd_ref where label = 'usd_company'), null, null, 'cash') -> 'by_currency'
    ) row
    where row ->> 'currency' = 'USD'
  ),
  'USD',
  'a demo viewer can read by_currency'
);

-- Another owner cannot read the USD company
select tests.authenticate_as('usd_other');
select lives_ok($$select public.create_company('Other Co', true)$$, 'other owner creates a company');

select throws_ok(
  format(
    'select public.company_pnl(%L::uuid, null, null, ''cash'')',
    (select id from usd_ref where label = 'usd_company')
  ),
  'P0001',
  'forbidden',
  'another owner cannot read the usd company totals'
);

select * from finish();

rollback;
