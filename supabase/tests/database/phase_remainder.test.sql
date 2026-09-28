-- Tenancy hook, dirty months, refresh budget, offline replay, notifications.

begin;

select plan(22);

create temp table rem_ref (
  label text primary key,
  id uuid
);
grant all on rem_ref to authenticated, service_role;

do $users$
begin
  perform tests.create_supabase_user('rem_a', 'rem-a@test.flow');
  perform tests.create_supabase_user('rem_b', 'rem-b@test.flow');
end
$users$;

select tests.authenticate_as('rem_a');
select lives_ok(
  $$select public.create_company('שארית א', true)$$,
  'owner A creates a company'
);
insert into rem_ref (label, id)
select 'a', id from public.companies;

select tests.authenticate_as('rem_b');
select lives_ok($$select public.create_company('שארית ב', true)$$, 'owner B creates a company');

do $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end
$$;

select is(
  (
    public.custom_access_token_hook(
      jsonb_build_object(
        'user_id', tests.get_supabase_uid('rem_a')::text,
        'claims', '{}'::jsonb
      )
    ) -> 'claims' ->> 'company_id'
  ),
  (select id::text from rem_ref where label = 'a'),
  'the access token hook adds that owner company id'
);

select ok(
  (
    public.custom_access_token_hook(
      jsonb_build_object(
        'user_id', tests.get_supabase_uid('rem_b')::text,
        'claims', '{}'::jsonb
      )
    ) -> 'claims' ->> 'company_id'
  ) is distinct from (select id::text from rem_ref where label = 'a'),
  'the hook does not give owner B the other company'
);

select tests.authenticate_as('rem_a');

select is(
  (select count(*)::int from public.company_member),
  1,
  'a member sees only their membership'
);

select throws_ok(
  $$insert into public.company_member (company_id, user_id, role)
    values (gen_random_uuid(), gen_random_uuid(), 'owner')$$,
  '42501',
  null,
  'a member cannot insert a membership'
);

select lives_ok(
  $$select public.create_manual_entry('expense', 'expense', 11800, '2026-09-01', 'מלט', null, null, false)$$,
  'a manual expense is stored'
);

select is(
  (select count(*)::int from public.dirty_month),
  1,
  'the entry marks September dirty'
);

select lives_ok($$select public.refresh_dirty(null)$$, 'the owner can refresh their dirty months');

select is(
  (select net_profit_agorot from public.agg_month where basis = 'cash' and ym = '2026-09-01'),
  (
    public.company_pnl(
      (select id from rem_ref where label = 'a'),
      '2026-09-01',
      '2026-09-30',
      'cash'
    ) ->> 'net_profit_agorot'
  )::bigint,
  'the stored month matches a full recompute'
);

select tests.authenticate_as('rem_b');
select throws_ok(
  format(
    'select public.refresh_company_months(%L::uuid, array[%L::date])',
    (select id from rem_ref where label = 'a'),
    '2026-09-01'
  ),
  'P0001',
  'forbidden',
  'another owner cannot refresh the first company'
);

do $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end
$$;

insert into public.sumit_connections (
  company_id, sumit_company_id, key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version
) values (
  (select id from rem_ref where label = 'a'),
  2389917160,
  '\x01', '\x02', '\x03', '\x04',
  '1'
);

select is(
  public.reserve_sumit_call((select id from rem_ref where label = 'a'), 'daily'),
  true,
  'the first reserved SUMIT call is allowed'
);

select tests.authenticate_as('rem_a');

select is(
  public.request_refresh('app_open') ->> 'enqueued',
  'true',
  'an app-open refresh is enqueued'
);

select is(
  public.request_refresh('app_open') ->> 'reason',
  'recent',
  'a second app-open refresh inside six hours waits'
);

select throws_ok(
  $$select public.reserve_sumit_call(private.current_company_id(), 'daily')$$,
  '42501',
  null,
  'the browser cannot reserve a SUMIT call'
);

select is(
  public.create_manual_entry(
    'expense', 'expense', 100, '2026-09-02', 'כפילות', null, null, true,
    '11111111-1111-4111-8111-111111111111'::uuid
  ),
  public.create_manual_entry(
    'expense', 'expense', 100, '2026-09-02', 'כפילות', null, null, true,
    '11111111-1111-4111-8111-111111111111'::uuid
  ),
  'the same offline op is applied once'
);

select ok(
  jsonb_array_length(public.export_ledger('2026-09-01', '2026-09-30')) >= 1,
  'the accountant export includes the month'
);

do $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end
$$;

update public.sumit_connections
set calls_count = 100, calls_month = date_trunc('month', (now() at time zone 'Asia/Jerusalem'))::date
where company_id = (select id from rem_ref where label = 'a');

select is(
  public.reserve_sumit_call((select id from rem_ref where label = 'a'), 'daily'),
  false,
  'the call cap refuses another SUMIT call'
);

select is(
  public.dispatch_notifications('2026-09-27 05:00:00+00'::timestamptz) > 0,
  true,
  'Sunday 08:00 Israel time queues the weekly summary'
);

do $$
begin
  perform public.dispatch_notifications('2026-09-28 15:00:00+00'::timestamptz);
end
$$;

select is(
  (select count(*)::int from public.notification_outbox where kind = 'nudge'),
  0,
  'the 18:00 pass still skips an empty queue'
);

select tests.clear_authentication();

select throws_ok(
  $$select * from public.notification_outbox$$,
  '42501',
  null,
  'anon cannot read the notification outbox'
);

select ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  ),
  'every public table has row level security'
);

select * from finish();

rollback;
