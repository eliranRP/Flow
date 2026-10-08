-- FLOW-120: a deadlock, serialization failure or lock timeout inside reassign_transaction
-- still ends mcp_attach_loan_payment as before, it is not reported as 'project not set'.
-- FLOW-129: a lock timeout in the attach or in mcp_undo returns unavailable / retry and is
-- not stored, so a retry with the same key runs again.
-- Test-only triggers raise the error codes. Invented data only. @example.com only.

begin;

select plan(11);

select tests.create_supabase_user('lr_owner', 'lr-owner@example.com');

insert into public.companies (owner_id, name, is_demo)
values (tests.get_supabase_uid('lr_owner'), 'Example Loan Reraise LLC', false);

create temp table lr (label text primary key, id uuid);
grant all on lr to authenticated, service_role;

insert into lr (label, id)
select 'co', id from public.companies where name = 'Example Loan Reraise LLC';

insert into public.projects (company_id, name, status)
values ((select id from lr where label = 'co'), 'Site Reraise', 'active');
insert into lr (label, id)
select 'p1', id from public.projects where company_id = (select id from lr where label = 'co');

insert into public.categories (company_id, name, kind, sort_order, is_default)
values ((select id from lr where label = 'co'), 'Reraise servicer', 'expense', 50, false);
insert into lr (label, id)
select 'cat', id from public.categories
where company_id = (select id from lr where label = 'co') and name = 'Reraise servicer';

insert into private.mcp_credentials (user_id, company_id, token_hash, pepper_kid, scope, expires_at)
values (
  tests.get_supabase_uid('lr_owner'), (select id from lr where label = 'co'),
  'hash-lr-write', 'pepper-1', array['read','write'], now() + interval '90 days'
);
insert into lr (label, id)
select 'write', id from private.mcp_credentials where token_hash = 'hash-lr-write';

insert into public.loans (
  company_id, name, principal_minor, annual_rate_ppm, term_months, start_date,
  payment_minor, escrow_minor, currency, project_id
)
values (
  (select id from lr where label = 'co'), 'Example Mortgage R', 12000000, 60000, 360,
  '2026-01-01', 100000, 20000, 'USD', (select id from lr where label = 'p1')
);
insert into lr (label, id)
select 'loan', id from public.loans where name = 'Example Mortgage R';

insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, category_id, description, user_assigned
)
values (
  (select id from lr where label = 'co'), 'expense', 'expense', 'posted', 'USD',
  -100000, -100000, 100000, 0, 'source',
  '2026-06-10', '2026-06-10', 'manual', 'd1', (select id from lr where label = 'cat'), 'd1', false
);
insert into lr (label, id)
select 'd1', id from public.transactions where idempotency_key = 'd1';

-- Test-only: raise the error code named in lr.fail when reassign_transaction keeps its undo row.
create function public.lr_fail_reassign()
returns trigger
language plpgsql
as $$
begin
  if current_setting('lr.fail', true) = '40P01' then
    raise exception 'lr test deadlock' using errcode = 'deadlock_detected';
  elsif current_setting('lr.fail', true) = '55P03' then
    raise exception 'lr test lock timeout' using errcode = 'lock_not_available';
  end if;
  return new;
end;
$$;
create trigger lr_fail_reassign
  before insert on public.reassign_undo
  for each row execute function public.lr_fail_reassign();

create or replace function pg_temp.attach(p_key text, p_fail text)
returns jsonb
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('lr_owner');
  result jsonb;
begin
  perform set_config('lr.fail', p_fail, true);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', uid, 'role', 'authenticated', 'aal', 'aal1',
      'mcp_tid', (select id from pg_temp.lr where label = 'write')
    )::text,
    true
  );
  result := public.mcp_attach_loan_payment(
    p_key,
    (select id from pg_temp.lr where label = 'd1'),
    (select id from pg_temp.lr where label = 'loan'),
    jsonb_build_array(
      jsonb_build_object('part', 'interest', 'amount_minor', 70000, 'scheduled_minor', 70000),
      jsonb_build_object('part', 'escrow', 'amount_minor', 20000, 'scheduled_minor', 20000),
      jsonb_build_object('part', 'principal', 'amount_minor', 10000, 'scheduled_minor', 10000)
    )
  );
  perform set_config('lr.fail', '', true);
  return result;
end;
$$;

select is(
  pg_temp.attach('lr-att-deadlock', '40P01')->'error'->>'code',
  'unavailable',
  'a deadlock while filing the line ends the attach as unavailable'
);
reset role;
select is(
  (select count(*)::int from public.loan_splits where transaction_id = (select id from lr where label = 'd1')),
  0,
  'the deadlocked attach kept no parts'
);

select is(
  pg_temp.attach('lr-att-lock', '55P03')->'error'->>'code',
  'unavailable',
  'a lock timeout while filing the line ends the attach as unavailable'
);
reset role;
select is(
  (select count(*)::int from public.loan_splits where transaction_id = (select id from lr where label = 'd1')),
  0,
  'the timed-out attach kept no parts'
);
select is(
  (select count(*)::int from public.transactions t
   where t.id = (select id from lr where label = 'd1') and t.project_id is null and t.pnl_role is null),
  1,
  'the line is left as it was'
);

-- The timed-out attach stored nothing: the same key runs again and files the line.
select is(
  pg_temp.attach('lr-att-lock', '')->'data'->>'project_inherited',
  'true',
  'a retry with the timed-out key runs again and files the line'
);
reset role;
select is(
  (select count(*)::int from public.loan_splits where transaction_id = (select id from lr where label = 'd1')),
  3,
  'the retried attach kept the parts'
);

-- mcp_undo: a lock timeout while removing the parts returns unavailable and stores nothing.
create function public.lr_fail_split_delete()
returns trigger
language plpgsql
as $$
begin
  if current_setting('lr.fail', true) = '55P03' then
    raise exception 'lr test lock timeout' using errcode = 'lock_not_available';
  end if;
  return old;
end;
$$;
create trigger lr_fail_split_delete
  before delete on public.loan_splits
  for each row execute function public.lr_fail_split_delete();

create or replace function pg_temp.undo(p_key text, p_fail text)
returns jsonb
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('lr_owner');
  result jsonb;
begin
  perform set_config('lr.fail', p_fail, true);
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', uid, 'role', 'authenticated', 'aal', 'aal1',
      'mcp_tid', (select id from pg_temp.lr where label = 'write')
    )::text,
    true
  );
  result := public.mcp_undo(p_key, 'loan_split', (select id from pg_temp.lr where label = 'd1'));
  perform set_config('lr.fail', '', true);
  return result;
end;
$$;

select is(
  pg_temp.undo('lr-undo-lock', '55P03')->'error'->>'code',
  'unavailable',
  'a lock timeout in undo returns unavailable'
);
reset role;
select is(
  (select count(*)::int from public.loan_splits where transaction_id = (select id from lr where label = 'd1')),
  3,
  'the timed-out undo kept the parts'
);
select is(
  pg_temp.undo('lr-undo-lock', '')->>'ok',
  'true',
  'a retry with the timed-out key runs the undo'
);
reset role;
select is(
  (select count(*)::int from public.loan_splits where transaction_id = (select id from lr where label = 'd1')),
  0,
  'the retried undo removed the parts'
);

select * from finish();
rollback;
