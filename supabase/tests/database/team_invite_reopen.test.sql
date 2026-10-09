-- FLOW-601 (decision 0167). A declined invite comes back only as the toast's undo, within 10 minutes
-- of the decline: the owner neither sees nor can cancel a declined invite. Invented names and
-- @example.com emails only.

begin;

select plan(7);

do $users$
begin
  perform tests.create_supabase_user('tv_owner', 'tv-owner@example.com');
  perform tests.create_supabase_user('tv_invitee', 'tv-invitee@example.com');
end
$users$;

-- The invitee signed in with Google with that address.
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'google', now(), now(), now()
from auth.users u
where u.email = 'tv-invitee@example.com';

create temp table tv (label text primary key, id uuid);
grant all on tv to authenticated, service_role;
insert into tv (label, id) values
  ('a', tests.fixture_company('tv_owner', 'Example Reopen')),
  ('invitee', tests.get_supabase_uid('tv_invitee'));

select tests.authenticate_as('tv_owner');
insert into tv (label, id) select 'inv', (public.invite_member('tv-invitee@example.com', 'editor')->>'id')::uuid;

select tests.authenticate_as('tv_invitee');
select is(public.decline_invite((select id from tv where label = 'inv'))->>'status', 'declined', 'the invitee declines');
select is(public.reopen_invite((select id from tv where label = 'inv'))->>'status', 'pending',
  'the toast''s undo right after brings it back (positive control)');
select is(public.decline_invite((select id from tv where label = 'inv'))->>'status', 'declined', 'and declines again');

-- Eleven minutes later the decline stands.
reset role;
update public.company_invites set decided_at = now() - interval '11 minutes' where id = (select id from tv where label = 'inv');
select tests.authenticate_as('tv_invitee');
select throws_ok(format('select public.reopen_invite(%L)', (select id from tv where label = 'inv')), 'P0001',
  'invite is not declined', 'a decline older than the toast cannot be taken back');
select throws_ok(format('select public.accept_invite(%L)', (select id from tv where label = 'inv')), 'P0001',
  'invite is not pending', 'so the invitee cannot join through it');
select is(private.readable_company_id(), null, 'and reads nothing');

select tests.authenticate_as('tv_owner');
select is(jsonb_array_length(public.list_team()->'members'), 1, 'the team is still only the owner');

select * from finish();
rollback;
