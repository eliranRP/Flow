-- FLOW-506: the first-run setup flags live in setup_states, one row per owner and company.
-- Only the owner reads and writes their own row. Invented names, @example.com only.

begin;

select plan(11);

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
  $$insert into public.setup_states (user_id, company_id, state)
    select auth.uid(), id, '{"skipped": {"2": "2026-10-09T00:00:00.000Z"}}'::jsonb from f506 where label = 'company'$$,
  'the owner saves their setup flags'
);
select lives_ok(
  $$insert into public.setup_states (user_id, company_id, state)
    select auth.uid(), id, '{"card_dismissed_at": "2026-10-09T01:00:00.000Z"}'::jsonb from f506 where label = 'company'
    on conflict (user_id, company_id) do update set state = excluded.state, updated_at = now()$$,
  'the owner replaces them with an upsert'
);
select is(
  (select state->>'card_dismissed_at' from public.setup_states),
  '2026-10-09T01:00:00.000Z',
  'the owner reads back their own row'
);
select throws_ok(
  $$insert into public.setup_states (user_id, company_id, state)
    select auth.uid(), id, '[]'::jsonb from f506 where label = 'company'
    on conflict (user_id, company_id) do update set state = excluded.state$$,
  '23514',
  null,
  'the state must be an object'
);
select throws_ok(
  $$insert into public.setup_states (user_id, company_id) select auth.uid(), id from f506 where label = 'other'$$,
  '42501',
  null,
  'the owner cannot write a row for another company'
);
select throws_ok(
  $$update public.setup_states set company_id = (select id from f506 where label = 'other')$$,
  '42501',
  null,
  'the owner cannot move their row to another company'
);
reset role;

select tests.authenticate_as('f506_other');
select is((select count(*) from public.setup_states)::integer, 0, 'another owner reads no row of this company');
update public.setup_states set state = '{}'::jsonb;
reset role;
select is(
  (select state->>'card_dismissed_at' from public.setup_states),
  '2026-10-09T01:00:00.000Z',
  'another owner''s update touches no row'
);
select tests.authenticate_as('f506_other');
select throws_ok(
  $$insert into public.setup_states (user_id, company_id) select auth.uid(), id from f506 where label = 'company'$$,
  '42501',
  null,
  'another owner cannot write into this company'
);
reset role;

select tests.authenticate_as('f506_viewer');
select is((select count(*) from public.setup_states)::integer, 0, 'a viewer reads no setup row');
select throws_ok(
  $$insert into public.setup_states (user_id, company_id) select auth.uid(), id from f506 where label = 'company'$$,
  '42501',
  null,
  'a viewer cannot save setup flags'
);
reset role;

select * from finish();
rollback;
