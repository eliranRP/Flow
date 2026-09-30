#!/usr/bin/env bash
# Read-only check of the hosted database. A failed check does not push migrations.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

redact() {
  sed -E 's#(postgres(ql)?://)[^[:space:]'\''\"]+#\1***#g'
}

node scripts/cd-db-url.mjs

echo "Preflight: opening a read-only session."
read_only_log="$(mktemp)"
set +e
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -At --single-transaction \
  -c "SET TRANSACTION READ ONLY" \
  -c "select current_setting('transaction_read_only');" >"$read_only_log" 2>&1
read_only_status=$?
set -e
redact <"$read_only_log"
read_only="$(tr -d '[:space:]' <"$read_only_log")"
rm -f "$read_only_log"
if [[ "$read_only_status" -ne 0 || "$read_only" != "on" ]]; then
  echo "Preflight did not get a read-only session. Migrations were not pushed."
  exit 1
fi

echo "Preflight: running scripts/preflight-r23.sql"
if ! psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X --single-transaction \
  -c "SET TRANSACTION READ ONLY" \
  -f scripts/preflight-r23.sql 2>&1 | redact
then
  echo "Preflight failed. Migrations were not pushed."
  exit 1
fi

echo "Preflight: supabase db push --dry-run (no changes applied)"
dry_log="$(mktemp)"
trap 'rm -f "$dry_log"' EXIT
if ! supabase --yes db push --db-url "$SUPABASE_DB_URL" --dry-run >"$dry_log" 2>&1; then
  redact <"$dry_log"
  echo "Preflight dry-run failed. Migrations were not pushed."
  exit 1
fi
redact <"$dry_log"
if ! grep -Eq "DRY RUN|up to date" "$dry_log"; then
  echo "Preflight did not return a readable dry-run. Migrations were not pushed."
  exit 1
fi
echo "Preflight passed. Pending migrations may be pushed."
