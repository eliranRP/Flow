-- FLOW-309. Skipped review cards: list_skipped_review lists a line's latest skipped row, and
-- reopen_review on a skipped row reopens it without restoring the skip-time snapshot.
-- Invented data only.

begin;

select plan(8);

do $users$
begin
  perform tests.create_supabase_user('fsk_owner', 'fsk-owner@test.flow');
  perform tests.create_supabase_user('fsk_other', 'fsk-other@test.flow');
end
$users$;

create temp table fsk (label text primary key, id uuid);
grant all on fsk to authenticated, service_role;

select tests.authenticate_as('fsk_owner');
select lives_ok($$select public.create_company('Skip Co', true)$$, 'owner creates a company');
select lives_ok($$select public.upsert_project(null, 'East', null, 'active')$$, 'owner opens East');
select lives_ok($$select public.upsert_project(null, 'West', null, 'active')$$, 'owner opens West');
insert into fsk (label, id) select 'company', id from public.companies where name = 'Skip Co';
insert into fsk (label, id) select lower(name), id from public.projects where name in ('East', 'West');
select tests.authenticate_as('fsk_other');
select public.create_company('Other Skip Co', true);
reset role;
insert into fsk (label, id) select 'other_company', id from public.companies where name = 'Other Skip Co';

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, source, idempotency_key, description, removed_at
)
select (select id from fsk where label = v.co), 'expense', 'expense', 'project',
  v.amount, v.amount, 0, 'unknown', ('2026-06-0' || v.day)::date, 'manual', v.ikey, v.ikey, v.removed
from (values
  ('company', -1000, '1', 'fsk:old', null::timestamptz),
  ('company', -2000, '2', 'fsk:new', null),
  ('company', -3000, '3', 'fsk:back', null),
  ('company', -4000, '4', 'fsk:removed', now()),
  ('other_company', -5000, '5', 'fsk:other', null)
) as v(co, amount, day, ikey, removed);
insert into fsk (label, id) select replace(idempotency_key, 'fsk:', 'txn_'), id
from public.transactions where idempotency_key like 'fsk:%';

-- Skipped rows. fsk:back was skipped, then came back as a newer open row.
insert into public.review_queue (company_id, transaction_id, status, reason, resolved_at, created_at, prior_project_id)
select t.company_id, t.id, v.status::public.review_status, 'missing_project', v.resolved, v.created, v.prior
from public.transactions t
join (values
  ('fsk:old', 'skipped', now() - interval '2 days', now() - interval '3 days', (select id from fsk where label = 'west')),
  ('fsk:new', 'skipped', now() - interval '1 hour', now() - interval '2 hours', null::uuid),
  ('fsk:back', 'skipped', now() - interval '2 days', now() - interval '3 days', null),
  ('fsk:back', 'open', null, now() - interval '1 day', null),
  ('fsk:removed', 'skipped', now() - interval '1 hour', now() - interval '2 hours', null),
  ('fsk:other', 'skipped', now() - interval '1 hour', now() - interval '2 hours', null)
) as v(ikey, status, resolved, created, prior) on v.ikey = t.idempotency_key;

select tests.authenticate_as('fsk_owner');
select is(
  (select jsonb_agg(elem->>'description') from jsonb_array_elements(public.list_skipped_review()) elem),
  '["fsk:new", "fsk:old"]'::jsonb,
  'the latest skipped rows, newest skip first; not a card that came back, a removed line, or another company');
select is(
  (public.list_skipped_review() -> 0 ->> 'transaction_id')::uuid,
  (select id from fsk where label = 'txn_new'),
  'a row names its line');

-- The owner files the old line in the app after skipping it, then puts the card back.
reset role;
update public.transactions set project_id = (select id from fsk where label = 'east')
where id = (select id from fsk where label = 'txn_old');
select tests.authenticate_as('fsk_owner');
select lives_ok(
  format('select public.reopen_review(%L::uuid)',
    (select id from public.review_queue where transaction_id = (select id from fsk where label = 'txn_old'))),
  'reopen puts a skipped card back');
select is(
  (select project_id from public.transactions where id = (select id from fsk where label = 'txn_old')),
  (select id from fsk where label = 'east'),
  'reopen leaves the owner''s later edit, not the skip-time snapshot');
select is(
  (select status::text from public.review_queue where transaction_id = (select id from fsk where label = 'txn_old')),
  'open',
  'the card is open again and off the skipped list');

select * from finish();
rollback;
