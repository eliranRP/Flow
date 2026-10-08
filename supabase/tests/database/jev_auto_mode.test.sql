-- FLOW-702 (decision 0145). Jev auto mode on the server: the anomaly gate, income pre-fills,
-- the audit trail, one-tap undo, the status counts, and the #177 review follow-ups.
-- Helpers come from supabase/tests/helpers.sql.

begin;

select plan(37);

do $users$
begin
  perform tests.create_supabase_user('ja_owner');
  perform tests.create_supabase_user('ja_other');
end
$users$;

select tests.authenticate_as('ja_owner');
select lives_ok($$select public.create_company('עסק א', true)$$, 'owner creates a company');
select tests.authenticate_as('ja_other');
select lives_ok($$select public.create_company('עסק ב', true)$$, 'other owner creates a company');
reset role;

create temp table ja_ref (label text primary key, id uuid);
grant all on ja_ref to anon, authenticated, service_role;

insert into ja_ref (label, id)
select 'co', c.id from public.companies c
join auth.users u on u.id = c.owner_id
where u.raw_user_meta_data ->> 'test_identifier' = 'ja_owner';

insert into public.suppliers (company_id, name)
select (select id from ja_ref where label = 'co'), n from unnest(array['ספק קבוע', 'ספק כפול', 'ספק שני', 'ספק כללי']) n;
insert into ja_ref (label, id)
select case s.name when 'ספק קבוע' then 's_a' when 'ספק כפול' then 's_dup' when 'ספק שני' then 's_dup2' else 's_oh' end, s.id
from public.suppliers s where s.company_id = (select id from ja_ref where label = 'co');
insert into public.customers (company_id, name) values ((select id from ja_ref where label = 'co'), 'לקוח');
insert into ja_ref (label, id)
select 'c_a', c.id from public.customers c where c.company_id = (select id from ja_ref where label = 'co');
insert into public.projects (company_id, name, status)
select (select id from ja_ref where label = 'co'), n, s::public.project_status
from (values ('פרויקט א', 'active'), ('פרויקט ב', 'active'), ('פרויקט ישן', 'finished')) v(n, s);
insert into ja_ref (label, id)
select case p.name when 'פרויקט א' then 'p1' when 'פרויקט ב' then 'p2' else 'pf' end, p.id
from public.projects p
where p.company_id = (select id from ja_ref where label = 'co')
  and p.name in ('פרויקט א', 'פרויקט ב', 'פרויקט ישן');
update public.companies set overhead_project_id = (select id from ja_ref where label = 'p2')
where id = (select id from ja_ref where label = 'co');
insert into ja_ref (label, id)
select 'cat1', c.id
from public.categories c
where c.company_id = (select id from ja_ref where label = 'co') and c.kind = 'expense' and not c.hidden
order by c.name, c.id limit 1;
insert into ja_ref (label, id)
select 'cat_inc', c.id
from public.categories c
where c.company_id = (select id from ja_ref where label = 'co') and c.kind = 'income' and not c.excluded_from_pnl
order by c.name, c.id limit 1;
insert into public.categories (company_id, name, kind, hidden, sort_order)
values ((select id from ja_ref where label = 'co'), 'מוסתרת', 'expense', true, 999);
insert into ja_ref (label, id)
select 'cat_hidden', c.id from public.categories c
where c.company_id = (select id from ja_ref where label = 'co') and c.name = 'מוסתרת';

-- label, direction, party, date, net (minor, unsigned), project, category, review status, role, user_assigned
create temp table ja_lines (
  label text, dir text, party text, doc_date date, net bigint, project text, category text,
  status text, role text, user_set boolean
);
insert into ja_lines values
  -- Filed history, so neither party is new and no amount is a spike.
  ('h1', 'expense', 's_a', '2026-01-10', 10000, 'p1', 'cat1', 'approved', 'project', true),
  ('h2', 'expense', 's_a', '2026-02-10', 10100, 'p1', 'cat1', 'approved', 'project', true),
  ('h3', 'expense', 's_a', '2026-03-10', 10200, 'p1', 'cat1', 'approved', 'project', true),
  ('hi', 'income', 'c_a', '2026-03-01', 10300, 'p1', 'cat_inc', 'approved', null, true),
  ('hd', 'expense', 's_dup', '2026-01-05', 5000, 'p1', 'cat1', 'approved', 'project', true),
  ('hd2', 'expense', 's_dup2', '2026-01-06', 5100, 'p1', 'cat1', 'approved', 'project', true),
  ('fpl', 'expense', 's_a', '2026-02-20', 10400, 'pf', 'cat1', 'approved', 'project', true),
  ('fn', 'expense', 's_oh', '2026-03-05', 10500, 'p2', 'cat1', 'approved', 'project', true),
  -- a1 has a project and allocation of its own (not the owner's); Jev replaces both.
  ('a1', 'expense', 's_a', '2026-04-10', 10600, 'p2', null, 'open', 'project', false),
  -- Duplicates: d1/d2 scored 0.49 and 0.5; e1/e2 not scored.
  ('d1', 'expense', 's_dup', '2026-04-11', 5000, null, null, 'open', 'project', false),
  ('d2', 'expense', 's_dup', '2026-04-12', 5000, null, null, 'open', 'project', false),
  ('e1', 'expense', 's_dup2', '2026-04-11', 5100, null, null, 'open', 'project', false),
  ('e2', 'expense', 's_dup2', '2026-04-12', 5100, null, null, 'open', 'project', false),
  ('i1', 'income', 'c_a', '2026-04-12', 10700, null, null, 'open', null, false),
  -- The finished project's last line is 2026-02-20.
  ('a3', 'expense', 's_a', '2026-04-14', 10800, null, null, 'open', 'project', false),
  ('a4', 'expense', 's_a', '2026-02-01', 10900, null, null, 'open', 'project', false),
  ('n1', 'expense', 's_oh', '2026-04-16', 11000, null, null, 'open', null, false),
  ('sp', 'expense', 's_a', '2026-04-17', 11100, null, 'cat1', 'open', 'shared', false);

insert into public.transactions (
  company_id, direction, doc_kind, pnl_role, supplier_id, customer_id, project_id, category_id,
  user_assigned, category_assigned, project_assigned,
  amount_gross, amount_net, vat_amount, vat_status, line_status,
  doc_date, cash_date, source, idempotency_key, description
)
select (select id from ja_ref where label = 'co'), l.dir::public.txn_direction,
  case when l.dir = 'expense' then 'expense' else 'invoice' end::public.doc_kind,
  l.role::public.pnl_role,
  case when l.dir = 'expense' then (select id from ja_ref where label = l.party) end,
  case when l.dir = 'income' then (select id from ja_ref where label = l.party) end,
  (select id from ja_ref where label = l.project), (select id from ja_ref where label = l.category),
  l.user_set, l.user_set, l.user_set,
  l.sign * (l.net * 118 / 100), l.sign * l.net, l.sign * (l.net * 118 / 100 - l.net),
  'assumed', 'posted', l.doc_date, l.doc_date, 'sumit', 'sumit:ja-' || l.label, l.label
from (select j.*, case when j.dir = 'expense' then -1 else 1 end as sign from ja_lines j) l;
insert into ja_ref (label, id)
select substr(idempotency_key, 10), id from public.transactions where idempotency_key like 'sumit:ja-%';

insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, t.project_id, 10000, t.amount_net
from public.transactions t
where t.idempotency_key like 'sumit:ja-%' and t.direction = 'expense' and t.pnl_role = 'project'
  and t.project_id is not null;
insert into public.allocations (company_id, transaction_id, project_id, share_bp, amount_net)
select t.company_id, t.id, (select id from ja_ref where label = p), 5000, t.amount_net / 2
from public.transactions t, unnest(array['p1', 'p2']) p
where t.id = (select id from ja_ref where label = 'sp');

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'test'
from public.transactions t
where t.idempotency_key like 'sumit:ja-%'
  and not exists (select 1 from public.review_queue q where q.transaction_id = t.id);
update public.review_queue q set status = l.status::public.review_status
from ja_lines l
where q.transaction_id = (select id from ja_ref where label = l.label);

insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
select (select id from ja_ref where label = 'co'), (select id from ja_ref where label = s.line),
  jsonb_strip_nulls(jsonb_build_object(
    'project', jsonb_build_object('choice', coalesce((select id::text from ja_ref where label = s.project), s.project), 'confidence', 0.95),
    'category', jsonb_build_object('choice', (select id::text from ja_ref where label = 'cat1'), 'confidence', 0.95),
    'anomaly', case when s.score is not null then jsonb_build_object('type', 'noul', 'noul', s.score) end
  )),
  0.95, 'jev-1.13.0', 'jev-1.13.0'
from (values ('a1', 'p1', null::numeric), ('d1', 'p1', 0.49), ('d2', 'p1', 0.5), ('e1', 'p1', null),
  ('e2', 'p1', -1), ('i1', 'p1', null), ('a3', 'pf', null), ('a4', 'pf', null), ('n1', 'none', null)
) s(line, project, score);
set constraints all immediate;

create temp table ja_out (label text primary key, result jsonb);
grant all on ja_out to anon, authenticated, service_role;
-- What the held line looks like before Jev runs (insert triggers may set a category).
insert into ja_out (label, result)
select 'held_before', jsonb_build_array(t.project_id, t.category_id)
from public.transactions t where t.id = (select id from ja_ref where label = 'd2');
insert into ja_out (label, result)
select 'a1_before', jsonb_build_array(t.category_id, t.category_suggested)
from public.transactions t where t.id = (select id from ja_ref where label = 'a1');

do $call$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into ja_out (label, result)
  select 'pre_' || l, public.jev_prefill(
    (select id from ja_ref where label = 'co'), (select id from ja_ref where label = l),
    (select id from ja_ref where label = 'p1'), (select id from ja_ref where label = 'cat1'),
    'jev-1.13.0', 0.95
  )
  from unnest(array['a1', 'd1', 'd2', 'e1']) l;
  insert into ja_out (label, result)
  select 'pre_i1', public.jev_prefill(
    (select id from ja_ref where label = 'co'), (select id from ja_ref where label = 'i1'),
    (select id from ja_ref where label = 'p1'), (select id from ja_ref where label = 'cat_inc'), 'jev-1.13.0', 0.9);
  insert into ja_out (label, result)
  select 'pre_' || l, public.jev_prefill(
    (select id from ja_ref where label = 'co'), (select id from ja_ref where label = l),
    (select id from ja_ref where label = 'pf'), null, 'jev-1.13.0', 0.9)
  from unnest(array['a3', 'a4']) l;
  -- The same answer again (a re-tag) writes nothing new; a score outside 0..1 is no score.
  insert into ja_out (label, result)
  select 'pre_' || l || '_again', public.jev_prefill(
    (select id from ja_ref where label = 'co'), (select id from ja_ref where label = l),
    (select id from ja_ref where label = 'p1'), (select id from ja_ref where label = 'cat1'),
    'jev-1.13.0', 0.95
  )
  from unnest(array['d1', 'e2']) l;
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claims', '{}', true);
end
$call$;

-- 1. The anomaly gate.
select is(
  (select result from ja_out where label = 'pre_d1'),
  '{"project": true, "category": true}'::jsonb,
  'a flag Jev scored below 0.5 does not stop the fill'
);
select is(
  (select result->>'skipped' from ja_out where label = 'pre_d2'),
  'flagged',
  'a flag Jev scored at 0.5 stops the fill'
);
select is(
  (select result->>'skipped' from ja_out where label = 'pre_e1'),
  'flagged',
  'a flag Jev did not score stops the fill'
);
select is(
  (select jsonb_build_array(t.project_id, t.category_id) from public.transactions t
   where t.id = (select id from ja_ref where label = 'd2')),
  (select result from ja_out where label = 'held_before'),
  'and the held line is unchanged'
);

select is(
  (select jsonb_build_array(o.result,
     (select count(*) from public.jev_prefills jp where jp.transaction_id = (select id from ja_ref where label = 'd1'))::int)
   from ja_out o where o.label = 'pre_d1_again'),
  '[{"project": false, "category": false}, 1]'::jsonb,
  'the same answer again writes nothing and adds no fill to undo'
);
select is(
  (select result->>'skipped' from ja_out where label = 'pre_e2_again'),
  'flagged',
  'a flag score outside 0 to 1 counts as no score'
);

-- 2. Income.
select is(
  (select result from ja_out where label = 'pre_i1'),
  '{"project": true, "category": true}'::jsonb,
  'an income line gets its project and income category'
);
select is(
  (select jsonb_build_array(t.project_id = (select id from ja_ref where label = 'p1'),
     t.category_id = (select id from ja_ref where label = 'cat_inc'), t.pnl_role,
     (select count(*) from public.allocations a where a.transaction_id = t.id)::int)
   from public.transactions t where t.id = (select id from ja_ref where label = 'i1')),
  '[true, true, null, 0]'::jsonb,
  'with no allocation and no role'
);

-- 5. Finished project, checked in SQL.
select is(
  (select jsonb_build_array(a3.result->'project', a4.result->'project')
   from ja_out a3, ja_out a4 where a3.label = 'pre_a3' and a4.label = 'pre_a4'),
  '[false, true]'::jsonb,
  'a finished project goes only on a line dated on or before its last line'
);

-- 3. The audit trail.
select is(
  (select jsonb_build_array(jp.model_version, jp.confidence, jp.project_id = (select id from ja_ref where label = 'p1'),
     jp.category_id = (select id from ja_ref where label = 'cat1'), jp.prior_project_id, jp.undone_at)
   from public.jev_prefills jp where jp.transaction_id = (select id from ja_ref where label = 'd1')),
  '["jev-1.13.0", 0.95, true, true, null, null]'::jsonb,
  'each fill writes an audit row with what it wrote and what was there'
);
select is(
  (select jsonb_build_array(jp.prior_project_id = (select id from ja_ref where label = 'p2'),
     jsonb_array_length(jp.prior_allocations))
   from public.jev_prefills jp where jp.transaction_id = (select id from ja_ref where label = 'a1')),
  '[true, 1]'::jsonb,
  'including the project and allocation it replaced'
);
select is(
  (select count(*)::integer from public.jev_prefills jp
   where jp.transaction_id in (select id from ja_ref where label in ('d2', 'e1', 'a3'))),
  0,
  'a fill that wrote nothing leaves no audit row'
);

-- 4. Status and suggestions, before any undo.
select tests.authenticate_as('ja_owner');
insert into ja_out (label, result) select 'status', public.mcp_jev_status();
insert into ja_out (label, result)
select 'sug', public.jev_suggestions(array(select id from ja_ref where label in ('a1', 'd1', 'd2', 'n1')));
select is(
  (select jsonb_build_array(result->'prefilled_today', result->'prefilled_open') from ja_out where label = 'status'),
  '[4, 4]'::jsonb,
  'status counts today''s fills and the open lines that carry one'
);
select is(
  (select jsonb_object_agg((select label from ja_ref where id = (s->>'transaction_id')::uuid), s->'prefilled')
   from ja_out o, jsonb_array_elements(o.result) s where o.label = 'sug'
     and (select label from ja_ref where id = (s->>'transaction_id')::uuid) in ('d1', 'd2')),
  '{"d1": true, "d2": false}'::jsonb,
  'a suggestion says whether Jev filled the line'
);
select is(
  (select s->>'reason' from ja_out o, jsonb_array_elements(o.result) s
   where o.label = 'sug' and (s->>'transaction_id')::uuid = (select id from ja_ref where label = 'n1')),
  'same_as_last',
  'a line filed to the overhead project matches a no-project suggestion'
);

-- 3. Undo.
select lives_ok(
  format($$select public.undo_jev_prefill(%L)$$, (select id from ja_ref where label = 'a1')),
  'the owner undoes Jev''s fill in one call'
);
reset role;
select is(
  (select jsonb_build_array(t.project_id = (select id from ja_ref where label = 'p2'),
     jsonb_build_array(t.category_id, t.category_suggested) = (select result from ja_out where label = 'a1_before'),
     (select jsonb_agg(jsonb_build_array(a.project_id = (select id from ja_ref where label = 'p2'), a.share_bp, a.amount_net = t.amount_net))
      from public.allocations a where a.transaction_id = t.id))
   from public.transactions t where t.id = (select id from ja_ref where label = 'a1')),
  '[true, true, [[true, 10000, true]]]'::jsonb,
  'undo puts back the project, its allocation and the category from before'
);
select is(
  (select undone_at is not null from public.jev_prefills where transaction_id = (select id from ja_ref where label = 'a1')),
  true,
  'and marks the audit row undone'
);
select is(
  (select status::text from public.review_queue where transaction_id = (select id from ja_ref where label = 'a1')),
  'open',
  'the line stays in review'
);
select tests.authenticate_as('ja_owner');
select throws_ok(
  format($$select public.undo_jev_prefill(%L)$$, (select id from ja_ref where label = 'a1')),
  'nothing to undo',
  'a second undo has nothing to undo'
);
reset role;
update public.transactions set user_assigned = true where id = (select id from ja_ref where label = 'a4');
update public.review_queue set status = 'approved' where transaction_id = (select id from ja_ref where label = 'i1');
select tests.authenticate_as('ja_owner');
select throws_ok(
  format($$select public.undo_jev_prefill(%L)$$, (select id from ja_ref where label = 'a4')),
  'line changed since',
  'a line the owner changed since is not undone'
);
select throws_ok(
  format($$select public.undo_jev_prefill(%L)$$, (select id from ja_ref where label = 'i1')),
  'review item not found',
  'a filed line is not undone'
);
select throws_ok(
  format($$select public.undo_jev_prefill(%L)$$, (select id from ja_ref where label = 'd2')),
  'nothing to undo',
  'a line Jev did not fill has nothing to undo'
);
insert into ja_out (label, result) select 'status2', public.mcp_jev_status();
select tests.authenticate_as('ja_other');
select throws_ok(
  format($$select public.undo_jev_prefill(%L)$$, (select id from ja_ref where label = 'd1')),
  'transaction not found',
  'another company cannot undo the fill'
);
reset role;
select is(
  (select jsonb_build_array(result->'prefilled_today', result->'prefilled_open') from ja_out where label = 'status2'),
  '[3, 2]'::jsonb,
  'an undone fill and a filed line leave the counts'
);
select is(
  (select project_id from public.transactions where id = (select id from ja_ref where label = 'd1')),
  (select id from ja_ref where label = 'p1'),
  'the other company''s attempt changed nothing'
);

update public.transactions set category_assigned = true, category_suggested = false
where id = (select id from ja_ref where label = 'd1');
select tests.authenticate_as('ja_owner');
select throws_ok(
  format($$select public.undo_jev_prefill(%L)$$, (select id from ja_ref where label = 'd1')),
  'line changed since',
  'a category the owner confirmed since is not undone'
);
reset role;

-- MCP undo_jev_prefill.
select public.store_mcp_credential(tests.get_supabase_uid('ja_owner'), 'hash-ja-write001', array['read','write'],
  now() + interval '90 days', 'pepper-1');
insert into ja_ref (label, id) select 'tok', id from private.mcp_credentials where token_hash = 'hash-ja-write001';
create or replace function pg_temp.ja_mcp()
returns void
language plpgsql
as $$
declare
  uid uuid := tests.get_supabase_uid('ja_owner');
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', uid, 'role', 'authenticated', 'aal', 'aal1', 'mcp_tid', (select id from ja_ref where label = 'tok'))::text, true);
end;
$$;
grant execute on function pg_temp.ja_mcp() to authenticated, service_role;
do $$ begin perform pg_temp.ja_mcp(); end $$;
insert into ja_out (label, result)
select 'mcp_' || l, public.mcp_undo_jev_prefill('ja-' || l, (select id from ja_ref where label = l))
from unnest(array['a4', 'd1', 'd2', 'i1']) l;
insert into ja_out (label, result)
select 'mcp_a4_replay', public.mcp_undo_jev_prefill('ja-a4', (select id from ja_ref where label = 'a4'));
reset role;
select is(
  (select jsonb_object_agg(label, coalesce(result->'error'->>'code', 'ok')) from ja_out where label like 'mcp_%'),
  '{"mcp_a4": "conflict", "mcp_d1": "conflict", "mcp_d2": "not_found", "mcp_i1": "already_closed", "mcp_a4_replay": "conflict"}'::jsonb,
  'MCP undo maps a changed line to conflict, no fill to not_found, a filed line to already_closed, and replays'
);

-- 5. The one-call split approval takes only a visible expense category.
select tests.authenticate_as('ja_owner');
select throws_ok(
  format($$select public.approve_split_review(%L, %L)$$,
    (select q.id from public.review_queue q where q.transaction_id = (select id from ja_ref where label = 'sp')),
    (select id from ja_ref where label = 'cat_inc')),
  'category kind must match the direction',
  'an income category is refused on a split expense'
);
select throws_ok(
  format($$select public.approve_split_review(%L, %L)$$,
    (select q.id from public.review_queue q where q.transaction_id = (select id from ja_ref where label = 'sp')),
    (select id from ja_ref where label = 'cat_hidden')),
  'category not found',
  'a hidden category is refused'
);
reset role;
select is(
  (select jsonb_build_array(t.category_id = (select id from ja_ref where label = 'cat1'), q.status)
   from public.transactions t join public.review_queue q on q.transaction_id = t.id
   where t.id = (select id from ja_ref where label = 'sp')),
  '[true, "open"]'::jsonb,
  'and the line is unchanged and open'
);

-- Access.
select ok(
  has_function_privilege('authenticated', 'public.undo_jev_prefill(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.undo_jev_prefill(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.mcp_undo_jev_prefill(text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.mcp_undo_jev_prefill(text, uuid)', 'execute'),
  'members can undo; anon cannot'
);
select ok(
  not has_function_privilege('authenticated', 'public.jev_prefill(uuid, uuid, uuid, uuid, text, numeric)', 'execute')
  and has_function_privilege('service_role', 'public.jev_prefill(uuid, uuid, uuid, uuid, text, numeric)', 'execute'),
  'only the job pre-fills'
);
select ok(
  has_table_privilege('authenticated', 'public.jev_prefills', 'select')
  and not has_table_privilege('authenticated', 'public.jev_prefills', 'insert')
  and not has_table_privilege('authenticated', 'public.jev_prefills', 'update')
  and not has_table_privilege('anon', 'public.jev_prefills', 'select'),
  'members read the audit trail and cannot write it'
);
select tests.authenticate_as('ja_other');
select is(
  (select count(*)::integer from public.jev_prefills),
  0,
  'another company sees none of the audit rows'
);
reset role;

select * from finish();
rollback;
