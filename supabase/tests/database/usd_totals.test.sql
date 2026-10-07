-- company_pnl.by_currency and projects[].by_currency for non-ILS lines.

begin;

select plan(26);

do $users$
begin
  perform tests.create_supabase_user('usd_owner', 'usd-owner@test.flow');
  perform tests.create_supabase_user('usd_other', 'usd-other@test.flow');
  perform tests.create_supabase_user('usd_viewer', 'usd-viewer@test.flow');
  perform tests.create_supabase_user('mix_owner', 'mix-owner@test.flow');
end
$users$;

create temp table usd_ref (label text primary key, id uuid);
create temp table usd_out (label text primary key, body jsonb);
grant all on usd_ref, usd_out to authenticated;

create function pg_temp.cur(p jsonb, c text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p) x where x ->> 'currency' = c $$;

create function pg_temp.proj(p jsonb, n text) returns jsonb
language sql immutable
as $$ select x from jsonb_array_elements(p -> 'projects') x where x ->> 'name' = n $$;

create function pg_temp.out_of(l text) returns jsonb
language sql stable
as $$ select body from usd_out where label = l $$;

grant execute on function pg_temp.cur(jsonb, text), pg_temp.proj(jsonb, text), pg_temp.out_of(text) to authenticated;

-- Company A: USD only. Company M: ILS + USD. Company B: ILS only, another owner.
select tests.authenticate_as('usd_owner');
select lives_ok($$select public.create_company('Treasury Co', true)$$, 'usd owner creates a company');
select lives_ok($$select public.upsert_project(null, 'Alpha', null, 'active')$$, 'usd owner opens a project');
insert into usd_ref (label, id) select 'a', id from public.companies where name = 'Treasury Co';
insert into usd_ref (label, id) select 'a_alpha', id from public.projects where name = 'Alpha';

select tests.authenticate_as('mix_owner');
select lives_ok($$select public.create_company('Mix Co', true)$$, 'mix owner creates a company');
select lives_ok($$select public.upsert_project(null, 'Beta', null, 'active')$$, 'mix owner opens a project');
insert into usd_ref (label, id) select 'm', id from public.companies where name = 'Mix Co';
insert into usd_ref (label, id) select 'm_beta', id from public.projects where name = 'Beta';

select tests.authenticate_as('usd_other');
select lives_ok($$select public.create_company('Other Co', true)$$, 'other owner creates a company');
insert into usd_ref (label, id) select 'b', id from public.companies where name = 'Other Co';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description, removed_at
)
select c.id, v.direction::public.txn_direction, v.doc_kind::public.doc_kind, v.pnl_role::public.pnl_role,
  v.line_status::public.line_status, v.currency,
  v.amount, v.amount, abs(v.amount), 0, 'source',
  v.doc_date::date, v.cash_date::date, v.source::public.txn_source, v.ikey,
  case when v.project then (select id from usd_ref where label = v.co || case v.co when 'a' then '_alpha' else '_beta' end) end,
  v.ikey, case when v.removed then now() end
from (values
  -- A, USD only
  ('a', 'income',  'receipt', null,       'posted',  'USD', 100000, '2026-09-10', '2026-09-10', 'mercury', 'a:income',     true,  false),
  ('a', 'income',  'receipt', null,       'posted',  'USD',   5000, '2026-08-20', '2026-09-15', 'mercury', 'a:late_cash',  false, false),
  ('a', 'income',  'invoice', null,       'posted',  'USD',   9000, '2026-09-14', null,         'mercury', 'a:invoice',    false, false),
  ('a', 'expense', 'expense', 'project',  'posted',  'USD', -30000, '2026-09-11', null,         'mercury', 'a:direct',     true,  false),
  ('a', 'expense', 'expense', 'shared',   'posted',  'USD', -50000, '2026-09-12', null,         'mercury', 'a:shared',     true,  false),
  ('a', 'expense', 'expense', 'overhead', 'posted',  'USD', -20000, '2026-09-13', null,         'mercury', 'a:overhead',   false, false),
  ('a', 'expense', 'expense', 'overhead', 'posted',  'USD',  -1000, '2026-08-25', '2026-09-05', 'mercury', 'a:aug_exp',    false, false),
  ('a', 'income',  'receipt', null,       'pending', 'USD',   7000, '2026-09-10', '2026-09-10', 'mercury', 'a:pending',    true,  false),
  ('a', 'expense', 'expense', 'project',  'pending', 'USD',  -4000, '2026-09-11', null,         'mercury', 'a:pending_x',  true,  false),
  ('a', 'expense', 'expense', 'overhead', 'void',    'USD',  -6000, '2026-09-12', null,         'mercury', 'a:void',       false, false),
  ('a', 'income',  'receipt', null,       'posted',  'USD',   3000, '2026-09-10', '2026-09-10', 'mercury', 'a:removed',    true,  true),
  -- M, ILS + USD
  ('m', 'income',  'receipt', null,       'posted',  'ILS',   7000, '2026-09-05', '2026-09-05', 'manual',  'm:ils_income', true,  false),
  ('m', 'expense', 'expense', 'project',  'posted',  'ILS',  -2000, '2026-09-06', null,         'manual',  'm:ils_direct', true,  false),
  ('m', 'expense', 'expense', 'shared',   'posted',  'ILS',  -1500, '2026-09-07', null,         'manual',  'm:ils_shared', false, false),
  ('m', 'expense', 'expense', 'overhead', 'posted',  'ILS',   -500, '2026-09-08', null,         'manual',  'm:ils_over',   false, false),
  ('m', 'income',  'receipt', null,       'pending', 'ILS',    800, '2026-09-05', '2026-09-05', 'manual',  'm:ils_pend',   true,  false),
  ('m', 'income',  'receipt', null,       'posted',  'USD',   4000, '2026-09-06', '2026-09-06', 'mercury', 'm:usd_income', true,  false),
  ('m', 'expense', 'expense', 'project',  'posted',  'USD',  -1000, '2026-09-07', null,         'mercury', 'm:usd_direct', true,  false),
  -- B, ILS only
  ('b', 'income',  'receipt', null,       'posted',  'ILS',   1000, '2026-09-05', '2026-09-05', 'manual',  'b:ils_income', false, false)
) as v(co, direction, doc_kind, pnl_role, line_status, currency, amount, doc_date, cash_date, source, ikey, project, removed)
join usd_ref c on c.label = v.co;

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, p.id, 10000, t.amount_net
from public.transactions t
join usd_ref p on p.label = case t.idempotency_key when 'a:shared' then 'a_alpha' else 'm_beta' end
where t.idempotency_key in ('a:shared', 'm:ils_shared');

select tests.authenticate_as('usd_owner');
insert into usd_out (label, body) values
  ('a_sep_cash', public.company_pnl((select id from usd_ref where label = 'a'), '2026-09-01', '2026-09-30', 'cash')),
  ('a_sep_inv',  public.company_pnl((select id from usd_ref where label = 'a'), '2026-09-01', '2026-09-30', 'invoiced')),
  ('a_aug_cash', public.company_pnl((select id from usd_ref where label = 'a'), '2026-08-01', '2026-08-31', 'cash')),
  ('a_all_cash', public.company_pnl((select id from usd_ref where label = 'a'), null, null, 'cash'));

select tests.authenticate_as('mix_owner');
insert into usd_out (label, body) values
  ('m_sep_cash', public.company_pnl((select id from usd_ref where label = 'm'), '2026-09-01', '2026-09-30', 'cash'));

select tests.authenticate_as('usd_other');
insert into usd_out (label, body) values
  ('b_sep_cash', public.company_pnl((select id from usd_ref where label = 'b'), '2026-09-01', '2026-09-30', 'cash'));

reset role;

-- A: USD-only company gets a full, non-zero USD P&L (pending, void and removed lines stay out)
select is(
  pg_temp.cur(pg_temp.out_of('a_sep_cash') -> 'by_currency', 'USD'),
  '{"currency": "USD", "income_minor": 105000, "direct_minor": 30000, "shared_minor": 50000, "overhead_minor": 20000, "expense_minor": 100000, "net_profit_minor": 5000, "excluded_income_minor": 0, "excluded_expense_minor": 0, "excluded_count": 0, "count": 5, "loan_split_fallback_count": 0, "unassigned_income_minor": 5000, "unassigned_expense_minor": 0}'::jsonb,
  'usd-only company: September cash USD row (cash date, posted only, not removed)'
);

select is(
  jsonb_array_length(pg_temp.out_of('a_sep_cash') -> 'by_currency'),
  1,
  'usd-only company: no ILS row in by_currency'
);

select is(
  (select jsonb_build_object('i', b -> 'income_agorot', 'e', b -> 'expense_agorot', 'n', b -> 'net_profit_agorot') from (select pg_temp.out_of('a_sep_cash') b) s),
  '{"i": 0, "e": 0, "n": 0}'::jsonb,
  'usd-only company: agorot fields stay ILS only'
);

select is(
  pg_temp.out_of('a_sep_cash') -> 'other_currencies',
  '[{"currency": "USD", "income_minor": 105000, "expense_minor": -100000, "count": 5}]'::jsonb,
  'other_currencies keeps its legacy shape and values'
);

select is(
  pg_temp.proj(pg_temp.out_of('a_sep_cash'), 'Alpha') -> 'by_currency',
  '[{"currency": "USD", "income_minor": 100000, "direct_minor": 30000, "shared_minor": 50000, "profit_minor": 20000}]'::jsonb,
  'usd-only company: project by_currency'
);

select is(
  pg_temp.cur(pg_temp.out_of('a_sep_inv') -> 'by_currency', 'USD'),
  '{"currency": "USD", "income_minor": 9000, "direct_minor": 30000, "shared_minor": 50000, "overhead_minor": 20000, "expense_minor": 100000, "net_profit_minor": -91000, "excluded_income_minor": 0, "excluded_expense_minor": 0, "excluded_count": 0, "count": 4, "loan_split_fallback_count": 0, "unassigned_income_minor": 9000, "unassigned_expense_minor": 0}'::jsonb,
  'invoiced basis counts the invoice and not the receipts'
);

select is(
  pg_temp.cur(pg_temp.out_of('a_aug_cash') -> 'by_currency', 'USD'),
  '{"currency": "USD", "income_minor": 0, "direct_minor": 0, "shared_minor": 0, "overhead_minor": 1000, "expense_minor": 1000, "net_profit_minor": -1000, "excluded_income_minor": 0, "excluded_expense_minor": 0, "excluded_count": 0, "count": 1, "loan_split_fallback_count": 0, "unassigned_income_minor": 0, "unassigned_expense_minor": 0}'::jsonb,
  'expenses use doc_date and income uses the cash date'
);

select is(
  pg_temp.cur(pg_temp.out_of('a_all_cash') -> 'by_currency', 'USD'),
  '{"currency": "USD", "income_minor": 105000, "direct_minor": 30000, "shared_minor": 50000, "overhead_minor": 21000, "expense_minor": 101000, "net_profit_minor": 4000, "excluded_income_minor": 0, "excluded_expense_minor": 0, "excluded_count": 0, "count": 6, "loan_split_fallback_count": 0, "unassigned_income_minor": 5000, "unassigned_expense_minor": 0}'::jsonb,
  'all time USD row'
);

-- M: the ILS row equals the agorot fields; USD is separate
select is(
  (pg_temp.out_of('m_sep_cash') ->> 'income_agorot')::bigint,
  7000::bigint,
  'mixed company: income_agorot counts ILS only'
);

select is(
  pg_temp.cur(pg_temp.out_of('m_sep_cash') -> 'by_currency', 'ILS'),
  (
    select jsonb_build_object(
      'currency', 'ILS',
      'income_minor', b -> 'income_agorot',
      'direct_minor', b -> 'direct_agorot',
      'shared_minor', b -> 'shared_agorot',
      'overhead_minor', b -> 'overhead_agorot',
      'expense_minor', b -> 'expense_agorot',
      'net_profit_minor', b -> 'net_profit_agorot',
      'excluded_income_minor', b -> 'excluded_income_agorot',
      'excluded_expense_minor', b -> 'excluded_expense_agorot',
      'excluded_count', 0,
      'count', 4,
      'loan_split_fallback_count', 0,
      'unassigned_income_minor', b -> 'unassigned_income_agorot',
      'unassigned_expense_minor', b -> 'unassigned_expense_agorot'
    )
    from (select pg_temp.out_of('m_sep_cash') b) s
  ),
  'mixed company: ILS row equals every agorot field'
);

select is(
  pg_temp.cur(pg_temp.out_of('m_sep_cash') -> 'by_currency', 'USD'),
  '{"currency": "USD", "income_minor": 4000, "direct_minor": 1000, "shared_minor": 0, "overhead_minor": 0, "expense_minor": 1000, "net_profit_minor": 3000, "excluded_income_minor": 0, "excluded_expense_minor": 0, "excluded_count": 0, "count": 2, "loan_split_fallback_count": 0, "unassigned_income_minor": 0, "unassigned_expense_minor": 0}'::jsonb,
  'mixed company: USD row is separate'
);

select is(
  pg_temp.proj(pg_temp.out_of('m_sep_cash'), 'Beta') -> 'by_currency',
  '[{"currency": "ILS", "income_minor": 7000, "direct_minor": 2000, "shared_minor": 1500, "profit_minor": 3500}, {"currency": "USD", "income_minor": 4000, "direct_minor": 1000, "shared_minor": 0, "profit_minor": 3000}]'::jsonb,
  'mixed project: one entry per currency, ordered'
);

select is(
  pg_temp.cur(pg_temp.proj(pg_temp.out_of('m_sep_cash'), 'Beta') -> 'by_currency', 'ILS'),
  (
    select jsonb_build_object(
      'currency', 'ILS',
      'income_minor', p -> 'income_agorot',
      'direct_minor', p -> 'direct_agorot',
      'shared_minor', p -> 'shared_agorot',
      'profit_minor', p -> 'profit_agorot'
    )
    from (select pg_temp.proj(pg_temp.out_of('m_sep_cash'), 'Beta') p) s
  ),
  'mixed project: ILS entry equals the project agorot fields'
);

-- Tenancy: B sees its own ILS and none of A's USD; B cannot read A
select is(
  pg_temp.out_of('b_sep_cash') -> 'by_currency',
  '[{"currency": "ILS", "income_minor": 1000, "direct_minor": 0, "shared_minor": 0, "overhead_minor": 0, "expense_minor": 0, "net_profit_minor": 1000, "excluded_income_minor": 0, "excluded_expense_minor": 0, "excluded_count": 0, "count": 1, "loan_split_fallback_count": 0, "unassigned_income_minor": 1000, "unassigned_expense_minor": 0}]'::jsonb,
  'another company sees its own totals and none of the usd company lines'
);

select tests.authenticate_as('usd_other');
select throws_ok(
  format('select public.company_pnl(%L::uuid, null, null, ''cash'')', (select id from usd_ref where label = 'a')),
  'P0001',
  'forbidden',
  'another owner cannot read the usd company totals'
);

select tests.authenticate_as('mix_owner');
select throws_ok(
  format('select public.company_pnl(%L::uuid, null, null, ''cash'')', (select id from usd_ref where label = 'a')),
  'P0001',
  'forbidden',
  'the mixed owner cannot read the usd company totals'
);

-- Viewer on a demo company reads the same by_currency as the owner
reset role;
update public.companies set is_demo = true where id = (select id from usd_ref where label = 'a');
insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('usd_viewer'), id from usd_ref where label = 'a';

select tests.authenticate_as('usd_viewer');
select is(
  public.company_pnl((select id from usd_ref where label = 'a'), '2026-09-01', '2026-09-30', 'cash') -> 'by_currency',
  pg_temp.out_of('a_sep_cash') -> 'by_currency',
  'a demo viewer reads the owner''s by_currency'
);

select is(
  public.get_dashboard('2026-09-01', '2026-09-30', 'cash') -> 'by_currency',
  pg_temp.out_of('a_sep_cash') -> 'by_currency',
  'get_dashboard passes by_currency through'
);

reset role;

-- Grants unchanged
select ok(
  not has_function_privilege('anon', 'public.company_pnl(uuid, date, date, text)', 'execute'),
  'anon cannot execute company_pnl'
);

select ok(
  has_function_privilege('authenticated', 'public.company_pnl(uuid, date, date, text)', 'execute'),
  'authenticated can execute company_pnl'
);

select is(
  (select prosecdef from pg_proc where oid = 'public.company_pnl(uuid, date, date, text)'::regprocedure),
  true,
  'company_pnl stays security definer'
);

select * from finish();

rollback;
