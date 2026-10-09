-- Shekel totals ignore USD. A Mercury row keeps a null fx pair.
-- Pending income is queued and is not in the total. A zero-insert re-run does not wipe.

begin;

select plan(26);

do $users$
begin
  perform tests.create_supabase_user('ils_owner', 'ils-owner@test.flow');
end
$users$;

select tests.authenticate_as('ils_owner');
select lives_ok($$select public.create_company('ספר מטבע', true)$$, 'owner creates a company');

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

create temp table ils_co (id uuid);
insert into ils_co (id)
select id from public.companies where name = 'ספר מטבע' order by created_at desc limit 1;

select is(
  (
    public.upsert_connector_lines(
      (select id from ils_co),
      'sumit',
      jsonb_build_object(
        'lines', jsonb_build_array(jsonb_build_object(
          'source', 'sumit',
          'external_id', 'ils-income',
          'direction', 'income',
          'line_status', 'posted',
          'doc_kind', 'receipt',
          'currency', 'ILS',
          'amount_original', 5000,
          'amount_negated', false,
          'doc_date', '2026-09-01',
          'cash_date', '2026-09-01',
          'description', 'קבלה',
          'vat', jsonb_build_object('amount', 0, 'status', 'unknown'),
          'provider_meta', jsonb_build_object('kind', 'receipt')
        )),
        'removed_ids', '[]'::jsonb,
        'complete', false
      ),
      null,
      null
    )
  ).inserted,
  1,
  'an ILS receipt inserts'
);

select is(
  (
    public.upsert_connector_lines(
      (select id from ils_co),
      'mercury',
      jsonb_build_object(
        'lines', jsonb_build_array(
          jsonb_build_object(
            'source', 'mercury',
            'external_id', 'usd-income',
            'direction', 'income',
            'line_status', 'posted',
            'doc_kind', 'receipt',
            'currency', 'USD',
            'amount_original', 10000,
            'amount_negated', false,
            'doc_date', '2026-09-02',
            'cash_date', '2026-09-02',
            'description', 'Treasury interest',
            'category_hint', 'הכנסה אחרת',
            'vat', jsonb_build_object('amount', 0, 'status', 'source'),
            'provider_meta', jsonb_build_object('kind', 'interestPosted', 'checked_at', '2026-09-02T00:00:00.000Z')
          ),
          jsonb_build_object(
            'source', 'mercury',
            'external_id', 'usd-pending',
            'direction', 'income',
            'line_status', 'pending',
            'doc_kind', 'receipt',
            'currency', 'USD',
            'amount_original', 2500,
            'amount_negated', false,
            'doc_date', '2026-09-03',
            'description', 'Pending credit',
            'vat', jsonb_build_object('amount', 0, 'status', 'source'),
            'provider_meta', jsonb_build_object('kind', 'incomingDomesticWire')
          )
        ),
        'removed_ids', '[]'::jsonb,
        'complete', false
      ),
      null,
      null
    )
  ).inserted,
  2,
  'a posted dollar receipt and a pending receipt insert'
);

select is(
  (public.company_pnl((select id from ils_co), null, null, 'cash') ->> 'income_agorot')::bigint,
  5000::bigint,
  'a 100 dollar receipt does not change the shekel income'
);

select is(
  (
    select (item ->> 'income_minor')::bigint
    from jsonb_array_elements(
      public.company_pnl((select id from ils_co), null, null, 'cash') -> 'other_currencies'
    ) item
    where item ->> 'currency' = 'USD'
  ),
  10000::bigint,
  'the dollar receipt is returned on its own'
);

select is(
  (
    select (item ->> 'count')::integer
    from jsonb_array_elements(
      public.company_pnl((select id from ils_co), null, null, 'cash') -> 'other_currencies'
    ) item
    where item ->> 'currency' = 'USD'
  ),
  1,
  'the pending dollar receipt is not in the dollar count'
);

select is(
  (
    select t.fx_rate is null and t.fx_rate_date is null
    from public.transactions t
    where t.company_id = (select id from ils_co)
      and t.external_id = 'usd-income'
  ),
  true,
  'a mercury insert leaves the fx pair null'
);

select is(
  (
    select c.name
    from public.transactions t
    join public.categories c on c.id = t.category_id
    where t.company_id = (select id from ils_co)
      and t.external_id = 'usd-income'
  ),
  'הכנסה אחרת',
  'treasury yield uses other income'
);

select is(
  (
    select q.reason
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.company_id = (select id from ils_co)
      and t.external_id = 'usd-pending'
      and q.status = 'open'
  ),
  'pending_income',
  'pending mercury income is queued for review'
);

do $$
begin
  perform public.upsert_connector_lines(
    (select id from ils_co),
    'mercury',
    jsonb_build_object(
      'lines', jsonb_build_array(jsonb_build_object(
        'source', 'mercury',
        'external_id', 'usd-income',
        'direction', 'income',
        'line_status', 'posted',
        'doc_kind', 'receipt',
        'currency', 'USD',
        'amount_original', 10000,
        'amount_negated', false,
        'doc_date', '2026-09-02',
        'cash_date', '2026-09-02',
        'description', 'Treasury interest',
        'category_hint', 'הכנסה אחרת',
        'vat', jsonb_build_object('amount', 0, 'status', 'source'),
        'provider_meta', jsonb_build_object('kind', 'interestPosted')
      )),
      'removed_ids', '[]'::jsonb,
      'complete', false
    ),
    null,
    null
  );
  perform public.upsert_connector_lines(
    (select id from ils_co),
    'mercury',
    jsonb_build_object('lines', '[]'::jsonb, 'removed_ids', '[]'::jsonb, 'complete', true),
    null,
    null
  );
end
$$;

select is(
  (
    select count(*)::integer
    from public.transactions
    where company_id = (select id from ils_co)
      and source::text = 'mercury'
      and removed_at is null
  ),
  2,
  'a complete mercury re-run that inserts nothing new does not wipe'
);

select is(
  (
    select provider_meta ->> 'checked_at'
    from public.transactions
    where company_id = (select id from ils_co)
      and external_id = 'usd-income'
  ),
  '2026-09-02T00:00:00.000Z',
  'a later upsert keeps checked_at'
);

insert into public.connector_connections (
  company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version
)
select id, 'sumit', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'SUMIT_KEK', '1', '3'
from ils_co;

insert into public.connector_connections (
  company_id, provider,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce,
  kek_ref, kek_version, envelope_version
)
select id, 'mercury', '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea,
  'MERCURY_KEK', '1', '3'
from ils_co;

insert into public.connector_refresh_requests (company_id, provider, forced)
select id, 'sumit', false from ils_co;

insert into public.connector_refresh_requests (company_id, provider, forced)
select id, 'mercury', false from ils_co;

select is(
  (select count(*)::integer from public.claim_connector_refreshes(20, 'mercury') where provider::text = 'mercury'),
  1,
  'the mercury claim takes the mercury row'
);

select is(
  (select count(*)::integer from public.connector_refresh_requests where provider::text = 'sumit' and claimed_at is null),
  1,
  'the mercury claim leaves the sumit row unclaimed'
);

update public.review_queue q
set status = 'approved', resolved_at = now()
from public.transactions t
where t.id = q.transaction_id
  and t.company_id = (select id from ils_co)
  and t.external_id = 'usd-pending'
  and q.status = 'open';

do $$
begin
  perform public.upsert_connector_lines(
    (select id from ils_co),
    'mercury',
    jsonb_build_object(
      'lines', jsonb_build_array(jsonb_build_object(
        'source', 'mercury',
        'external_id', 'usd-pending',
        'direction', 'income',
        'line_status', 'pending',
        'doc_kind', 'receipt',
        'currency', 'USD',
        'amount_original', 2500,
        'amount_negated', false,
        'doc_date', '2026-09-03',
        'description', 'Pending credit',
        'vat', jsonb_build_object('amount', 0, 'status', 'source'),
        'provider_meta', jsonb_build_object('kind', 'incomingDomesticWire')
      )),
      'removed_ids', '[]'::jsonb,
      'complete', false
    ),
    null,
    null
  );
  perform public.upsert_connector_lines(
    (select id from ils_co),
    'mercury',
    jsonb_build_object(
      'lines', jsonb_build_array(jsonb_build_object(
        'source', 'mercury',
        'external_id', 'usd-posts',
        'direction', 'income',
        'line_status', 'pending',
        'doc_kind', 'receipt',
        'currency', 'USD',
        'amount_original', 800,
        'amount_negated', false,
        'doc_date', '2026-09-04',
        'description', 'Posts later',
        'vat', jsonb_build_object('amount', 0, 'status', 'source'),
        'provider_meta', jsonb_build_object('kind', 'incomingDomesticWire')
      )),
      'removed_ids', '[]'::jsonb,
      'complete', false
    ),
    null,
    null
  );
  perform public.upsert_connector_lines(
    (select id from ils_co),
    'mercury',
    jsonb_build_object(
      'lines', jsonb_build_array(jsonb_build_object(
        'source', 'mercury',
        'external_id', 'usd-posts',
        'direction', 'income',
        'line_status', 'posted',
        'doc_kind', 'receipt',
        'currency', 'USD',
        'amount_original', 800,
        'amount_negated', false,
        'doc_date', '2026-09-04',
        'cash_date', '2026-09-04',
        'description', 'Posts later',
        'vat', jsonb_build_object('amount', 0, 'status', 'source'),
        'provider_meta', jsonb_build_object('kind', 'incomingDomesticWire')
      )),
      'removed_ids', '[]'::jsonb,
      'complete', false
    ),
    null,
    null
  );
  perform public.upsert_connector_lines(
    (select id from ils_co),
    'mercury',
    jsonb_build_object(
      'lines', jsonb_build_array(jsonb_build_object(
        'source', 'mercury',
        'external_id', 'usd-void',
        'direction', 'income',
        'line_status', 'pending',
        'doc_kind', 'receipt',
        'currency', 'USD',
        'amount_original', 400,
        'amount_negated', false,
        'doc_date', '2026-09-05',
        'description', 'Voids later',
        'vat', jsonb_build_object('amount', 0, 'status', 'source'),
        'provider_meta', jsonb_build_object('kind', 'incomingDomesticWire')
      )),
      'removed_ids', '[]'::jsonb,
      'complete', false
    ),
    null,
    null
  );
  perform public.upsert_connector_lines(
    (select id from ils_co),
    'mercury',
    jsonb_build_object(
      'lines', '[]'::jsonb,
      'removed_ids', jsonb_build_array('usd-void'),
      'complete', false
    ),
    null,
    null
  );
end
$$;

select is(
  (
    select count(*)::integer
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.company_id = (select id from ils_co)
      and t.external_id = 'usd-pending'
      and q.status = 'open'
  ),
  0,
  'an approved pending income line is not re-queued'
);

select is(
  (
    select q.reason::text
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.company_id = (select id from ils_co)
      and t.external_id = 'usd-posts'
      and q.status = 'open'
  ),
  'missing_category',
  'a posted line trades the pending income label for a real reason (FLOW-309)'
);

select is(
  (
    select count(*)::integer
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.company_id = (select id from ils_co)
      and t.external_id = 'usd-void'
      and q.status = 'open'
  ),
  0,
  'a voided line drops its open review row'
);

insert into public.projects (company_id, name)
select id, 'אתר דולר' from ils_co;

create temp table ils_project (id uuid);
insert into ils_project (id)
select id from public.projects where company_id = (select id from ils_co) and name = 'אתר דולר';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status,
  amount_gross, amount_net, vat_amount, vat_status, currency,
  doc_date, source, idempotency_key, project_id, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project', 'posted',
  -4000, -4000, 0, 'unknown', 'ILS',
  '2026-09-06', 'manual', 'ils:direct', p.id, cat.id, true, 'הוצאה בשקלים'
from ils_co c
join ils_project p on true
join public.categories cat on cat.company_id = c.id and cat.kind = 'expense' and cat.name = 'חומרים';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status,
  amount_gross, amount_net, vat_amount, vat_status, currency,
  doc_date, source, idempotency_key, project_id, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project', 'posted',
  -8000, -8000, 0, 'unknown', 'USD',
  '2026-09-07', 'manual', 'usd:direct', p.id, cat.id, true, 'Dollar expense'
from ils_co c
join ils_project p on true
join public.categories cat on cat.company_id = c.id and cat.kind = 'expense' and cat.name = 'חומרים';

insert into public.transactions (
  company_id, direction, doc_kind, line_status,
  amount_gross, amount_net, vat_amount, vat_status, currency,
  doc_date, source, idempotency_key, project_id, description
)
select c.id, 'income', 'invoice', 'posted',
  6000, 6000, 0, 'unknown', 'ILS',
  '2026-09-08', 'manual', 'ils:invoice', p.id, 'חשבונית בשקלים'
from ils_co c
join ils_project p on true;

insert into public.transactions (
  company_id, direction, doc_kind, line_status,
  amount_gross, amount_net, vat_amount, vat_status, currency,
  doc_date, source, idempotency_key, project_id, description
)
select c.id, 'income', 'invoice', 'posted',
  9000, 9000, 0, 'unknown', 'USD',
  '2026-09-09', 'manual', 'usd:invoice', p.id, 'Dollar invoice'
from ils_co c
join ils_project p on true;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status,
  amount_gross, amount_net, vat_amount, vat_status, currency,
  doc_date, source, idempotency_key, project_id, category_suggested, description
)
select c.id, 'expense', 'expense', 'project', 'pending',
  -1500, -1500, 0, 'unknown', 'ILS',
  '2026-09-10', 'manual', 'ils:waiting', p.id, true, 'ממתין בשקלים'
from ils_co c
join ils_project p on true;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status,
  amount_gross, amount_net, vat_amount, vat_status, currency,
  doc_date, source, idempotency_key, project_id, category_suggested, description
)
select c.id, 'expense', 'expense', 'project', 'pending',
  -2000, -2000, 0, 'unknown', 'USD',
  '2026-09-11', 'manual', 'usd:waiting', p.id, true, 'Waiting dollar'
from ils_co c
join ils_project p on true;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, line_status,
  amount_gross, amount_net, vat_amount, vat_status, currency,
  doc_date, source, idempotency_key, project_id, category_id, description
)
select c.id, 'expense', 'expense', 'project', 'pending',
  -700, -700, 0, 'unknown', 'USD',
  '2026-09-12', 'manual', 'usd:queued', p.id, cat.id, 'Pending dollar'
from ils_co c
join ils_project p on true
join public.categories cat on cat.company_id = c.id and cat.kind = 'expense' and cat.name = 'חומרים';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_category'
from public.transactions t
where t.company_id = (select id from ils_co)
  and t.idempotency_key = 'usd:queued';

grant all on ils_project to authenticated, service_role;

select tests.authenticate_as('ils_owner');

select is(
  (public.get_home() ->> 'net_profit_agorot')::bigint,
  1000::bigint,
  'home profit keeps the shekel receipt and the shekel expense'
);

select is(
  (
    select (item ->> 'income_minor')::bigint
    from jsonb_array_elements(public.get_home() -> 'other_currencies') item
    where item ->> 'currency' = 'USD'
  ),
  10800::bigint,
  'home returns the dollar receipts beside the shekel total'
);

select is(
  (
    select (item ->> 'expense_minor')::bigint
    from jsonb_array_elements(public.get_home() -> 'other_currencies') item
    where item ->> 'currency' = 'USD'
  ),
  -8000::bigint,
  'home returns the dollar expense beside the shekel total'
);

select is(
  (public.get_project((select id from ils_project)) ->> 'income_agorot')::bigint,
  6000::bigint,
  'project income keeps the shekel invoice'
);

select is(
  (public.get_project((select id from ils_project)) ->> 'direct_agorot')::bigint,
  4000::bigint,
  'project expenses keep the shekel line'
);

select is(
  (
    select (item ->> 'income_minor')::bigint
    from jsonb_array_elements(public.get_project((select id from ils_project)) -> 'other_currencies') item
    where item ->> 'currency' = 'USD'
  ),
  9000::bigint,
  'project returns the dollar invoice on its own'
);

select is(
  (
    select (item ->> 'expense_minor')::bigint
    from jsonb_array_elements(public.get_project((select id from ils_project)) -> 'other_currencies') item
    where item ->> 'currency' = 'USD'
  ),
  -8000::bigint,
  'project returns the dollar expense on its own'
);

select is(
  (public.get_project((select id from ils_project)) ->> 'pending_agorot')::bigint,
  1500::bigint,
  'a waiting dollar expense is not added to the shekel pending total'
);

select is(
  (
    select (item ->> 'expense_minor')::bigint
    from jsonb_array_elements(public.get_project((select id from ils_project)) -> 'pending_other_currencies') item
    where item ->> 'currency' = 'USD'
  ),
  -2700::bigint,
  'waiting dollar expenses are returned on their own'
);

select is(
  (
    select (item ->> 'count')::integer
    from jsonb_array_elements(public.get_project((select id from ils_project)) -> 'pending_other_currencies') item
    where item ->> 'currency' = 'USD'
  ),
  2,
  'the waiting dollar expense and the pending dollar expense are both counted'
);

select * from finish();
rollback;
