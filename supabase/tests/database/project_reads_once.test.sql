-- Project page speed, round 5 (20261014093004_project_reads_once.sql): get_project reads the
-- project's lines once, and the overhead share passes only lines that can be income or
-- overhead. The share must still count an overhead part of a split line and an income-kind
-- line filed as an expense. Invented data only. Amounts are agorot.

begin;

select plan(7);

do $users$
begin
  perform tests.create_supabase_user('pro_owner', 'pro-owner@example.com');
end
$users$;

create temp table pro (label text primary key, id uuid);
grant all on pro to authenticated, service_role;

insert into pro (label, id) values ('co', tests.fixture_company('pro_owner', 'Example Reads Once LLC'));
insert into pro (label, id) values
  ('alpha', tests.fixture_project((select id from pro where label = 'co'), 'Alpha')),
  ('beta', tests.fixture_project((select id from pro where label = 'co'), 'Beta')),
  ('office', tests.fixture_project((select id from pro where label = 'co'), 'Office')),
  ('sales', tests.fixture_category((select id from pro where label = 'co'), 'Sales', 'income')),
  ('costs', tests.fixture_category((select id from pro where label = 'co'), 'Costs'));

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.pro where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- Income: Alpha 6,000,000 less a 3,000,000 refund filed as an expense in an income category,
-- Beta 4,000,000. Overhead: 1,000,000 filed to Office, and a 2,000,000 line with no project
-- split 500,000 to Office and 1,500,000 to Beta.
insert into pro (label, id) values
  ('alpha_in', tests.fixture_line(pg_temp.id('co'), 'pro:alpha_in', 6000000, 'income', pg_temp.id('alpha'), pg_temp.id('sales'), p_doc_kind => 'invoice')),
  ('alpha_refund', tests.fixture_line(pg_temp.id('co'), 'pro:alpha_refund', 3000000, 'expense', pg_temp.id('alpha'), pg_temp.id('sales'), p_doc_kind => 'expense')),
  ('beta_in', tests.fixture_line(pg_temp.id('co'), 'pro:beta_in', 4000000, 'income', pg_temp.id('beta'), pg_temp.id('sales'), p_doc_kind => 'invoice')),
  ('office_cost', tests.fixture_line(pg_temp.id('co'), 'pro:office_cost', 1000000, 'expense', pg_temp.id('office'), pg_temp.id('costs'), p_doc_kind => 'expense')),
  ('split', tests.fixture_line(pg_temp.id('co'), 'pro:split', 2000000, 'expense', null, pg_temp.id('costs'), p_doc_kind => 'expense'));

select tests.authenticate_as('pro_owner');

select public.set_overhead_project(pg_temp.id('office'));
select public.save_line_split(pg_temp.id('split'), jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.id('costs'), 'project_id', pg_temp.id('office'), 'amount_minor', 500000),
  jsonb_build_object('category_id', pg_temp.id('costs'), 'project_id', pg_temp.id('beta'), 'amount_minor', 1500000)
));

create or replace function pg_temp.share(p_project text)
returns bigint
language sql
as $$ select (public.get_project(pg_temp.id(p_project), 'invoiced') ->> 'overhead_share_agorot')::bigint; $$;
grant execute on function pg_temp.share(text) to authenticated, service_role;

select is(
  pg_temp.share('alpha') + pg_temp.share('beta'),
  1500000::bigint,
  'the shares add up to the overhead, the split line''s Office part included'
);
select ok(
  pg_temp.share('alpha') < pg_temp.share('beta'),
  'the refund filed as an expense in an income category lowers Alpha''s weight'
);
select is(
  (public.get_project(pg_temp.id('alpha'), 'invoiced') ->> 'income_agorot')::bigint,
  3000000::bigint,
  'Alpha''s income nets the refund'
);
select is(
  (public.get_project(pg_temp.id('beta'), 'invoiced') ->> 'direct_agorot')::bigint,
  1500000::bigint,
  'Beta''s direct cost is its part of the split line'
);

reset role;

-- The structure the speed depends on: one read of the view and one category pass.
select is(
  (select (length(d) - length(replace(d, 'from private.pnl_lines u', ''))) / length('from private.pnl_lines u')
   from pg_get_functiondef('public.get_project(uuid,text,date,date)'::regprocedure) d),
  1,
  'get_project reads private.pnl_lines for its totals once'
);
select is(
  (select (length(d) - length(replace(d, 'project_category_entries_by_currency(', ''))) / length('project_category_entries_by_currency(')
   from pg_get_functiondef('public.get_project(uuid,text,date,date)'::regprocedure) d),
  1,
  'get_project runs the category entries once'
);
select is(
  (select count(*)::integer
   from pg_proc p
   where p.oid in ('private.overhead_share_for(uuid,uuid,text,date,date)'::regprocedure,
                   'private.overhead_share_for(uuid,uuid,text,date,date,text)'::regprocedure)
     and pg_get_functiondef(p.oid) like '%select s.transaction_id from public.line_splits s where s.company_id = p_company%'),
  2,
  'both overhead_share_for overloads pass only the lines that can be income or overhead'
);

select * from finish();
rollback;
