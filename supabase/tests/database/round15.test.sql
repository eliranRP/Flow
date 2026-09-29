-- A remembered supplier rule is not a guess.
-- A rule-assigned row stays put, a real guess flips and writes an audit row,
-- and an undone rule row stays put. A rule row already flipped is put back.

begin;

select plan(11);

do $users$
begin
  perform tests.create_supabase_user('r15_a', 'r15-a@test.flow');
end
$users$;

select tests.authenticate_as('r15_a');
select lives_ok($$select public.create_company('סבב 15', true)$$, 'owner creates a company');

create temp table r15 (label text primary key, id uuid);
grant all on r15 to authenticated, service_role;
insert into r15 (label, id) select 'company', id from public.companies;
select lives_ok($$select public.upsert_project(null, 'אלפא', null, 'active')$$, 'owner opens אלפא');
insert into r15 (label, id) select 'alpha', id from public.projects where name = 'אלפא';
insert into r15 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into r15 (label, id)
select 'haul', id from public.categories where name = 'הובלה' and kind = 'expense';

reset role;

insert into public.suppliers (company_id, name, remembered_category_id)
select c.id, 'צבעי הגליל בע״מ', m.id
from r15 c
join r15 m on m.label = 'materials'
where c.label = 'company';

insert into r15 (label, id)
select 'paint', id from public.suppliers where name = 'צבעי הגליל בע״מ';

insert into public.suppliers (company_id, name, remembered_category_id)
select c.id, 'הובלות הגליל בע״מ', h.id
from r15 c
join r15 h on h.label = 'haul'
where c.label = 'company';

insert into r15 (label, id)
select 'haul-supplier', id from public.suppliers where name = 'הובלות הגליל בע״מ';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, supplier_id, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project',
  -100, -100, 0, 'unknown',
  '2026-08-01', 'manual', 'r15:rule-review', p.id, s.id, m.id, true, 'כלל ספק'
from r15 c
join r15 p on p.label = 'alpha'
join r15 s on s.label = 'paint'
join r15 m on m.label = 'materials'
where c.label = 'company';

update public.transactions
set user_assigned = false, category_suggested = false
where idempotency_key = 'r15:rule-review';

insert into public.review_queue (
  company_id, transaction_id, status, reason, prior_category_id, prior_user_assigned, prior_category_suggested
)
select t.company_id, t.id, 'open', 'suggested', t.category_id, false, null
from public.transactions t
where t.idempotency_key = 'r15:rule-review';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project',
  -110, -110, 0, 'unknown',
  '2026-08-02', 'manual', 'r15:guess', p.id, m.id, true, 'ניחוש'
from r15 c
join r15 p on p.label = 'alpha'
join r15 m on m.label = 'materials'
where c.label = 'company';

update public.transactions
set user_assigned = false, category_suggested = false
where idempotency_key = 'r15:guess';

insert into public.reassign_undo (
  company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
  prior_user_assigned, prior_category_suggested, prior_allocations, undone_at
)
select t.company_id, t.id, t.project_id, t.category_id, 'project',
  false, null, '[]'::jsonb, now()
from public.transactions t
where t.idempotency_key = 'r15:guess';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, supplier_id, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project',
  -120, -120, 0, 'unknown',
  '2026-08-03', 'manual', 'r15:undone-rule', p.id, s.id, h.id, true, 'כלל שבוטל'
from r15 c
join r15 p on p.label = 'alpha'
join r15 s on s.label = 'haul-supplier'
join r15 h on h.label = 'haul'
where c.label = 'company';

update public.transactions
set user_assigned = false, category_suggested = false
where idempotency_key = 'r15:undone-rule';

insert into public.reassign_undo (
  company_id, transaction_id, prior_project_id, prior_category_id, prior_pnl_role,
  prior_user_assigned, prior_category_suggested, prior_allocations, undone_at
)
select t.company_id, t.id, t.project_id, t.category_id, 'project',
  false, null, '[]'::jsonb, now()
from public.transactions t
where t.idempotency_key = 'r15:undone-rule';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, supplier_id, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project',
  -130, -130, 0, 'unknown',
  '2026-08-04', 'manual', 'r15:preflipped', p.id, s.id, m.id, true, 'כבר סומן'
from r15 c
join r15 p on p.label = 'alpha'
join r15 s on s.label = 'paint'
join r15 m on m.label = 'materials'
where c.label = 'company';

update public.transactions
set user_assigned = false, category_suggested = true
where idempotency_key = 'r15:preflipped';

select private.restore_undone_suggestions();

select is(
  (select category_suggested from public.transactions where idempotency_key = 'r15:rule-review'),
  false,
  'a rule-assigned row is untouched'
);

select is(
  (
    select q.prior_category_suggested
    from public.review_queue q
    join public.transactions t on t.id = q.transaction_id
    where t.idempotency_key = 'r15:rule-review'
  ),
  null,
  'a suggested review of a rule does not store the prior as a guess'
);

select is(
  (select category_suggested from public.transactions where idempotency_key = 'r15:guess'),
  true,
  'a real guess flips'
);

select is(
  (
    select count(*)
    from public.audit_log a
    join public.transactions t on t.id = a.entity_id
    where t.idempotency_key = 'r15:guess'
      and a.entity = 'transactions'
      and a.meta->>'backfill' = 'restore_suggested'
  ),
  1::bigint,
  'a real guess writes one audit row'
);

select is(
  (select category_suggested from public.transactions where idempotency_key = 'r15:undone-rule'),
  false,
  'an undone rule row is untouched'
);

select is(
  (
    select u.prior_category_suggested
    from public.reassign_undo u
    join public.transactions t on t.id = u.transaction_id
    where t.idempotency_key = 'r15:undone-rule'
  ),
  null,
  'an undone rule does not store the prior as a guess'
);

select is(
  (select category_suggested from public.transactions where idempotency_key = 'r15:preflipped'),
  false,
  'a rule row already flipped is put back'
);

select is(
  (
    select count(*)
    from public.audit_log a
    join public.transactions t on t.id = a.entity_id
    where t.idempotency_key = 'r15:preflipped'
      and a.meta->>'backfill' = 'restore_rule'
  ),
  1::bigint,
  'putting a rule row back writes an audit row'
);

select private.restore_undone_suggestions();

select is(
  (
    select count(*)
    from public.audit_log a
    join public.transactions t on t.id = a.entity_id
    where t.idempotency_key = 'r15:guess'
      and a.meta->>'backfill' = 'restore_suggested'
  ),
  1::bigint,
  'a second run does not write another audit row'
);

select * from finish();
rollback;
