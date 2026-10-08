-- FLOW-701 part 2 (decision 0126). A resolved review line with a Jev suggestion records
-- what Jev suggested against what the line was filed as. MCP get_jev_accuracy sums them.
-- The trigger is deferred, so each step ends with `set constraints all immediate`.
-- Helpers come from supabase/tests/helpers.sql.

begin;

select plan(43);

do $users$
begin
  perform tests.create_supabase_user('jo_owner');
  perform tests.create_supabase_user('jo_other');
end
$users$;

select tests.authenticate_as('jo_owner');
select lives_ok($$select public.create_company('עסק א', true)$$, 'owner creates a company');
select tests.authenticate_as('jo_other');
select lives_ok($$select public.create_company('עסק ב', true)$$, 'other owner creates a company');
reset role;

create temp table jo_ref (label text primary key, id uuid);
grant all on jo_ref to anon, authenticated, service_role;

insert into jo_ref (label, id)
select 'company_a', c.id from public.companies c
join auth.users u on u.id = c.owner_id
where u.raw_user_meta_data ->> 'test_identifier' = 'jo_owner';
insert into jo_ref (label, id)
select 'company_b', c.id from public.companies c
join auth.users u on u.id = c.owner_id
where u.raw_user_meta_data ->> 'test_identifier' = 'jo_other';

insert into public.projects (company_id, name)
select id, 'בניין צפון' from jo_ref where label = 'company_a';
insert into public.projects (company_id, name)
select id, 'בניין דרום' from jo_ref where label = 'company_a';
insert into jo_ref (label, id) select 'p1', id from public.projects where name = 'בניין צפון';
insert into jo_ref (label, id) select 'p2', id from public.projects where name = 'בניין דרום';
insert into jo_ref (label, id)
select 'c1', c.id from public.categories c
where c.company_id = (select id from jo_ref where label = 'company_a') and c.kind = 'expense'
order by c.name limit 1;
insert into jo_ref (label, id)
select 'c2', c.id from public.categories c
where c.company_id = (select id from jo_ref where label = 'company_a') and c.kind = 'expense'
  and c.id <> (select id from jo_ref where label = 'c1')
order by c.name limit 1;

-- Twelve open lines in company A, one in company B.
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description
)
select (select id from jo_ref where label = 'company_a'), 'expense', 'expense', 'project',
  -11800, -10000, -1800, 'assumed', '2026-04-12', '2026-04-12', 'sumit', 'sumit:jo-' || n, 'line ' || n
from generate_series(1, 12) n;
insert into public.transactions (
  company_id, direction, doc_kind, pnl_role,
  amount_gross, amount_net, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, description
)
select (select id from jo_ref where label = 'company_b'), 'expense', 'expense', 'project',
  -11800, -10000, -1800, 'assumed', '2026-04-12', '2026-04-12', 'sumit', 'sumit:jo-b', 'line b';
insert into jo_ref (label, id)
select 't' || substr(idempotency_key, 10), id from public.transactions where idempotency_key like 'sumit:jo-%';

insert into public.review_queue (company_id, transaction_id, status, reason)
select t.company_id, t.id, 'open', 'test'
from public.transactions t
where t.idempotency_key like 'sumit:jo-%'
  and not exists (select 1 from public.review_queue q where q.transaction_id = t.id);
update public.review_queue q set status = 'open'
from public.transactions t
where t.id = q.transaction_id and t.idempotency_key like 'sumit:jo-%';
set constraints all immediate;
set constraints all deferred;

-- Jev suggests p1 and c1 on lines 1 to 5 and 7; line 6 gets an answer that is not an id.
insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
select t.company_id, t.id,
  jsonb_build_object(
    'project', jsonb_build_object('choice', (select id from jo_ref where label = 'p1'), 'confidence', 0.95),
    'category', jsonb_build_object('choice', (select id from jo_ref where label = 'c1'), 'confidence', 0.95)
  ),
  case r.label when 't1' then 0.95 when 't2' then 0.8 else 0.5 end,
  'jev-1.13.0', 'jev-1.13.0'
from jo_ref r join public.transactions t on t.id = r.id
where r.label in ('t1', 't2', 't3', 't4', 't7', 't8', 't9', 't10', 't11', 't12', 'tb');
insert into public.tag_suggestions (company_id, transaction_id, answers, confidence, model_version, response_model)
select t.company_id, t.id, '{"project": {"choice": "not-an-id"}, "category": {"choice": 7}}'::jsonb, 0.99,
  'jev-1.13.0', 'jev-1.13.0'
from jo_ref r join public.transactions t on t.id = r.id where r.label = 't6';

-- t1: filed as suggested and approved.
update public.transactions set project_id = (select id from jo_ref where label = 'p1'),
  category_id = (select id from jo_ref where label = 'c1')
where id = (select id from jo_ref where label = 't1');
update public.review_queue set status = 'approved' where transaction_id = (select id from jo_ref where label = 't1');
-- t2: another project, same category, changed.
update public.transactions set project_id = (select id from jo_ref where label = 'p2'),
  category_id = (select id from jo_ref where label = 'c1')
where id = (select id from jo_ref where label = 't2');
update public.review_queue set status = 'changed' where transaction_id = (select id from jo_ref where label = 't2');
-- t3: a shared cost, category matched.
update public.transactions set pnl_role = 'shared', project_id = null,
  category_id = (select id from jo_ref where label = 'c1')
where id = (select id from jo_ref where label = 't3');
update public.review_queue set status = 'approved' where transaction_id = (select id from jo_ref where label = 't3');
-- t4: skipped.
update public.review_queue set status = 'skipped' where transaction_id = (select id from jo_ref where label = 't4');
-- t5: approved with no Jev suggestion.
update public.transactions set category_id = (select id from jo_ref where label = 'c2')
where id = (select id from jo_ref where label = 't5');
update public.review_queue set status = 'approved' where transaction_id = (select id from jo_ref where label = 't5');
-- t6: approved, Jev's answer was not an id.
update public.transactions set project_id = (select id from jo_ref where label = 'p1'),
  category_id = (select id from jo_ref where label = 'c2')
where id = (select id from jo_ref where label = 't6');
update public.review_queue set status = 'approved' where transaction_id = (select id from jo_ref where label = 't6');
-- t7: approved, category changed in the same transaction after the review row moved.
update public.review_queue set status = 'approved' where transaction_id = (select id from jo_ref where label = 't7');
update public.transactions set project_id = (select id from jo_ref where label = 'p1'),
  category_id = (select id from jo_ref where label = 'c2')
where id = (select id from jo_ref where label = 't7');
-- tb: company B, approved as suggested ids (which are not B's).
update public.review_queue set status = 'approved' where transaction_id = (select id from jo_ref where label = 'tb');

select is(
  (select count(*)::integer from public.jev_outcomes o join jo_ref r on r.id = o.transaction_id),
  0, 'nothing is recorded before the deferred trigger runs'
);
set constraints all immediate;
set constraints all deferred;

select is(
  (select project_match::text || '/' || category_match::text || '/' || review_status::text
   from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't1')),
  'true/true/approved', 'a line filed as suggested matches both fields'
);
select is(
  (select project_match::text || '/' || category_match::text || '/' || review_status::text
   from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't2')),
  'false/true/changed', 'another project is a project miss'
);
select is(
  (select final_project_id from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't2')),
  (select id from jo_ref where label = 'p2'), 'the filed project is stored'
);
select ok(
  (select project_match is null and category_match from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't3')),
  'a shared cost is not compared on project'
);
select is(
  (select count(*)::integer from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't4')),
  0, 'a skipped line is not recorded'
);
select is(
  (select count(*)::integer from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't5')),
  0, 'a line with no suggestion is not recorded'
);
select ok(
  (select suggested_project_id is null and suggested_category_id is null
      and project_match is null and category_match is null
   from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't6')),
  'an answer that is not an id is not compared'
);
select is(
  (select category_match::text || '/' || (final_category_id = (select id from jo_ref where label = 'c2'))::text
   from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't7')),
  'false/true', 'the outcome reads the line at commit, after the approval wrote it'
);
select is(
  (select company_id from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 'tb')),
  (select id from jo_ref where label = 'company_b'), 'company B keeps its own row'
);

-- Undo: the line goes back to open, so its outcome goes away; approving again brings it back.
update public.review_queue set status = 'open' where transaction_id = (select id from jo_ref where label = 't7');
set constraints all immediate;
set constraints all deferred;
select is(
  (select count(*)::integer from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't7')),
  0, 'a reopened line has no outcome'
);
update public.transactions set category_id = (select id from jo_ref where label = 'c1')
where id = (select id from jo_ref where label = 't7');
update public.review_queue set status = 'approved' where transaction_id = (select id from jo_ref where label = 't7');
set constraints all immediate;
set constraints all deferred;
select is(
  (select category_match from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't7')),
  true, 'approving again records the new result'
);

-- A split by category is not compared on category.
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, amount_minor)
select t.company_id, t.id, 1, (select id from jo_ref where label = 'c1'), 10000
from public.transactions t where t.id = (select id from jo_ref where label = 't1');
update public.review_queue set status = 'approved' where transaction_id = (select id from jo_ref where label = 't1');
set constraints all immediate;
set constraints all deferred;
select ok(
  (select category_match is null and project_match from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't1')),
  'a line split by category is not compared on category'
);
delete from public.line_splits where transaction_id = (select id from jo_ref where label = 't1');
update public.review_queue set status = 'approved' where transaction_id = (select id from jo_ref where label = 't1');
set constraints all immediate;
set constraints all deferred;

-- Permissions.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.jev_outcomes'::regclass),
  'jev_outcomes has row level security'
);
select ok(
  has_table_privilege('authenticated', 'public.jev_outcomes', 'select')
  and not has_table_privilege('authenticated', 'public.jev_outcomes', 'insert')
  and not has_table_privilege('authenticated', 'public.jev_outcomes', 'update')
  and not has_table_privilege('authenticated', 'public.jev_outcomes', 'delete')
  and not has_table_privilege('anon', 'public.jev_outcomes', 'select'),
  'members only read outcomes'
);
select ok(
  has_function_privilege('authenticated', 'public.mcp_jev_accuracy(date, date)', 'execute')
  and not has_function_privilege('anon', 'public.mcp_jev_accuracy(date, date)', 'execute')
  and not has_function_privilege('authenticated', 'private.jev_outcome_sync(uuid, uuid)', 'execute'),
  'members read the report; nobody else calls the sync'
);

-- Report for company A: t1, t2, t3, t6, t7.
select tests.authenticate_as('jo_owner');
select is(
  (select count(*)::integer from public.jev_outcomes),
  5, 'the owner sees their own outcomes'
);
select is((public.mcp_jev_accuracy() ->> 'lines')::integer, 5, 'five resolved lines with a suggestion');
select is((public.mcp_jev_accuracy() ->> 'all_matched')::integer, 3, 't1, t3 and t7 match on every compared field');
select is(
  (select (r ->> 'project_compared') || '/' || (r ->> 'project_matched') from (select public.mcp_jev_accuracy() r) x),
  '3/2', 'project: t1, t2 and t7 compared, t1 and t7 matched'
);
select is(
  (select (r ->> 'category_compared') || '/' || (r ->> 'category_matched') from (select public.mcp_jev_accuracy() r) x),
  '4/4', 'category: t1, t2, t3 and t7 compared and matched'
);
select is(
  public.mcp_jev_accuracy() -> 'at_threshold',
  '{"lines": 2, "all_matched": 1}'::jsonb,
  'at the default 0.90 threshold: t1 and t6, one matched'
);
select is(
  (select jsonb_agg(b -> 'lines' order by b ->> 'band') from jsonb_array_elements(public.mcp_jev_accuracy() -> 'bands') b),
  '[2, 2, 1]'::jsonb, 'bands high 2, low 2, medium 1'
);
select is(
  (public.mcp_jev_accuracy('2000-01-01', '2000-01-31') ->> 'lines')::integer,
  0, 'a period with nothing resolved is empty'
);
select is(
  (public.mcp_jev_accuracy((now() at time zone 'utc')::date, (now() at time zone 'utc')::date) ->> 'lines')::integer,
  5, 'today holds every line resolved today'
);
select throws_ok(
  $$select public.mcp_jev_accuracy('2026-02-01', '2026-01-01')$$,
  'P0001', 'validation', 'from after to is refused'
);
reset role;
insert into public.company_integrations (company_id, provider, threshold)
select id, 'jev', 0.50 from jo_ref where label = 'company_a'
on conflict (company_id, provider) do update set threshold = excluded.threshold;
select tests.authenticate_as('jo_owner');
select is(
  public.mcp_jev_accuracy() -> 'at_threshold',
  '{"lines": 5, "all_matched": 3}'::jsonb,
  'the company threshold sets the cut'
);
select tests.authenticate_as('jo_other');
select is((public.mcp_jev_accuracy() ->> 'lines')::integer, 1, 'company B counts only its own line');
select is((select count(*)::integer from public.jev_outcomes), 1, 'company B reads only its own row');
reset role;

-- t8: the app's approve and reopen.
select tests.authenticate_as('jo_owner');
select public.resolve_review(
  (select q.id from public.review_queue q where q.transaction_id = (select id from jo_ref where label = 't8')),
  'approved', (select id from jo_ref where label = 'p1'), (select id from jo_ref where label = 'c1')
);
reset role;
set constraints all immediate;
set constraints all deferred;
select is(
  (select project_match::text || '/' || category_match::text
   from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't8')),
  'true/true', 'resolve_review records the outcome'
);
select tests.authenticate_as('jo_owner');
select public.reopen_review(
  (select q.id from public.review_queue q where q.transaction_id = (select id from jo_ref where label = 't8'))
);
reset role;
set constraints all immediate;
set constraints all deferred;
select is(
  (select count(*)::integer from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't8')),
  0, 'reopen_review removes it'
);

-- t9: approved, then a sync opens a new review row. The newest row is the line's review.
update public.transactions set project_id = (select id from jo_ref where label = 'p1'),
  category_id = (select id from jo_ref where label = 'c1')
where id = (select id from jo_ref where label = 't9');
update public.review_queue set status = 'approved' where transaction_id = (select id from jo_ref where label = 't9');
set constraints all immediate;
set constraints all deferred;
-- One test transaction shares now(), so the later row is dated a second on.
insert into public.review_queue (company_id, transaction_id, status, reason, created_at)
select company_id, id, 'open', 'test reopen', now() + interval '1 second' from public.transactions where id = (select id from jo_ref where label = 't9');
update public.transactions set category_id = (select id from jo_ref where label = 'c2')
where id = (select id from jo_ref where label = 't9');
set constraints all immediate;
set constraints all deferred;
select is(
  (select count(*)::integer from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't9')),
  0, 'a line back in review has no outcome, even with an older approved row'
);
update public.review_queue set status = 'skipped'
where transaction_id = (select id from jo_ref where label = 't9') and reason = 'test reopen';
set constraints all immediate;
set constraints all deferred;
select is(
  (select count(*)::integer from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't9')),
  0, 'skipping the new row records nothing'
);

-- t10 to t12: approved as suggested, then edited without touching the review.
update public.transactions set project_id = (select id from jo_ref where label = 'p1'),
  category_id = (select id from jo_ref where label = 'c1')
where id in (select id from jo_ref where label in ('t10', 't11', 't12'));
update public.review_queue set status = 'approved'
where transaction_id in (select id from jo_ref where label in ('t10', 't11', 't12'));
set constraints all immediate;
set constraints all deferred;
select is(
  (select count(*)::integer from public.jev_outcomes o join jo_ref r on r.id = o.transaction_id
   where r.label in ('t10', 't11', 't12') and o.project_match and o.category_match),
  3, 't10 to t12 match before the edits'
);
update public.transactions set removed_at = now() where id = (select id from jo_ref where label = 't10');
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
select t.company_id, t.id, n, (select id from jo_ref where label = 'c1'),
  (select id from jo_ref where label = case n when 1 then 'p1' else 'p2' end), 5000
from public.transactions t, generate_series(1, 2) n
where t.id = (select id from jo_ref where label = 't11');
update public.transactions set pnl_role = 'overhead', project_id = null
where id = (select id from jo_ref where label = 't12');
set constraints all immediate;
set constraints all deferred;
select is(
  (select count(*)::integer from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't10')),
  0, 'removing the line removes its outcome'
);
select ok(
  (select project_match is null and category_match is null
   from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't11')),
  'a split across two projects added after approval is no longer compared'
);
select ok(
  (select project_match is null and category_match
   from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't12')),
  'moving the line to overhead drops the project comparison'
);

-- t11 split again, every part on p2; t12 back on p1 and split {p2, no project}.
delete from public.line_splits where transaction_id = (select id from jo_ref where label = 't11');
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
select t.company_id, t.id, n, (select id from jo_ref where label = case n when 1 then 'c1' else 'c2' end),
  (select id from jo_ref where label = 'p2'), 5000
from public.transactions t, generate_series(1, 2) n
where t.id = (select id from jo_ref where label = 't11');
update public.transactions set pnl_role = 'project', project_id = (select id from jo_ref where label = 'p1')
where id = (select id from jo_ref where label = 't12');
insert into public.line_splits (company_id, transaction_id, ordinal, category_id, project_id, amount_minor)
select t.company_id, t.id, n, (select id from jo_ref where label = 'c1'),
  case n when 1 then (select id from jo_ref where label = 'p2') end, 5000
from public.transactions t, generate_series(1, 2) n
where t.id = (select id from jo_ref where label = 't12');
set constraints all immediate;
set constraints all deferred;
select is(
  (select project_match::text || '/' || (final_project_id = (select id from jo_ref where label = 'p2'))::text
   from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't11')),
  'false/true', 'every part on another project is a project miss on that project'
);
select ok(
  (select project_match is null from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't12')),
  'a part with no project keeps the line project, so a split with p2 spans two projects'
);

-- Deleting the newest review row makes the older one current again.
delete from public.review_queue
where transaction_id = (select id from jo_ref where label = 't9') and reason = 'test reopen';
set constraints all immediate;
set constraints all deferred;
select is(
  (select review_status::text from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 't9')),
  'approved', 'deleting the newer row brings back the approved outcome'
);

-- The suggestion row going away removes the outcome with it.
delete from public.tag_suggestions where transaction_id = (select id from jo_ref where label = 'tb');
select is(
  (select count(*)::integer from public.jev_outcomes where transaction_id = (select id from jo_ref where label = 'tb')),
  0, 'deleting the suggestion deletes the outcome'
);

select * from finish();
rollback;
