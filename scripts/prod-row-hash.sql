-- Read-only row-hash baseline for scripts/prod-row-hash.sh.
-- One line per table in public and private: schema.table, row count, md5 of its rows.
-- Each table's rows are hashed as text in sorted order, so the hash depends only on the
-- data, not on the physical order. No row values are printed.
select format(
  '%s.%s	%s	%s',
  t.table_schema,
  t.table_name,
  (xpath('/row/n/text()', x))[1]::text,
  (xpath('/row/h/text()', x))[1]::text
)
from information_schema.tables t
cross join lateral query_to_xml(
  format(
    'select count(*) as n, md5(coalesce(string_agg(r::text, E''\n'' order by r::text), '''')) as h from %I.%I r',
    t.table_schema,
    t.table_name
  ),
  false,
  true,
  ''
) as x
where t.table_schema in ('public', 'private')
  and t.table_type = 'BASE TABLE'
order by t.table_schema, t.table_name;
