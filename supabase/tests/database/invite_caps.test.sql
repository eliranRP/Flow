-- FLOW-928 (decision 0195). invite_member creates at most 10 invites per company and 20 per
-- inviting user in any 24 hours; over a cap it raises invite_limit (23514) and writes nothing.
-- claim_invite_email lets the invite-email function send at most 3 emails per invite.
-- Invented names and @example.com emails only.

begin;

select plan(25);

do $users$
begin
  perform tests.create_supabase_user('ic_owner', 'ic-owner@example.com');
  perform tests.create_supabase_user('ic_rival', 'ic-rival@example.com');
  perform tests.create_supabase_user('ic_third', 'ic-third@example.com');
end
$users$;

create temp table ic (label text primary key, id uuid);
grant all on ic to authenticated, service_role;

create or replace function pg_temp.id(p_label text)
returns uuid
language sql
as $$ select id from pg_temp.ic where label = p_label; $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;

-- Invite rows of a company, read past RLS (browser roles have no table grants).
create or replace function pg_temp.invites(p_company uuid)
returns integer
language sql
security definer
as $$ select count(*)::int from public.company_invites i where i.company_id = p_company; $$;
grant execute on function pg_temp.invites(uuid) to authenticated, service_role;

create or replace function pg_temp.sends(p_invite uuid)
returns integer
language sql
security definer
as $$ select i.email_sends::int from public.company_invites i where i.id = p_invite; $$;
grant execute on function pg_temp.sends(uuid) to authenticated, service_role;

insert into ic (label, id) values
  ('a', tests.fixture_company('ic_owner', 'Example Cap Works')),
  ('c', tests.fixture_company('ic_rival', 'Example Rival Ltd')),
  ('d', tests.fixture_company('ic_third', 'Example Third Co')),
  ('owner', tests.get_supabase_uid('ic_owner')),
  ('rival', tests.get_supabase_uid('ic_rival'));

select tests.authenticate_as('ic_owner');
insert into ic (label, id) values ('b', public.create_company('Example Cap Homes', true));
select public.switch_company(pg_temp.id('a'));

-- Under the cap: ten new invites in company A go through.
select is(
  (select count(*)::int from generate_series(1, 10) n
   where (public.invite_member('ic-' || n || '@example.com', 'viewer')->>'existing')::boolean is false),
  10, 'ten new invites in a day go through');

-- At the cap: the eleventh is refused with the stable code, and nothing is written.
select throws_ok($$select public.invite_member('ic-11@example.com', 'viewer')$$, '23514', 'invite_limit',
  'the eleventh new invite of the company in a day is invite_limit');
select is(pg_temp.invites(pg_temp.id('a')), 10, 'the refused invite wrote nothing');

-- An email with a pending invite still answers it: no email goes out, so it is not counted.
select is(public.invite_member('ic-3@example.com', 'editor')->>'existing', 'true',
  'inviting a pending email again still answers its invite at the cap');

-- A cancelled invite still counts, so cancel and invite again cannot loop.
select lives_ok(
  format('select public.cancel_invite(%L)',
    (select (public.invite_member('ic-1@example.com', 'viewer')->>'id'))),
  'the owner cancels one invite');
select throws_ok($$select public.invite_member('ic-12@example.com', 'viewer')$$, '23514', 'invite_limit',
  'a cancelled invite still counts toward the day');

-- Another company is unaffected.
select tests.authenticate_as('ic_rival');
select is(public.invite_member('ic-rival-1@example.com', 'viewer')->>'existing', 'false',
  'another owner''s company invites while company A is at its cap');

-- Per company: the owner's second company has its own count (the owner has 10 of 20 today).
select tests.authenticate_as('ic_owner');
select public.switch_company(pg_temp.id('b'));
select is(public.invite_member('ic-b-1@example.com', 'viewer')->>'existing', 'false',
  'the same owner''s other company has its own company count');

-- Per user: invites this user made in a company they no longer own count toward their 20.
reset role;
insert into public.company_invites (company_id, email, role, invited_by)
select pg_temp.id('d'), 'ic-d-' || n || '@example.com', 'viewer', pg_temp.id('owner')
from generate_series(1, 9) n;
select tests.authenticate_as('ic_owner');
select public.switch_company(pg_temp.id('b'));
select throws_ok($$select public.invite_member('ic-b-2@example.com', 'viewer')$$, '23514', 'invite_limit',
  'the user''s twentieth invite of the day across companies is the last: company B has 1, yet it is refused');
select is(pg_temp.invites(pg_temp.id('b')), 1, 'and the refused invite wrote nothing in company B');

-- The user count is the inviter's own: company D's owner is not held by them.
select tests.authenticate_as('ic_third');
select is(public.invite_member('ic-third-1@example.com', 'viewer')->>'existing', 'false',
  'company D''s owner invites: D has 9 rows from another inviter, under its cap of 10');
select throws_ok($$select public.invite_member('ic-third-2@example.com', 'viewer')$$, '23514', 'invite_limit',
  'and the next one is over D''s company cap, whoever made the rest');

-- The window rolls: invites older than 24 hours no longer count.
reset role;
update public.company_invites set created_at = now() - interval '25 hours'
where company_id in (pg_temp.id('a'), pg_temp.id('d'));
select tests.authenticate_as('ic_owner');
select public.switch_company(pg_temp.id('a'));
select is(public.invite_member('ic-13@example.com', 'viewer')->>'existing', 'false',
  'a day later company A invites again');

-- flow-mcp's invite_member says why: invite_limit, not the generic refusal.
reset role;
select public.store_mcp_credential(pg_temp.id('owner'), 'hash-ic-write-0001',
  array['read', 'write'], now() + interval '90 days', 'pepper-1');
insert into ic (label, id) select 'cred', id from private.mcp_credentials where token_hash = 'hash-ic-write-0001';
insert into public.company_invites (company_id, email, role, invited_by)
select pg_temp.id('a'), 'ic-fill-' || n || '@example.com', 'viewer', pg_temp.id('owner')
from generate_series(1, 9) n;
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claim.sub', pg_temp.id('owner')::text, true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claims', json_build_object(
  'sub', pg_temp.id('owner'), 'role', 'authenticated', 'mcp_tid', pg_temp.id('cred'))::text, true);
select is(public.mcp_invite_member('ic-mcp-1', 'ic-mcp@example.com', 'viewer')->'error',
  '{"code": "refused", "message": "invite_limit"}'::jsonb, 'flow-mcp''s invite_member is refused with invite_limit');
select is(pg_temp.invites(pg_temp.id('a')), 20, 'and wrote no invite');

-- claim_invite_email: three sends per invite, then invite_email_limit.
reset role;
insert into ic (label, id)
select 'sent', i.id from public.company_invites i
where i.company_id = pg_temp.id('a') and i.email = 'ic-13@example.com';
insert into ic (label, id)
select 'expired', i.id from public.company_invites i
where i.company_id = pg_temp.id('a') and i.email = 'ic-fill-1@example.com';
update public.company_invites set expires_at = now() - interval '1 minute' where id = pg_temp.id('expired');
select tests.authenticate_as('ic_owner');
select public.switch_company(pg_temp.id('a'));
select is(public.claim_invite_email(pg_temp.id('sent'))->>'email_sends', '1', 'the first email is claimed');
select is(public.claim_invite_email(pg_temp.id('sent'))->>'email_sends', '2', 'a second');
select is(public.claim_invite_email(pg_temp.id('sent'))->>'email_sends', '3', 'a third');
select throws_ok(format('select public.claim_invite_email(%L)', pg_temp.id('sent')), '23514', 'invite_email_limit',
  'the fourth email of one invite is invite_email_limit');
select is(pg_temp.sends(pg_temp.id('sent')), 3, 'and the count stays at three');

-- Only the company's owner claims, only a pending, unexpired invite.
select tests.authenticate_as('ic_rival');
select throws_ok(format('select public.claim_invite_email(%L)', pg_temp.id('sent')), 'P0001', 'invite not found',
  'another company''s owner cannot claim the invite');
select tests.authenticate_as('ic_owner');
select public.switch_company(pg_temp.id('a'));
select throws_ok(format('select public.claim_invite_email(%L)', pg_temp.id('expired')), 'P0001', 'invite not found',
  'an expired invite is not mailed');
select is(pg_temp.sends(pg_temp.id('expired')), 0, 'and is not counted');

-- Grants: authenticated may call both, anon neither.
select ok(has_function_privilege('authenticated', 'public.claim_invite_email(uuid)', 'execute'),
  'authenticated executes claim_invite_email');
select ok(not has_function_privilege('anon', 'public.claim_invite_email(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.invite_member(text, text)', 'execute'),
  'anon executes neither');

select * from finish();
rollback;
