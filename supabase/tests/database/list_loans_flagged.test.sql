-- FLOW-131: mcp_list_loans shows the parts the balance check flagged for review
-- (flagged_parts) and the lines they belong to (flagged_transaction_ids).
-- Fixed dates. @example.com only.

begin;

select plan(12);

do $users$
begin
  perform tests.create_supabase_user('f131_owner', 'owner131@example.com');
end
$users$;

create temp table f131 (label text primary key, id uuid);
grant all on f131 to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid('f131_owner');
  select id into tid from pg_temp.f131 where label = p_label;
  if uid is null or tid is null then
    raise exception 'missing mcp actor %', p_label;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', tid)::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp(text) to authenticated, service_role;

-- A line with the given status and amount, split by the app (as the owner) into
-- interest 0, escrow 0 and the whole amount as principal. A null status splits an
-- existing line, found by its external id.
create or replace function pg_temp.app_split_line(p_key text, p_status text, p_amount bigint)
returns void
language plpgsql
set search_path = ''
as $$
begin
  reset role;
  if p_status is not null then
  insert into public.transactions (
    company_id, direction, doc_kind, line_status, amount_gross, amount_net, amount_original,
    vat_amount, vat_status, doc_date, currency, source, idempotency_key, description
  )
  select c.id, 'expense', 'expense', p_status::public.line_status, -p_amount, -p_amount, p_amount, 0, 'unknown',
    '2026-02-01', 'USD', 'manual', p_key, 'Example loan payment'
  from pg_temp.f131 c where c.label = 'company';
  end if;

  perform tests.authenticate_as('f131_owner');
  insert into public.loan_splits (company_id, loan_id, transaction_id, part, amount_minor, scheduled_minor, category_id)
  select t.company_id, (select id from pg_temp.f131 where label = 'loan'), t.id, v.part::public.loan_split_part,
    v.amount, v.amount, c.id
  from public.transactions t
  cross join (values
    ('interest', 'ריבית משכנתא', 0::bigint),
    ('escrow', 'מסים וביטוח', 0::bigint),
    ('principal', 'תשלומי הלוואה', p_amount)
  ) as v(part, category, amount)
  join public.categories c on c.company_id = t.company_id and c.name = v.category and c.kind = 'expense'
  where t.idempotency_key = p_key or t.external_id = p_key;
  set constraints all immediate;
  set constraints all deferred;
  reset role;
end;
$$;
grant execute on function pg_temp.app_split_line(text, text, bigint) to authenticated, service_role;

select tests.authenticate_as('f131_owner');
select public.create_company('Example Loan Flag Co', true);
reset role;
insert into f131 (label, id) select 'company', id from public.companies where name = 'Example Loan Flag Co';

select public.store_mcp_credential(
  tests.get_supabase_uid('f131_owner'), 'hash-f131-write-1', array['read','write'], now() + interval '90 days', 'pepper-1'
);
insert into f131 (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-f131-write-1';

-- 100,000.00 at 6 percent: month-one interest is 500.00, the payment 1,000.00.
select pg_temp.as_mcp('write');
insert into f131 (label, id)
select 'loan', (
  public.mcp_add_loan('f131-add', 'Example Bank', 10000000, 60000, 360, '2026-01-01'::date, 100000, 10000, 'USD')->'data'->>'id'
)::uuid;
reset role;

create or replace function pg_temp.listed(p_field text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform pg_temp.as_mcp('write');
  select l -> p_field into result
  from jsonb_array_elements(public.mcp_list_loans()) l
  where l->>'id' = (select id::text from pg_temp.f131 where label = 'loan');
  reset role;
  return result;
end;
$$;
grant execute on function pg_temp.listed(text) to authenticated, service_role;

select is(pg_temp.listed('flagged_parts'), '0'::jsonb, 'a loan with nothing flagged shows flagged_parts 0');
select is(pg_temp.listed('flagged_transaction_ids'), '[]'::jsonb, 'and an empty flagged_transaction_ids');

-- 6,000,000 counts; a pending 5,000,000 posts past the 4,000,000 left and is flagged.
select pg_temp.app_split_line('f131:paid', 'posted', 6000000);
select pg_temp.app_split_line('f131:pending', 'pending', 5000000);
update public.transactions set line_status = 'posted' where idempotency_key = 'f131:pending';

select is(pg_temp.listed('flagged_parts'), '3'::jsonb, 'list_loans counts the three flagged parts');
select is(
  pg_temp.listed('flagged_transaction_ids'),
  (select jsonb_build_array(id) from public.transactions where idempotency_key = 'f131:pending'),
  'list_loans names the flagged line once'
);
select is(pg_temp.listed('balance_minor'), '4000000'::jsonb, 'the flagged line does not lower the balance');

-- A second flagged line is listed too, in id order.
select pg_temp.app_split_line('f131:pending2', 'pending', 5000000);
update public.transactions set line_status = 'posted' where idempotency_key = 'f131:pending2';
select is(
  pg_temp.listed('flagged_transaction_ids'),
  (select jsonb_agg(id order by id) from public.transactions where idempotency_key in ('f131:pending', 'f131:pending2')),
  'list_loans names every flagged line, sorted'
);
select is(pg_temp.listed('flagged_parts'), '6'::jsonb, 'and counts all their parts');

-- A second loan of the same company does not show the first loan's flagged lines.
select pg_temp.as_mcp('write');
select public.mcp_add_loan('f131-add-2', 'Example Bank Two', 5000000, 60000, 360, '2026-01-01'::date, 50000, 0, 'USD');
select pg_temp.as_mcp('write');
create temp table f131_other_loan on commit drop as
select l from jsonb_array_elements(public.mcp_list_loans()) l where l->>'name' = 'Example Bank Two';
reset role;
select is(
  (select l -> 'flagged_transaction_ids' from f131_other_loan),
  '[]'::jsonb,
  'another loan of the company lists no flagged lines'
);
select is((select l -> 'flagged_parts' from f131_other_loan), '0'::jsonb, 'and counts no flagged parts');

-- A viewer of this company, made a demo, can read its loans through RLS, but list_loans is
-- scoped to the caller's own company, so it shows nothing (fails without the filter).
do $viewer$
begin
  perform tests.create_supabase_user('f131_viewer', 'viewer131@example.com');
end
$viewer$;
update public.companies set is_demo = true where id = (select id from f131 where label = 'company');
insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('f131_viewer'), id from f131 where label = 'company';
select tests.authenticate_as('f131_viewer');
select ok((select count(*) from public.loans) > 0, 'a viewer reads the demo company loans');
select is(
  (select count(*)::int from jsonb_array_elements(public.mcp_list_loans())),
  0,
  'but list_loans does not return another company''s loan or its flags'
);
reset role;

-- Another company's list_loans does not see the loan or its flags.
do $other$
begin
  perform tests.create_supabase_user('f131_other', 'other131@example.com');
end
$other$;
select tests.authenticate_as('f131_other');
select public.create_company('Example Other Flag Co', true);
select is(
  (select count(*)::int from jsonb_array_elements(public.mcp_list_loans())),
  0,
  'another company sees no loans and no flags'
);
reset role;

select * from finish();

rollback;
