-- FLOW-701 part 5 (decision 0133). Jev's suggestions with a reason from SQL, Jev's score on
-- anomaly flags, income lines in the tagging reads, and the #160 review follow-ups.
-- Helpers come from supabase/tests/helpers.sql.

begin;

select plan(30);

do $users$
begin
  perform tests.create_supabase_user('jr_owner');
  perform tests.create_supabase_user('jr_other');
end
$users$;

select tests.authenticate_as('jr_owner');
select lives_ok($$select public.create_company('עסק א', true)$$, 'owner creates a company');
select tests.authenticate_as('jr_other');
select lives_ok($$select public.create_company('עסק ב', true)$$, 'other owner creates a company');
reset role;

create temp table jr_ref (label text primary key, id uuid);
grant all on jr_ref to anon, authenticated, service_role;

insert into jr_ref (label, id)
select 'co', c.id from public.companies c
join auth.users u on u.id = c.owner_id
where u.raw_user_meta_data ->> 'test_identifier' = 'jr_owner';
insert into jr_ref (label, id)
select 'co_b', c.id from public.companies c
join auth.users u on u.id = c.owner_id
where u.raw_user_meta_data ->> 'test_identifier' = 'jr_other';

insert into public.suppliers (company_id, name)
select (select id from jr_ref where label = 'co'), n from unnest(array['ספק קבוע', 'ספק חדש', 'ספק כפול']) n;
insert into jr_ref (label, id)
select case s.name when 'ספק קבוע' then 's_a' when 'ספק חדש' then 's_new' else 's_dup' end, s.id
from public.suppliers s where s.company_id = (select id from jr_ref where label = 'co');
insert into public.customers (company_id, name)
select (select id from jr_ref where label = 'co'), n from unnest(array['לקוח קבוע', 'לקוח כפול', 'לקוח קבלות']) n;
insert into jr_ref (label, id)
select case c.name when 'לקוח קבוע' then 'c_a' when 'לקוח כפול' then 'c_dup' else 'c_rcpt' end, c.id
from public.customers c where c.company_id = (select id from jr_ref where label = 'co');
insert into public.projects (company_id, name)
select (select id from jr_ref where label = 'co'), n from unnest(array['פרויקט א', 'פרויקט ב']) n;
insert into jr_ref (label, id)
select case p.name when 'פרויקט א' then 'p1' else 'p2' end, p.id
from public.projects p where p.company_id = (select id from jr_ref where label = 'co');
insert into jr_ref (label, id)
select 'cat' || row_number() over (order by c.name, c.id), c.id
from public.categories c
where c.company_id = (select id from jr_ref where label = 'co') and c.kind = 'expense' and not c.hidden
order by c.name, c.id limit 2;
insert into jr_ref (label, id)
select 'cat_inc', c.id
from public.categories c
where c.company_id = (select id from jr_ref where label = 'co') and c.kind = 'income' and not c.excluded_from_pnl
order by c.name, c.id limit 1;

-- label, direction, kind, party, date, gross, project, category, review status, external, linked, line status
create temp table jr_lines (
  label text, dir text, kind text, party text, doc_date date, gross bigint,
  project text, category text, status text, ext text, linked text, line_status text
);
insert into jr_lines values
  -- s_a filed: newest p1/cat1, then two p2/cat2.
  ('f1', 'expense', 'expense', 's_a', '2026-04-03', -11800, 'p1', 'cat1', 'approved', null, null, 'posted'),
  ('f2', 'expense', 'expense', 's_a', '2026-04-02', -11800, 'p2', 'cat2', 'changed', null, null, 'posted'),
  ('f3', 'expense', 'expense', 's_a', '2026-04-01', -11800, 'p2', 'cat2', 'approved', null, null, 'posted'),
  -- c_a filed income.
  ('fi', 'income', 'invoice', 'c_a', '2026-03-01', 118000, 'p1', 'cat_inc', 'approved', null, null, 'posted'),
  -- Open lines with suggestions.
  ('o1', 'expense', 'expense', 's_a', '2026-04-10', -23600, null, null, 'open', null, null, 'posted'),
  ('o2', 'expense', 'expense', 's_a', '2026-04-11', -35400, null, null, 'open', null, null, 'posted'),
  ('o3', 'expense', 'expense', 's_a', '2026-04-12', -47200, null, null, 'open', null, null, 'posted'),
  ('o4', 'expense', 'expense', 's_new', '2026-04-13', -11800, null, null, 'open', null, null, 'posted'),
  ('o5', 'income', 'invoice', 'c_a', '2026-04-14', 118000, null, null, 'open', null, null, 'posted'),
  ('o6', 'expense', 'expense', 's_a', '2026-04-15', -59000, null, null, 'open', null, null, 'posted'),
  ('o7', 'income', 'invoice', 'c_a', '2026-04-16', 236000, null, null, 'open', null, null, 'posted'),
  -- A duplicate pair; Jev scored the second.
  ('d1', 'expense', 'expense', 's_dup', '2026-04-20', -5900, null, null, 'open', null, null, 'posted'),
  ('d2', 'expense', 'expense', 's_dup', '2026-04-21', -5900, null, null, 'open', null, null, 'posted'),
  -- Two invoices to one customer; a credit note for the first was voided.
  ('v1', 'income', 'invoice', 'c_dup', '2026-04-05', 59000, null, null, 'open', 'V-1', null, 'posted'),
  ('v2', 'income', 'invoice', 'c_dup', '2026-04-07', 59000, null, null, 'open', 'V-2', null, 'posted'),
  ('vc', 'income', 'credit', 'c_dup', '2026-04-06', -59000, null, null, 'approved', 'C-1', 'V-1', 'void'),
  -- A customer billed 1000 by invoice three times, then one receipt paying many invoices.
  ('r1', 'income', 'invoice', 'c_rcpt', '2026-01-10', 1180, null, null, 'approved', null, null, 'posted'),
  ('r2', 'income', 'invoice', 'c_rcpt', '2026-02-10', 1180, null, null, 'approved', null, null, 'posted'),
  ('r3', 'income', 'invoice', 'c_rcpt', '2026-03-10', 1180, null, null, 'approved', null, null, 'posted'),
  ('r4', 'income', 'receipt', 'c_rcpt', '2026-04-10', 118000, null, null, 'open', null, null, 'posted');

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, supplier_id, customer_id, project_id, category_id,
  amount_gross, amount_net, vat_amount, vat_status, line_status, external_id, linked_external_id,
  doc_date, cash_date, source, idempotency_key, description
)
select (select id from jr_ref where label = 'co'), l.dir::public.txn_direction, l.kind::public.doc_kind,
  case when l.dir = 'expense' then 'project' end::public.pnl_role,
  case when l.dir = 'expense' then (select id from jr_ref where label = l.party) end,
  case when l.dir = 'income' then (select id from jr_ref where label = l.party) end,
  (select id from jr_ref where label = l.project), (select id from jr_ref where label = l.category),
  l.gross, (l.gross * 100) / 118, l.gross - (l.gross * 100) / 118, 'assumed',
  l.line_status::public.line_status, l.ext, l.linked,
  l.doc_date, l.doc_date, 'sumit', 'sumit:jr-' || l.label, l.label
from jr_lines l;
insert into jr_ref (label, id)
select substr(idempotency_key, 10), id from public.transactions where idempotency_key like 'sumit:jr-%';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'test'
from public.transactions t
where t.idempotency_key like 'sumit:jr-%'
  and not exists (select 1 from public.review_queue q where q.transaction_id = t.id);
update public.review_queue q set status = l.status::public.review_status
from jr_lines l
where q.transaction_id = (select id from jr_ref where label = l.label);
set constraints all immediate;

-- Suggestions. o6 has answers that are not ids; f1 (filed) has one too.
insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
select (select id from jr_ref where label = 'co'), (select id from jr_ref where label = s.line),
  jsonb_strip_nulls(jsonb_build_object(
    'project', case when s.project is not null
      then jsonb_build_object('choice', coalesce((select id::text from jr_ref where label = s.project), s.project), 'confidence', 0.9) end,
    'category', case when s.category is not null
      then jsonb_build_object('choice', coalesce((select id::text from jr_ref where label = s.category), s.category), 'confidence', 0.8) end,
    'anomaly', s.anomaly
  )),
  0.8, 'jev-1.13.0', 'jev-1.13.0'
from (values
  ('o1', 'p1', 'cat1', '{"type": "noul", "noul": 0.8}'::jsonb),
  ('o2', 'p2', 'cat2', '{"type": "noul", "noul": 7}'::jsonb),
  ('o3', 'p1', 'cat2', null),
  ('o4', 'p1', null, null),
  ('o5', 'p1', 'cat_inc', null),
  ('o6', 'not-an-id', 'also-not', null),
  ('d2', null, 'cat1', '{"type": "noul", "noul": 0.42}'::jsonb),
  ('f1', 'p1', 'cat1', null)
) s(line, project, category, anomaly);

create temp table jr_out (label text primary key, result jsonb);
grant all on jr_out to anon, authenticated, service_role;

select tests.authenticate_as('jr_owner');
insert into jr_out (label, result)
select 'sug', public.jev_suggestions(array(
  select id from jr_ref where label in ('o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7', 'f1')
));
insert into jr_out (label, result) select 'mcp', public.mcp_jev_suggestions();
insert into jr_out (label, result)
select 'flags', public.review_anomalies(array(
  select id from jr_ref where label in ('d1', 'd2', 'v1', 'v2', 'r4')
));
insert into jr_out (label, result) select 'mcp_flags', public.mcp_review_anomalies();
insert into jr_out (label, result) select 'status', public.mcp_jev_status();
reset role;

create temp view jr_sug as
select (select label from jr_ref where id = (s->>'transaction_id')::uuid) as line, s
from jr_out o, jsonb_array_elements(o.result) s where o.label = 'sug';
grant select on jr_sug to anon, authenticated, service_role;

select is(
  (select jsonb_agg(line order by line) from jr_sug),
  '["f1", "o1", "o2", "o3", "o4", "o5"]'::jsonb,
  'lines with a usable suggestion come back; answers that are not ids and lines without one do not'
);
select is(
  (select s->>'reason' || ' ' || (s->>'party_filings') || ' ' || (s->>'matching_filings') from jr_sug where line = 'o1'),
  'same_as_last 3 1',
  'the suggestion equals the party''s last filed line'
);
select is(
  (select s->>'reason' || ' ' || (s->>'matching_filings') from jr_sug where line = 'o2'),
  'usual_for_party 2',
  'the suggestion equals 2 of the party''s last filed lines'
);
select is(
  (select s->>'reason' || ' ' || (s->>'matching_filings') from jr_sug where line = 'o3'),
  'model_only 0',
  'a mix that no filed line has is Jev''s own call'
);
select is(
  (select s->>'reason' || ' ' || (s->>'party_filings') || ' ' || coalesce(s->>'category_id', 'none') from jr_sug where line = 'o4'),
  'new_party 0 none',
  'a supplier with nothing filed is new; an unanswered field is null'
);
select is(
  (select s->>'reason' || ' ' || (s->>'direction') || ' ' || (s->>'project_name') from jr_sug where line = 'o5'),
  'same_as_last income פרויקט א',
  'an income suggestion is compared with the customer''s filed income'
);
select is(
  (select (s->>'category_id')::uuid from jr_sug where line = 'o5'),
  (select id from jr_ref where label = 'cat_inc'),
  'the income suggestion carries the income category'
);
select is(
  (select s->>'reason' || ' ' || (s->>'party_filings') from jr_sug where line = 'f1'),
  'model_only 2',
  'a line is not compared with itself'
);
select is(
  (select jsonb_build_array(
    (select s->'anomaly_score' from jr_sug where line = 'o1'),
    (select s->'anomaly_score' from jr_sug where line = 'o2'),
    (select s->'anomaly_score' from jr_sug where line = 'o3'))),
  '[0.800, null, null]'::jsonb,
  'the anomaly score reads only a noul between 0 and 1'
);
select is(
  (select jsonb_agg((select label from jr_ref where id = (s->>'transaction_id')::uuid) order by s->>'transaction_id')
   from jr_out o, jsonb_array_elements(o.result->'suggestions') s where o.label = 'mcp')
    @> '["o1", "o5", "d2"]'::jsonb
  and not (select (o.result->'suggestions') @> jsonb_build_array(jsonb_build_object('transaction_id', (select id from jr_ref where label = 'f1')))
    from jr_out o where o.label = 'mcp'),
  true,
  'MCP lists the open lines with suggestions, not the filed one'
);

create temp view jr_flags as
select (select label from jr_ref where id = (f->>'transaction_id')::uuid) as line, f
from jr_out o, jsonb_array_elements(o.result) f where o.label = 'flags';
grant select on jr_flags to anon, authenticated, service_role;

select is(
  (select jsonb_agg(jsonb_build_array(line, f->>'kind', f->'jev_score') order by line)
   from jr_flags where line in ('d1', 'd2')),
  '[["d1", "duplicate", null], ["d2", "duplicate", 0.420]]'::jsonb,
  'a flag carries Jev''s score when the line''s call scored it'
);
select is(
  (select jsonb_agg(line order by line) from jr_flags where f->>'kind' = 'duplicate' and line in ('v1', 'v2')),
  '["v1", "v2"]'::jsonb,
  'a voided credit note does not hide a duplicate invoice'
);
select is(
  (select count(*)::integer from jr_flags where line = 'r4'),
  0,
  'a receipt paying many invoices is not a spike or a new customer'
);
select is(
  (select f->'jev_score' from jr_out o, jsonb_array_elements(o.result->'anomalies') f
   where o.label = 'mcp_flags' and (f->>'transaction_id')::uuid = (select id from jr_ref where label = 'd2')),
  '0.420'::jsonb,
  'MCP get_anomalies carries the score too'
);
select is(
  (select (result->>'lines_without_suggestion')::integer from jr_out where label = 'status'),
  (select count(*)::integer from public.transactions t
   join public.review_queue q on q.transaction_id = t.id and q.status = 'open'
   where t.company_id = (select id from jr_ref where label = 'co') and t.removed_at is null
     and not exists (select 1 from public.tag_suggestions s where s.transaction_id = t.id)),
  'get_jev_status counts open lines of both directions'
);
select ok(
  (select (result->>'lines_without_suggestion')::integer from jr_out where label = 'status') >=
  (select count(*)::integer from jr_ref where label in ('o7', 'v1', 'v2', 'r4')),
  'open income lines without a suggestion are in that count'
);

-- Validation and other companies.
select tests.authenticate_as('jr_owner');
select throws_ok(
  $$select public.jev_suggestions(array(select gen_random_uuid() from generate_series(1, 501)))$$,
  'validation', 'more than 500 ids is refused'
);
select is(public.jev_suggestions(null), '[]'::jsonb, 'no ids, no suggestions');
select throws_ok(
  format('select public.jev_line_flags(%L, array[%L]::uuid[])',
    (select id from jr_ref where label = 'co'), (select id from jr_ref where label = 'd2')),
  '42501', null, 'a member cannot read the job''s flags'
);
select tests.authenticate_as('jr_other');
select is(
  public.jev_suggestions(array(select id from jr_ref where label in ('o1', 'o5'))),
  '[]'::jsonb,
  'another company sees none of these suggestions'
);
select is(
  public.review_anomalies(array(select id from jr_ref where label in ('d1', 'd2'))),
  '[]'::jsonb,
  'or their flags'
);
reset role;

do $call$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into jr_out (label, result)
  select 'job_flags', public.jev_line_flags(
    (select id from jr_ref where label = 'co'),
    array(select id from jr_ref where label in ('d1', 'd2', 'o1'))
  );
  insert into jr_out (label, result)
  select 'history', public.jev_supplier_history(
    (select id from jr_ref where label = 'co'),
    array[(select id from jr_ref where label = 'c_a'), (select id from jr_ref where label = 's_a')]
  );
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '{}', true);
end
$call$;

select is(
  (select jsonb_agg((select label from jr_ref where id = (f->>'transaction_id')::uuid) order by f->>'transaction_id')
   from jr_out o, jsonb_array_elements(o.result) f where o.label = 'job_flags')
   <@ '["d1", "d2"]'::jsonb
  and (select jsonb_array_length(result) from jr_out where label = 'job_flags') = 2,
  true,
  'the job reads the flags of the lines it sends, without scores'
);
select is(
  (select count(*)::integer from jr_out o, jsonb_array_elements(o.result) f
   where o.label = 'job_flags' and f ? 'jev_score'),
  0,
  'the job''s flags carry no score field'
);
select is(
  (select jsonb_agg(jsonb_build_array(f->>'direction', f->>'description') order by f->>'doc_date')
   from jr_out o, jsonb_array_elements(o.result) f
   where o.label = 'history' and (f->>'supplier_id')::uuid = (select id from jr_ref where label = 'c_a')),
  '[["income", "fi"]]'::jsonb,
  'a customer''s filed income comes back with its direction'
);
select is(
  (select count(*)::integer from jr_out o, jsonb_array_elements(o.result) f
   where o.label = 'history' and (f->>'supplier_id')::uuid = (select id from jr_ref where label = 's_a')),
  3,
  'a supplier''s filed lines still come back'
);

select ok(
  has_function_privilege('authenticated', 'public.jev_suggestions(uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.mcp_jev_suggestions()', 'execute')
  and not has_function_privilege('anon', 'public.jev_suggestions(uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.mcp_jev_suggestions()', 'execute'),
  'members can read suggestions; anon cannot'
);
select ok(
  not has_function_privilege('authenticated', 'public.jev_line_flags(uuid, uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.jev_line_flags(uuid, uuid[])', 'execute')
  and has_function_privilege('service_role', 'public.jev_line_flags(uuid, uuid[])', 'execute'),
  'the job''s flag read is service role only'
);
select ok(
  not has_function_privilege('authenticated', 'private.jev_suggestions_for(uuid, uuid[])', 'execute')
  and not has_function_privilege('authenticated', 'private.flags_with_scores(uuid, uuid[])', 'execute')
  and not has_function_privilege('authenticated', 'private.open_review_ids(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.jev_suggestion_rows(uuid, uuid[])', 'execute')
  and not has_function_privilege('authenticated', 'private.jev_line_filed(uuid, uuid)', 'execute'),
  'the private helpers are not callable by members'
);

select * from finish();
rollback;
