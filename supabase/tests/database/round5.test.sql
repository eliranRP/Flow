-- Round 5: reassignment, categories, overhead income share, undo of a supplier rule.

begin;

select plan(38);

do $users$
begin
  perform tests.create_supabase_user('r5_a', 'r5-a@test.flow');
  perform tests.create_supabase_user('r5_b', 'r5-b@test.flow');
end
$users$;

select tests.authenticate_as('r5_a');
select lives_ok($$select public.create_company('סבב 5', true)$$, 'owner creates a company');

create temp table r5 (label text primary key, id uuid);
grant all on r5 to authenticated, service_role;
insert into r5 (label, id) select 'company', id from public.companies;
select lives_ok($$select public.upsert_project(null, 'אלפא', null, 'active')$$, 'owner opens אלפא');
insert into r5 (label, id) select 'alpha', id from public.projects where name = 'אלפא';
select lives_ok($$select public.upsert_project(null, 'ביתא', null, 'active')$$, 'owner opens ביתא');
insert into r5 (label, id) select 'beta', id from public.projects where name = 'ביתא';
insert into r5 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into r5 (label, id)
select 'income_cat', id from public.categories where name = 'תקבול מלקוח' and kind = 'income';
insert into r5 (label, id)
select 'gear', id from public.categories where name = 'ציוד והשכרה' and kind = 'expense';

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select id, 'income', 'invoice', null, 20000000, 20000000, 0, 'unknown',
  '2026-09-01', 'manual', 'r5:in-a', (select id from r5 where label = 'alpha'), 'הכנסת אלפא'
from r5 where label = 'company';
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select id, 'income', 'invoice', null, 10000000, 10000000, 0, 'unknown',
  '2026-09-01', 'manual', 'r5:in-b', (select id from r5 where label = 'beta'), 'הכנסת ביתא'
from r5 where label = 'company';
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select id, 'expense', 'expense', 'project', -10000000, -10000000, 0, 'unknown',
  '2026-09-02', 'manual', 'r5:ex-a', (select id from r5 where label = 'alpha'), 'הוצאת אלפא'
from r5 where label = 'company';
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'overhead', -6000000, -6000000, 0, 'unknown',
  '2026-09-03', 'manual', 'r5:oh', 'כלליות'
from r5 where label = 'company';

select tests.authenticate_as('r5_a');
select is(
  (public.get_project((select id from r5 where label = 'alpha'))->>'overhead_weighted')::boolean,
  true,
  'overhead can be shared once projects have income'
);
select is(
  (public.get_project((select id from r5 where label = 'alpha'))->>'overhead_share_agorot')::bigint,
  4000000::bigint,
  'אלפא takes two thirds of the overhead cost'
);
select is(
  (public.get_project((select id from r5 where label = 'alpha'))->>'profit_after_overhead_agorot')::bigint,
  6000000::bigint,
  'profit after overhead is profit minus the share'
);
select is(
  (public.get_project((select id from r5 where label = 'beta'))->>'overhead_share_agorot')::bigint,
  2000000::bigint,
  'ביתא takes the remaining third'
);

reset role;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select id, 'expense', 'expense', 'overhead', -15000, -15000, 0, 'unknown',
  '2026-09-04', 'manual', 'r5:odd', 'עיגול'
from r5 where label = 'company';

select tests.authenticate_as('r5_a');
select is(
  (public.get_project((select id from r5 where label = 'alpha'))->>'overhead_share_agorot')::bigint
  + (public.get_project((select id from r5 where label = 'beta'))->>'overhead_share_agorot')::bigint,
  6015000::bigint,
  'rounded shares plus the remainder equal the overhead cost'
);

reset role;
update public.transactions
set removed_at = now()
where idempotency_key in ('r5:in-a', 'r5:in-b');

select tests.authenticate_as('r5_a');
select is(
  (public.get_project((select id from r5 where label = 'alpha'))->>'overhead_weighted')::boolean,
  false,
  'no project income means the share is not available'
);
select is(
  public.get_project((select id from r5 where label = 'alpha'))->>'overhead_share_agorot',
  null,
  'an unavailable share is null rather than a fake zero'
);

reset role;
update public.transactions set removed_at = null where idempotency_key in ('r5:in-a', 'r5:in-b');

do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

select public.upsert_sumit_documents(
  (select id from r5 where label = 'company'),
  jsonb_build_array(jsonb_build_object(
    'idempotency_key', 'r5:sync',
    'external_id', 'sync-exp',
    'direction', 'expense',
    'doc_kind', 'expense',
    'pnl_role', 'project',
    'amount_gross', '-11800',
    'amount_net', '-10000',
    'vat_amount', '-1800',
    'vat_status', 'source',
    'doc_date', '2026-09-05',
    'description', 'חשבונית לסנכרון',
    'party_name', 'ספק',
    'party_kind', 'supplier'
  ))
);

insert into r5 (label, id)
select 'sync', id from public.transactions where idempotency_key = 'r5:sync';
insert into r5 (label, id)
select 'review', id from public.review_queue where transaction_id = (select id from r5 where label = 'sync') and status = 'open';

select tests.authenticate_as('r5_a');
select throws_ok(
  format(
    'select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from r5 where label = 'sync'),
    (select id from r5 where label = 'alpha'),
    (select id from r5 where label = 'income_cat')
  ),
  'P0001',
  'category kind must match the direction',
  'an income category cannot label an expense'
);

select lives_ok(
  format(
    'select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from r5 where label = 'sync'),
    (select id from r5 where label = 'beta'),
    (select id from r5 where label = 'materials')
  ),
  'the owner reassigns the expense'
);

select is(
  (select user_assigned from public.transactions where id = (select id from r5 where label = 'sync')),
  true,
  'reassignment marks the row so sync keeps it'
);
select is(
  (select project_id from public.transactions where id = (select id from r5 where label = 'sync')),
  (select id from r5 where label = 'beta'),
  'the books now point at ביתא'
);
select is(
  (select status from public.review_queue where id = (select id from r5 where label = 'review')),
  'changed'::public.review_status,
  'saving from the transaction closes the open review item'
);

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$$;

select public.upsert_sumit_documents(
  (select id from r5 where label = 'company'),
  jsonb_build_array(jsonb_build_object(
    'idempotency_key', 'r5:sync',
    'external_id', 'sync-exp',
    'direction', 'expense',
    'doc_kind', 'expense',
    'pnl_role', 'project',
    'amount_gross', '-11800',
    'amount_net', '-10000',
    'vat_amount', '-1800',
    'vat_status', 'source',
    'doc_date', '2026-09-05',
    'description', 'חשבונית לסנכרון',
    'party_name', 'ספק',
    'party_kind', 'supplier'
  ))
);
select public.upsert_sumit_documents(
  (select id from r5 where label = 'company'),
  jsonb_build_array(jsonb_build_object(
    'idempotency_key', 'r5:sync',
    'external_id', 'sync-exp',
    'direction', 'expense',
    'doc_kind', 'expense',
    'pnl_role', 'project',
    'amount_gross', '-11800',
    'amount_net', '-10000',
    'vat_amount', '-1800',
    'vat_status', 'source',
    'doc_date', '2026-09-05',
    'description', 'חשבונית לסנכרון',
    'party_name', 'ספק',
    'party_kind', 'supplier'
  ))
);

select is(
  (select project_id from public.transactions where id = (select id from r5 where label = 'sync')),
  (select id from r5 where label = 'beta'),
  'two re-syncs leave the owner assignment in place'
);

select tests.authenticate_as('r5_b');
select lives_ok($$select public.create_company('סבב 5 ב', true)$$, 'the other owner creates a company');
select throws_ok(
  format(
    'select public.reassign_transaction(%L::uuid, %L::uuid, %L::uuid)',
    (select id from r5 where label = 'sync'),
    (select id from r5 where label = 'beta'),
    (select id from r5 where label = 'materials')
  ),
  'P0001',
  'transaction not found',
  'another owner cannot reassign the row'
);

reset role;
insert into r5 (label, id)
select 'undo', id from public.reassign_undo
where transaction_id = (select id from r5 where label = 'sync') and undone_at is null;
select tests.authenticate_as('r5_a');
select lives_ok(
  format('select public.undo_reassign(%L::uuid)', (select id from r5 where label = 'undo')),
  'undo restores the assignment'
);
select is(
  (select project_id from public.transactions where id = (select id from r5 where label = 'sync')),
  null,
  'undo clears the project that reassignment wrote'
);
select is(
  (select user_assigned from public.transactions where id = (select id from r5 where label = 'sync')),
  false,
  'undo restores the assigned flag'
);
select is(
  (select status from public.review_queue where id = (select id from r5 where label = 'review')),
  'open'::public.review_status,
  'undo reopens the review item'
);

select lives_ok(
  $$select public.create_category('נגרות', 'expense')$$,
  'the owner creates a category'
);
select is(
  (select count(*)::int from public.categories where name = 'נגרות' and kind = 'expense'),
  1,
  'the new category is in this company'
);
select throws_ok(
  $$select public.create_category('נגרות', 'expense')$$,
  'P0001',
  'category already exists',
  'the same name and kind cannot be created twice'
);

select tests.authenticate_as('r5_b');
select is(
  (select count(*)::int from public.categories where name = 'נגרות'),
  0,
  'the other company does not see the new category'
);

reset role;
insert into public.suppliers (company_id, name)
select id, 'ספק לזכירה' from r5 where label = 'company';
insert into r5 (label, id) select 'supplier', id from public.suppliers where name = 'ספק לזכירה';
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, supplier_id, description
)
select id, 'expense', 'expense', 'project', -100, -100, 0, 'unknown',
  '2026-09-06', 'manual', 'r5:remember', (select id from r5 where label = 'supplier'), 'לזכירה'
from r5 where label = 'company';
insert into public.review_queue (company_id, transaction_id, status, reason)
select company_id, id, 'open', 'missing_project'
from public.transactions where idempotency_key = 'r5:remember';
insert into r5 (label, id)
select 'remember_review', id from public.review_queue
where transaction_id = (select id from public.transactions where idempotency_key = 'r5:remember');

select tests.authenticate_as('r5_a');
select lives_ok(
  format(
    'select public.resolve_review(%L::uuid, ''approved'', %L::uuid, %L::uuid, true)',
    (select id from r5 where label = 'remember_review'),
    (select id from r5 where label = 'alpha'),
    (select id from r5 where label = 'materials')
  ),
  'approving remembers the supplier category'
);
reset role;
update public.suppliers
set remembered_category_id = (select id from r5 where label = 'gear')
where id = (select id from r5 where label = 'supplier');
select tests.authenticate_as('r5_a');
select lives_ok(
  format('select public.reopen_review(%L::uuid)', (select id from r5 where label = 'remember_review')),
  'undo runs after the supplier category changed'
);
select is(
  (select remembered_category_id from public.suppliers where id = (select id from r5 where label = 'supplier')),
  (select id from r5 where label = 'gear'),
  'undo leaves a supplier category that changed after the approval'
);

select tests.authenticate_as('r5_a');
select throws_ok(
  format($$insert into public.projects (company_id, name) values (%L::uuid, 'ישיר')$$, (select id from r5 where label = 'company')),
  '42501', null, 'authenticated cannot insert a project'
);
select throws_ok(
  format($$insert into public.customers (company_id, name) values (%L::uuid, 'ישיר')$$, (select id from r5 where label = 'company')),
  '42501', null, 'authenticated cannot insert a customer'
);
select throws_ok(
  format($$insert into public.suppliers (company_id, name) values (%L::uuid, 'ישיר')$$, (select id from r5 where label = 'company')),
  '42501', null, 'authenticated cannot insert a supplier'
);
select throws_ok(
  format(
    $$insert into public.transactions (
      company_id, direction, doc_kind, amount_gross, amount_net, vat_amount, vat_status,
      doc_date, source, idempotency_key, description
    ) values (%L::uuid, 'expense', 'expense', 1, 1, 0, 'unknown', '2026-09-01', 'manual', 'direct', 'ישיר')$$,
    (select id from r5 where label = 'company')
  ),
  '42501', null, 'authenticated cannot insert a transaction'
);
select throws_ok(
  $$insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 10000, 1)$$,
  '42501', null, 'authenticated cannot insert an allocation'
);
select throws_ok(
  format($$insert into public.split_rules (company_id, method, label) values (%L::uuid, 'equal', 'ישיר')$$, (select id from r5 where label = 'company')),
  '42501', null, 'authenticated cannot insert a split rule'
);
select throws_ok(
  $$insert into public.split_rule_targets (company_id, rule_id, project_id, share_bp) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 10000)$$,
  '42501', null, 'authenticated cannot insert a split target'
);
select throws_ok(
  format($$insert into public.review_queue (company_id, status) values (%L::uuid, 'open')$$, (select id from r5 where label = 'company')),
  '42501', null, 'authenticated cannot insert a review row'
);

reset role;
create function pg_temp.check_drain()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  scheduled boolean := false;
  has_secret boolean := false;
  has_url boolean := false;
begin
  if to_regclass('cron.job') is null
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;
  select exists (select 1 from cron.job where jobname = 'flow-sumit-drain') into scheduled;
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $sql$
      select exists (
        select 1 from vault.decrypted_secrets
        where name = 'cron_secret' and btrim(decrypted_secret) <> ''
      )
    $sql$ into has_secret;
    execute $sql$
      select exists (
        select 1 from vault.decrypted_secrets
        where name = 'flow_sync_url' and btrim(decrypted_secret) <> ''
      )
    $sql$ into has_url;
  end if;
  if has_secret and has_url and not scheduled then
    raise exception 'drain job missing';
  end if;
  if scheduled and not (has_secret and has_url) then
    raise exception 'drain job scheduled without cron_secret and flow_sync_url';
  end if;
end;
$$;

select lives_ok($$select pg_temp.check_drain()$$, 'the drain job matches the extensions, cron_secret, and flow_sync_url');

select * from finish();
rollback;
