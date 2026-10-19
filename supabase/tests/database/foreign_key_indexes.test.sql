-- pgtap: catalog-wide
-- FLOW-811: every foreign key in public and private has an index that leads with its columns,
-- as the database advisor's unindexed_foreign_keys check asks. A new foreign key needs one too.
-- FLOW-928 (decision 0195): the index must be valid, and either whole or partial on
-- "<one of the key's columns> is not null" (the only partial index a key lookup can use), so
-- dropping an index can never leave a cascade or a key check to scan the table.

begin;

select plan(2);

select is(
  (
    select coalesce(jsonb_agg(c.conrelid::regclass::text || ' ' || c.conname
      order by c.conrelid::regclass::text || ' ' || c.conname), '[]'::jsonb)
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where c.contype = 'f'
      and n.nspname in ('public', 'private')
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and i.indisvalid
          and i.indisready
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
          and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey
          and (
            i.indpred is null
            or pg_get_expr(i.indpred, i.indrelid) in (
              select '(' || quote_ident(a.attname) || ' IS NOT NULL)'
              from pg_attribute a
              where a.attrelid = c.conrelid and a.attnum = any (c.conkey)
            )
          )
      )
  ),
  -- Known before FLOW-928, each covered only by a partial index on another condition. Small
  -- tables, so a cascade from the parent scans few rows. Do not add to this list: give a new
  -- key a whole index.
  jsonb_build_array(
    'connector_refresh_requests connector_refresh_requests_company_id_fkey', -- connector_refresh_open_uidx: claimed_at is null
    'private.mcp_credentials mcp_credentials_user_id_fkey',                 -- mcp_credentials_user_open_idx: revoked_at is null
    'private.mcp_writes mcp_writes_user_id_fkey'                            -- the *_open_idx indexes: per kind, undone_at is null
  ),
  'every foreign key has a valid index that leads with its columns, but the three known ones'
);

-- The indexes decision 0195 dropped stay dropped: another index leads with the same columns.
select is(
  (
    select coalesce(jsonb_agg(c.relname::text order by c.relname), '[]'::jsonb)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'invoice_match_dismissals_company_idx', 'invoice_paid_marks_company_idx',
        'invoice_payment_links_company_idx', 'jev_line_failures_company_idx', 'overhead_company_idx',
        'split_rule_targets_company_idx', 'split_rules_company_idx', 'split_rules_supplier_idx',
        'loans_project_idx', 'loans_escrow_category_idx', 'loans_fees_category_idx',
        'loans_principal_category_idx'
      )
  ),
  '[]'::jsonb,
  'the 12 redundant indexes are gone'
);

select * from finish();

rollback;
