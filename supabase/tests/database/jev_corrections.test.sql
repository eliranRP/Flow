-- FLOW-703 (decision 0139). Jev's corrections in the party history, the one-call prefill, the
-- one-call split approval, the no-project answer, and finished projects for older lines.
-- Helpers come from supabase/tests/helpers.sql.

begin;

select plan(36);

do $users$
begin
  perform tests.create_supabase_user('jc_owner');
  perform tests.create_supabase_user('jc_other');
end
$users$;

select tests.authenticate_as('jc_owner');
select lives_ok($$select public.create_company('עסק א', true)$$, 'owner creates a company');
select tests.authenticate_as('jc_other');
select lives_ok($$select public.create_company('עסק ב', true)$$, 'other owner creates a company');
reset role;

create temp table jc_ref (label text primary key, id uuid);
grant all on jc_ref to anon, authenticated, service_role;

insert into jc_ref (label, id)
select 'co', c.id from public.companies c
join auth.users u on u.id = c.owner_id
where u.raw_user_meta_data ->> 'test_identifier' = 'jc_owner';
insert into jc_ref (label, id)
select 'co_b', c.id from public.companies c
join auth.users u on u.id = c.owner_id
where u.raw_user_meta_data ->> 'test_identifier' = 'jc_other';

insert into public.suppliers (company_id, name)
select (select id from jc_ref where label = 'co'), n from unnest(array['ספק קבוע', 'ספק כללי']) n;
insert into jc_ref (label, id)
select case s.name when 'ספק קבוע' then 's_a' else 's_oh' end, s.id
from public.suppliers s where s.company_id = (select id from jc_ref where label = 'co');
insert into public.customers (company_id, name) values ((select id from jc_ref where label = 'co'), 'לקוח');
insert into jc_ref (label, id)
select 'c_a', c.id from public.customers c where c.company_id = (select id from jc_ref where label = 'co');
insert into public.projects (company_id, name, status)
select (select id from jc_ref where label = 'co'), n, s::public.project_status
from (values ('פרויקט א', 'active'), ('פרויקט ב', 'active'), ('פרויקט ישן', 'finished'), ('פרויקט ריק', 'finished')) v(n, s);
insert into jc_ref (label, id)
select case p.name when 'פרויקט א' then 'p1' when 'פרויקט ב' then 'p2' when 'פרויקט ישן' then 'pf' else 'pe' end, p.id
from public.projects p
where p.company_id = (select id from jc_ref where label = 'co')
  and p.name in ('פרויקט א', 'פרויקט ב', 'פרויקט ישן', 'פרויקט ריק');
update public.companies set overhead_project_id = (select id from jc_ref where label = 'p2')
where id = (select id from jc_ref where label = 'co');
insert into jc_ref (label, id)
select 'cat' || row_number() over (order by c.name, c.id), c.id
from public.categories c
where c.company_id = (select id from jc_ref where label = 'co') and c.kind = 'expense' and not c.hidden
order by c.name, c.id limit 2;
insert into jc_ref (label, id)
select 'cat_inc', c.id
from public.categories c
where c.company_id = (select id from jc_ref where label = 'co') and c.kind = 'income' and not c.excluded_from_pnl
order by c.name, c.id limit 1;
insert into jc_ref (label, id)
select 'cat_b', c.id
from public.categories c
where c.company_id = (select id from jc_ref where label = 'co_b') and c.kind = 'expense' and not c.hidden
order by c.name, c.id limit 1;

-- label, direction, party, date, project, category, review status, role, user_assigned, category_assigned
create temp table jc_lines (
  label text, dir text, party text, doc_date date, project text, category text, status text,
  role text, user_set boolean, cat_set boolean
);
insert into jc_lines values
  -- s_a filed: Jev guessed f1 wrong (project), f2 right, f3 had no guess.
  ('f1', 'expense', 's_a', '2026-03-01', 'p1', 'cat1', 'changed', 'project', true, true),
  ('f2', 'expense', 's_a', '2026-02-01', 'p1', 'cat1', 'approved', 'project', true, true),
  ('f3', 'expense', 's_a', '2026-01-15', 'p1', 'cat1', 'approved', 'project', true, true),
  -- The finished project's last line.
  ('fp', 'expense', 's_a', '2026-02-20', 'pf', 'cat1', 'approved', 'project', true, true),
  -- s_oh filed with no project.
  ('fn', 'expense', 's_oh', '2026-03-05', null, 'cat2', 'approved', null, true, true),
  -- Prefill candidates.
  ('o1', 'expense', 's_a', '2026-04-10', null, null, 'open', 'project', false, false),
  ('o2', 'expense', 's_a', '2026-04-11', null, null, 'open', 'project', true, false),
  ('o3', 'expense', 's_a', '2026-04-12', null, 'cat2', 'open', 'project', false, true),
  ('o4', 'expense', 's_a', '2026-04-13', null, null, 'approved', 'project', false, false),
  ('o5', 'income', 'c_a', '2026-04-14', null, null, 'open', null, false, false),
  ('o6', 'expense', 's_a', '2026-04-15', null, null, 'open', 'shared', false, false),
  -- A no-project suggestion.
  ('n1', 'expense', 's_oh', '2026-04-16', null, null, 'open', null, false, false),
  -- Split approvals: sp is split across two projects; ns is not split.
  ('sp', 'expense', 's_a', '2026-04-17', null, 'cat1', 'open', 'shared', false, false),
  ('ns', 'expense', 's_a', '2026-04-18', 'p1', 'cat1', 'open', 'project', false, false),
  -- More prefill guards: the owner's project, a split across projects, a hidden or income category.
  ('o7', 'expense', 's_a', '2026-04-19', 'p2', null, 'open', 'project', false, false),
  ('o8', 'expense', 's_a', '2026-04-20', null, null, 'open', 'project', false, false),
  ('o9', 'expense', 's_a', '2026-04-21', null, null, 'open', 'project', false, false);

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, supplier_id, customer_id, project_id, category_id,
  user_assigned, category_assigned, project_assigned,
  amount_gross, amount_net, vat_amount, vat_status, line_status,
  doc_date, cash_date, source, idempotency_key, description
)
select (select id from jc_ref where label = 'co'), l.dir::public.txn_direction,
  case when l.dir = 'expense' then 'expense' else 'invoice' end::public.doc_kind,
  l.role::public.pnl_role,
  case when l.dir = 'expense' then (select id from jc_ref where label = l.party) end,
  case when l.dir = 'income' then (select id from jc_ref where label = l.party) end,
  (select id from jc_ref where label = l.project), (select id from jc_ref where label = l.category),
  l.user_set, l.cat_set, l.project is not null,
  case when l.dir = 'expense' then -11800 else 11800 end,
  case when l.dir = 'expense' then -10000 else 10000 end,
  case when l.dir = 'expense' then -1800 else 1800 end,
  'assumed', 'posted', l.doc_date, l.doc_date, 'sumit', 'sumit:jc-' || l.label, l.label
from jc_lines l;
insert into jc_ref (label, id)
select substr(idempotency_key, 10), id from public.transactions where idempotency_key like 'sumit:jc-%';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from jc_ref where label = 'co'), (select id from jc_ref where label = l.label),
  (select id from jc_ref where label = l.project), 10000, -10000
from jc_lines l where l.project is not null and l.role = 'project';
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from jc_ref where label = 'co'), (select id from jc_ref where label = 'sp'),
  (select id from jc_ref where label = p), 5000, -5000
from unnest(array['p1', 'p2']) p;
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select (select id from jc_ref where label = 'co'), (select id from jc_ref where label = 'o8'),
  (select id from jc_ref where label = p), 5000, -5000
from unnest(array['p1', 'p2']) p;
insert into public.projects (company_id, name, status)
values ((select id from jc_ref where label = 'co_b'), 'פרויקט זר', 'active');
insert into jc_ref (label, id)
select 'p_b', p.id from public.projects p
where p.company_id = (select id from jc_ref where label = 'co_b') and p.name = 'פרויקט זר';
insert into public.categories (company_id, name, kind, hidden, sort_order)
values ((select id from jc_ref where label = 'co'), 'מוסתרת', 'expense', true, 999);
insert into jc_ref (label, id)
select 'cat_hidden', c.id from public.categories c
where c.company_id = (select id from jc_ref where label = 'co') and c.name = 'מוסתרת';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'test'
from public.transactions t
where t.idempotency_key like 'sumit:jc-%'
  and not exists (select 1 from public.review_queue q where q.transaction_id = t.id);
update public.review_queue q set status = l.status::public.review_status
from jc_lines l
where q.transaction_id = (select id from jc_ref where label = l.label);

insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
select (select id from jc_ref where label = 'co'), (select id from jc_ref where label = s.line),
  jsonb_build_object(
    'project', jsonb_build_object('choice', coalesce((select id::text from jc_ref where label = s.project), s.project), 'confidence', 0.9),
    'category', jsonb_build_object('choice', (select id::text from jc_ref where label = s.category), 'confidence', 0.9)
  ),
  0.9, 'jev-1.13.0', 'jev-1.13.0'
from (values ('f1', 'p2', 'cat1'), ('f2', 'p1', 'cat1'), ('n1', 'none', 'cat2')) s(line, project, category);
set constraints all immediate;

-- The outcomes the trigger keeps (decision 0126), written here as the filed lines would have.
insert into public.jev_outcomes (
  company_id, transaction_id, suggestion_id, model_version, confidence,
  suggested_project_id, suggested_category_id, final_project_id, final_category_id,
  project_match, category_match, review_status
)
select (select id from jc_ref where label = 'co'), s.transaction_id, s.id, s.model_version, s.confidence,
  (s.answers->'project'->>'choice')::uuid, (s.answers->'category'->>'choice')::uuid,
  (select id from jc_ref where label = 'p1'), (select id from jc_ref where label = 'cat1'),
  (s.answers->'project'->>'choice')::uuid = (select id from jc_ref where label = 'p1'), true,
  case when s.transaction_id = (select id from jc_ref where label = 'f1') then 'changed' else 'approved' end::public.review_status
from public.tag_suggestions s
where s.transaction_id in (select id from jc_ref where label in ('f1', 'f2'))
on conflict (transaction_id) do update
  set suggested_project_id = excluded.suggested_project_id,
      project_match = excluded.project_match,
      category_match = excluded.category_match;

create temp table jc_out (label text primary key, result jsonb);
grant all on jc_out to anon, authenticated, service_role;

do $call$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into jc_out (label, result)
  select 'history', public.jev_supplier_history(
    (select id from jc_ref where label = 'co'), array[(select id from jc_ref where label = 's_a')], 10
  );
  insert into jc_out (label, result) select 'projects', public.jev_projects((select id from jc_ref where label = 'co'));
  insert into jc_out (label, result)
  select 'pre_' || l, public.jev_prefill(
    (select id from jc_ref where label = 'co'), (select id from jc_ref where label = l),
    (select id from jc_ref where label = 'p1'), (select id from jc_ref where label = 'cat1')
  )
  from unnest(array['o1', 'o2', 'o3', 'o4', 'o5', 'o6']) l;
  insert into jc_out (label, result)
  select 'pre_bad', public.jev_prefill(
    (select id from jc_ref where label = 'co'), (select id from jc_ref where label = 'n1'),
    (select id from jc_ref where label = 'p1'), (select id from jc_ref where label = 'cat_b')
  );
  insert into jc_out (label, result)
  select 'pre_o7', public.jev_prefill(
    (select id from jc_ref where label = 'co'), (select id from jc_ref where label = 'o7'),
    (select id from jc_ref where label = 'p1'), null);
  insert into jc_out (label, result)
  select 'pre_o8', public.jev_prefill(
    (select id from jc_ref where label = 'co'), (select id from jc_ref where label = 'o8'),
    (select id from jc_ref where label = 'p1'), (select id from jc_ref where label = 'cat_inc'));
  insert into jc_out (label, result)
  select 'pre_o9', public.jev_prefill(
    (select id from jc_ref where label = 'co'), (select id from jc_ref where label = 'o9'),
    (select id from jc_ref where label = 'p_b'), (select id from jc_ref where label = 'cat_hidden'));
  insert into jc_out (label, result)
  select 'pre_xco', public.jev_prefill(
    (select id from jc_ref where label = 'co_b'), (select id from jc_ref where label = 'o9'),
    (select id from jc_ref where label = 'p_b'), (select id from jc_ref where label = 'cat_b'));
  insert into jc_out (label, result) select 'projects_b', public.jev_projects((select id from jc_ref where label = 'co_b'));
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '{}', true);
end
$call$;

create temp view jc_hist as
select (select label from jc_ref where id = (f->>'supplier_id')::uuid) as party, f
from jc_out o, jsonb_array_elements(o.result) f where o.label = 'history';
grant select on jc_hist to anon, authenticated, service_role;

-- 1. Corrections in the history.
select is(
  (select jsonb_agg(jsonb_build_array(f->>'description', f->>'jev_corrected') order by f->>'doc_date' desc)
   from jc_hist where f->>'description' in ('f1', 'f2', 'f3')),
  '[["f1", "true"], ["f2", "false"], ["f3", "false"]]'::jsonb,
  'the history says which filed lines corrected Jev'
);
select is(
  (select (f->>'jev_project_id')::uuid from jc_hist where f->>'description' = 'f1'),
  (select id from jc_ref where label = 'p2'),
  'and what Jev had suggested on them'
);
select is(
  (select f->'jev_project_id' from jc_hist where f->>'description' = 'f3'),
  'null'::jsonb,
  'a line Jev never suggested on has no Jev ids'
);

-- 2. Prefill.
select is(
  (select result from jc_out where label = 'pre_o1'),
  '{"project": true, "category": true}'::jsonb,
  'an open untouched expense gets the project and the category'
);
select is(
  (select jsonb_build_array(t.project_id = (select id from jc_ref where label = 'p1'),
     t.category_id = (select id from jc_ref where label = 'cat1'), t.category_suggested, t.user_assigned)
   from public.transactions t where t.id = (select id from jc_ref where label = 'o1')),
  '[true, true, true, false]'::jsonb,
  'the line carries them as suggested, not as the owner''s'
);
select is(
  (select jsonb_agg(jsonb_build_array(a.share_bp, a.amount_net))
   from public.allocations a where a.transaction_id = (select id from jc_ref where label = 'o1')),
  '[[10000, -10000]]'::jsonb,
  'one allocation, with the amount read from the line'
);
select is(
  (select status::text from public.review_queue where transaction_id = (select id from jc_ref where label = 'o1')),
  'open',
  'the prefill never approves the line'
);
select is(
  (select result->>'skipped' from jc_out where label = 'pre_o2'),
  'closed',
  'a line the owner assigned is left alone'
);
select is(
  (select result from jc_out where label = 'pre_o3'),
  '{"project": true, "category": false}'::jsonb,
  'a category the owner set is kept'
);
select is(
  (select category_id from public.transactions where id = (select id from jc_ref where label = 'o3')),
  (select id from jc_ref where label = 'cat2'),
  'and stays as it was'
);
select is(
  (select result->>'skipped' from jc_out where label = 'pre_o4'),
  'closed',
  'a filed line is left alone'
);
select is(
  (select result from jc_out where label = 'pre_o5'),
  '{"project": false, "category": false}'::jsonb,
  'income is never pre-filled'
);
select is(
  (select jsonb_build_array(o.result, (select count(*) from public.allocations a where a.transaction_id = (select id from jc_ref where label = 'o6'))::int)
   from jc_out o where o.label = 'pre_o6'),
  '[{"project": false, "category": true}, 0]'::jsonb,
  'a shared line gets no project'
);
select is(
  (select result from jc_out where label = 'pre_bad'),
  '{"project": true, "category": false}'::jsonb,
  'another company''s category is not written'
);

select is(
  (select jsonb_build_array(o.result, t.project_id = (select id from jc_ref where label = 'p2'))
   from jc_out o, public.transactions t
   where o.label = 'pre_o7' and t.id = (select id from jc_ref where label = 'o7')),
  '[{"project": false, "category": false}, true]'::jsonb,
  'a project the owner set is kept'
);
select is(
  (select jsonb_build_array(o.result, (select count(*) from public.allocations a where a.transaction_id = (select id from jc_ref where label = 'o8'))::int)
   from jc_out o where o.label = 'pre_o8'),
  '[{"project": false, "category": false}, 2]'::jsonb,
  'a line split across projects gets no project, and an income category is not written on an expense'
);
select is(
  (select result from jc_out where label = 'pre_o9'),
  '{"project": false, "category": false}'::jsonb,
  'another company''s project and a hidden category are not written'
);
select is(
  (select result->>'skipped' from jc_out where label = 'pre_xco'),
  'not_found',
  'another company cannot prefill the line'
);
select is(
  (select jsonb_build_array(t.project_id is null,
     t.category_id in (select id from jc_ref where label in ('cat_b', 'cat_hidden')))
   from public.transactions t where t.id = (select id from jc_ref where label = 'o9')),
  '[true, false]'::jsonb,
  'and the line is unchanged'
);
select ok(
  (select bool_and((p->>'id')::uuid <> (select id from jc_ref where label = 'p1')) from jc_out o, jsonb_array_elements(o.result) p where o.label = 'projects_b')
  and exists (select 1 from jc_out o, jsonb_array_elements(o.result) p where o.label = 'projects_b' and (p->>'id')::uuid = (select id from jc_ref where label = 'p_b')),
  'jev_projects lists only that company''s projects, and still lists its own'
);

-- 3. No project.
select tests.authenticate_as('jc_owner');
insert into jc_out (label, result)
select 'sug', public.jev_suggestions(array[(select id from jc_ref where label = 'n1')]);
reset role;
select is(
  (select jsonb_build_array(s->'no_project', s->'project_id', s->>'reason')
   from jc_out o, jsonb_array_elements(o.result) s where o.label = 'sug'),
  '[true, null, "same_as_last"]'::jsonb,
  'a no-project answer comes back as no_project and matches a filing with no project'
);

-- 4. Finished projects.
create temp view jc_proj as
select (select label from jc_ref where id = (p->>'id')::uuid) as label, p
from jc_out o, jsonb_array_elements(o.result) p where o.label = 'projects';
grant select on jc_proj to anon, authenticated, service_role;
select is(
  (select p->>'last_doc_date' from jc_proj where label = 'pf'),
  '2026-02-20',
  'a finished project carries its last line date'
);
select is(
  (select p->'last_doc_date' from jc_proj where label = 'pe'),
  'null'::jsonb,
  'a finished project with no lines has none'
);
select is(
  (select jsonb_build_array(p->>'status', p->'last_doc_date') from jc_proj where label = 'p1'),
  '["active", null]'::jsonb,
  'an active project needs no date'
);
select is(
  (select jsonb_agg(label order by label) from jc_proj where (p->>'overhead')::boolean),
  '["p2"]'::jsonb,
  'the company''s overhead project is marked'
);

-- 5. Split approval in one call.
select tests.authenticate_as('jc_owner');
select lives_ok(
  format($$select public.approve_split_review(%L, %L)$$,
    (select q.id from public.review_queue q where q.transaction_id = (select id from jc_ref where label = 'sp')),
    (select id from jc_ref where label = 'cat2')),
  'the owner approves a split line with a new category in one call'
);
select throws_ok(
  format($$select public.approve_split_review(%L, %L)$$,
    (select q.id from public.review_queue q where q.transaction_id = (select id from jc_ref where label = 'ns')),
    (select id from jc_ref where label = 'cat2')),
  'transaction is not split',
  'a line that is not split is refused'
);
reset role;
select is(
  (select jsonb_build_array(t.category_id = (select id from jc_ref where label = 'cat2'), q.status)
   from public.transactions t join public.review_queue q on q.transaction_id = t.id
   where t.id = (select id from jc_ref where label = 'sp')),
  '[true, "approved"]'::jsonb,
  'the split line has the new category and is approved'
);
select is(
  (select category_id from public.transactions where id = (select id from jc_ref where label = 'ns')),
  (select id from jc_ref where label = 'cat1'),
  'a refused approval leaves the category as it was'
);
select is(
  (select count(*)::integer from public.reassign_undo where transaction_id = (select id from jc_ref where label = 'sp')),
  1,
  'the category change keeps its undo row'
);

-- Access.
select tests.authenticate_as('jc_other');
select throws_ok(
  format($$select public.approve_split_review(%L, %L)$$,
    (select q.id from public.review_queue q where q.transaction_id = (select id from jc_ref where label = 'ns')),
    (select id from jc_ref where label = 'cat_b')),
  'review item not found',
  'another company cannot approve the line'
);
reset role;
select ok(
  not has_function_privilege('authenticated', 'public.jev_prefill(uuid, uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.jev_prefill(uuid, uuid, uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.jev_prefill(uuid, uuid, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.jev_projects(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.jev_projects(uuid)', 'execute'),
  'the job''s prefill and project reads are service role only'
);
select ok(
  has_function_privilege('authenticated', 'public.approve_split_review(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.approve_split_review(uuid, uuid)', 'execute'),
  'members can approve a split with a category; anon cannot'
);

select tests.authenticate_as('jc_owner');
select throws_ok(
  format($$select public.approve_split_review(%L, null::uuid)$$,
    (select q.id from public.review_queue q where q.transaction_id = (select id from jc_ref where label = 'o8'))),
  'category is required',
  'the one-call approval needs a category'
);
reset role;

select * from finish();
rollback;
