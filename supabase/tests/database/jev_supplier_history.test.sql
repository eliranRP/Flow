-- FLOW-701 part 3 (decision 0127). jev_supplier_history returns the newest filed lines of
-- each supplier for the jev-tag job. Filed means the line's newest review row is approved or
-- changed, and the line is a live expense. Service role only.
-- Helpers come from supabase/tests/helpers.sql.

begin;

select plan(15);

do $users$
begin
  perform tests.create_supabase_user('jsh_owner');
  perform tests.create_supabase_user('jsh_other');
end
$users$;

select tests.authenticate_as('jsh_owner');
select lives_ok($$select public.create_company('עסק א', true)$$, 'owner creates a company');
select tests.authenticate_as('jsh_other');
select lives_ok($$select public.create_company('עסק ב', true)$$, 'other owner creates a company');
reset role;

create temp table jsh_ref (label text primary key, id uuid);
grant all on jsh_ref to anon, authenticated, service_role;

insert into jsh_ref (label, id)
select 'company_a', c.id from public.companies c
join auth.users u on u.id = c.owner_id
where u.raw_user_meta_data ->> 'test_identifier' = 'jsh_owner';
insert into jsh_ref (label, id)
select 'company_b', c.id from public.companies c
join auth.users u on u.id = c.owner_id
where u.raw_user_meta_data ->> 'test_identifier' = 'jsh_other';

insert into public.suppliers (company_id, name)
select id, 'ספק א' from jsh_ref where label = 'company_a';
insert into public.suppliers (company_id, name)
select id, 'ספק ב' from jsh_ref where label = 'company_a';
insert into public.suppliers (company_id, name)
select id, 'ספק ג' from jsh_ref where label = 'company_b';
insert into jsh_ref (label, id) select 's1', id from public.suppliers where name = 'ספק א';
insert into jsh_ref (label, id) select 's2', id from public.suppliers where name = 'ספק ב';
insert into jsh_ref (label, id) select 's3', id from public.suppliers where name = 'ספק ג';

-- Supplier s1: eight lines in company A, dated 2026-04-01 to 2026-04-08. Supplier s2: one.
-- Company B: one line for its own supplier.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, supplier_id,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description
)
select (select id from jsh_ref where label = 'company_a'), 'expense', 'expense', 'project',
  (select id from jsh_ref where label = 's1'),
  -1180 * n, -1000 * n, -180 * n, 'assumed',
  ('2026-04-0' || n)::date, ('2026-04-0' || n)::date, 'sumit', 'sumit:jsh-' || n, 'line ' || n
from generate_series(1, 8) n;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, supplier_id,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description
)
values
  ((select id from jsh_ref where label = 'company_a'), 'expense', 'expense', 'project',
   (select id from jsh_ref where label = 's2'),
   -1180, -1000, -180, 'assumed', '2026-03-01', '2026-03-01', 'sumit', 'sumit:jsh-s2', repeat('א', 200)),
  ((select id from jsh_ref where label = 'company_b'), 'expense', 'expense', 'project',
   (select id from jsh_ref where label = 's3'),
   -1180, -1000, -180, 'assumed', '2026-03-01', '2026-03-01', 'sumit', 'sumit:jsh-b', 'line b');
insert into jsh_ref (label, id)
select 't' || substr(idempotency_key, 11), id from public.transactions where idempotency_key like 'sumit:jsh-%';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'test'
from public.transactions t
where t.idempotency_key like 'sumit:jsh-%'
  and not exists (select 1 from public.review_queue q where q.transaction_id = t.id);
-- Everything filed except t8 (still open) and t7 (skipped).
update public.review_queue q set status = case
    when t.idempotency_key = 'sumit:jsh-8' then 'open'::public.review_status
    when t.idempotency_key = 'sumit:jsh-7' then 'skipped'::public.review_status
    when t.idempotency_key = 'sumit:jsh-6' then 'changed'::public.review_status
    else 'approved'::public.review_status
  end
from public.transactions t
where t.id = q.transaction_id and t.idempotency_key like 'sumit:jsh-%';
-- An income line of s1, filed, dated last: it is left out.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, supplier_id,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description
)
values ((select id from jsh_ref where label = 'company_a'), 'income', 'invoice', 'project',
  (select id from jsh_ref where label = 's1'),
  1180, 1000, 180, 'assumed', '2026-04-30', '2026-04-30', 'sumit', 'sumit:jsh-in', 'income line');
insert into public.review_queue (company_id, transaction_id, status, reason)
select company_id, id, 'approved', 'test' from public.transactions where idempotency_key = 'sumit:jsh-in';
-- t3 is split by category.
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, amount_minor)
select t.company_id, t.id, 1, c.id, 3000
from public.transactions t
join public.categories c on c.company_id = t.company_id and c.kind = 'expense'
where t.id = (select id from jsh_ref where label = 't3')
order by c.name limit 1;
-- t5 is removed; t4 is back in review with a newer open row.
update public.transactions set removed_at = now() where id = (select id from jsh_ref where label = 't5');
insert into public.review_queue (company_id, transaction_id, status, reason, created_at)
select company_id, id, 'open', 'test reopen', now() + interval '1 second'
from public.transactions where id = (select id from jsh_ref where label = 't4');
set constraints all immediate;

create temp table jsh_out (label text primary key, result jsonb);
grant all on jsh_out to anon, authenticated, service_role;

select tests.authenticate_as('jsh_owner');
select throws_ok(
  format('select public.jev_supplier_history(%L, array[%L]::uuid[])',
    (select id from jsh_ref where label = 'company_a'), (select id from jsh_ref where label = 's1')),
  '42501', null, 'a member cannot call it'
);
reset role;

do $call$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into jsh_out (label, result)
  select 'a', public.jev_supplier_history(
    (select id from jsh_ref where label = 'company_a'),
    array[(select id from jsh_ref where label = 's1'), (select id from jsh_ref where label = 's2'),
          (select id from jsh_ref where label = 's3')]
  );
  insert into jsh_out (label, result)
  select 'per2', public.jev_supplier_history(
    (select id from jsh_ref where label = 'company_a'),
    array[(select id from jsh_ref where label = 's1')], 2
  );
  insert into jsh_out (label, result)
  select 'none', public.jev_supplier_history((select id from jsh_ref where label = 'company_a'), array[]::uuid[]);
end
$call$;

select is(
  (select jsonb_agg(e ->> 'description' order by ord)
   from jsh_out, jsonb_array_elements(result) with ordinality x(e, ord)
   where label = 'a' and e ->> 'supplier_id' = (select id::text from jsh_ref where label = 's1')),
  '["line 6", "line 3", "line 2", "line 1"]'::jsonb,
  's1: filed lines newest first; open, skipped, removed and reopened lines are left out'
);
select is(
  (select jsonb_agg((e ->> 'split')::boolean order by ord)
   from jsh_out, jsonb_array_elements(result) with ordinality x(e, ord)
   where label = 'a' and e ->> 'supplier_id' = (select id::text from jsh_ref where label = 's1')),
  '[false, true, false, false]'::jsonb,
  'a line with split parts is marked split'
);
select is(
  (select count(*)::integer from jsh_out, jsonb_array_elements(result) e
   where label = 'a' and e ->> 'description' = 'income line'),
  0, 'income lines are left out'
);
select is(
  (select count(*)::integer from jsh_out, jsonb_array_elements(result) e
   where label = 'a' and e ->> 'supplier_id' = (select id::text from jsh_ref where label = 's3')),
  0, 'another company''s supplier returns nothing'
);
select is(
  (select length(e ->> 'description') from jsh_out, jsonb_array_elements(result) e
   where label = 'a' and e ->> 'supplier_id' = (select id::text from jsh_ref where label = 's2')),
  120, 'a description is cut to 120 characters'
);
select is(
  (select e - 'supplier_id' - 'description' from jsh_out, jsonb_array_elements(result) e
   where label = 'a' and e ->> 'description' = 'line 6'),
  jsonb_build_object('doc_date', '2026-04-06', 'amount_net', -6000, 'project_id', null,
    'category_id', (select category_id from public.transactions where id = (select id from jsh_ref where label = 't6')),
    'pnl_role', 'project', 'split', false),
  'each filing carries its date, amount, project, category, role and split flag'
);
select is(
  (select jsonb_array_length(result) from jsh_out where label = 'per2'),
  2, 'p_per caps lines per supplier'
);
select is((select result from jsh_out where label = 'none'), '[]'::jsonb, 'no suppliers, no lines');

do $bad$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
end
$bad$;
select throws_ok(
  format('select public.jev_supplier_history(%L, array[]::uuid[], 0)', (select id from jsh_ref where label = 'company_a')),
  'P0001', 'validation', 'p_per below 1 is refused'
);
select throws_ok(
  format('select public.jev_supplier_history(%L, array[]::uuid[], 21)', (select id from jsh_ref where label = 'company_a')),
  'P0001', 'validation', 'p_per above 20 is refused'
);
do $noclaims$
begin
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '{}', true);
end
$noclaims$;
select throws_ok(
  format('select public.jev_supplier_history(%L, array[]::uuid[])', (select id from jsh_ref where label = 'company_a')),
  '42501', 'forbidden', 'a caller with execute but no service-role claim is refused'
);
select ok(
  not has_function_privilege('authenticated', 'public.jev_supplier_history(uuid, uuid[], integer)', 'execute')
  and not has_function_privilege('anon', 'public.jev_supplier_history(uuid, uuid[], integer)', 'execute')
  and has_function_privilege('service_role', 'public.jev_supplier_history(uuid, uuid[], integer)', 'execute'),
  'only the service role can execute it'
);

select * from finish();
rollback;
