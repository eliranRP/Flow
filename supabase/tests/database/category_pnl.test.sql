-- excluded_from_pnl defaults, P&L reads, API, and MCP set_category_pnl.

begin;

select plan(60);

do $users$
begin
  perform tests.create_supabase_user('pnl_owner', 'pnl-owner@example.com');
  perform tests.create_supabase_user('pnl_viewer', 'pnl-viewer@example.com');
  perform tests.create_supabase_user('pnl_other', 'pnl-other@example.com');
  perform tests.create_supabase_user('pnl_demo', 'pnl-demo@example.com');
end
$users$;

create temp table pnl_ref (label text primary key, id uuid);
grant all on pnl_ref to authenticated, service_role;

select tests.authenticate_as('pnl_owner');
select lives_ok($$select public.create_company('Example Holdings LLC', true)$$, 'owner creates company');
select lives_ok($$select public.upsert_project(null, 'Site Alpha', null, 'active')$$, 'project');
insert into pnl_ref (label, id) select 'co', id from public.companies where name = 'Example Holdings LLC';
insert into pnl_ref (label, id) select 'proj', id from public.projects where name = 'Site Alpha';

select lives_ok($$select public.create_category('Rental income', 'income')$$, 'create rental income');
select lives_ok($$select public.create_category('OWNER Contributions', 'income')$$, 'create owner contributions (mixed case)');
select lives_ok($$select public.create_category('Materials', 'expense')$$, 'create materials');
select lives_ok($$select public.create_category('  Loan principal  ', 'expense')$$, 'create loan principal (padded)');

select is(
  (select excluded_from_pnl from public.categories
   where company_id = (select id from pnl_ref where label = 'co') and name = 'OWNER Contributions'),
  true,
  'insert trigger flags owner contributions income (case-insensitive)'
);

select is(
  (select excluded_from_pnl from public.categories
   where company_id = (select id from pnl_ref where label = 'co') and name = 'Loan principal'),
  true,
  'insert trigger flags loan principal expense'
);

select is(
  (select excluded_from_pnl from public.categories
   where company_id = (select id from pnl_ref where label = 'co') and name = 'Rental income'),
  false,
  'ordinary income name stays in P&L'
);

reset role;
select is(
  private.non_pnl_category('income'::public.category_kind, '  Owner Contributions  '),
  true,
  'non_pnl_category is case and space insensitive'
);

select is(
  has_function_privilege('authenticated', 'private.non_pnl_category(public.category_kind, text)', 'execute'),
  false,
  'non_pnl_category is not executable by authenticated'
);
select tests.authenticate_as('pnl_owner');

select lives_ok($$select public.create_category('Owner contributions', 'expense')$$, 'create owner contributions as expense');

select is(
  (select excluded_from_pnl from public.categories
   where company_id = (select id from pnl_ref where label = 'co') and name = 'Owner contributions' and kind = 'expense'),
  false,
  'wrong kind is not flagged by an income default name'
);

select lives_ok($$select public.create_category('Utility deposits', 'expense')$$, 'create utility deposits');
select lives_ok($$select public.create_category('Tax & insurance escrow', 'expense')$$, 'create escrow');

select is(
  (select excluded_from_pnl from public.categories
   where company_id = (select id from pnl_ref where label = 'co') and name = 'Tax & insurance escrow'),
  false,
  'escrow stays in the P&L per owner decision'
);

select is(
  (select excluded_from_pnl from public.categories
   where company_id = (select id from pnl_ref where label = 'co') and name = 'Utility deposits'),
  true,
  'utility deposits stay out per owner decision'
);

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description
)
select
  (select id from pnl_ref where label = 'co'),
  v.direction::public.txn_direction,
  v.doc_kind::public.doc_kind,
  v.pnl_role::public.pnl_role,
  'posted'::public.line_status,
  'ILS',
  v.amount, v.amount, abs(v.amount), 0, 'source',
  v.doc_date::date, v.cash_date::date,
  'manual'::public.txn_source,
  v.ikey,
  (select id from pnl_ref where label = 'proj'),
  (select c.id from public.categories c
   where c.company_id = (select id from pnl_ref where label = 'co') and c.name = v.cat and c.kind = v.ckind::public.category_kind),
  v.ikey
from (values
  ('income',  'receipt', null,      100000, '2026-06-01', '2026-06-01', 'pnl:in',   'Rental income',       'income'),
  ('income',  'receipt', null,      100000, '2026-06-02', '2026-06-02', 'pnl:exin', 'OWNER Contributions', 'income'),
  ('expense', 'expense', 'project', -50000, '2026-06-03', null,         'pnl:dir',  'Materials',           'expense'),
  ('expense', 'expense', 'project', -50000, '2026-06-04', null,         'pnl:exex', 'Loan principal',      'expense'),
  ('income',  'receipt', null,       20000, '2026-05-15', '2026-05-15', 'pnl:prev', 'Rental income',       'income')
) as v(direction, doc_kind, pnl_role, amount, doc_date, cash_date, ikey, cat, ckind);

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, description
)
values (
  (select id from pnl_ref where label = 'co'),
  'income', 'receipt', null, 'posted', 'ILS',
  30000, 30000, 30000, 0, 'source',
  '2026-06-05', '2026-06-05', 'manual', 'pnl:uncat',
  (select id from pnl_ref where label = 'proj'),
  'Uncategorised income'
);

-- A kept-out line in the prev period and a kept-out shared line allocated to the project.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description
)
select
  (select id from pnl_ref where label = 'co'),
  v.direction::public.txn_direction, v.doc_kind::public.doc_kind, v.pnl_role::public.pnl_role, 'posted', 'ILS',
  v.amount, v.amount, abs(v.amount), 0, 'source', v.d::date, v.d::date, 'manual', v.ikey,
  case when v.pnl_role is null then (select id from pnl_ref where label = 'proj') end,
  (select c.id from public.categories c
   where c.company_id = (select id from pnl_ref where label = 'co') and c.name = v.cat and c.kind = v.ckind::public.category_kind),
  v.ikey
from (values
  ('income',  'receipt', null,      7000,   '2026-05-20', 'pnl:prev:ex',   'OWNER Contributions', 'income'),
  ('expense', 'expense', 'shared',  -10000, '2026-06-10', 'pnl:shared:ex', 'Loan principal',      'expense')
) as v(direction, doc_kind, pnl_role, amount, d, ikey, cat, ckind);

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, (select id from pnl_ref where label = 'proj'), 10000, t.amount_net
from public.transactions t
where t.idempotency_key = 'pnl:shared:ex';

-- A zero-amount shared line (e.g. a zero SUMIT document split across projects) must not break the totals.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description, user_assigned
)
values (
  (select id from pnl_ref where label = 'co'), 'expense', 'expense', 'shared', 'posted', 'ILS',
  0, 0, 0, 0, 'source', '2026-06-12', null, 'manual', 'pnl:shared:zero', 'Zero shared line', true
);

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, (select id from pnl_ref where label = 'proj'), 10000, 0
from public.transactions t
where t.idempotency_key = 'pnl:shared:zero';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select
  (select id from pnl_ref where label = 'co'),
  v.direction::public.txn_direction, v.doc_kind::public.doc_kind, v.pnl_role::public.pnl_role,
  'posted'::public.line_status, 'USD',
  v.amount, v.amount, abs(v.amount), 0, 'source',
  '2026-06-15', '2026-06-15', 'mercury'::public.txn_source, v.ikey,
  (select id from pnl_ref where label = 'proj'),
  (select c.id from public.categories c
   where c.company_id = (select id from pnl_ref where label = 'co') and c.name = v.cat and c.kind = v.ckind::public.category_kind),
  v.ikey,
  v.cat is null
from (values
  ('income',  'invoice_receipt', null,      70000, 'pnl:usd:in',   'Rental income',       'income'),
  ('income',  'invoice_receipt', null,      40000, 'pnl:usd:exin', 'OWNER Contributions', 'income'),
  ('expense', 'expense',         'project', -9000, 'pnl:usd:exex', 'Loan principal',      'expense'),
  ('expense', 'expense',         'project', -3000, 'pnl:usd:unc',  null,                  null)
) as v(direction, doc_kind, pnl_role, amount, ikey, cat, ckind);

-- A month whose only USD line is kept out: the by_currency row must still carry it.
insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, category_id, description
)
select
  (select id from pnl_ref where label = 'co'), 'income', 'invoice_receipt', 'posted', 'USD',
  5000, 5000, 5000, 0, 'source', '2026-07-15', '2026-07-15', 'mercury', 'pnl:usd:only-excluded',
  (select c.id from public.categories c
   where c.company_id = (select id from pnl_ref where label = 'co') and c.name = 'OWNER Contributions' and c.kind = 'income'),
  'Kept-out only line';

select tests.authenticate_as('pnl_owner');

select is(
  (
    select jsonb_build_object(
      'income', x->'income_minor', 'excluded_income', x->'excluded_income_minor', 'excluded_count', x->'excluded_count')
    from jsonb_array_elements(
      public.company_pnl((select id from pnl_ref where label = 'co'), '2026-07-01', '2026-07-31', 'cash')->'by_currency'
    ) x
    where x->>'currency' = 'USD'
  ),
  '{"income": 0, "excluded_income": 5000, "excluded_count": 1}'::jsonb,
  'a currency with only kept-out lines still reports them'
);

select is(
  (
    select jsonb_build_object(
      'income', x->'income_minor', 'expense', x->'expense_minor', 'net', x->'net_profit_minor',
      'excluded_income', x->'excluded_income_minor', 'excluded_expense', x->'excluded_expense_minor',
      'excluded_count', x->'excluded_count')
    from jsonb_array_elements(
      public.company_pnl((select id from pnl_ref where label = 'co'), '2026-06-01', '2026-06-30', 'invoiced')->'by_currency'
    ) x
    where x->>'currency' = 'USD'
  ),
  '{"income": 70000, "expense": 3000, "net": 67000, "excluded_income": 40000, "excluded_expense": 9000, "excluded_count": 2}'::jsonb,
  'invoiced USD by_currency leaves out excluded lines and reports them per currency'
);

select is(
  (
    select (x->>'net_profit_minor')::bigint + (x->>'excluded_income_minor')::bigint - (x->>'excluded_expense_minor')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from pnl_ref where label = 'co'), null, null, 'cash')->'by_currency'
    ) x
    where x->>'currency' = 'USD'
  ),
  103000::bigint,
  'cash USD: in-P&L net plus excluded equals every posted line'
);

select is(
  (
    select jsonb_agg(x->>'name' order by x->>'name')
    from jsonb_array_elements(public.get_project((select id from pnl_ref where label = 'proj'), 'cash')->'categories_by_currency') x
    where x->>'currency' = 'USD'
  ),
  '[null]'::jsonb,
  'get_project keeps the uncategorised entry and drops the excluded category'
);

select is(
  (public.company_pnl((select id from pnl_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->>'income_agorot')::bigint,
  130000::bigint,
  'company_pnl cash ILS income counts in-P&L and uncategorised'
);

select is(
  (public.company_pnl((select id from pnl_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->>'excluded_income_agorot')::bigint,
  100000::bigint,
  'excluded income is reported separately'
);

select is(
  (public.company_pnl((select id from pnl_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->>'direct_agorot')::bigint,
  50000::bigint,
  'direct expense in P&L'
);

select is(
  (public.company_pnl((select id from pnl_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->>'excluded_expense_agorot')::bigint,
  60000::bigint,
  'excluded expense is reported separately (direct and shared)'
);

select is(
  (public.company_pnl((select id from pnl_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->>'net_profit_agorot')::bigint,
  80000::bigint,
  'net profit skips excluded lines'
);

select is(
  (public.company_pnl((select id from pnl_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->>'prev_income_agorot')::bigint,
  20000::bigint,
  'prev period respects in_pnl'
);

select lives_ok(
  $$select public.company_pnl((select id from pnl_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')$$,
  'company_pnl survives a zero-amount shared line'
);

select lives_ok(
  $$select public.get_project((select id from pnl_ref where label = 'proj'), 'cash')$$,
  'get_project survives a zero-amount shared line'
);

select is(
  (
    select (x->>'shared_agorot')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from pnl_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->'projects'
    ) x
    where x->>'id' = (select id::text from pnl_ref where label = 'proj')
  ),
  0::bigint,
  'company_pnl projects[] skip a kept-out shared allocation'
);

select is(
  (
    select (x->>'shared_minor')::bigint
    from jsonb_array_elements(public.get_project((select id from pnl_ref where label = 'proj'), 'cash')->'by_currency') x
    where x->>'currency' = 'ILS'
  ),
  0::bigint,
  'get_project shared skips a kept-out shared allocation'
);

select is(
  (
    select (x->>'excluded_income_minor')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from pnl_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->'by_currency'
    ) x
    where x->>'currency' = 'ILS'
  ),
  100000::bigint,
  'by_currency carries excluded_income_minor'
);

select is(
  (public.get_home()->>'net_profit_agorot')::bigint,
  100000::bigint,
  'get_home net skips excluded lines (all time, ILS)'
);

select is(
  (public.get_project((select id from pnl_ref where label = 'proj'), 'cash')->>'income_agorot')::bigint,
  150000::bigint,
  'get_project income uses in_pnl (all time)'
);

select is(
  (public.get_project((select id from pnl_ref where label = 'proj'), 'cash')->>'direct_agorot')::bigint,
  50000::bigint,
  'get_project direct uses in_pnl'
);

select is(
  jsonb_array_length(public.get_project((select id from pnl_ref where label = 'proj'), 'cash')->'categories'),
  1,
  'categories list keeps only in-P&L categories'
);

select is(
  jsonb_array_length(public.get_project((select id from pnl_ref where label = 'proj'), 'cash')->'excluded_categories_by_currency'),
  2,
  'excluded_categories_by_currency lists the kept-out category per currency'
);

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description
)
select
  (select id from pnl_ref where label = 'co'),
  'expense', 'expense', 'overhead', 'posted', 'ILS',
  -100000, -100000, 100000, 0, 'source',
  '2026-06-10', null, 'manual', 'pnl:oh',
  (select id from pnl_ref where label = 'proj'),
  (select c.id from public.categories c
   where c.company_id = (select id from pnl_ref where label = 'co') and c.name = 'Loan principal'),
  'Excluded overhead line'
;

select tests.authenticate_as('pnl_owner');

reset role;

-- An in-P&L overhead line and invoiced income: Site Alpha has in-P&L income, Site Beta only excluded income.
insert into public.projects (company_id, name, status)
select (select id from pnl_ref where label = 'co'), 'Site Beta', 'active';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description, user_assigned
)
select
  (select id from pnl_ref where label = 'co'),
  v.direction::public.txn_direction, v.doc_kind::public.doc_kind, v.pnl_role::public.pnl_role,
  'posted'::public.line_status, 'ILS',
  v.amount, v.amount, abs(v.amount), 0, 'source',
  '2026-06-20', '2026-06-20', 'manual'::public.txn_source, v.ikey,
  (select p.id from public.projects p where p.company_id = (select id from pnl_ref where label = 'co') and p.name = v.proj),
  (select c.id from public.categories c
   where c.company_id = (select id from pnl_ref where label = 'co') and c.name = v.cat and c.kind = v.ckind::public.category_kind),
  v.ikey,
  v.cat is null
from (values
  ('income',  'invoice', null,       100000, 'pnl:oh:in',   'Site Alpha', 'Rental income',       'income'),
  ('income',  'invoice', null,       100000, 'pnl:oh:exin', 'Site Beta',  'OWNER Contributions', 'income'),
  ('expense', 'expense', 'overhead', -10000, 'pnl:oh:keep', null,         null,                  null)
) as v(direction, doc_kind, pnl_role, amount, ikey, proj, cat, ckind);

select tests.authenticate_as('pnl_owner');

select is(
  (select share_agorot from private.overhead_share((select id from pnl_ref where label = 'proj'))),
  10000::bigint,
  'overhead_share ignores excluded overhead and excluded income weights'
);

select ok(
  jsonb_array_length(public.list_project_category(
    (select id from pnl_ref where label = 'proj'),
    (select id from public.categories
     where company_id = (select id from pnl_ref where label = 'co') and name = 'Loan principal')
  )->'rows') > 0,
  'list_project_category still drills into an excluded category'
);

select lives_ok(
  $$select public.set_category_excluded_from_pnl(
    (select id from public.categories
     where company_id = (select id from pnl_ref where label = 'co') and name = 'Materials'),
    true
  )$$,
  'owner can exclude a category'
);

select throws_ok(
  $$select public.set_category_excluded_from_pnl(
    (select id from public.categories
     where company_id = (select id from pnl_ref where label = 'co') and name = 'תשלומי הלוואה' and kind = 'expense'),
    false
  )$$,
  'loan category is fixed',
  'loan principal seed cannot be toggled'
);

-- Viewers only see a demo company; one viewer of a demo company cannot set the flag there.
select tests.authenticate_as('pnl_demo');
select public.create_company('Example Demo LLC', true);
reset role;
update public.companies set is_demo = true where name = 'Example Demo LLC';
insert into pnl_ref (label, id) select 'demo', id from public.companies where name = 'Example Demo LLC';
insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('pnl_viewer'), (select id from pnl_ref where label = 'demo');

select tests.authenticate_as('pnl_viewer');

select throws_ok(
  $$select public.set_category_excluded_from_pnl(
    (select id from public.categories
     where company_id = (select id from pnl_ref where label = 'demo') and name = 'תשלומי הלוואה' and kind = 'expense'),
    true
  )$$,
  '42501',
  'forbidden',
  'viewer is forbidden'
);

select tests.authenticate_as('pnl_other');
select lives_ok($$select public.create_company('Other Example LLC', true)$$, 'other company');

select throws_ok(
  $$select public.set_category_excluded_from_pnl(
    (select id from public.categories
     where company_id = (select id from pnl_ref where label = 'co') and name = 'Rental income'),
    true
  )$$,
  'category not found',
  'other company cannot change owner category'
);

select tests.authenticate_as('pnl_owner');
select lives_ok(
  $$select public.set_category_excluded_from_pnl(
    (select id from public.categories
     where company_id = (select id from pnl_ref where label = 'co') and name = 'Rental income'),
    false
  )$$,
  'owner positive control still updates own category'
);

select is(
  (select excluded_from_pnl from public.categories
   where company_id = (select id from pnl_ref where label = 'co') and name = 'Rental income'),
  false,
  'owner change persisted'
);

select is(
  (select jsonb_array_length(public.list_categories())),
  (select count(*)::int from public.categories where company_id = (select id from pnl_ref where label = 'co')),
  'list_categories returns every row'
);

select is(
  (select (x->>'excluded_from_pnl')::boolean
   from jsonb_array_elements(public.list_categories()) x
   where x->>'name' = 'Loan principal' limit 1),
  true,
  'list_categories exposes excluded_from_pnl'
);

reset role;

select public.store_mcp_credential(
  tests.get_supabase_uid('pnl_owner'), 'hash-pnl-write-0001', array['read','write'], now() + interval '90 days', 'pepper-pnl'
);
insert into pnl_ref (label, id) select 'tok', id from private.mcp_credentials where token_hash = 'hash-pnl-write-0001';

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claim.sub', tests.get_supabase_uid('pnl_owner')::text, true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', tests.get_supabase_uid('pnl_owner'),
    'role', 'authenticated',
    'mcp_tid', (select id from pnl_ref where label = 'tok')
  )::text,
  true
);

insert into pnl_ref (label, id)
select 'mat', id from public.categories
where company_id = (select id from pnl_ref where label = 'co') and name = 'Materials';

-- Materials is already kept out by the owner above; the MCP write puts it back in.
select is(
  public.mcp_set_category_pnl('pnl-mcp-1', (select id from pnl_ref where label = 'mat'), false)->'data'->>'undo_kind',
  'category_pnl',
  'mcp_set_category_pnl succeeds'
);

select is(
  (select excluded_from_pnl from public.categories where id = (select id from pnl_ref where label = 'mat')),
  false,
  'mcp write changed the flag'
);

select is(
  public.mcp_set_category_pnl('pnl-mcp-1', (select id from pnl_ref where label = 'mat'), false)->'ok',
  'true'::jsonb,
  'idempotency replay'
);

select is(
  public.mcp_set_category_pnl('pnl-mcp-1', (select id from pnl_ref where label = 'mat'), true)->'error'->>'code',
  'conflict',
  'idempotency key reuse with other args is conflict'
);

select is(
  public.mcp_undo('pnl-undo-1', 'category_pnl', (select id from pnl_ref where label = 'mat'))->'data'->>'kind',
  'category_pnl',
  'undo restores prior excluded flag'
);

select is(
  (select excluded_from_pnl from public.categories where id = (select id from pnl_ref where label = 'mat')),
  true,
  'undo kept materials out of the P&L again'
);

select is(
  public.mcp_set_category_pnl('pnl-mcp-3', (select id from pnl_ref where label = 'mat'), false)->'ok',
  'true'::jsonb,
  'second mcp write'
);

select lives_ok(
  $$select public.set_category_excluded_from_pnl((select id from pnl_ref where label = 'mat'), true)$$,
  'manual change after mcp write'
);

select is(
  public.mcp_undo('pnl-undo-2', 'category_pnl', (select id from pnl_ref where label = 'mat'))->'error'->>'code',
  'conflict',
  'undo after a later change is conflict'
);

select is(
  public.mcp_set_category_pnl('pnl-mcp-4', (select id from public.categories
    where company_id = (select id from pnl_ref where label = 'co') and name = 'תשלומי הלוואה' and kind = 'expense'), false)->'error'->>'message',
  'loan category is fixed',
  'mcp refuses a loan category'
);

reset role;
select public.store_mcp_credential(
  tests.get_supabase_uid('pnl_other'), 'hash-pnl-other-0001', array['read','write'], now() + interval '90 days', 'pepper-pnl2'
);
insert into pnl_ref (label, id) select 'tok_other', id from private.mcp_credentials where token_hash = 'hash-pnl-other-0001';
select set_config('role', 'authenticated', true);

select set_config('request.jwt.claim.sub', tests.get_supabase_uid('pnl_other')::text, true);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', tests.get_supabase_uid('pnl_other'),
    'role', 'authenticated',
    'mcp_tid', (select id from pnl_ref where label = 'tok_other')
  )::text,
  true
);

select is(
  public.mcp_set_category_pnl('pnl-cross', (select id from pnl_ref where label = 'mat'), true)->'error'->>'message',
  'category not found',
  'cross-tenant mcp write is refused'
);

select set_config('request.jwt.claim.sub', tests.get_supabase_uid('pnl_owner')::text, true);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', tests.get_supabase_uid('pnl_owner'),
    'role', 'authenticated',
    'mcp_tid', (select id from pnl_ref where label = 'tok')
  )::text,
  true
);

select is(
  public.mcp_set_category_pnl('pnl-own', (select id from pnl_ref where label = 'mat'), true)->'ok',
  'true'::jsonb,
  'owner positive control for mcp'
);

select * from finish();
rollback;
