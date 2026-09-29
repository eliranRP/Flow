-- Category drill-down rows add up to the category line.
-- The waiting count and project_waiting are the same rows.
-- The backfill covers an undone guess with no review, a reopened
-- missing-project approval, and a pending undo. Audit meta does not.

begin;

select plan(25);

do $users$
begin
  perform tests.create_supabase_user('r14_a', 'r14-a@test.flow');
  perform tests.create_supabase_user('r14_b', 'r14-b@test.flow');
end
$users$;

select tests.authenticate_as('r14_a');
select lives_ok($$select public.create_company('סבב 14', true)$$, 'owner creates a company');

create temp table r14 (label text primary key, id uuid);
grant all on r14 to authenticated, service_role;
insert into r14 (label, id) select 'company', id from public.companies;
select lives_ok($$select public.upsert_project(null, 'אלפא', null, 'active')$$, 'owner opens אלפא');
insert into r14 (label, id) select 'alpha', id from public.projects where name = 'אלפא';
select lives_ok($$select public.upsert_project(null, 'ביתא', null, 'active')$$, 'owner opens ביתא');
insert into r14 (label, id) select 'beta', id from public.projects where name = 'ביתא';
insert into r14 (label, id)
select 'haul', id from public.categories where name = 'הובלה' and kind = 'expense';
insert into r14 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project',
  -3000, -3000, 0, 'unknown',
  '2026-09-02', 'manual', 'r14:haul', p.id, h.id, true, 'הובלה מאושרת'
from r14 c
join r14 p on p.label = 'alpha'
join r14 h on h.label = 'haul'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select c.id, 'expense', 'expense', 'project',
  -5000, -5000, 0, 'unknown',
  '2026-09-03', 'manual', 'r14:guess', p.id, 'חומר מוצע'
from r14 c
join r14 p on p.label = 'alpha'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project',
  -2000, -2000, 0, 'unknown',
  '2026-09-04', 'manual', 'r14:queued', p.id, h.id, true, 'בתור'
from r14 c
join r14 p on p.label = 'alpha'
join r14 h on h.label = 'haul'
where c.label = 'company';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'missing_category'
from public.transactions t
where t.idempotency_key = 'r14:queued';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'shared',
  -10000, -10000, 0, 'unknown',
  '2026-09-05', 'manual', 'r14:shared', h.id, true, 'הובלה משותפת'
from r14 c
join r14 h on h.label = 'haul'
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, p.id, 4000, -4000
from public.transactions t
join r14 p on p.label = 'alpha'
where t.idempotency_key = 'r14:shared';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, p.id, 6000, -6000
from public.transactions t
join r14 p on p.label = 'beta'
where t.idempotency_key = 'r14:shared';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, user_assigned, description
)
select c.id, 'income', 'invoice', null,
  8000, 8000, 0, 'unknown',
  '2026-09-06', 'manual', 'r14:income', p.id, h.id, true, 'תקבול'
from r14 c
join r14 p on p.label = 'alpha'
join r14 h on h.label = 'haul'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description
)
select c.id, 'expense', 'expense', 'shared',
  -900, -900, 0, 'unknown',
  '2026-09-07', 'manual', 'r14:guess-shared', 'ניחוש משותף'
from r14 c
where c.label = 'company';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, p.id, 10000, t.amount_net
from public.transactions t
join r14 p on p.label = 'alpha'
where t.idempotency_key = 'r14:guess-shared';

select tests.authenticate_as('r14_a');

select is(
  (
    select (row->>'amount_agorot')::bigint
    from jsonb_array_elements(public.get_project((select id from r14 where label = 'alpha')) -> 'categories') row
    where row->>'name' = 'הובלה'
  ),
  7000::bigint,
  'the haul line is the confirmed expense plus this project''s share'
);

select is(
  (public.list_project_category(
    (select id from r14 where label = 'alpha'),
    (select id from r14 where label = 'haul')
  ) ->> 'total_agorot')::bigint,
  7000::bigint,
  'the drill-down total is the haul line'
);

select is(
  (
    select coalesce(sum(-(row->>'amount_net')::bigint), 0)::bigint
    from jsonb_array_elements(
      public.list_project_category(
        (select id from r14 where label = 'alpha'),
        (select id from r14 where label = 'haul'),
        0,
        40
      ) -> 'rows'
    ) row
  ),
  (
    select (row->>'amount_agorot')::bigint
    from jsonb_array_elements(public.get_project((select id from r14 where label = 'alpha')) -> 'categories') row
    where row->>'name' = 'הובלה'
  ),
  'the listed rows add up to the category line'
);

select ok(
  not exists (
    select 1
    from jsonb_array_elements(
      public.list_project_category(
        (select id from r14 where label = 'alpha'),
        (select id from r14 where label = 'haul')
      ) -> 'rows'
    ) row
    where row->>'description' in ('חומר מוצע', 'בתור', 'תקבול', 'ניחוש משותף')
  ),
  'a guess, a queued row, income, and an unconfirmed share stay off the line'
);

select is(
  jsonb_array_length(
    public.list_project_category(
      (select id from r14 where label = 'alpha'),
      (select id from r14 where label = 'haul'),
      0,
      1
    ) -> 'rows'
  ),
  1,
  'the first page returns one row'
);

select is(
  (public.list_project_category(
    (select id from r14 where label = 'alpha'),
    (select id from r14 where label = 'haul'),
    0,
    1
  ) ->> 'next_offset')::int,
  1,
  'a short page says where the next page starts'
);

select is(
  (public.list_project_category(
    (select id from r14 where label = 'alpha'),
    (select id from r14 where label = 'haul'),
    1,
    1
  ) ->> 'next_offset'),
  null,
  'the last page has no further offset'
);

select is(
  (
    select coalesce(sum(-(row->>'amount_net')::bigint), 0)::bigint
    from (
      select jsonb_array_elements(
        public.list_project_category(
          (select id from r14 where label = 'alpha'),
          (select id from r14 where label = 'haul'),
          0, 1
        ) -> 'rows'
      ) as row
      union all
      select jsonb_array_elements(
        public.list_project_category(
          (select id from r14 where label = 'alpha'),
          (select id from r14 where label = 'haul'),
          1, 1
        ) -> 'rows'
      )
    ) pages
  ),
  7000::bigint,
  'the pages together add up to the line'
);

select is(
  ((public.get_project((select id from r14 where label = 'alpha')) ->> 'pending_count')::int),
  jsonb_array_length(public.project_waiting((select id from r14 where label = 'alpha'))),
  'the waiting count is the waiting query'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(public.project_waiting((select id from r14 where label = 'alpha'))) row
    where row->>'description' = 'חומר מוצע' and row->>'review_id' is null
  ),
  'a suggestion with no review is in the waiting query'
);

select ok(
  exists (
    select 1
    from jsonb_array_elements(public.project_waiting((select id from r14 where label = 'alpha'))) row
    where row->>'description' = 'בתור' and row->>'review_id' is not null
  ),
  'an open review for this project is in the waiting query'
);

select is(
  jsonb_array_length(public.project_waiting((select id from r14 where label = 'beta'))),
  0,
  'another project does not see these rows'
);

select is(
  (
    select coalesce(sum((row->>'amount_agorot')::bigint), 0)::bigint
    from jsonb_array_elements(public.get_project((select id from r14 where label = 'alpha')) -> 'categories') row
  ) + ((public.get_project((select id from r14 where label = 'alpha')) ->> 'pending_agorot')::bigint),
  ((public.get_project((select id from r14 where label = 'alpha')) ->> 'direct_agorot')::bigint) + 4000,
  'named lines plus waiting equal direct expenses plus the confirmed share'
);

-- Backfill. These rows are the three cases the first backfill missed.
-- The audit row is the case it must not use.

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project',
  -100, -100, 0, 'unknown',
  '2026-08-01', 'manual', 'r14:no-review', p.id, h.id, true, 'בלי תור'
from r14 c
join r14 p on p.label = 'alpha'
join r14 h on h.label = 'materials'
where c.label = 'company';

update public.transactions
set user_assigned = false, category_suggested = false
where idempotency_key = 'r14:no-review';

insert into public.reassign_undo (
  company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
  prior_user_assigned, prior_category_suggested, prior_allocations, undone_at
)
select t.company_id, t.id, t.project_id, t.category_id, 'project',
  false, null, '[]'::jsonb, now()
from public.transactions t
where t.idempotency_key = 'r14:no-review';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project',
  -110, -110, 0, 'unknown',
  '2026-08-02', 'manual', 'r14:reopened', h.id, true, 'נפתח מחדש'
from r14 c
join r14 h on h.label = 'materials'
where c.label = 'company';

update public.transactions
set user_assigned = false, category_suggested = false, project_id = null
where idempotency_key = 'r14:reopened';

insert into public.review_queue (
  company_id, transaction_id, status, reason,
  prior_category_id, prior_user_assigned, prior_category_suggested
)
select t.company_id, t.id, 'open', 'missing_project',
  t.category_id, false, null
from public.transactions t
where t.idempotency_key = 'r14:reopened';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project',
  -120, -120, 0, 'unknown',
  '2026-08-03', 'manual', 'r14:pending-undo', p.id, h.id, true, 'ביטול ממתין'
from r14 c
join r14 p on p.label = 'alpha'
join r14 h on h.label = 'haul'
where c.label = 'company';

insert into public.reassign_undo (
  company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
  prior_user_assigned, prior_category_suggested, prior_allocations
)
select t.company_id, t.id, t.project_id, (select id from r14 where label = 'materials'), 'project',
  false, null, '[]'::jsonb
from public.transactions t
where t.idempotency_key = 'r14:pending-undo';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project',
  -130, -130, 0, 'unknown',
  '2026-08-04', 'manual', 'r14:audit-only', p.id, h.id, true, 'רק יומן'
from r14 c
join r14 p on p.label = 'alpha'
join r14 h on h.label = 'materials'
where c.label = 'company';

update public.transactions
set user_assigned = false, category_suggested = false
where idempotency_key = 'r14:audit-only';

insert into public.audit_log (company_id, actor_id, action, entity, entity_id, meta)
select t.company_id, u.id, 'update', 'transactions', t.id,
  jsonb_build_object('category_suggested', true, 'category_id', t.category_id)
from public.transactions t
join auth.users u on u.email = 'r14-a@test.flow'
where t.idempotency_key = 'r14:audit-only';

select private.restore_undone_suggestions();

select is(
  (select category_suggested from public.transactions where idempotency_key = 'r14:no-review'),
  true,
  'an undone guess with no review is suggested again'
);

select is(
  (select category_suggested from public.transactions where idempotency_key = 'r14:reopened'),
  true,
  'a reopened missing-project approval is suggested again'
);

select is(
  (
    select prior_category_suggested
    from public.reassign_undo u
    join public.transactions t on t.id = u.transaction_id
    where t.idempotency_key = 'r14:pending-undo'
  ),
  true,
  'a pending undo stores the suggestion so a later undo can restore it'
);

select is(
  (select category_suggested from public.transactions where idempotency_key = 'r14:pending-undo'),
  false,
  'a pending undo does not change the category the owner just saved'
);

select is(
  (select category_suggested from public.transactions where idempotency_key = 'r14:audit-only'),
  false,
  'audit meta alone does not flip a row'
);

select private.restore_undone_suggestions();

select is(
  (select count(*) from public.transactions where idempotency_key like 'r14:%' and category_suggested),
  4::bigint,
  'a second run does not flag any further row'
);

select tests.authenticate_as('r14_b');
select lives_ok($$select public.create_company('סבב 14 ב', true)$$, 'the other owner creates a company');

select is(
  public.list_project_category(
    (select id from r14 where label = 'alpha'),
    (select id from r14 where label = 'haul')
  ),
  null,
  'another owner cannot read the drill-down'
);

select is(
  public.project_waiting((select id from r14 where label = 'alpha')),
  '[]'::jsonb,
  'another owner cannot read the waiting rows'
);

select * from finish();
rollback;
