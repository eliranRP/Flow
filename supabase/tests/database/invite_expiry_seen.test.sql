-- FLOW-513 (server part). An invite expires after 7 days; the invitee's seen flag is per invite.
-- Invented names and @example.com emails only.

begin;

select plan(7);

do $users$
begin
  perform tests.create_supabase_user('ei_owner', 'ei-owner@example.com');
  perform tests.create_supabase_user('ei_older', 'ei-older@example.com');
  perform tests.create_supabase_user('ei_invitee', 'ei-invitee@example.com');
  perform tests.create_supabase_user('ei_other', 'ei-other@example.com');
end
$users$;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'google', now(), now(), now()
from auth.users u
where u.email in ('ei-invitee@example.com', 'ei-other@example.com');

create temp table ei (label text primary key, id uuid);
grant all on ei to authenticated, service_role;

select tests.authenticate_as('ei_owner');
insert into ei (label, id) values ('a', tests.fixture_company('ei_owner', 'Example Expiry'));
insert into ei (label, id) select 'new', (public.invite_member('ei-invitee@example.com', 'editor')->>'id')::uuid;

select tests.authenticate_as('ei_older');
insert into ei (label, id) values ('b', tests.fixture_company('ei_older', 'Example Older'));
insert into ei (label, id) select 'old', (public.invite_member('ei-invitee@example.com', 'viewer')->>'id')::uuid;

-- Sent 20 days ago: out of the inbox. Sent 8 days ago: expired yesterday.
reset role;
update public.company_invites set expires_at = now() - interval '20 days' where id = (select id from ei where label = 'old');
update public.company_invites set expires_at = now() - interval '1 day' where id = (select id from ei where label = 'new');

select tests.authenticate_as('ei_invitee');
select is(jsonb_array_length(public.my_invites()), 1, 'an invite expired 20 days ago is not in the inbox');
select is(public.my_invites()->0->>'status', 'expired', 'an invite expired yesterday shows as expired');
select throws_ok(format('select public.accept_invite(%L)', (select id from ei where label = 'new')), 'P0001',
  'invite expired', 'and it cannot be accepted');

select isnt((public.mark_invite_seen((select id from ei where label = 'new'))->>'seen_at'), null,
  'marking it seen sets seen_at');

-- The first time stays.
reset role;
update public.company_invites set seen_at = '2026-10-01 09:00:00+00' where id = (select id from ei where label = 'new');
select tests.authenticate_as('ei_invitee');
select is((public.mark_invite_seen((select id from ei where label = 'new'))->>'seen_at')::timestamptz,
  '2026-10-01 09:00:00+00'::timestamptz, 'a second mark keeps the first time');

select tests.authenticate_as('ei_other');
select throws_ok(format('select public.mark_invite_seen(%L)', (select id from ei where label = 'new')), 'P0001',
  'invite not found', 'nobody else can mark it');

select * from finish();
rollback;
