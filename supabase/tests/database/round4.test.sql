-- Round 4: income stays out of Review, remember is optional, section ids win,
-- a suspicious sweep does not wipe the ledger, and a project with no income has no overhead share.

begin;

select plan(51);

do $users$
begin
  perform tests.create_supabase_user('r4_a', 'r4-a@test.flow');
  perform tests.create_supabase_user('r4_b', 'r4-b@test.flow');
end
$users$;

select tests.authenticate_as('r4_a');
select lives_ok($$select public.create_company('סבב 4', true)$$, 'owner creates a company');

create temp table r4 (label text primary key, id uuid);
grant all on r4 to authenticated, service_role;
insert into r4 (label, id) select 'company', id from public.companies;
select lives_ok($$select public.upsert_project(null, 'שלי', null, 'active')$$, 'owner opens a project');
insert into r4 (label, id) select 'project', id from public.projects where name = 'שלי';
insert into r4 (label, id) select 'other', id from public.projects where false;
select lives_ok($$select public.upsert_project(null, 'אחר', null, 'active')$$, 'owner opens a second project');
insert into r4 (label, id) select 'other', id from public.projects where name = 'אחר';
insert into r4 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into r4 (label, id)
select 'income_cat', id from public.categories where name = 'תקבול מלקוח' and kind = 'income';

select lives_ok(
  format(
    'select public.map_budget_section(42, %L::uuid, null)',
    (select id from r4 where label = 'project')
  ),
  'the owner maps a SUMIT section onto their project'
);
select lives_ok(
  format(
    'select public.map_budget_section(7, %L::uuid, null)',
    (select id from r4 where label = 'other')
  ),
  'a second project keeps its own section'
);

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
    (select id from r4 where label = 'company'),
    jsonb_build_array(
      jsonb_build_object(
        'idempotency_key', 'r4:income',
        'external_id', 'income',
        'direction', 'income',
        'doc_kind', 'invoice',
        'amount_gross', '11800',
        'amount_net', '10000',
        'vat_amount', '1800',
        'vat_status', 'source',
        'doc_date', '2026-05-01',
        'description', 'חשבונית הכנסה',
        'party_name', 'לקוח',
        'party_kind', 'customer'
      ),
      jsonb_build_object(
        'idempotency_key', 'r4:exp',
        'external_id', 'exp',
        'direction', 'expense',
        'doc_kind', 'expense',
        'pnl_role', 'project',
        'amount_gross', '-11800',
        'amount_net', '-10000',
        'vat_amount', '-1800',
        'vat_status', 'assumed',
        'doc_date', '2026-05-02',
        'description', 'חומר',
        'party_name', 'ספק חדש',
        'party_kind', 'supplier'
      ),
      jsonb_build_object(
        'idempotency_key', 'r4:mapped',
        'external_id', 'mapped',
        'direction', 'expense',
        'doc_kind', 'expense',
        'pnl_role', 'project',
        'amount_gross', '-5000',
        'amount_net', '-5000',
        'vat_amount', '0',
        'vat_status', 'derived',
        'doc_date', '2026-05-03',
        'description', 'סעיף ממופה',
        'budget_section_id', '42',
        'budget_section_name', 'שם אחר לגמרי'
      ),
      jsonb_build_object(
        'idempotency_key', 'r4:clash',
        'external_id', 'clash',
        'direction', 'expense',
        'doc_kind', 'expense',
        'pnl_role', 'project',
        'amount_gross', '-1000',
        'amount_net', '-1000',
        'vat_amount', '0',
        'vat_status', 'derived',
        'doc_date', '2026-05-04',
        'description', 'התנגשות',
        'budget_section_id', '99',
        'budget_section_name', 'אחר'
      )
    )
  ),
  4,
  'the page is written'
);

select tests.authenticate_as('r4_a');

select is(
  (select count(*)::int from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.idempotency_key = 'r4:income'),
  1,
  'posted income without a project is queued'
);

select is(
  (select category_id from public.transactions where idempotency_key = 'r4:income'),
  (select id from r4 where label = 'income_cat'),
  'income takes the default income category'
);

select is(
  (select pnl_role from public.transactions where idempotency_key = 'r4:income'),
  null,
  'income has no pnl role'
);

select is(
  (select count(*)::int from public.allocations a
    join public.transactions t on t.id = a.transaction_id
    where t.idempotency_key = 'r4:income'),
  0,
  'income has no allocation'
);

select is(
  (select project_id from public.transactions where idempotency_key = 'r4:mapped'),
  (select id from r4 where label = 'project'),
  'a document follows the mapped section id, not the section name'
);

select is(
  (select sumit_budget_section_id from public.projects where name = 'אחר'),
  7::bigint,
  'sync does not overwrite an existing section mapping'
);

select is(
  (select project_id from public.transactions where idempotency_key = 'r4:clash'),
  null,
  'a name clash with another mapping does not steal the project'
);

insert into r4 (label, id)
select 'queue', q.id
from public.review_queue q
join public.transactions t on t.id = q.transaction_id
where t.idempotency_key = 'r4:exp' and q.status = 'open';

select lives_ok(
  format(
    'select public.resolve_review(%L::uuid, ''approved'', %L::uuid, %L::uuid, false)',
    (select id from r4 where label = 'queue'),
    (select id from r4 where label = 'project'),
    (select id from r4 where label = 'materials')
  ),
  'approval can leave the supplier rule unsaved'
);

select is(
  (select remembered_category_id from public.suppliers where name = 'ספק חדש'),
  null,
  'p_remember false does not write the supplier category'
);

select lives_ok(
  format('select public.reopen_review(%L::uuid)', (select id from r4 where label = 'queue')),
  'undo reopens the item'
);

select lives_ok(
  format(
    'select public.resolve_review(%L::uuid, ''approved'', %L::uuid, %L::uuid, true)',
    (select id from r4 where label = 'queue'),
    (select id from r4 where label = 'project'),
    (select id from r4 where label = 'materials')
  ),
  'approval can save the supplier rule'
);

select is(
  (select remembered_category_id from public.suppliers where name = 'ספק חדש'),
  (select id from r4 where label = 'materials'),
  'p_remember true writes the supplier category'
);

select lives_ok(
  format('select public.reopen_review(%L::uuid)', (select id from r4 where label = 'queue')),
  'undo runs again'
);

select is(
  (select remembered_category_id from public.suppliers where name = 'ספק חדש'),
  null,
  'undo restores the supplier rule'
);

select lives_ok(
  format(
    'select public.resolve_review(%L::uuid, ''skipped'', null, null, false)',
    (select id from r4 where label = 'queue')
  ),
  'the owner skips the expense'
);

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

select public.upsert_sumit_documents(
  (select id from r4 where label = 'company'),
  (
    select jsonb_agg(jsonb_build_object(
      'idempotency_key', t.idempotency_key,
      'external_id', t.external_id,
      'direction', t.direction,
      'doc_kind', t.doc_kind,
      'pnl_role', coalesce(t.pnl_role::text, ''),
      'amount_gross', t.amount_gross,
      'amount_net', t.amount_net,
      'vat_amount', t.vat_amount,
      'vat_status', t.vat_status,
      'doc_date', t.doc_date,
      'description', t.description,
      'budget_section_id', case when t.idempotency_key = 'r4:mapped' then '42' when t.idempotency_key = 'r4:clash' then '99' else null end,
      'budget_section_name', case when t.idempotency_key = 'r4:mapped' then 'שם אחר לגמרי' when t.idempotency_key = 'r4:clash' then 'אחר' else null end,
      'party_name', case when t.idempotency_key = 'r4:exp' then 'ספק חדש' when t.idempotency_key = 'r4:income' then 'לקוח' else null end,
      'party_kind', case when t.idempotency_key = 'r4:exp' then 'supplier' when t.idempotency_key = 'r4:income' then 'customer' else null end
    ))
    from public.transactions t
    where t.company_id = (select id from r4 where label = 'company')
  )
);

select tests.authenticate_as('r4_a');
select is(
  (select count(*)::int from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.idempotency_key = 'r4:exp' and q.status = 'open'),
  0,
  'a skipped document is not queued again while it is unchanged'
);

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;

select public.upsert_sumit_documents(
  (select id from r4 where label = 'company'),
  jsonb_build_array(
    jsonb_build_object(
      'idempotency_key', 'r4:exp',
      'external_id', 'exp',
      'direction', 'expense',
      'doc_kind', 'expense',
      'pnl_role', 'project',
      'amount_gross', '-23600',
      'amount_net', '-20000',
      'vat_amount', '-3600',
      'vat_status', 'assumed',
      'doc_date', '2026-05-02',
      'description', 'חומר',
      'party_name', 'ספק חדש',
      'party_kind', 'supplier'
    ),
    jsonb_build_object(
      'idempotency_key', 'r4:income',
      'external_id', 'income',
      'direction', 'income',
      'doc_kind', 'invoice',
      'amount_gross', '11800',
      'amount_net', '10000',
      'vat_amount', '1800',
      'vat_status', 'source',
      'doc_date', '2026-05-01',
      'description', 'חשבונית הכנסה'
    ),
    jsonb_build_object(
      'idempotency_key', 'r4:mapped',
      'external_id', 'mapped',
      'direction', 'expense',
      'doc_kind', 'expense',
      'pnl_role', 'project',
      'amount_gross', '-5000',
      'amount_net', '-5000',
      'vat_amount', '0',
      'vat_status', 'derived',
      'doc_date', '2026-05-03',
      'description', 'סעיף ממופה',
      'budget_section_id', '42',
      'budget_section_name', 'שם אחר לגמרי'
    ),
    jsonb_build_object(
      'idempotency_key', 'r4:clash',
      'external_id', 'clash',
      'direction', 'expense',
      'doc_kind', 'expense',
      'pnl_role', 'project',
      'amount_gross', '-1000',
      'amount_net', '-1000',
      'vat_amount', '0',
      'vat_status', 'derived',
      'doc_date', '2026-05-04',
      'description', 'התנגשות',
      'budget_section_id', '99',
      'budget_section_name', 'אחר'
    )
  )
);

select tests.authenticate_as('r4_a');
select is(
  (select count(*)::int from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.idempotency_key = 'r4:exp' and q.status = 'open'),
  1,
  'a skipped document returns to the queue after the amount changes'
);

select throws_ok(
  format(
    'select public.resolve_review(%L::uuid, ''approved'', %L::uuid, %L::uuid, false)',
    (select q.id from public.review_queue q
      join public.transactions t on t.id = q.transaction_id
      where t.idempotency_key = 'r4:exp' and q.status = 'open'),
    (select id from r4 where label = 'project'),
    (select id from r4 where label = 'income_cat')
  ),
  'P0001',
  'category kind must match the direction',
  'an expense cannot be filed under an income category'
);

reset role;
insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_category'
from public.transactions t
where t.idempotency_key = 'r4:income';

select tests.authenticate_as('r4_a');
select throws_ok(
  format(
    'select public.resolve_review(%L::uuid, ''approved'', null, %L::uuid, false)',
    (select q.id from public.review_queue q
      join public.transactions t on t.id = q.transaction_id
      where t.idempotency_key = 'r4:income' and q.status = 'open'),
    (select id from r4 where label = 'materials')
  ),
  'P0001',
  'category kind must match the direction',
  'income cannot be filed under an expense category'
);

select lives_ok(
  format(
    'select public.resolve_review(%L::uuid, ''approved'', null, %L::uuid, false)',
    (select q.id from public.review_queue q
      join public.transactions t on t.id = q.transaction_id
      where t.idempotency_key = 'r4:income' and q.status = 'open'),
    (select id from r4 where label = 'income_cat')
  ),
  'income can be approved with an income category and no project'
);

select is(
  (select pnl_role from public.transactions where idempotency_key = 'r4:income'),
  null,
  'approving income still leaves the role empty'
);

select lives_ok($$select public.set_after_overhead(true, null)$$, 'settings turns the overhead view on');
select is(
  (public.get_project((select id from r4 where label = 'project'))->>'after_overhead')::boolean,
  true,
  'a project with no choice inherits the company default'
);
select is(
  public.get_project((select id from r4 where label = 'project'))->>'overhead_share_agorot',
  null,
  'with no project income the overhead share is unavailable'
);
select is(
  (public.get_project((select id from r4 where label = 'project'))->>'overhead_weighted')::boolean,
  false,
  'the payload says the weights are not set'
);
select is(
  (public.get_project((select id from r4 where label = 'project'))->>'profit_after_overhead_agorot')::bigint,
  (public.get_project((select id from r4 where label = 'project'))->>'profit_agorot')::bigint,
  'profit after a zero share equals the stored profit'
);
select lives_ok(
  format('select public.set_after_overhead(false, %L::uuid)', (select id from r4 where label = 'project')),
  'the project can turn the view off on its own'
);
select is(
  (public.get_project((select id from r4 where label = 'project'))->>'after_overhead')::boolean,
  false,
  'the project flag wins over the company default'
);

select lives_ok(
  format(
    'select public.set_supplier_settings(%L::uuid, true)',
    (select id from public.suppliers where name = 'ספק חדש')
  ),
  'the owner marks the supplier exempt'
);
select is(
  (select amount_net from public.transactions where idempotency_key = 'r4:exp'),
  -23600::bigint,
  'an exemption recomputes the net to the gross'
);

select tests.authenticate_as('r4_b');
select lives_ok($$select public.create_company('שכן', true)$$, 'the other owner has a company');
select throws_ok(
  format(
    'select public.save_split(%L::uuid, ''[]''::jsonb)',
    (select id from public.transactions where idempotency_key = 'r4:exp')
  ),
  'P0001',
  'transaction not found',
  'another owner cannot split the row'
);
select throws_ok(
  format(
    'select public.resolve_review(%L::uuid, ''skipped'', null, null)',
    (select id from r4 where label = 'queue')
  ),
  'P0001',
  'review item not found',
  'another owner cannot resolve the item'
);
select throws_ok(
  format(
    'select public.set_supplier_settings(%L::uuid, false)',
    (select id from public.suppliers where name = 'ספק חדש')
  ),
  'P0001',
  'supplier not found',
  'another owner cannot change the supplier'
);
select throws_ok(
  format(
    'select public.map_budget_section(1, %L::uuid, null)',
    (select id from r4 where label = 'project')
  ),
  'P0001',
  'project not found',
  'another owner cannot map the project'
);
select throws_ok(
  format(
    'select public.merge_category(%L::uuid, %L::uuid)',
    (select id from r4 where label = 'materials'),
    (select id from r4 where label = 'income_cat')
  ),
  'P0001',
  'category not found',
  'another owner cannot merge the categories'
);
select throws_ok(
  format(
    'select public.set_category_hidden(%L::uuid, true)',
    (select id from r4 where label = 'materials')
  ),
  'P0001',
  'category not found',
  'another owner cannot hide the category'
);
select throws_ok(
  format(
    'select public.delete_transaction(%L::uuid)',
    (select id from public.transactions where idempotency_key = 'r4:exp')
  ),
  'P0001',
  'only a manual entry can be deleted',
  'another owner cannot delete the row'
);
select throws_ok(
  format(
    'select public.set_after_overhead(true, %L::uuid)',
    (select id from r4 where label = 'project')
  ),
  'P0001',
  'project not found',
  'another owner cannot change the overhead view'
);

select tests.authenticate_as('r4_a');
select throws_ok(
  format(
    $$insert into public.categories (company_id, name, kind, sort_order) values (%L::uuid, 'ישיר', 'expense', 9)$$,
    (select id from r4 where label = 'company')
  ),
  '42501',
  null,
  'authenticated cannot insert a category'
);

reset role;
insert into public.sumit_connections (
  company_id, sumit_company_id,
  key_ciphertext, key_nonce, dek_ciphertext, dek_nonce, kek_version, envelope_version
)
select id, 1, '\x01'::bytea, '\x0201'::bytea, '\x03'::bytea, '\x0401'::bytea, '1', '2'
from r4 where label = 'company';

do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;

select public.upsert_sumit_documents((select id from r4 where label = 'company'), '[]'::jsonb);

select is(
  (select count(*)::int from public.transactions
    where company_id = (select id from r4 where label = 'company') and removed_at is null),
  4,
  'an empty payload does not remove documents'
);
select is(
  (select last_error from public.sumit_connections where company_id = (select id from r4 where label = 'company')),
  'sync_sweep_empty',
  'an empty payload records last_error'
);

select public.upsert_sumit_documents(
  (select id from r4 where label = 'company'),
  jsonb_build_array(
    jsonb_build_object(
      'idempotency_key', 'r4:income',
      'external_id', 'income',
      'direction', 'income',
      'doc_kind', 'invoice',
      'amount_gross', '11800',
      'amount_net', '10000',
      'vat_amount', '1800',
      'vat_status', 'source',
      'doc_date', '2026-05-01',
      'description', 'חשבונית הכנסה'
    )
  )
);

select is(
  (select count(*)::int from public.transactions
    where company_id = (select id from r4 where label = 'company') and removed_at is null),
  4,
  'a payload that would remove most of the ledger is not applied'
);
select is(
  (select last_error from public.sumit_connections where company_id = (select id from r4 where label = 'company')),
  'sync_sweep_suspicious',
  'a suspicious payload records last_error'
);

-- The job exists only when Vault holds cron_secret and flow_sync_url.
reset role;
select lives_ok(
  $$do $chk$
    declare
      secret text;
      sync_url text;
    begin
      if to_regclass('cron.job') is null then
        if exists (select 1 from pg_extension where extname = 'pg_cron')
           and exists (select 1 from pg_extension where extname = 'pg_net')
        then
          raise exception 'cron.job is missing while pg_cron is installed';
        end if;
        return;
      end if;
      select s.decrypted_secret into secret
      from vault.decrypted_secrets s
      where s.name = 'cron_secret'
      limit 1;
      select s.decrypted_secret into sync_url
      from vault.decrypted_secrets s
      where s.name = 'flow_sync_url'
      limit 1;
      if coalesce(secret, '') = '' or coalesce(sync_url, '') = '' then
        if exists (select 1 from cron.job where jobname = 'flow-sumit-drain') then
          raise exception 'drain is scheduled without cron_secret and flow_sync_url';
        end if;
        return;
      end if;
      if not exists (select 1 from cron.job where jobname = 'flow-sumit-drain') then
        raise exception 'drain is not scheduled';
      end if;
    end
    $chk$;$$,
  'the drain is scheduled only when cron_secret and flow_sync_url are set'
);

select * from finish();
rollback;
