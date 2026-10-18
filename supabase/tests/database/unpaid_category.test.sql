-- list_unpaid sends each open invoice's category (the forecast's לפי קטגוריה): its id and name, or null
-- when the document is not filed. Invented data only. Amounts are agorot.

begin;

select plan(4);

do $users$
begin
  perform tests.create_supabase_user('uc_owner', 'uc-owner@example.com');
end
$users$;

create temp table uc (label text primary key, id uuid);
grant all on uc to authenticated, service_role;
insert into uc (label, id) values ('co', tests.fixture_company('uc_owner', 'Example Unpaid Category LLC'));
insert into uc (label, id) select 'fees', tests.fixture_category(id, 'Example fees', 'income') from uc where label = 'co';

insert into uc (label, id)
select 'filed', tests.fixture_line(id, 'uc:filed', 500000, 'income', null, (select id from uc where label = 'fees'), '2026-10-01', p_doc_kind => 'invoice') from uc where label = 'co';
insert into uc (label, id)
select 'unfiled', tests.fixture_line(id, 'uc:unfiled', 300000, 'income', null, null, '2026-10-02', p_doc_kind => 'invoice') from uc where label = 'co';
update public.transactions set external_id = idempotency_key where company_id = (select id from uc where label = 'co');

create or replace function pg_temp.row_of(p_label text)
returns jsonb
language sql
as $$
  select u from jsonb_array_elements(public.list_unpaid()) u where (u ->> 'id')::uuid = (select id from pg_temp.uc where label = p_label);
$$;
grant execute on function pg_temp.row_of(text) to authenticated;

select tests.authenticate_as('uc_owner');

select is((pg_temp.row_of('filed') ->> 'category_id')::uuid, (select id from uc where label = 'fees'), 'a filed invoice sends its category id');
select is(pg_temp.row_of('filed') ->> 'category_name', 'Example fees', 'and its name');
select ok(pg_temp.row_of('unfiled') ? 'category_id' and pg_temp.row_of('unfiled') -> 'category_id' = 'null'::jsonb, 'an invoice not filed sends a null category');
select is(jsonb_array_length(public.list_unpaid()), 2, 'the list keeps every open invoice');

select * from finish();
rollback;
