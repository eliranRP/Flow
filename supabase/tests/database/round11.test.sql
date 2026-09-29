-- The banner count and list_auto_assigned_today are the same rows.
-- The filed fixture is a project expense with a category, so it would stay
-- filed if sync_review_queue ran.
-- A suggested category stays out of the named breakdown. Its amount is
-- pending_agorot, and the named lines plus that amount equal direct_agorot.

begin;

select plan(15);

do $users$
begin
  perform tests.create_supabase_user('r11_a', 'r11-a@test.flow');
end
$users$;

select tests.authenticate_as('r11_a');
select lives_ok($$select public.create_company('סבב 11', true)$$, 'owner creates a company');

create temp table r11 (label text primary key, id uuid);
grant all on r11 to authenticated, service_role;
insert into r11 (label, id) select 'company', id from public.companies;
select lives_ok($$select public.upsert_project(null, 'אלפא', null, 'active')$$, 'owner opens אלפא');
insert into r11 (label, id) select 'alpha', id from public.projects where name = 'אלפא';
select lives_ok($$select public.upsert_project(null, 'ביתא', null, 'active')$$, 'owner opens ביתא');
insert into r11 (label, id) select 'beta', id from public.projects where name = 'ביתא';
insert into r11 (label, id)
select 'materials', id from public.categories where name = 'חומרים' and kind = 'expense';
insert into r11 (label, id)
select 'haul', id from public.categories where name = 'הובלה' and kind = 'expense';

reset role;

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, user_assigned, description
)
select c.id, 'expense', 'expense', 'project',
  -3000, -3000, 0, 'unknown',
  '2026-09-02', 'manual', 'r11:confirmed', p.id, h.id, true, 'הובלה מאושרת'
from r11 c
join r11 p on p.label = 'alpha'
join r11 h on h.label = 'haul'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, description
)
select c.id, 'expense', 'expense', 'project',
  -5000, -5000, 0, 'unknown',
  '2026-09-03', 'manual', 'r11:suggested', p.id, 'חומר מוצע'
from r11 c
join r11 p on p.label = 'alpha'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description
)
select c.id, 'expense', 'expense', 'project',
  -1000, -1000, 0, 'unknown',
  '2026-09-29', 'sumit', 'r11:filed', p.id, h.id, 'שויך היום'
from r11 c
join r11 p on p.label = 'beta'
join r11 h on h.label = 'materials'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, project_id, category_id, description
)
select c.id, 'expense', 'expense', 'project',
  -2000, -2000, 0, 'unknown',
  '2026-09-29', 'sumit', 'r11:queued', p.id, h.id, 'בתור'
from r11 c
join r11 p on p.label = 'beta'
join r11 h on h.label = 'haul'
where c.label = 'company';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'suggested'
from public.transactions t
where t.idempotency_key = 'r11:queued';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, category_id, created_at, description
)
select c.id, 'expense', 'expense', 'shared',
  -400, -400, 0, 'unknown',
  '2026-09-27', 'sumit', 'r11:old', h.id, now() - interval '2 days', 'מאתמול'
from r11 c
join r11 h on h.label = 'materials'
where c.label = 'company';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, category_id, description
)
select c.id, 'expense', 'expense', 'shared',
  -700, -700, 0, 'unknown',
  '2026-09-29', 'manual', 'r11:manual', h.id, 'ידני'
from r11 c
join r11 h on h.label = 'materials'
where c.label = 'company';

select tests.authenticate_as('r11_a');

select is(
  (select jsonb_array_length(public.list_auto_assigned_today())),
  (select (public.list_review() -> 0 ->> 'auto_approved_today')::int),
  'the filed list has the same rows the banner counts'
);
select is(
  (select jsonb_array_length(public.list_auto_assigned_today())),
  1,
  'only today''s categorised SUMIT row with no open review is listed'
);
select is(
  (select public.list_auto_assigned_today() -> 0 ->> 'description'),
  'שויך היום',
  'the listed row is the one filed today'
);
select is(
  (select public.list_auto_assigned_today() -> 0 ->> 'project_name'),
  'ביתא',
  'the filed row is a project expense, not an unallocated shared cost'
);
select ok(
  not exists (
    select 1
    from jsonb_array_elements(public.list_auto_assigned_today()) row
    where row->>'description' = 'בתור'
  ),
  'an open review row stays out of the filed list'
);

select is(
  ((public.get_project((select id from r11 where label = 'alpha')) ->> 'direct_agorot')::bigint),
  8000::bigint,
  'a suggested expense still counts in the project total'
);
select is(
  jsonb_array_length(public.get_project((select id from r11 where label = 'alpha')) -> 'categories'),
  1,
  'a suggested category stays out of the breakdown'
);
select is(
  public.get_project((select id from r11 where label = 'alpha')) -> 'categories' -> 0 ->> 'name',
  'הובלה',
  'the breakdown names the confirmed category'
);
select is(
  ((public.get_project((select id from r11 where label = 'alpha')) -> 'categories' -> 0 ->> 'amount_agorot')::bigint),
  3000::bigint,
  'the confirmed category keeps its own amount'
);
select is(
  ((public.get_project((select id from r11 where label = 'alpha')) ->> 'pending_count')::int),
  1,
  'the suggested expense is waiting for approval'
);
select is(
  ((public.get_project((select id from r11 where label = 'alpha')) ->> 'pending_agorot')::bigint),
  5000::bigint,
  'the waiting line carries the suggested amount'
);
select is(
  (
    select coalesce(sum((row ->> 'amount_agorot')::bigint), 0)::bigint
    from jsonb_array_elements(
      public.get_project((select id from r11 where label = 'alpha')) -> 'categories'
    ) row
  ) + ((public.get_project((select id from r11 where label = 'alpha')) ->> 'pending_agorot')::bigint),
  ((public.get_project((select id from r11 where label = 'alpha')) ->> 'direct_agorot')::bigint),
  'named categories plus waiting costs equal the project expenses'
);

select * from finish();
rollback;
