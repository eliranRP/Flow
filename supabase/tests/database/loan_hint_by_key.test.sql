-- FLOW-122. A connector hint 'loan_part:<part>' finds the loan category by its key, so a
-- renamed loan category still gets the line, and only in the line's own company.
-- A plain hint still matches the category name. A hint that finds nothing leaves the usual guess.

begin;

select plan(9);

do $users$
begin
  perform tests.create_supabase_user('hint_owner', 'hint-owner@test.flow');
  perform tests.create_supabase_user('hint_other', 'hint-other@test.flow');
end
$users$;

select tests.authenticate_as('hint_owner');
select lives_ok($$select public.create_company('ספר רמז', true)$$, 'owner creates a company');
select tests.authenticate_as('hint_other');
select lives_ok($$select public.create_company('ספר אחר', true)$$, 'another owner creates a company');

reset role;
do $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
end
$$;

create temp table hint_co (label text, id uuid);
insert into hint_co (label, id)
select 'co', id from public.companies where name = 'ספר רמז' order by created_at desc limit 1;
insert into hint_co (label, id)
select 'other', id from public.companies where name = 'ספר אחר' order by created_at desc limit 1;

-- The owner renamed the principal category. Only the seed sets loan_part, so it stays.
update public.categories
set name = 'החזר הלוואה'
where company_id = (select id from hint_co where label = 'co') and loan_part = 'principal';

create function pg_temp.hint_line(p_ext text, p_direction text, p_hint text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'source', 'mercury',
    'external_id', p_ext,
    'direction', p_direction,
    'line_status', 'posted',
    'doc_kind', case when p_direction = 'income' then 'receipt' else 'expense' end,
    'currency', 'USD',
    'amount_original', 10000,
    'amount_negated', p_direction = 'expense',
    'doc_date', '2026-09-05',
    'cash_date', '2026-09-05',
    'description', 'Example ' || p_ext,
    'category_hint', p_hint,
    'vat', jsonb_build_object('amount', 0, 'status', 'source'),
    'provider_meta', jsonb_build_object('kind', 'externalTransfer')
  )
$$;

select is(
  (
    public.upsert_connector_lines(
      (select id from hint_co where label = 'co'),
      'mercury',
      jsonb_build_object(
        'lines', jsonb_build_array(
          pg_temp.hint_line('hint-key', 'expense', 'loan_part:principal'),
          pg_temp.hint_line('hint-old-name', 'expense', 'תשלומי הלוואה'),
          pg_temp.hint_line('hint-unknown-key', 'expense', 'loan_part:penalty'),
          pg_temp.hint_line('hint-name', 'income', 'הכנסה אחרת'),
          pg_temp.hint_line('hint-key-income', 'income', 'loan_part:principal'),
          pg_temp.hint_line('hint-wildcard', 'expense', 'loanXpart:principal')
        ),
        'removed_ids', '[]'::jsonb,
        'complete', false
      ),
      null,
      null
    )
  ).inserted,
  6,
  'six hinted lines insert'
);

select is(
  (select t.category_id from public.transactions t
   where t.company_id = (select id from hint_co where label = 'co') and t.external_id = 'hint-key'),
  (select c.id from public.categories c
   where c.company_id = (select id from hint_co where label = 'co') and c.loan_part = 'principal'),
  'the loan_part hint files the line under the renamed principal category of its own company'
);

select is(
  (select t.category_suggested from public.transactions t
   where t.company_id = (select id from hint_co where label = 'co') and t.external_id = 'hint-old-name'),
  true,
  'the old Hebrew name no longer finds the renamed category: the line only gets the usual guess'
);

select is(
  (select t.category_suggested from public.transactions t
   where t.company_id = (select id from hint_co where label = 'co') and t.external_id = 'hint-unknown-key'),
  true,
  'an unknown loan_part key files nothing: the line only gets the usual guess'
);

select is(
  (select c.name from public.transactions t
   join public.categories c on c.id = t.category_id
   where t.company_id = (select id from hint_co where label = 'co') and t.external_id = 'hint-name'),
  'הכנסה אחרת',
  'a plain hint still matches by name'
);

select is(
  (select t.category_id is distinct from (
     select c.id from public.categories c
     where c.company_id = (select id from hint_co where label = 'co') and c.loan_part = 'principal')
   from public.transactions t
   where t.company_id = (select id from hint_co where label = 'co') and t.external_id = 'hint-key-income'),
  true,
  'a loan_part hint on an income line does not file it under the expense principal category'
);

select is(
  (select t.category_suggested from public.transactions t
   where t.company_id = (select id from hint_co where label = 'co') and t.external_id = 'hint-wildcard'),
  true,
  'only the exact loan_part: prefix is a key: an underscore is not a wildcard'
);

select * from finish();
rollback;
