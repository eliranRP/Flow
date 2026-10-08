-- list_review returns customer_name for an income line, and get_transaction returns review_id,
-- the line's open review (UI lane 2 gaps for #175). Invented data only. Amounts are agorot.

begin;

select plan(7);

do $users$
begin
  perform tests.create_supabase_user('rpi_owner', 'rpi-owner@example.com');
  perform tests.create_supabase_user('rpi_viewer', 'rpi-viewer@example.com');
end
$users$;

create temp table rpi (label text primary key, id uuid);
grant all on rpi to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.rpi where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

insert into rpi (label, id) values ('co', tests.fixture_company('rpi_owner', 'Example Review Party LLC', true));
insert into public.company_viewers (user_id, company_id)
values (tests.get_supabase_uid('rpi_viewer'), pg_temp.id('co'));
insert into public.customers (company_id, name) values (pg_temp.id('co'), 'Example Tenant');
insert into rpi (label, id) select 'tenant', id from public.customers where company_id = pg_temp.id('co');
insert into rpi (label, id) values
  ('inc', tests.fixture_line(pg_temp.id('co'), 'rpi:inc', 50000, 'income')),
  ('exp', tests.fixture_line(pg_temp.id('co'), 'rpi:exp', 20000)),
  ('done', tests.fixture_line(pg_temp.id('co'), 'rpi:done', 30000));
update public.transactions set customer_id = pg_temp.id('tenant') where id = pg_temp.id('inc');
insert into public.review_queue (company_id, transaction_id, status, reason) values
  (pg_temp.id('co'), pg_temp.id('inc'), 'open', 'missing_project'),
  (pg_temp.id('co'), pg_temp.id('exp'), 'open', 'missing_category'),
  (pg_temp.id('co'), pg_temp.id('done'), 'approved', 'missing_category');
insert into rpi (label, id) select 'q_exp', id from public.review_queue where transaction_id = pg_temp.id('exp');

create function pg_temp.review_field(p_line text, p_field text) returns text
language sql
as $$
  select r->>p_field from jsonb_array_elements(public.list_review()) r
  where (r->>'transaction_id')::uuid = pg_temp.id(p_line)
$$;
grant execute on function pg_temp.review_field(text, text) to authenticated;

select tests.authenticate_as('rpi_owner');
select is(pg_temp.review_field('inc', 'customer_name'), 'Example Tenant', 'an income review names its customer');
select ok((select r ? 'customer_name' and r->'customer_name' = 'null'::jsonb
           from jsonb_array_elements(public.list_review()) r
           where (r->>'transaction_id')::uuid = pg_temp.id('exp')),
  'a line with no customer has customer_name null');
select is((public.get_transaction(pg_temp.id('exp'))->>'review_id')::uuid, pg_temp.id('q_exp'),
  'get_transaction gives the open review''s id');
select is(public.get_transaction(pg_temp.id('done'))->'review_id', 'null'::jsonb,
  'and null when the line has no open review');
select is(public.get_transaction(pg_temp.id('exp'))->>'review_reason', 'missing_category', 'review_reason is unchanged');

select tests.authenticate_as('rpi_viewer');
select is(pg_temp.review_field('inc', 'customer_name'), 'Example Tenant', 'a viewer reads the customer name too');
select is((public.get_transaction(pg_temp.id('exp'))->>'review_id')::uuid, pg_temp.id('q_exp'), 'and the review id');

select * from finish();
rollback;
