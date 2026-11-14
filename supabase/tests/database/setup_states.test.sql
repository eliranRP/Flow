-- FLOW-506: the first-run setup flags live in setup_states, one row per owner and company.
-- Only the owner reads their own row, and writes it through save_setup_state (FLOW-854).
-- Invented names, @example.com only.

begin;

select plan(13);

do $users$
begin
  perform tests.create_supabase_user('f506_owner', 'owner506@example.com');
  perform tests.create_supabase_user('f506_other', 'other506@example.com');
  perform tests.create_supabase_user('f506_viewer', 'viewer506@example.com');
end
$users$;

create temp table f506 (label text primary key, id uuid);
grant all on f506 to authenticated;
-- A demo company, since only a demo company takes viewers.
insert into f506 (label, id) values ('company', tests.fixture_company('f506_owner', 'Example Setup Co', true));
insert into f506 (label, id) values ('other', tests.fixture_company('f506_other', 'Example Other Co'));
insert into public.company_viewers (user_id, company_id)
select tests.get_supabase_uid('f506_viewer'), id from f506 where label = 'company';

select tests.authenticate_as('f506_owner');
select lives_ok(
  $$select public.save_setup_state((select id from f506 where label = 'company'),
    '{"skipped": {"2": "2026-10-09T00:00:00.000Z"}}'::jsonb)$$,
  'the owner saves their setup flags'
);
select lives_ok(
  $$select public.save_setup_state((select id from f506 where label = 'company'),
    '{"card_dismissed_at": "2026-10-09T01:00:00.000Z"}'::jsonb)$$,
  'the owner replaces them'
);
select is(
  (select state->>'card_dismissed_at' from public.setup_states),
  '2026-10-09T01:00:00.000Z',
  'the owner reads back their own row'
);
reset role;
update public.setup_states set updated_at = '2000-01-01T00:00:00Z';
select tests.authenticate_as('f506_owner');
select public.save_setup_state((select id from f506 where label = 'company'),
  '{"card_dismissed_at": "2026-10-09T01:00:00.000Z"}'::jsonb);
select is(
  (select updated_at from public.setup_states),
  pg_catalog.now(),
  'the server stamps updated_at on every save'
);
select throws_ok(
  $$select public.save_setup_state((select id from f506 where label = 'company'), '[]'::jsonb)$$,
  '23514',
  null,
  'the state must be an object'
);
select throws_ok(
  $$select public.save_setup_state((select id from f506 where label = 'other'), '{}'::jsonb)$$,
  '42501',
  'forbidden',
  'the owner cannot write a row for another company'
);
select throws_ok(
  $$update public.setup_states set company_id = (select id from f506 where label = 'other')$$,
  '42501',
  null,
  'the owner cannot update the row directly'
);
reset role;

select tests.authenticate_as('f506_other');
select is((select count(*) from public.setup_states)::integer, 0, 'another owner reads no row of this company');
select throws_ok(
  $$update public.setup_states set state = '{}'::jsonb$$,
  '42501',
  null,
  'another owner cannot update a row directly'
);
reset role;
select is(
  (select state->>'card_dismissed_at' from public.setup_states),
  '2026-10-09T01:00:00.000Z',
  'the row is unchanged'
);
select tests.authenticate_as('f506_other');
select throws_ok(
  $$select public.save_setup_state((select id from f506 where label = 'company'), '{}'::jsonb)$$,
  '42501',
  'forbidden',
  'another owner cannot write into this company'
);
reset role;

select tests.authenticate_as('f506_viewer');
select is((select count(*) from public.setup_states)::integer, 0, 'a viewer reads no setup row');
select throws_ok(
  $$select public.save_setup_state((select id from f506 where label = 'company'), '{}'::jsonb)$$,
  '42501',
  'forbidden',
  'a viewer cannot save setup flags'
);
reset role;

select * from finish();
rollback;
