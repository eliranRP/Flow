-- FLOW-210: undo_batch of a created project or category a line already uses is a conflict for
-- that row; create_projects with status finished. Names are invented. Emails use @example.com.

begin;

select plan(16);

do $users$
begin
  perform tests.create_supabase_user('bsf_owner', 'bsf-owner@example.com');
end
$users$;

create temp table bsf (label text primary key, id uuid);
grant all on bsf to authenticated, service_role;

create or replace function pg_temp.as_mcp(p_label text, p_user text default 'bsf_owner')
returns void
language plpgsql
set search_path = ''
as $$
declare
  uid uuid;
  tid uuid;
begin
  uid := tests.get_supabase_uid(p_user);
  select id into tid from pg_temp.bsf where label = p_label;
  if uid is null or tid is null then
    raise exception 'missing mcp actor %', p_label;
  end if;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', uid,
      'role', 'authenticated',
      'aal', 'aal1',
      'mcp_tid', tid
    )::text,
    true
  );
end;
$$;
grant execute on function pg_temp.as_mcp(text, text) to authenticated, service_role;

select tests.authenticate_as('bsf_owner');
select lives_ok($$select public.create_company('Fixture Co', true)$$, 'owner creates a company');
insert into bsf (label, id) select 'company', id from public.companies;

reset role;

select lives_ok(
  format(
    $$select public.store_mcp_credential(%L::uuid, 'hash-bsf-write01', array['read','write'], now() + interval '90 days', 'pepper-1')$$,
    tests.get_supabase_uid('bsf_owner')
  ),
  'store write token'
);
insert into bsf (label, id) select 'write', id from private.mcp_credentials where token_hash = 'hash-bsf-write01';

do $$ begin perform pg_temp.as_mcp('write'); end $$;

create temp table bsf_out (label text primary key, body jsonb);
grant all on bsf_out to authenticated, service_role;

insert into bsf_out (label, body)
select 'projects', public.mcp_create_projects('fu-p', '[
  {"name": "Used Site"},
  {"name": "Free Site"},
  {"name": "Done Site", "status": "finished"}
]'::jsonb);
insert into bsf_out (label, body)
select 'categories', public.mcp_create_categories('fu-c', '[
  {"name": "Used Cost", "kind": "expense"},
  {"name": "Free Cost", "kind": "expense"}
]'::jsonb);

select is((select body->'data'->>'ok_count' from bsf_out where label = 'projects'), '3', 'the three projects are created');
select is(
  (select status::text from public.projects where name = 'Done Site'),
  'finished', 'a project created with status finished is finished');
select is(
  (select status::text from public.projects where name = 'Free Site'),
  'active', 'a project with no status is active');
select is(
  (select body->'data'->'results'->2->>'ok' from bsf_out where label = 'projects'),
  'true', 'the finished row is a normal created row');

-- A line already uses Used Site and Used Cost.
reset role;
insert into public.transactions (
  company_id, direction, doc_kind, line_status, currency,
  amount_gross, amount_net, amount_original, vat_amount, vat_status,
  doc_date, cash_date, source, idempotency_key, project_id, category_id, description,
  user_assigned, category_assigned, category_suggested, pnl_role
)
values (
  (select id from bsf where label = 'company'), 'expense', 'receipt', 'posted', 'ILS',
  -5000, -5000, 5000, 0, 'source', '2026-06-10', '2026-06-10', 'manual', 'bsf:used',
  (select id from public.projects where name = 'Used Site'),
  (select id from public.categories where name = 'Used Cost'), 'bsf:used',
  true, true, false, 'project'
);

do $$ begin perform pg_temp.as_mcp('write'); end $$;

insert into bsf_out (label, body)
select 'undo_p', public.mcp_undo_batch('fu-undo-p', (select body->'data'->>'batch_key' from bsf_out where label = 'projects'));
insert into bsf_out (label, body)
select 'undo_c', public.mcp_undo_batch('fu-undo-c', (select body->'data'->>'batch_key' from bsf_out where label = 'categories'));

create or replace function pg_temp.undo_row(p_label text, p_name text)
returns jsonb
language sql
as $$
  select r from pg_temp.bsf_out o, jsonb_array_elements(o.body->'data'->'results') r
  where o.label = p_label and r->>'name' = p_name;
$$;
grant execute on function pg_temp.undo_row(text, text) to authenticated, service_role;

select is(pg_temp.undo_row('undo_p', 'Used Site')->>'code', 'conflict',
  'undo_batch: a created project a line uses is a conflict for that row');
select is(pg_temp.undo_row('undo_p', 'Free Site')->>'ok', 'true', 'the unused project is removed');
select is(pg_temp.undo_row('undo_p', 'Done Site')->>'ok', 'true', 'and so is the finished one');
select is((select body->'data'->>'ok_count' from bsf_out where label = 'undo_p'), '2', 'two of three project rows undone');
select is(
  (select count(*)::int from public.projects where name in ('Used Site', 'Free Site', 'Done Site')),
  1, 'the used project stays, the others are gone');
select is(
  (select project_id from public.transactions where idempotency_key = 'bsf:used'),
  (select id from public.projects where name = 'Used Site'), 'the line keeps its project');

select is(pg_temp.undo_row('undo_c', 'Used Cost')->>'code', 'conflict',
  'undo_batch: a created category a line uses is a conflict for that row');
select is(pg_temp.undo_row('undo_c', 'Free Cost')->>'ok', 'true', 'the unused category is removed');
select is(
  (select count(*)::int from public.categories where name in ('Used Cost', 'Free Cost')),
  1, 'the used category stays');
select is(
  (select category_id from public.transactions where idempotency_key = 'bsf:used'),
  (select id from public.categories where name = 'Used Cost'), 'the line keeps its category');

reset role;

select * from finish();

rollback;
