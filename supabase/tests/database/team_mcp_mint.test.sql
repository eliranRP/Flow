-- FLOW-601 (decision 0167). A flow-mcp key is made for the company the app shows (p_hint, from its
-- x-flow-company header) when the user owns it, else the one they last switched to; never for a
-- company they only edit or a stranger's. Invented names and @example.com emails only.

begin;

select plan(6);

do $users$
begin
  perform tests.create_supabase_user('tk_owner', 'tk-owner@example.com');
  perform tests.create_supabase_user('tk_other', 'tk-other@example.com');
end
$users$;

create temp table tk (label text primary key, id uuid);
grant all on tk to authenticated, service_role;
insert into tk (label, id) values
  ('a', tests.fixture_company('tk_owner', 'Example Keys')),
  ('other_co', tests.fixture_company('tk_other', 'Example Other Keys')),
  ('owner', tests.get_supabase_uid('tk_owner'));

select tests.authenticate_as('tk_owner');
insert into tk (label, id) select 'b', public.create_company('Example Keys Two', true);
select public.switch_company((select id from tk where label = 'a'));

-- The owner edits tk_other's company too (a member row, as accept_invite writes it).
reset role;
insert into public.company_members (company_id, user_id, role)
values ((select id from tk where label = 'other_co'), (select id from tk where label = 'owner'), 'editor');

create or replace function pg_temp.minted_for(p_hash text, p_hint uuid)
returns text
language plpgsql
as $$
declare
  cred uuid;
begin
  cred := public.store_mcp_credential((select id from pg_temp.tk where label = 'owner'), p_hash,
    array['read', 'write'], now() + interval '90 days', 'pepper-1', p_hint);
  return (select t.label from pg_temp.tk t join private.mcp_credentials c on c.company_id = t.id where c.id = cred);
end;
$$;

select is(pg_temp.minted_for('hash-tk-0000000001', null), 'a', 'without a hint, the company last switched to');
select is(pg_temp.minted_for('hash-tk-0000000002', (select id from tk where label = 'b')), 'b',
  'the company the app shows when the owner owns it');
select is(pg_temp.minted_for('hash-tk-0000000003', (select id from tk where label = 'a')), 'a', 'and the other one');
select throws_ok(
  format($$select public.store_mcp_credential(%L, 'hash-tk-0000000004', array['read'], now() + interval '1 day', 'pepper-1', %L)$$,
    (select id from tk where label = 'owner'), (select id from tk where label = 'other_co')),
  'P0001', 'no company', 'a company the user only edits gets no key');
update public.active_companies set company_id = (select id from tk where label = 'other_co')
where user_id = (select id from tk where label = 'owner');
select throws_ok(
  format($$select public.store_mcp_credential(%L, 'hash-tk-0000000005', array['read'], now() + interval '1 day', 'pepper-1')$$,
    (select id from tk where label = 'owner')),
  'P0001', 'no company', 'nor does a key made with no hint while that company is open');
select is(pg_temp.minted_for('hash-tk-0000000006', (select id from tk where label = 'b')), 'b',
  'while the app''s hint still makes it for the owned company it shows');

select * from finish();
rollback;
