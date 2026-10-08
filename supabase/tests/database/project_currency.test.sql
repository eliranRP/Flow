-- get_project by_currency, categories_by_currency, and transactions[].currency.
-- get_project(p_id, p_basis) counts income on the books basis exactly like company_pnl.

begin;

select plan(49);

do $users$
begin
  perform tests.create_supabase_user('pc_owner', 'pc-owner@example.com');
  perform tests.create_supabase_user('pc_other', 'pc-other@example.com');
end
$users$;

create temp table pc_ref (label text primary key, id uuid);
create temp table pc_out (label text primary key, body jsonb);
grant all on pc_ref, pc_out to authenticated;

create function pg_temp.cur(p jsonb, c text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p) x where x ->> 'currency' = c $$;

create function pg_temp.out_of(l text) returns jsonb
language sql stable
as $$ select body from pc_out where label = l $$;

grant execute on function pg_temp.cur(jsonb, text), pg_temp.out_of(text) to authenticated;

select tests.authenticate_as('pc_owner');
select lives_ok($$select public.create_company('Harbor Sample Co', true)$$, 'owner creates company');
select lives_ok($$select public.upsert_project(null, 'Dock', null, 'active')$$, 'owner opens the usd project');
select lives_ok($$select public.upsert_project(null, 'Pier', null, 'active')$$, 'owner opens the mixed project');
select lives_ok($$select public.upsert_project(null, 'Quay', null, 'active')$$, 'owner opens the basis project');
insert into pc_ref (label, id) select 'co', id from public.companies where name = 'Harbor Sample Co';
insert into pc_ref (label, id) select 'dock', id from public.projects where name = 'Dock';
insert into pc_ref (label, id) select 'pier', id from public.projects where name = 'Pier';
insert into pc_ref (label, id) select 'quay', id from public.projects where name = 'Quay';

select tests.authenticate_as('pc_other');
select lives_ok($$select public.create_company('Other Harbor Co', true)$$, 'other owner creates company');
select lives_ok($$select public.upsert_project(null, 'Jetty', null, 'active')$$, 'other owner opens a project');
insert into pc_ref (label, id) select 'other', id from public.companies where name = 'Other Harbor Co';
insert into pc_ref (label, id) select 'jetty', id from public.projects where name = 'Jetty';

reset role;

insert into public.categories (company_id, name, kind, sort_order)
select c.id, v.name, 'expense', v.ord
from pc_ref c, (values ('Sample Materials', 901), ('Sample Fuel', 902)) as v(name, ord)
where c.label in ('co', 'other');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, category_suggested, description, removed_at
)
select c.id, v.direction::public.txn_direction, v.doc_kind::public.doc_kind, v.pnl_role::public.pnl_role,
  v.line_status::public.line_status, v.currency,
  v.amount, v.amount, abs(v.amount), 0, 'source',
  v.doc_date::date, v.source::public.txn_source, v.ikey,
  (select id from pc_ref where label = v.project),
  (select k.id from public.categories k where k.company_id = c.id and k.name = v.category),
  v.suggested, v.ikey, case when v.removed then now() end
from (values
  -- Dock: USD only
  ('co', 'income',  'invoice',         null,       'posted',  'USD',  400000, '2026-09-01', 'mercury', 'dock:invoice',   'dock', null,               false, false),
  ('co', 'income',  'receipt',         null,       'posted',  'USD',   50000, '2026-09-02', 'mercury', 'dock:receipt',   'dock', null,               false, false),
  ('co', 'expense', 'expense',         'project',  'posted',  'USD', -125000, '2026-09-03', 'mercury', 'dock:materials', 'dock', 'Sample Materials', false, false),
  ('co', 'expense', 'expense',         'project',  'posted',  'USD',  -30000, '2026-09-04', 'mercury', 'dock:fuel',      'dock', 'Sample Fuel',      false, false),
  ('co', 'expense', 'expense',         'project',  'posted',  'USD',   -2000, '2026-09-05', 'mercury', 'dock:suggested', 'dock', 'Sample Materials', true,  false),
  ('co', 'expense', 'expense',         'project',  'posted',  'USD',   -1500, '2026-09-06', 'mercury', 'dock:in_review', 'dock', 'Sample Fuel',      false, false),
  ('co', 'expense', 'expense',         'overhead', 'posted',  'USD',   -9000, '2026-09-07', 'mercury', 'dock:overhead',  'dock', 'Sample Fuel',      false, false),
  ('co', 'income',  'invoice',         null,       'pending', 'USD',    7000, '2026-09-08', 'mercury', 'dock:pend_inc',  'dock', null,               false, false),
  ('co', 'expense', 'expense',         'project',  'pending', 'USD',   -4000, '2026-09-08', 'mercury', 'dock:pend_exp',  'dock', 'Sample Materials', false, false),
  ('co', 'expense', 'expense',         'project',  'void',    'USD',   -6000, '2026-09-09', 'mercury', 'dock:void',      'dock', 'Sample Materials', false, false),
  ('co', 'expense', 'expense',         'project',  'posted',  'USD',   -3000, '2026-09-09', 'mercury', 'dock:removed',   'dock', 'Sample Materials', false, true),
  ('co', 'income',  'invoice',         null,       'posted',  'USD',    2000, '2026-09-09', 'mercury', 'dock:rm_inc',    'dock', null,               false, true),
  -- shared USD line, split between Dock and Pier
  ('co', 'expense', 'expense',         'shared',   'posted',  'USD',  -60000, '2026-09-10', 'mercury', 'co:shared_usd',  null,   'Sample Fuel',      false, false),
  ('co', 'expense', 'expense',         'shared',   'pending', 'USD',   -4400, '2026-09-10', 'mercury', 'co:shared_pend', null,   'Sample Fuel',      false, false),
  ('co', 'expense', 'expense',         'shared',   'posted',  'USD',   -3300, '2026-09-10', 'mercury', 'co:shared_rm',   null,   'Sample Fuel',      false, true),
  -- Pier: ILS + USD
  ('co', 'income',  'invoice',         null,       'posted',  'ILS',  100000, '2026-09-11', 'manual',  'pier:ils_inc',   'pier', null,               false, false),
  ('co', 'expense', 'expense',         'project',  'posted',  'ILS',  -20000, '2026-09-12', 'manual',  'pier:ils_exp',   'pier', 'Sample Materials', false, false),
  ('co', 'expense', 'expense',         'project',  'pending', 'ILS',   -1000, '2026-09-12', 'manual',  'pier:ils_pend',  'pier', 'Sample Materials', false, false),
  ('co', 'expense', 'expense',         'shared',   'posted',  'ILS',   -8000, '2026-09-13', 'manual',  'co:shared_ils',  null,   'Sample Materials', false, false),
  ('co', 'income',  'invoice_receipt', null,       'posted',  'USD',   50000, '2026-09-14', 'mercury', 'pier:usd_inc',   'pier', null,               false, false),
  ('co', 'expense', 'expense',         'project',  'posted',  'USD',  -10000, '2026-09-15', 'mercury', 'pier:usd_exp',   'pier', 'Sample Fuel',      false, false),
  -- Jetty: the other company, ILS
  ('other', 'income', 'invoice',       null,       'posted',  'ILS',   70000, '2026-09-16', 'manual',  'jetty:ils_inc',  'jetty', null,              false, false),
  ('other', 'income', 'receipt',       null,       'posted',  'ILS',    5000, '2026-09-16', 'manual',  'jetty:ils_rcpt', 'jetty', null,              false, false),
  -- Quay: every income doc kind, ILS and USD, for the books basis
  ('co', 'income',  'receipt',         null,       'posted',  'USD',  300000, '2026-09-17', 'mercury', 'quay:usd_rcpt',  'quay', null,               false, false),
  ('co', 'income',  'invoice',         null,       'posted',  'USD',  200000, '2026-09-17', 'manual',  'quay:usd_inv',   'quay', null,               false, false),
  ('co', 'income',  'invoice_receipt', null,       'posted',  'USD',   50000, '2026-09-17', 'manual',  'quay:usd_ir',    'quay', null,               false, false),
  ('co', 'income',  'credit',          null,       'posted',  'USD',  -20000, '2026-09-17', 'manual',  'quay:usd_cred',  'quay', null,               false, false),
  ('co', 'income',  'receipt',         null,       'pending', 'USD',    9000, '2026-09-18', 'mercury', 'quay:usd_rpend', 'quay', null,               false, false),
  ('co', 'income',  'receipt',         null,       'void',    'USD',    7000, '2026-09-18', 'mercury', 'quay:usd_rvoid', 'quay', null,               false, false),
  ('co', 'income',  'receipt',         null,       'posted',  'USD',    8000, '2026-09-18', 'mercury', 'quay:usd_rrm',   'quay', null,               false, true),
  ('co', 'expense', 'expense',         'project',  'posted',  'USD',  -40000, '2026-09-18', 'mercury', 'quay:usd_exp',   'quay', 'Sample Fuel',      false, false),
  ('co', 'income',  'receipt',         null,       'posted',  'ILS',   11000, '2026-09-19', 'manual',  'quay:ils_rcpt',  'quay', null,               false, false),
  ('co', 'income',  'invoice',         null,       'posted',  'ILS',   22000, '2026-09-19', 'manual',  'quay:ils_inv',   'quay', null,               false, false),
  ('co', 'income',  'invoice_receipt', null,       'posted',  'ILS',    4000, '2026-09-19', 'manual',  'quay:ils_ir',    'quay', null,               false, false),
  ('co', 'income',  'credit',          null,       'posted',  'ILS',   -3000, '2026-09-19', 'manual',  'quay:ils_cred',  'quay', null,               false, false)
) as v(co, direction, doc_kind, pnl_role, line_status, currency, amount, doc_date, source, ikey, project, category, suggested, removed)
join pc_ref c on c.label = v.co;

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, p.id, v.share_bp, v.amount
from (values
  ('co:shared_usd', 'dock', 5000, -30000),
  ('co:shared_usd', 'pier', 5000, -30000),
  ('co:shared_pend', 'dock', 10000, -4400),
  ('co:shared_rm', 'dock', 10000, -3300),
  ('co:shared_ils', 'pier', 10000, -8000)
) as v(ikey, project, share_bp, amount)
join public.transactions t on t.idempotency_key = v.ikey
join pc_ref p on p.label = v.project;

-- The insert trigger clears category_suggested when a category is given; an update keeps it.
update public.transactions set category_suggested = true where idempotency_key = 'dock:suggested';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'sample'
from public.transactions t where t.idempotency_key = 'dock:in_review';

select tests.authenticate_as('pc_owner');
insert into pc_out (label, body) values
  ('dock', public.get_project((select id from pc_ref where label = 'dock'))),
  ('pier', public.get_project((select id from pc_ref where label = 'pier'))),
  ('quay_one', public.get_project((select id from pc_ref where label = 'quay'))),
  ('quay_cash', public.get_project((select id from pc_ref where label = 'quay'), 'cash')),
  ('quay_inv', public.get_project((select id from pc_ref where label = 'quay'), 'invoiced')),
  ('quay_null', public.get_project((select id from pc_ref where label = 'quay'), null)),
  ('quay_other_word', public.get_project((select id from pc_ref where label = 'quay'), 'accrual')),
  ('dock_cash', public.get_project((select id from pc_ref where label = 'dock'), 'cash')),
  ('pnl_cash', public.company_pnl((select id from pc_ref where label = 'co'), null, null, 'cash')),
  ('pnl_inv', public.company_pnl((select id from pc_ref where label = 'co'), null, null, 'invoiced'));

select tests.authenticate_as('pc_other');
insert into pc_out (label, body) values
  ('other_dock', public.get_project((select id from pc_ref where label = 'dock'))),
  ('other_pier', public.get_project((select id from pc_ref where label = 'pier'))),
  ('jetty', public.get_project((select id from pc_ref where label = 'jetty'))),
  ('other_quay_cash', public.get_project((select id from pc_ref where label = 'quay'), 'cash')),
  ('other_quay_inv', public.get_project((select id from pc_ref where label = 'quay'), 'invoiced')),
  ('jetty_cash', public.get_project((select id from pc_ref where label = 'jetty'), 'cash')),
  ('jetty_inv', public.get_project((select id from pc_ref where label = 'jetty'), 'invoiced'));

reset role;

-- Dock: USD only. Invoiced income kinds, project-role direct, shared via allocations, posted and not removed.
select is(
  pg_temp.out_of('dock') -> 'by_currency',
  '[{"currency": "USD", "income_minor": 400000, "direct_minor": 158500, "shared_minor": 30000, "profit_minor": 211500}]'::jsonb,
  'usd-only project: one USD by_currency row'
);

select is(
  (select jsonb_build_object('i', b -> 'income_agorot', 'd', b -> 'direct_agorot', 's', b -> 'shared_agorot', 'p', b -> 'profit_agorot', 'c', b -> 'categories')
   from (select pg_temp.out_of('dock') b) s),
  '{"i": 0, "d": 0, "s": 0, "p": 0, "c": []}'::jsonb,
  'usd-only project: agorot fields and categories stay ILS only'
);

select is(
  pg_temp.out_of('dock') -> 'categories_by_currency',
  (
    select jsonb_build_array(
      jsonb_build_object('currency', 'USD', 'id', m.id, 'name', 'Sample Materials', 'amount_minor', 125000, 'has_shared_share', false),
      jsonb_build_object('currency', 'USD', 'id', f.id, 'name', 'Sample Fuel', 'amount_minor', 60000, 'has_shared_share', true)
    )
    from public.categories m, public.categories f
    where m.company_id = (select id from pc_ref where label = 'co') and m.name = 'Sample Materials'
      and f.company_id = m.company_id and f.name = 'Sample Fuel'
  ),
  'usd-only project: categories_by_currency (suggested, in review, pending, void, removed and overhead lines and shares stay out)'
);

select is(
  (select jsonb_agg(x ->> 'currency' order by x ->> 'description') from jsonb_array_elements(pg_temp.out_of('dock') -> 'transactions') x),
  (select jsonb_agg('USD'::text order by t.idempotency_key)
   from public.transactions t
   where t.idempotency_key in ('dock:invoice', 'dock:receipt', 'dock:materials', 'dock:fuel', 'dock:suggested', 'dock:in_review',
                               'dock:overhead', 'dock:pend_inc', 'dock:pend_exp', 'dock:void', 'co:shared_usd', 'co:shared_pend')),
  'usd-only project: every transaction row says USD'
);

select is(
  (pg_temp.out_of('dock') -> 'pending_other_currencies'),
  '[{"currency": "USD", "expense_minor": -3500, "count": 2}]'::jsonb,
  'usd-only project: the waiting USD lines stay in pending_other_currencies'
);

-- Pier: ILS + USD
select is(
  pg_temp.out_of('pier') -> 'by_currency',
  '[{"currency": "ILS", "income_minor": 100000, "direct_minor": 20000, "shared_minor": 8000, "profit_minor": 72000}, {"currency": "USD", "income_minor": 50000, "direct_minor": 10000, "shared_minor": 30000, "profit_minor": 10000}]'::jsonb,
  'mixed project: one row per currency, ordered'
);

select is(
  pg_temp.cur(pg_temp.out_of('pier') -> 'by_currency', 'ILS'),
  (
    select jsonb_build_object(
      'currency', 'ILS',
      'income_minor', b -> 'income_agorot',
      'direct_minor', b -> 'direct_agorot',
      'shared_minor', b -> 'shared_agorot',
      'profit_minor', b -> 'profit_agorot'
    )
    from (select pg_temp.out_of('pier') b) s
  ),
  'mixed project: the ILS row equals the agorot fields'
);

select is(
  (pg_temp.out_of('pier') ->> 'profit_agorot')::bigint,
  72000::bigint,
  'mixed project: profit_agorot counts ILS only'
);

select is(
  (
    select jsonb_agg(x - 'currency' - 'amount_minor' || jsonb_build_object('amount_agorot', x -> 'amount_minor') order by n)
    from jsonb_array_elements(pg_temp.out_of('pier') -> 'categories_by_currency') with ordinality a(x, n)
    where x ->> 'currency' = 'ILS'
  ),
  pg_temp.out_of('pier') -> 'categories',
  'mixed project: ILS categories_by_currency equal categories'
);

select is(
  (
    select jsonb_agg(jsonb_build_object('currency', x ->> 'currency', 'name', x ->> 'name', 'amount', (x ->> 'amount_minor')::bigint, 'shared', (x ->> 'has_shared_share')::boolean) order by n)
    from jsonb_array_elements(pg_temp.out_of('pier') -> 'categories_by_currency') with ordinality a(x, n)
  ),
  '[{"currency": "ILS", "name": "Sample Materials", "amount": 28000, "shared": true}, {"currency": "USD", "name": "Sample Fuel", "amount": 40000, "shared": true}]'::jsonb,
  'mixed project: categories grouped by currency'
);

select is(
  (
    select jsonb_object_agg(t.idempotency_key, x ->> 'currency')
    from jsonb_array_elements(pg_temp.out_of('pier') -> 'transactions') x
    join public.transactions t on t.id = (x ->> 'id')::uuid
  ),
  '{"pier:ils_inc": "ILS", "pier:ils_exp": "ILS", "pier:ils_pend": "ILS", "co:shared_ils": "ILS", "pier:usd_inc": "USD", "pier:usd_exp": "USD", "co:shared_usd": "USD"}'::jsonb,
  'mixed project: each transaction row carries its own currency'
);

select is(
  (select jsonb_object_agg(k, pg_temp.out_of('pier') -> k) from unnest(array['income_agorot', 'direct_agorot', 'shared_agorot', 'pending_agorot', 'pending_count']) k),
  '{"income_agorot": 100000, "direct_agorot": 20000, "shared_agorot": 8000, "pending_agorot": 0, "pending_count": 0}'::jsonb,
  'mixed project: existing ILS fields keep their values'
);


-- Books basis (company_pnl's rule). Cash: receipt + invoice_receipt. Invoiced: invoice + credit + invoice_receipt.
select is(
  pg_temp.out_of('quay_cash') -> 'by_currency',
  '[{"currency": "ILS", "income_minor": 15000, "direct_minor": 0, "shared_minor": 0, "profit_minor": 15000}, {"currency": "USD", "income_minor": 350000, "direct_minor": 40000, "shared_minor": 0, "profit_minor": 310000}]'::jsonb,
  'cash basis: receipts and invoice_receipts count, invoices and credits do not (ILS and USD)'
);
select is(
  pg_temp.out_of('quay_inv') -> 'by_currency',
  '[{"currency": "ILS", "income_minor": 23000, "direct_minor": 0, "shared_minor": 0, "profit_minor": 23000}, {"currency": "USD", "income_minor": 230000, "direct_minor": 40000, "shared_minor": 0, "profit_minor": 190000}]'::jsonb,
  'invoiced basis: invoices, invoice_receipts and signed credits count, receipts do not (ILS and USD)'
);
select is(
  (select jsonb_object_agg(k, pg_temp.out_of('quay_cash') -> k) from unnest(array['income_agorot', 'profit_agorot']) k),
  '{"income_agorot": 15000, "profit_agorot": 15000}'::jsonb,
  'cash basis: the ILS agorot income and profit follow the basis'
);
select is(
  (select jsonb_object_agg(k, pg_temp.out_of('quay_inv') -> k) from unnest(array['income_agorot', 'profit_agorot']) k),
  '{"income_agorot": 23000, "profit_agorot": 23000}'::jsonb,
  'invoiced basis: the ILS agorot income keeps the credit sign'
);
select is(
  pg_temp.cur(pg_temp.out_of('quay_cash') -> 'by_currency', 'ILS'),
  (
    select jsonb_build_object('currency', 'ILS', 'income_minor', b -> 'income_agorot', 'direct_minor', b -> 'direct_agorot',
      'shared_minor', b -> 'shared_agorot', 'profit_minor', b -> 'profit_agorot')
    from (select pg_temp.out_of('quay_cash') b) s
  ),
  'cash basis: the ILS row equals the agorot fields'
);
select is(
  pg_temp.out_of('quay_cash') -> 'other_currencies',
  '[{"currency": "USD", "income_minor": 350000, "expense_minor": -40000, "count": 3}]'::jsonb,
  'cash basis: other_currencies income follows the basis'
);
select is(
  pg_temp.out_of('quay_inv') -> 'other_currencies',
  '[{"currency": "USD", "income_minor": 230000, "expense_minor": -40000, "count": 4}]'::jsonb,
  'invoiced basis: other_currencies income follows the basis'
);
select is(
  (pg_temp.cur(pg_temp.out_of('dock_cash') -> 'by_currency', 'USD') ->> 'income_minor')::bigint,
  50000::bigint,
  'cash basis: a Mercury USD receipt shows and the USD invoice does not'
);
select is(pg_temp.out_of('quay_one'), pg_temp.out_of('quay_inv'), 'one-argument get_project is the invoiced basis, as before');
select is(pg_temp.out_of('quay_null'), pg_temp.out_of('quay_cash'), 'null basis is cash, as in company_pnl');
select is(pg_temp.out_of('quay_other_word'), pg_temp.out_of('quay_cash'), 'any basis but invoiced is cash, as in company_pnl');
select is(
  pg_temp.out_of('quay_cash') - 'income_agorot' - 'profit_agorot' - 'profit_after_overhead_agorot' - 'by_currency' - 'other_currencies',
  pg_temp.out_of('quay_inv') - 'income_agorot' - 'profit_agorot' - 'profit_after_overhead_agorot' - 'by_currency' - 'other_currencies',
  'the basis changes only income-derived fields'
);
select is(
  (
    select jsonb_build_object('cash', jsonb_build_object('ILS', (c ->> 'income_agorot')::bigint, 'USD', (pg_temp.cur(c -> 'by_currency', 'USD') ->> 'income_minor')::bigint),
                              'invoiced', jsonb_build_object('ILS', (i ->> 'income_agorot')::bigint, 'USD', (pg_temp.cur(i -> 'by_currency', 'USD') ->> 'income_minor')::bigint))
    from (select (select x from jsonb_array_elements(pg_temp.out_of('pnl_cash') -> 'projects') x where x ->> 'name' = 'Quay') c,
                 (select x from jsonb_array_elements(pg_temp.out_of('pnl_inv') -> 'projects') x where x ->> 'name' = 'Quay') i) s
  ),
  (
    select jsonb_build_object('cash', jsonb_build_object('ILS', (c ->> 'income_agorot')::bigint, 'USD', (pg_temp.cur(c -> 'by_currency', 'USD') ->> 'income_minor')::bigint),
                              'invoiced', jsonb_build_object('ILS', (i ->> 'income_agorot')::bigint, 'USD', (pg_temp.cur(i -> 'by_currency', 'USD') ->> 'income_minor')::bigint))
    from (select pg_temp.out_of('quay_cash') c, pg_temp.out_of('quay_inv') i) s
  ),
  'project income equals company_pnl projects[] income on both bases, per currency'
);
select is(pg_temp.out_of('other_quay_cash'), null, 'another company owner gets null for the project on the cash basis');
select is(pg_temp.out_of('other_quay_inv'), null, 'another company owner gets null for the project on the invoiced basis');
select is(
  (select jsonb_build_object('cash', (pg_temp.out_of('jetty_cash') ->> 'income_agorot')::bigint, 'invoiced', (pg_temp.out_of('jetty_inv') ->> 'income_agorot')::bigint)),
  '{"cash": 5000, "invoiced": 70000}'::jsonb,
  'the other owner reads its own project on both bases (positive control)'
);

-- Tenancy: the other owner gets null for this company's projects and still gets its own
select is(pg_temp.out_of('other_dock'), null, 'another company owner gets null for the usd project');
select is(pg_temp.out_of('other_pier'), null, 'another company owner gets null for the mixed project');
select is(
  pg_temp.out_of('jetty') -> 'by_currency',
  '[{"currency": "ILS", "income_minor": 70000, "direct_minor": 0, "shared_minor": 0, "profit_minor": 70000}]'::jsonb,
  'the other owner still reads its own project (positive control)'
);
select is(
  pg_temp.out_of('dock') ->> 'id',
  (select id::text from pc_ref where label = 'dock'),
  'the owner reads its own project (positive control)'
);

-- Grants and security mode unchanged
select ok(
  not has_function_privilege('anon', 'public.get_project(uuid)', 'execute'),
  'anon cannot execute get_project'
);
select ok(
  has_function_privilege('authenticated', 'public.get_project(uuid)', 'execute'),
  'authenticated can execute get_project'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.get_project(uuid)'::regprocedure),
  false,
  'get_project stays security invoker'
);
select ok(
  not has_function_privilege('anon', 'public.get_project(uuid, text, date, date)', 'execute'),
  'anon cannot execute get_project(uuid, text, date, date)'
);
select ok(
  has_function_privilege('authenticated', 'public.get_project(uuid, text, date, date)', 'execute'),
  'authenticated can execute get_project(uuid, text, date, date)'
);
select ok(
  not has_function_privilege('public', 'public.get_project(uuid, text, date, date)', 'execute'),
  'public cannot execute get_project(uuid, text, date, date)'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.get_project(uuid, text, date, date)'::regprocedure),
  false,
  'get_project(uuid, text, date, date) is security invoker'
);
select is(
  (select jsonb_agg(p.proconfig order by p.pronargs) from pg_proc p where p.oid in ('public.get_project(uuid)'::regprocedure, 'public.get_project(uuid, text, date, date)'::regprocedure)),
  '[["search_path=\"\""], ["search_path=\"\""]]'::jsonb,
  'both get_project forms pin an empty search_path'
);
select is(
  (select provolatile::text from pg_proc where oid = 'public.get_project(uuid, text, date, date)'::regprocedure),
  's',
  'get_project(uuid, text, date, date) is stable'
);
select ok(
  not has_function_privilege('anon', 'private.project_category_entries_by_currency(uuid)', 'execute'),
  'anon cannot execute project_category_entries_by_currency'
);
select is(
  (select prosecdef from pg_proc where oid = 'private.project_category_entries_by_currency(uuid)'::regprocedure),
  false,
  'project_category_entries_by_currency is security invoker'
);

select * from finish();

rollback;
