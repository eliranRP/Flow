-- reassign_undo has row level security and no policies.
-- The definer reassign and undo functions still write it.

begin;

select plan(2);

select ok(
  (
    select c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'reassign_undo'
  ),
  'reassign_undo has row level security'
);

select is(
  (
    select count(*)::int
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relrowsecurity
  ),
  0,
  'every ordinary table in public has row level security'
);

select * from finish();
rollback;
