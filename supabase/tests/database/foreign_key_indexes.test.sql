-- FLOW-811: every foreign key in public and private has an index that leads with its columns,
-- as the database advisor's unindexed_foreign_keys check asks. A new foreign key needs one too.

begin;

select plan(1);

select is(
  (
    select coalesce(jsonb_agg(c.conrelid::regclass::text || ' ' || c.conname order by 1), '[]'::jsonb)
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where c.contype = 'f'
      and n.nspname in ('public', 'private')
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey
      )
  ),
  '[]'::jsonb,
  'every foreign key has an index that leads with its columns'
);

select * from finish();

rollback;
