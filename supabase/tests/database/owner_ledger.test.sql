-- Owner assignments survive a re-sync. Direct ledger writes are refused.

begin;

select plan(41);

do $users$
begin
  perform tests.create_supabase_user('ledger_a', 'ledger-a@test.flow');
  perform tests.create_supabase_user('ledger_b', 'ledger-b@test.flow');
end
$users$;

select tests.authenticate_as('ledger_a');

select lives_ok(
  $$select public.create_company('ספרים', true)$$,
  'owner creates a company'
);

create temp table ledger_ref (label text primary key, id uuid);
grant all on ledger_ref to authenticated, service_role;
insert into ledger_ref (label, id)
select 'company', id from public.companies;

select throws_ok(
  $$update public.transactions set description = 'ישיר'$$,
  '42501',
  null,
  'authenticated cannot update transactions directly'
);

select tests.authenticate_as('ledger_a');
select lives_ok(
  $$select public.upsert_project(null, 'שיפוץ הרצל', null, 'active')$$,
  'the owner opens a project'
);
insert into ledger_ref (label, id)
select 'project', id from public.projects where name = 'שיפוץ הרצל';
insert into ledger_ref (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into ledger_ref (label, id)
select 'income_cat', id from public.categories where name = 'תקבול מלקוח' and kind = 'income';

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

select is(
  public.upsert_sumit_documents(
    (select id from ledger_ref where label = 'company'),
    jsonb_build_array(
      jsonb_build_object(
        'idempotency_key', 'sumit:1',
        'external_id', '1',
        'direction', 'expense',
        'doc_kind', 'expense',
        'pnl_role', 'project',
        'amount_gross', '-10001',
        'amount_net', '-10001',
        'vat_amount', '0',
        'vat_status', 'derived',
        'doc_date', '2026-04-01',
        'cash_date', '2026-04-01',
        'description', 'עלות פרויקט: פועלים',
        'party_name', 'כוח אדם',
        'party_kind', 'supplier',
        'party_external_id', '9'
      ),
      jsonb_build_object(
        'idempotency_key', 'sumit:2',
        'external_id', '2',
        'direction', 'income',
        'doc_kind', 'invoice',
        'pnl_role', '',
        'amount_gross', '11800',
        'amount_net', '10000',
        'vat_amount', '1800',
        'vat_status', 'source',
        'doc_date', '2026-04-02',
        'description', 'חשבונית',
        'party_name', 'לקוח',
        'party_kind', 'customer',
        'party_external_id', '8'
      ),
      jsonb_build_object(
        'idempotency_key', 'sumit:3',
        'external_id', '3',
        'direction', 'income',
        'doc_kind', 'receipt',
        'amount_gross', '5900',
        'amount_net', '5000',
        'vat_amount', '900',
        'vat_status', 'derived',
        'doc_date', '2026-04-03',
        'cash_date', '2026-04-03',
        'description', 'קבלה',
        'linked_external_id', '2'
      )
    )
  ),
  3,
  'a service sync writes the page in one call'
);

select tests.authenticate_as('ledger_a');

select is(
  (select count(*)::int from public.review_queue where status = 'open'),
  3,
  'the unallocated expense and both income lines without a project are queued'
);

select lives_ok(
  format(
    'select public.resolve_review(%L::uuid, ''approved'', %L::uuid, %L::uuid)',
    (select q.id from public.review_queue q join public.transactions t on t.id = q.transaction_id where t.idempotency_key = 'sumit:1'),
    (select id from ledger_ref where label = 'project'),
    (select id from ledger_ref where label = 'materials')
  ),
  'approving a review item assigns the project'
);

select is(
  (select user_assigned from public.transactions where idempotency_key = 'sumit:1'),
  true,
  'approval marks the row as owner-assigned'
);

select is(
  (select remembered_category_id from public.suppliers where name = 'כוח אדם'),
  (select id from ledger_ref where label = 'materials'),
  'approval remembers the supplier category'
);

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

select lives_ok(
  $$select public.upsert_sumit_documents(
  (select id from ledger_ref where label = 'company'),
  jsonb_build_array(
    jsonb_build_object(
      'idempotency_key', 'sumit:1',
      'external_id', '1',
      'direction', 'expense',
      'doc_kind', 'expense',
      'pnl_role', 'shared',
      'amount_gross', '-20000',
      'amount_net', '-20000',
      'vat_amount', '0',
      'vat_status', 'derived',
      'doc_date', '2026-04-01',
      'cash_date', '2026-04-01',
      'description', 'עלות משותפת: פועלים',
      'party_name', 'כוח אדם',
      'party_kind', 'supplier',
      'party_external_id', '9'
    ),
    jsonb_build_object(
      'idempotency_key', 'sumit:2',
      'external_id', '2',
      'direction', 'income',
      'doc_kind', 'invoice',
      'amount_gross', '11800',
      'amount_net', '10000',
      'vat_amount', '1800',
      'vat_status', 'source',
      'doc_date', '2026-04-02',
      'description', 'חשבונית',
      'party_name', 'לקוח',
      'party_kind', 'customer'
    ),
    jsonb_build_object(
      'idempotency_key', 'sumit:3',
      'external_id', '3',
      'direction', 'income',
      'doc_kind', 'receipt',
      'amount_gross', '5900',
      'amount_net', '5000',
      'vat_amount', '900',
      'vat_status', 'derived',
      'doc_date', '2026-04-03',
      'cash_date', '2026-04-03',
      'description', 'קבלה',
      'linked_external_id', '2'
    )
  )
)
$$,
  'a second sync updates only SUMIT-owned columns'
);

select tests.authenticate_as('ledger_a');

select is(
  (select category_id from public.transactions where idempotency_key = 'sumit:1'),
  (select id from ledger_ref where label = 'materials'),
  'a re-sync keeps the approved category'
);

select is(
  (select amount_net from public.transactions where idempotency_key = 'sumit:1'),
  -20000::bigint,
  'a re-sync still updates the SUMIT amount'
);

select is(
  (select count(*)::int from public.allocations a
    join public.transactions t on t.id = a.transaction_id
    where t.idempotency_key = 'sumit:1'),
  1,
  'the approved allocation is still the only share'
);

insert into ledger_ref (label, id)
select 'queue', q.id
from public.review_queue q
join public.transactions t on t.id = q.transaction_id
where t.idempotency_key = 'sumit:1';

insert into ledger_ref (label, id)
select 'txn2', id from public.transactions where idempotency_key = 'sumit:2';

select tests.authenticate_as('ledger_b');
select lives_ok(
  $$select public.create_company('אחר', true)$$,
  'the other owner has their own company'
);
select throws_ok(
  format(
    'select public.reopen_review(%L::uuid)',
    (select id from ledger_ref where label = 'queue')
  ),
  'P0001',
  'review item not found',
  'another owner cannot reopen the item'
);

select tests.authenticate_as('ledger_a');

select lives_ok(
  format(
    'select public.reopen_review(%L::uuid)',
    (select id from ledger_ref where label = 'queue')
  ),
  'undo reopens the item'
);

select is(
  (select project_id from public.transactions where idempotency_key = 'sumit:1'),
  null,
  'undo restores the project from before the approval'
);

select is(
  (select user_assigned from public.transactions where idempotency_key = 'sumit:1'),
  false,
  'undo restores the unassigned flag'
);

select is(
  (select count(*)::int from public.allocations a
    join public.transactions t on t.id = a.transaction_id
    where t.idempotency_key = 'sumit:1'),
  0,
  'undo removes the allocation the approval added'
);

select tests.authenticate_as('ledger_a');

select lives_ok(
  $$select public.upsert_project(null, 'פרויקט ב', null, 'active')$$,
  'the owner opens a second project for the split'
);

select throws_ok(
  format(
    $sql$select public.save_split(%L::uuid, '[{"project_id":"%s","share_bp":6000}]'::jsonb)$sql$,
    (select id from public.transactions where idempotency_key = 'sumit:1'),
    (select id from public.projects where name = 'שיפוץ הרצל')
  ),
  'P0001',
  'allocation shares must sum to 10000',
  'a split that does not sum to 10000 is refused'
);

select lives_ok(
  format(
    $sql$select public.save_split(%L::uuid, '[{"project_id":"%s","share_bp":3333},{"project_id":"%s","share_bp":6667}]'::jsonb)$sql$,
    (select id from public.transactions where idempotency_key = 'sumit:1'),
    (select id from public.projects where name = 'שיפוץ הרצל'),
    (select id from public.projects where name = 'פרויקט ב')
  ),
  'the owner can split a shared cost'
);

select lives_ok(
  'set constraints all immediate',
  'the deferred share check can lock the transaction after the owner call returns'
);

select is(
  (select coalesce(sum(a.amount_net), 0)::bigint from public.allocations a
    join public.transactions t on t.id = a.transaction_id
    where t.idempotency_key = 'sumit:1'),
  (select amount_net from public.transactions where idempotency_key = 'sumit:1'),
  'split amounts, including the remainder, equal the net'
);

select throws_ok(
  format(
    'select public.merge_category(%L::uuid, %L::uuid)',
    (select id from ledger_ref where label = 'materials'),
    (select id from ledger_ref where label = 'income_cat')
  ),
  'P0001',
  'categories must be the same kind',
  'a merge across kinds is refused'
);

select lives_ok(
  format(
    'select public.set_category_hidden(%L::uuid, true)',
    (select id from public.categories where name = 'הובלה')
  ),
  'the owner can hide a category'
);

select is(
  (select hidden from public.categories where name = 'הובלה'),
  true,
  'hide sets the flag'
);

select lives_ok(
  format(
    'select public.set_category_hidden(%L::uuid, false)',
    (select id from public.categories where name = 'הובלה')
  ),
  'the owner can return a category to the list'
);

select is(
  (select hidden from public.categories where name = 'הובלה'),
  false,
  'unhide clears the flag'
);

insert into ledger_ref (label, id)
select 'haul', id from public.categories where name = 'הובלה';

select tests.authenticate_as('ledger_b');
select throws_ok(
  format(
    'select public.set_category_hidden(%L::uuid, false)',
    (select id from ledger_ref where label = 'haul')
  ),
  'P0001',
  'category not found',
  'another company cannot change the hidden flag'
);
select tests.authenticate_as('ledger_a');

select throws_ok(
  format(
    'select public.delete_transaction(%L::uuid)',
    (select id from public.transactions where idempotency_key = 'sumit:1')
  ),
  'P0001',
  'only a manual entry can be deleted',
  'a SUMIT row cannot be deleted'
);

select is(
  (select (value->>'open_gross_agorot')::bigint
    from jsonb_array_elements(public.list_unpaid()) value
    where value->>'description' = 'חשבונית'),
  5900::bigint,
  'open receivables subtract the linked receipt'
);

select is(
  (select (value->>'open_net_agorot')::numeric::bigint
    from jsonb_array_elements(public.list_unpaid()) value
    where value->>'description' = 'חשבונית'),
  5000::bigint,
  'open net scales with the remaining gross'
);

select tests.authenticate_as('ledger_b');
select is(
  public.get_project((select id from ledger_ref where label = 'project')),
  null,
  'another owner cannot read the project'
);
select is(
  public.get_transaction((select id from ledger_ref where label = 'txn2')),
  null,
  'another owner cannot read the transaction'
);

select tests.authenticate_as('ledger_a');
select lives_ok(
  $$select public.disconnect_sumit()$$,
  'disconnect removes a missing connection without error'
);

reset role;
insert into public.sumit_connections (
  company_id, sumit_company_id,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version
)
select id, 1, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, '1'
from ledger_ref where label = 'company';

select tests.authenticate_as('ledger_a');
select lives_ok($$select public.disconnect_sumit()$$, 'disconnect deletes the sealed connection');
select is(
  (select count(*)::int from public.sumit_connections),
  0,
  'the connection is gone'
);

select throws_ok(
  $$select public.sync_review_queue(null)$$,
  '42501',
  null,
  'authenticated cannot execute sync_review_queue'
);

select throws_ok(
  $$select * from public.sumit_refresh_requests$$,
  '42501',
  null,
  'authenticated cannot read the refresh queue'
);

select throws_ok(
  $$select key_ciphertext from public.sumit_connections$$,
  '42501',
  null,
  'authenticated cannot read ciphertext'
);

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

select throws_ok(
  format(
    'select public.company_pnl(%L::uuid, null, null, ''invoiced'')',
    (select id from ledger_ref where label = 'company')
  ),
  'P0001',
  'forbidden',
  'company_pnl refuses a session that is neither the owner nor service_role'
);

select * from finish();

rollback;
