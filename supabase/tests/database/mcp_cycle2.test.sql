-- MCP cycle 2: two users, two companies, two tokens. Each sees only its own rows.

begin;

select plan(25);

do $users$
begin
  perform tests.create_supabase_user('mcp2_a', 'mcp2-a@test.flow');
  perform tests.create_supabase_user('mcp2_b', 'mcp2-b@test.flow');
end
$users$;

select tests.authenticate_as('mcp2_a');
select lives_ok($$select public.create_company('חברה א', true)$$, 'user A creates a company');
select lives_ok(
  $$select public.create_manual_entry('expense', 'expense', 1000, '2026-09-01', 'חשבונית-אלפא', null, null, false)$$,
  'user A files an expense'
);

select tests.authenticate_as('mcp2_b');
select lives_ok($$select public.create_company('חברה ב', true)$$, 'user B creates a company');
select lives_ok(
  $$select public.create_manual_entry('expense', 'expense', 2000, '2026-09-02', 'חשבונית-ביתא', null, null, false)$$,
  'user B files an expense'
);

select tests.authenticate_as('mcp2_a');
select is(
  (public.search_transactions('אלפא', 'all', 50, 0) ->> 'total')::int,
  1,
  'user A finds their own expense'
);
select is(
  (public.search_transactions('ביתא', 'all', 50, 0) ->> 'total')::int,
  0,
  'user A cannot find user B'
);
select is(
  public.get_dashboard(null, null, 'cash') ->> 'name',
  'חברה א',
  'user A dashboard is their company'
);

select tests.authenticate_as('mcp2_b');
select is(
  (public.search_transactions('ביתא', 'all', 50, 0) ->> 'total')::int,
  1,
  'user B finds their own expense'
);
select is(
  (public.search_transactions('אלפא', 'all', 50, 0) ->> 'total')::int,
  0,
  'user B cannot find user A'
);
select is(
  public.get_dashboard(null, null, 'cash') ->> 'name',
  'חברה ב',
  'user B dashboard is their company'
);

reset role;

select lives_ok(
  $$select public.store_mcp_credential(
    (select id from auth.users where email = 'mcp2-a@test.flow'),
    'hash-mcp2-user-a-0001',
    array['read'],
    now() + interval '90 days',
    'pepper-1'
  )$$,
  'user A token is stored'
);

select lives_ok(
  $$select public.store_mcp_credential(
    (select id from auth.users where email = 'mcp2-b@test.flow'),
    'hash-mcp2-user-b-0001',
    array['read', 'write'],
    now() + interval '90 days',
    'pepper-1'
  )$$,
  'user B token is stored'
);

select is(
  (select company_id from private.mcp_credentials where token_hash = 'hash-mcp2-user-a-0001'),
  (select id from public.companies where name = 'חברה א'),
  'user A token stores user A company'
);
select is(
  (select user_id from private.mcp_credentials where token_hash = 'hash-mcp2-user-a-0001'),
  (select id from auth.users where email = 'mcp2-a@test.flow'),
  'user A token stores user A'
);
select is(
  (select company_id from private.mcp_credentials where token_hash = 'hash-mcp2-user-b-0001'),
  (select id from public.companies where name = 'חברה ב'),
  'user B token stores user B company'
);
select is(
  public.lookup_mcp_credential('hash-mcp2-user-a-0001', 'pepper-1') ->> 'user_id',
  (select id::text from auth.users where email = 'mcp2-a@test.flow'),
  'lookup of token A is user A'
);
select is(
  public.lookup_mcp_credential('hash-mcp2-user-a-0001', 'pepper-1') ->> 'company_id',
  (select id::text from public.companies where name = 'חברה א'),
  'lookup of token A is company A'
);
select is(
  public.lookup_mcp_credential('hash-mcp2-user-b-0001', 'pepper-1') ->> 'company_id',
  (select id::text from public.companies where name = 'חברה ב'),
  'lookup of token B is company B'
);
select is(
  public.lookup_mcp_credential('hash-mcp2-user-a-0001', 'pepper-1') ->> 'company_id'
    is distinct from (select id::text from public.companies where name = 'חברה ב'),
  true,
  'token A is not company B'
);
reset role;
select isnt(
  set_config(
    'mcp2.expense_a',
    (select id::text from public.transactions where description = 'חשבונית-אלפא'),
    false
  ),
  '',
  'expense A id is stored for the cross-company read'
);

select tests.authenticate_as('mcp2_a');
select is(
  public.get_transaction(current_setting('mcp2.expense_a')::uuid) ->> 'description',
  'חשבונית-אלפא',
  'user A reads their own expense'
);
select ok(
  position('חשבונית-ביתא' in coalesce(public.list_review(), '[]'::jsonb)::text) = 0,
  'user A review list has no user B expense'
);

select tests.authenticate_as('mcp2_b');
select is(
  public.get_transaction(current_setting('mcp2.expense_a')::uuid),
  null,
  'user B cannot read user A expense'
);
select ok(
  position('חשבונית-אלפא' in coalesce(public.list_review(), '[]'::jsonb)::text) = 0,
  'user B review list has no user A expense'
);

select ok(
  not has_function_privilege('anon', 'public.search_transactions(text, text, integer, integer, date, date, text, text, text, bigint, bigint, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.search_transactions(text, text, integer, integer, date, date, text, text, text, bigint, bigint, boolean)', 'execute'),
  'authenticated can search and anon cannot'
);

select * from finish();

rollback;
