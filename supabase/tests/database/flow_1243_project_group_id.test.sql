-- FLOW-1243 (perf queue): get_project answers the project's group id (projects.group_id), so the ⋯ menu's
-- groups read is one request. Both answers carry the key (the lean one the app asks, and flow-mcp's default);
-- an ungrouped project has it null; a move shows at once; another company gets nothing. Invented data only.

begin;

select plan(7);

do $users$
begin
  perform tests.create_supabase_user('f1243_owner', 'f1243-owner@example.com');
  perform tests.create_supabase_user('f1243_other', 'f1243-other@example.com');
end
$users$;

create temp table f1243 (label text primary key, id uuid);
grant all on f1243 to authenticated, service_role;

select tests.authenticate_as('f1243_owner');
do $c$ begin perform public.create_company('F1243 Books', true); end $c$;
do $p$ begin
  perform public.upsert_project(null, 'F1243 Grouped', null, 'active');
  perform public.upsert_project(null, 'F1243 Loose', null, 'active');
  perform public.upsert_project_group(null, 'F1243 Group');
  perform public.upsert_project_group(null, 'F1243 Other Group');
end $p$;
insert into f1243 (label, id) select 'grouped', id from public.projects where name = 'F1243 Grouped';
insert into f1243 (label, id) select 'loose', id from public.projects where name = 'F1243 Loose';
insert into f1243 (label, id) select 'group', id from public.project_groups where name = 'F1243 Group';
insert into f1243 (label, id) select 'group2', id from public.project_groups where name = 'F1243 Other Group';
select public.set_project_group(
  (select id from f1243 where label = 'grouped'),
  (select id from f1243 where label = 'group')
);

-- The lean answer the app asks (p_lines false): the group id is the project's, and null for a loose project.
select is(
  public.get_project((select id from f1243 where label = 'grouped'), 'invoiced', null, null, false)->>'group_id',
  (select id::text from f1243 where label = 'group'),
  'the lean read names the project''s group'
);
select is(
  public.get_project((select id from f1243 where label = 'loose'), 'invoiced', null, null, false)->'group_id',
  'null'::jsonb,
  'an ungrouped project has group_id null, the key present'
);
-- flow-mcp's default answer (lines on) carries it too.
select is(
  public.get_project((select id from f1243 where label = 'grouped'), 'invoiced')->>'group_id',
  (select id::text from f1243 where label = 'group'),
  'the default answer carries group_id too'
);
-- A move shows on the next read.
select public.set_project_group(
  (select id from f1243 where label = 'grouped'),
  (select id from f1243 where label = 'group2')
);
select is(
  public.get_project((select id from f1243 where label = 'grouped'), 'invoiced', null, null, false)->>'group_id',
  (select id::text from f1243 where label = 'group2'),
  'a move shows on the next read'
);
-- The keys the app already reads are still there.
select ok(
  public.get_project((select id from f1243 where label = 'loose'), 'invoiced', null, null, false) ?& array['id', 'name', 'status', 'state_label', 'budget_agorot'],
  'the keys the app reads are unchanged'
);

-- Grants: the same as before the change, no anon.
select ok(
  has_function_privilege('authenticated', 'public.get_project(uuid,text,date,date,boolean)', 'execute')
    and not has_function_privilege('anon', 'public.get_project(uuid,text,date,date,boolean)', 'execute'),
  'authenticated executes get_project and anon does not'
);

-- Another company.
select tests.authenticate_as('f1243_other');
do $o$ begin perform public.create_company('F1243 Other Books', true); end $o$;
select is(
  public.get_project((select id from f1243 where label = 'grouped'), 'invoiced', null, null, false),
  null,
  'another company gets nothing for the project'
);

select * from finish();
rollback;
