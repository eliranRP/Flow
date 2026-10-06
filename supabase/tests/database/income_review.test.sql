-- Income without a project enters review. Off-P&L income stays out.

begin;

select plan(19);

do $users$
begin
  perform tests.create_supabase_user('inc_a', 'inc-a@test.flow');
  perform tests.create_supabase_user('inc_b', 'inc-b@test.flow');
end
$users$;

select tests.authenticate_as('inc_a');
select lives_ok($$select public.create_company('חברה א', true)$$, 'owner creates company a');

create temp table inc_ref (label text primary key, id uuid);
grant all on inc_ref to authenticated, service_role;
insert into inc_ref (label, id) select 'company', id from public.companies where name = 'חברה א';
select lives_ok($$select public.upsert_project(null, 'אתר', null, 'active')$$, 'owner opens a project');
insert into inc_ref (label, id) select 'project', id from public.projects where name = 'אתר';
insert into inc_ref (label, id)
select 'income_cat', id from public.categories where name = 'תקבול מלקוח' and kind = 'income';
insert into inc_ref (label, id)
select 'off_pnl', id from public.categories where name = 'העברות' and kind = 'income';

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

select is(
  (
    public.upsert_sumit_documents(
      (select id from inc_ref where label = 'company'),
      jsonb_build_array(
        jsonb_build_object(
          'idempotency_key', 'inc:sumit',
          'external_id', 'sumit-inc',
          'direction', 'income',
          'doc_kind', 'invoice',
          'amount_gross', '5900',
          'amount_net', '5000',
          'vat_amount', '900',
          'vat_status', 'derived',
          'doc_date', '2026-06-01',
          'description', 'קבלה',
          'party_name', 'לקוח',
          'party_kind', 'customer'
        ),
        jsonb_build_object(
          'idempotency_key', 'inc:off',
          'external_id', 'off-inc',
          'direction', 'income',
          'doc_kind', 'invoice',
          'amount_gross', '1000',
          'amount_net', '1000',
          'vat_amount', '0',
          'vat_status', 'derived',
          'doc_date', '2026-06-02',
          'description', 'העברה',
          'party_name', 'לקוח',
          'party_kind', 'customer',
          'category_id', (select id from inc_ref where label = 'off_pnl')
        )
      )
    )
  ),
  2,
  'sumit income lines insert'
);

select is(
  (
    select count(*)::integer
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.idempotency_key = 'inc:sumit'
      and q.status = 'open'
      and q.reason = 'missing_project'
  ),
  1,
  'sumit income without a project is queued'
);

update public.transactions
set category_id = (select id from inc_ref where label = 'off_pnl'),
    user_assigned = true,
    category_assigned = true
where idempotency_key = 'inc:off';

delete from public.review_queue q
using public.transactions t
where t.id = q.transaction_id
  and t.idempotency_key = 'inc:off';

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.sync_review_queue((select id from inc_ref where label = 'company'));
end
$$;

select is(
  (
    select count(*)::integer
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.idempotency_key = 'inc:off'
  ),
  0,
  'off-pnl income is not queued'
);

select is(
  (
    public.upsert_connector_lines(
      (select id from inc_ref where label = 'company'),
      'mercury',
      jsonb_build_object(
        'lines', jsonb_build_array(jsonb_build_object(
          'source', 'mercury',
          'external_id', 'mercury-inc',
          'direction', 'income',
          'line_status', 'posted',
          'doc_kind', 'receipt',
          'currency', 'USD',
          'amount_original', 5000,
          'amount_negated', false,
          'doc_date', '2026-06-03',
          'cash_date', '2026-06-03',
          'description', 'Wire',
          'vat', jsonb_build_object('amount', 0, 'status', 'source'),
          'provider_meta', jsonb_build_object('kind', 'incomingDomesticWire')
        )),
        'removed_ids', '[]'::jsonb,
        'complete', false
      ),
      null,
      null
    )
  ).inserted,
  1,
  'mercury income inserts'
);

select is(
  (
    select count(*)::integer
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.external_id = 'mercury-inc'
      and q.status = 'open'
  ),
  1,
  'mercury income without a project is queued'
);

select tests.authenticate_as('inc_a');

select throws_ok(
  format(
    'select public.resolve_review(%L::uuid, ''approved'', null, %L::uuid)',
    (select q.id from public.review_queue q join public.transactions t on t.id = q.transaction_id where t.idempotency_key = 'inc:sumit'),
    (select id from inc_ref where label = 'income_cat')
  ),
  'project and category are required',
  'approving income without a project is refused'
);

select lives_ok(
  format(
    'select public.resolve_review(%L::uuid, ''approved'', %L::uuid, %L::uuid)',
    (select q.id from public.review_queue q join public.transactions t on t.id = q.transaction_id where t.idempotency_key = 'inc:sumit'),
    (select id from inc_ref where label = 'project'),
    (select id from inc_ref where label = 'income_cat')
  ),
  'approving income with a project succeeds'
);

select is(
  (
    select t.project_id
    from public.transactions t
    where t.idempotency_key = 'inc:sumit'
  ),
  (select id from inc_ref where label = 'project'),
  'income keeps the approved project'
);

select is(
  (
    select count(*)::integer
    from public.allocations a
    join public.transactions t on t.id = a.transaction_id
    where t.idempotency_key = 'inc:sumit'
  ),
  0,
  'income approval writes no allocation'
);

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.upsert_sumit_documents(
    (select id from inc_ref where label = 'company'),
    jsonb_build_array(
      jsonb_build_object(
        'idempotency_key', 'inc:sumit', 'external_id', 'sumit-inc', 'direction', 'income', 'doc_kind', 'invoice',
        'amount_gross', '5900', 'amount_net', '5000', 'vat_amount', '900', 'vat_status', 'derived',
        'doc_date', '2026-06-01', 'description', 'קבלה', 'party_name', 'לקוח', 'party_kind', 'customer'
      ),
      jsonb_build_object(
        'idempotency_key', 'inc:off', 'external_id', 'off-inc', 'direction', 'income', 'doc_kind', 'invoice',
        'amount_gross', '1000', 'amount_net', '1000', 'vat_amount', '0', 'vat_status', 'derived',
        'doc_date', '2026-06-02', 'description', 'העברה', 'party_name', 'לקוח', 'party_kind', 'customer'
      )
    )
  );
end
$$;

select is(
  (
    select t.project_id
    from public.transactions t
    where t.idempotency_key = 'inc:sumit'
  ),
  (select id from inc_ref where label = 'project'),
  'a re-sync keeps the income project'
);
select is(
  (
    select count(*)::integer
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.idempotency_key = 'inc:sumit' and q.status = 'open'
  ),
  0,
  'a re-sync does not queue the approved income again'
);

select tests.authenticate_as('inc_b');
select lives_ok($$select public.create_company('חברה ב', true)$$, 'other owner creates a company');

select is(
  (
    select count(*)::integer
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.idempotency_key = 'inc:sumit'
  ),
  0,
  'another company sees no row from company a'
);
select throws_ok(
  format(
    'select public.resolve_review(%L::uuid, ''changed'', %L::uuid, %L::uuid)',
    (select q.id from public.review_queue q join public.transactions t on t.id = q.transaction_id where t.idempotency_key = 'inc:sumit'),
    (select id from inc_ref where label = 'project'),
    (select id from inc_ref where label = 'income_cat')
  ),
  'review item not found',
  'another company cannot resolve the income review row'
);
select throws_ok(
  format(
    'select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from public.transactions where idempotency_key = 'inc:sumit'),
    (select id from inc_ref where label = 'project'),
    (select id from inc_ref where label = 'income_cat')
  ),
  'transaction not found',
  'another company cannot reassign the income line'
);

select tests.authenticate_as('inc_a');

select is(
  (
    select count(*)::integer
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.idempotency_key = 'inc:sumit'
      and q.status = 'approved'
  ),
  1,
  'company a still sees its approved income review row'
);

-- Default category fallback skips off-P&L defaults when only those remain visible.
-- Hide only the building-trade defaults (sort 1-7); the loan defaults (0088) stay visible.
reset role;
update public.categories
set hidden = true
where company_id = (select id from inc_ref where label = 'company')
  and kind = 'expense'
  and is_default
  and sort_order <= 7;

insert into public.transactions (
  company_id, direction, doc_kind, amount_gross, amount_net, vat_amount, vat_status,
  doc_date, description, idempotency_key, source, line_status
) values (
  (select id from inc_ref where label = 'company'),
  'expense',
  'expense',
  -1000,
  -1000,
  0,
  'derived',
  '2026-06-10',
  'חומר ללא הצעה',
  'inc:fallback',
  'manual',
  'posted'
);

select is(
  (select category_id from public.transactions where idempotency_key = 'inc:fallback'),
  null,
  'fallback suggests no loan category (תשלומי הלוואה, העברות, ריבית משכנתא, מסים וביטוח)'
);

select * from finish();

rollback;
