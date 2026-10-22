-- FLOW-948 (decision 0208). The balance invariant: a transaction's legs must sum to 0 and hit
-- exactly one is_bank account. The deferred constraint trigger refuses anything else at commit
-- (or when a caller forces constraints immediate). Invented data only.

begin;

select plan(6);

do $u$ begin perform tests.create_supabase_user('bi_owner', 'bi-owner@example.com'); end $u$;
insert into public.companies (owner_id, name, is_demo) values (tests.get_supabase_uid('bi_owner'), 'Balance LLC', false);

create temp table bi (label text primary key, id uuid);
grant all on bi to authenticated, service_role;
insert into bi select 'co', id from public.companies where name = 'Balance LLC';
insert into bi select 'bank', id from public.accounts where company_id = (select id from bi where label='co') and name = 'Bank/Clearing';
insert into bi select 'susp', id from public.accounts where company_id = (select id from bi where label='co') and name = 'Suspense';
insert into bi select 'uexp', id from public.accounts where company_id = (select id from bi where label='co') and name = 'Uncategorized expense';

-- A posted line is booked by the maintenance trigger into a balanced, single-bank-leg set.
insert into public.transactions (company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status, doc_date, cash_date, source, idempotency_key, user_assigned)
values ((select id from bi where label='co'), 'expense', 'receipt', 'project', 'posted', 'ILS',
  -5000, -5000, 5000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'bi1', true);
insert into bi select 'txn', id from public.transactions where idempotency_key = 'bi1';

select is(
  (select sum(amount_minor) from public.legs where transaction_id = (select id from bi where label='txn'))::bigint,
  0::bigint, 'a booked line''s legs sum to 0');
select is(
  (select count(*) filter (where a.is_bank) from public.legs l join public.accounts a on a.id = l.account_id
   where l.transaction_id = (select id from bi where label='txn'))::bigint,
  1::bigint, 'a booked line has exactly one bank leg');

-- A manual, balanced two-leg set on a fresh transaction is accepted.
insert into public.transactions (company_id, direction, doc_kind, pnl_role, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status, doc_date, cash_date, source, idempotency_key, user_assigned)
values ((select id from bi where label='co'), 'expense', 'receipt', 'project', 'pending', 'ILS',
  -1000, -1000, 1000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'bi2', true);
insert into bi select 'txn2', id from public.transactions where idempotency_key = 'bi2';

select lives_ok($$
  insert into public.legs (company_id, transaction_id, account_id, project_id, amount_minor, ordinal)
  values
    ((select id from bi where label='co'), (select id from bi where label='txn2'), (select id from bi where label='uexp'), null, 1000, 1),
    ((select id from bi where label='co'), (select id from bi where label='txn2'), (select id from bi where label='bank'), null, -1000, 2);
  set constraints all immediate;
$$, 'a balanced set with one bank leg is accepted');

-- An unbalanced set (sum <> 0) is refused.
select throws_ok($$
  delete from public.legs where transaction_id = (select id from bi where label='txn2');
  insert into public.legs (company_id, transaction_id, account_id, project_id, amount_minor, ordinal)
  values
    ((select id from bi where label='co'), (select id from bi where label='txn2'), (select id from bi where label='uexp'), null, 1000, 3),
    ((select id from bi where label='co'), (select id from bi where label='txn2'), (select id from bi where label='bank'), null, -900, 4);
  set constraints all immediate;
$$, 'P0001', null, 'an unbalanced leg set (sum <> 0) is refused');

-- No bank leg is refused.
select throws_ok($$
  delete from public.legs where transaction_id = (select id from bi where label='txn2');
  insert into public.legs (company_id, transaction_id, account_id, project_id, amount_minor, ordinal)
  values
    ((select id from bi where label='co'), (select id from bi where label='txn2'), (select id from bi where label='uexp'), null, 1000, 5),
    ((select id from bi where label='co'), (select id from bi where label='txn2'), (select id from bi where label='susp'), null, -1000, 6);
  set constraints all immediate;
$$, 'P0001', null, 'a set with no bank leg is refused');

-- Two bank legs is refused.
select throws_ok($$
  delete from public.legs where transaction_id = (select id from bi where label='txn2');
  insert into public.legs (company_id, transaction_id, account_id, project_id, amount_minor, ordinal)
  values
    ((select id from bi where label='co'), (select id from bi where label='txn2'), (select id from bi where label='bank'), null, 1000, 7),
    ((select id from bi where label='co'), (select id from bi where label='txn2'), (select id from bi where label='bank'), null, -1000, 8);
  set constraints all immediate;
$$, 'P0001', null, 'a set with two bank legs is refused');

select finish();
rollback;
