-- FLOW-601 (decision 0167). An invite matches the invitee's Google sign-in, not only the account
-- email, which its user can change. Invented names and @example.com emails only.

begin;

select plan(6);

do $users$
begin
  perform tests.create_supabase_user('ti_owner', 'ti-owner@example.com');
  perform tests.create_supabase_user('ti_invitee', 'ti-invitee@example.com');
  perform tests.create_supabase_user('ti_taker', 'ti-taker@example.com');
end
$users$;

-- Both sign in with Google, each with their own address.
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'google', now(), now(), now()
from auth.users u
where u.email in ('ti-invitee@example.com', 'ti-taker@example.com');

create temp table ti (label text primary key, id uuid);
grant all on ti to authenticated, service_role;
insert into ti (label, id) values ('a', tests.fixture_company('ti_owner', 'Example Identity'));

select tests.authenticate_as('ti_owner');
insert into ti (label, id) select 'inv', (public.invite_member('ti-invitee@example.com', 'editor')->>'id')::uuid;

-- ti_taker changes their account email to the invited one (updateUser with the email change
-- applied at once). Their Google sign-in still says ti-taker@example.com.
reset role;
update auth.users set email = 'ti-invitee-2@example.com' where email = 'ti-invitee@example.com';
update auth.users set email = 'ti-invitee@example.com' where email = 'ti-taker@example.com';

select tests.authenticate_as('ti_taker');
select is(public.my_invites(), '[]'::jsonb, 'a changed account email does not see the invite');
select throws_ok(format('select public.accept_invite(%L)', (select id from ti where label = 'inv')), 'P0001',
  'invite not found', 'and cannot join through it');
select is(private.readable_company_id(), null, 'so it reads nothing');

-- Positive control: the person whose Google sign-in has the address.
reset role;
update auth.users set email = 'ti-taker@example.com' where email = 'ti-invitee@example.com';
update auth.users set email = 'ti-invitee@example.com' where email = 'ti-invitee-2@example.com';
select tests.authenticate_as('ti_invitee');
select is(jsonb_array_length(public.my_invites()), 1, 'the invitee sees it');
select is(public.accept_invite((select id from ti where label = 'inv'))->>'role', 'editor', 'and joins');
select is(private.current_company_id(), (select id from ti where label = 'a'), 'and the company opens');

select * from finish();
rollback;
