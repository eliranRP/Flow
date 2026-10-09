#!/usr/bin/env bash
# Row-hash baseline of the production database (FLOW-811), read only.
# Usage:
#   SUPABASE_DB_URL=... bash scripts/prod-row-hash.sh > baseline.tsv
#   SUPABASE_DB_URL=... bash scripts/prod-row-hash.sh baseline.tsv
# The first form prints one line per table in public and private: schema.table, row count,
# md5 of its rows. The second recomputes it and prints only the tables whose count or hash
# differ from the baseline file (exit 2), or "Row hashes match the baseline." (exit 0).
# No row values are printed. Keep baseline files out of the repo: they describe real data.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "prod-row-hash: SUPABASE_DB_URL is missing. Nothing was read." >&2
  exit 1
fi

baseline="${1:-}"
if [[ -n "$baseline" && ! -r "$baseline" ]]; then
  echo "prod-row-hash: cannot read the baseline file $baseline." >&2
  exit 1
fi

if ! current="$(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q -At --single-transaction \
  -c "SET TRANSACTION READ ONLY" \
  -f "$root/scripts/prod-row-hash.sql")"; then
  echo "prod-row-hash: the hash query failed. Nothing was compared." >&2
  exit 1
fi

if [[ -z "$baseline" ]]; then
  printf '%s\n' "$current"
  exit 0
fi

if diff_out="$(awk -F'\t' '
  NR == FNR { base[$1] = $2 "\t" $3; base_n[$1] = $2; next }
  {
    seen[$1] = 1
    if (!($1 in base)) { print "new\t" $1 "\trows " $2; next }
    if (base[$1] != $2 "\t" $3) print "changed\t" $1 "\trows " base_n[$1] " -> " $2
  }
  END { for (t in base) if (!(t in seen)) print "gone\t" t "\trows " base_n[t] }
' "$baseline" <(printf '%s\n' "$current") | sort -k2)" && [[ -z "$diff_out" ]]; then
  echo "Row hashes match the baseline."
  exit 0
fi

printf '%s\n' "$diff_out"
exit 2
