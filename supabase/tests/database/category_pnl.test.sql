-- excluded_from_pnl defaults, P&L reads, API, and MCP set_category_pnl.

begin;

select plan(43);

do $users$
begin
  perform tests.create_supabase_user('pnl_owner', 'pnl-owner@example.com');
  perform tests.create_supabase_user('pnl_viewer', 'pnl-viewer@example.com');
  perform tests.create_supabase_user('pnl_other', 'pnl-other@example.com');
end
$users$;

create temp table pnl_ref (label text primary key, id uuid);
grant all on pnl_ref to authenticated, service_role;

select tests.authenticate_as('pnl_owner');
select lives_ok($$select public.create_company('Example Holdings LLC', true)$$, 'owner creates company');
select lives_ok($$select public.upsert_project(null, 'Site Alpha', null, 'active')$$, 'project');
insert into pnl_ref (label, id) select 'co', id from public.companies where name = 'Example Holdings LLC';
insert into pnl_ref (label, id) select 'proj', id from public.projects where name = 'Site Alpha';

insert into public.categories (company_id, name, kind, sort_order, is_default)
select (select id from pnl_ref where label = 'co'), 'Rental income', 'income', 50, false;

insert into public.categories (company_id, name, kind, sort_order, is_default)
select (select id from pnl_ref where label = 'co'), 'Owner contributions', 'income', 51, false;

insert into public.categories (company_id, name, kind, sort_order, is_default)
select (select id from pnl_ref where label = 'co'), 'Materials', 'expense', 52, false;

insert into public.categories (company_id, name, kind, sort_order, is_default)
select (select id from pnl_ref where label = 'co'), 'Loan principal', 'expense', 53, false;

select is(
  (select excluded_from_pnl from public.categories
   where company_id = (select id from pnl_ref where label = 'co') and name = 'Owner contributions'),
  true,
  'backfill flags owner contributions income'
);

select is(
  (select excluded_from_pnl from public.categories
   where company_id = (select id from pnl_ref where label = 'co') and name = 'Loan principal'),
  true,
  'backfill flags loan principal expense'
);

select is(
  (select excluded_from_pnl from public.categories
   where company_id = (select id from pnl_ref where label = 'co') and name = 'Rental income'),
  false,
  'ordinary income name stays in P&L'
);

select is(
  private.non_pnl_category('income'::public.category_kind, '  Owner Contributions  '),
  true,
  'non_pnl_category is case and space insensitive'
);

insert into public.categories (company_id, name, kind, sort_order, is_default)
values (
  (select id from pnl_ref where label = 'co'),
  'Owner contributions',
  'expense',
  55,
  false
);

select is(
  (select excluded_from_pnl from public.categories
   where company_id = (select id from pnl_ref where label = 'co') and name = 'Owner contributions' and kind = 'expense'),
  false,
  'wrong kind is not flagged by an income default name'
);

insert into public.categories (company_id, name, kind, sort_order, is_default)
select (select id from pnl_ref where label = 'co'), 'Utility deposits', 'expense', 56, false;

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
   where c.company_id = (select id from pnl_ref where label = 'co') and c.name = v.cat and c.kind = v.ckind),
  v.ikey
from (values
  ('income',  'receipt', null,      100000, '2026-06-01', '2026-06-01', 'pnl:in',   'Rental income',       'income'),
  ('income',  'receipt', null,      100000, '2026-06-02', '2026-06-02', 'pnl:exin', 'Owner contributions', 'income'),
  ('expense', 'expense', 'project', -50000, '2026-06-03', null,         'pnl:dir',  'Materials',           'expense'),
  ('expense', 'expense', 'project', -50000, '2026-06-04', null,         'pnl:exex', 'Loan principal',      'expense'),
  ('income',  'receipt', null,       20000, '2026-05-01', '2026-05-01', 'pnl:prev', 'Rental income',       'income')
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

select tests.authenticate_as('pnl_owner');

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
  50000::bigint,
  'excluded expense is reported separately'
);

select is(
  (public.company_pnl((select id from pnl_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->>'net_profit_agorot')::bigint,
  110000::bigint,
  'net profit skips excluded lines'
);

select is(
  (public.company_pnl((select id from pnl_ref where label = 'co'), '2026-06-01', '2026-06-30', 'cash')->>'prev_income_agorot')::bigint,
  20000::bigint,
  'prev period respects in_pnl'
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
  110000::bigint,
  'get_home net skips excluded lines'
);

select is(
  (public.get_project((select id from pnl_ref where label = 'proj'), 'cash')->>'income_agorot')::bigint,
  130000::bigint,
  'get_project income uses in_pnl'
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
  1,
  'excluded_categories_by_currency lists kept-out category'
);

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

select is(
  (select share_agorot from private.overhead_share((select id from pnl_ref where label = 'proj'))),
  0::bigint,
  'overhead_share ignores excluded overhead and income weights'
);

select isnt_empty(
  public.list_project_category(
    (select id from pnl_ref where label = 'proj'),
    (select id::text from public.categories
     where company_id = (select id from pnl_ref where label = 'co') and name = 'Loan principal')
  ),
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

insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('pnl_viewer'), (select id from pnl_ref where label = 'co');

select tests.authenticate_as('pnl_viewer');

select throws_ok(
  $$select public.set_category_excluded_from_pnl(
    (select id from public.categories
     where company_id = (select id from pnl_ref where label = 'co') and name = 'Rental income'),
    true
  )$$,
  '42501',
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
  tests.get_supabase_uid('pnl_owner'), 'hash-pnl-write', array['read','write'], now() + interval '90 days', 'pepper-pnl'
);

select set_config('role', 'authenticated', true);
select set_config('request.jwt.claim.sub', tests.get_supabase_uid('pnl_owner')::text, true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', tests.get_supabase_uid('pnl_owner'),
    'role', 'authenticated',
    'mcp_tid', (select id from private.mcp_credentials where token_hash = 'hash-pnl-write')
  )::text,
  true
);

insert into pnl_ref (label, id)
select 'mat', id from public.categories
where company_id = (select id from pnl_ref where label = 'co') and name = 'Materials';

select is(
  public.mcp_set_category_pnl('pnl-mcp-1', (select id from pnl_ref where label = 'mat'), true)->'data'->>'undo_kind',
  'category_pnl',
  'mcp_set_category_pnl succeeds'
);

select is(
  public.mcp_set_category_pnl('pnl-mcp-1', (select id from pnl_ref where label = 'mat'), true)->'ok',
  'true'::jsonb,
  'idempotency replay'
);

select is(
  public.mcp_set_category_pnl('pnl-mcp-2', (select id from pnl_ref where label = 'mat'), false)->'error'->>'code',
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
  false,
  'undo put materials back in P&L'
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

select public.store_mcp_credential(
  tests.get_supabase_uid('pnl_other'), 'hash-pnl-other', array['read','write'], now() + interval '90 days', 'pepper-pnl2'
);

select set_config('request.jwt.claim.sub', tests.get_supabase_uid('pnl_other')::text, true);
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', tests.get_supabase_uid('pnl_other'),
    'role', 'authenticated',
    'mcp_tid', (select id from private.mcp_credentials where token_hash = 'hash-pnl-other')
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
    'mcp_tid', (select id from private.mcp_credentials where token_hash = 'hash-pnl-write')
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
