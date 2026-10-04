-- provider_meta keeps providerCategory beside kind. Kind-only and empty stay as they were.

begin;

select plan(5);

do $users$
begin
  perform tests.create_supabase_user('meta_owner', 'meta-owner@test.flow');
end
$users$;

select tests.authenticate_as('meta_owner');
select lives_ok($$select public.create_company('קטגוריה', true)$$, 'owner creates a company');

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

create temp table meta_co (id uuid);
insert into meta_co (id)
select id from public.companies where name = 'קטגוריה' order by created_at desc limit 1;

select is(
  (
    public.upsert_connector_lines(
      (select id from meta_co),
      'sumit',
      jsonb_build_object(
        'lines', jsonb_build_array(
          jsonb_build_object(
            'source', 'sumit',
            'external_id', 'meta-both',
            'direction', 'expense',
            'line_status', 'posted',
            'doc_kind', 'expense',
            'pnl_role', 'overhead',
            'currency', 'ILS',
            'amount_original', 500,
            'amount_negated', true,
            'doc_date', '2026-10-01',
            'description', 'עם קטגוריה',
            'vat', jsonb_build_object('amount', 0, 'status', 'unknown'),
            'provider_meta', jsonb_build_object('kind', 'expense', 'providerCategory', 'Software')
          ),
          jsonb_build_object(
            'source', 'sumit',
            'external_id', 'meta-kind',
            'direction', 'expense',
            'line_status', 'posted',
            'doc_kind', 'expense',
            'pnl_role', 'overhead',
            'currency', 'ILS',
            'amount_original', 500,
            'amount_negated', true,
            'doc_date', '2026-10-01',
            'description', 'רק סוג',
            'vat', jsonb_build_object('amount', 0, 'status', 'unknown'),
            'provider_meta', jsonb_build_object('kind', 'expense')
          ),
          jsonb_build_object(
            'source', 'sumit',
            'external_id', 'meta-empty',
            'direction', 'expense',
            'line_status', 'posted',
            'doc_kind', 'expense',
            'pnl_role', 'overhead',
            'currency', 'ILS',
            'amount_original', 500,
            'amount_negated', true,
            'doc_date', '2026-10-01',
            'description', 'ריק',
            'vat', jsonb_build_object('amount', 0, 'status', 'unknown'),
            'provider_meta', '{}'::jsonb
          )
        ),
        'removed_ids', '[]'::jsonb,
        'complete', false
      ),
      null,
      null
    )
  ).inserted,
  3,
  'three posted lines are inserted'
);

select is(
  (select provider_meta from public.transactions where company_id = (select id from meta_co) and external_id = 'meta-both'),
  '{"kind":"expense","providerCategory":"Software"}'::jsonb,
  'the engine keeps providerCategory beside kind'
);

select is(
  (select provider_meta from public.transactions where company_id = (select id from meta_co) and external_id = 'meta-kind'),
  '{"kind":"expense"}'::jsonb,
  'a kind-only meta stays kind-only'
);

select is(
  (select provider_meta from public.transactions where company_id = (select id from meta_co) and external_id = 'meta-empty'),
  '{}'::jsonb,
  'an empty meta stays empty'
);

select * from finish();
rollback;
