#!/usr/bin/env bash
# Lists one unapplied migration with supabase db push --dry-run, then checks it was not applied.
# Local Supabase only. Production preflight does not create this file.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

if [[ "${FLOW_CD_PREFLIGHT_LOCAL:-}" != "1" ]]; then
  echo "Pending dry-run check runs only against local Supabase."
  exit 1
fi

node scripts/cd-db-url.mjs --local

redact() {
  sed -E 's#(postgres(ql)?://)[^[:space:]'\''\"]+#\1***#g'
}

file="supabase/migrations/20990101000000_ci_dry_run_pending.sql"
log="$(mktemp)"
psql_out="$(mktemp)"
psql_err="$(mktemp)"
cleanup() {
  rm -f "$root/$file" "$log" "$psql_out" "$psql_err"
}
trap cleanup EXIT

printf '%s\n' "-- CI dry-run fixture. This file is deleted and must not be applied." >"$file"

if ! supabase --yes db push --db-url "$SUPABASE_DB_URL" --dry-run >"$log" 2>&1; then
  redact <"$log"
  echo "Pending dry-run failed. The fixture migration was not pushed."
  exit 1
fi
redact <"$log"
if ! kind="$(node scripts/cd-output.mjs dry-run <"$log")"; then
  echo "Pending dry-run output did not match Supabase CLI 2.118.0."
  exit 1
fi
if [[ "$kind" != "pending" ]]; then
  echo "Pending dry-run was classified as ${kind}."
  exit 1
fi
if ! grep -F "20990101000000_ci_dry_run_pending.sql" "$log" >/dev/null; then
  echo "Pending dry-run did not list the fixture migration."
  exit 1
fi

if ! psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q -At -F '|' --single-transaction \
  -c "SET TRANSACTION READ ONLY" \
  -c "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20990101000000';" \
  >"$psql_out" 2>"$psql_err"
then
  redact <"$psql_err" >&2
  echo "Could not confirm the fixture migration was not applied."
  exit 1
fi
if ! node scripts/cd-output.mjs equals 0 <"$psql_out"; then
  echo "Dry-run applied the fixture migration."
  exit 1
fi

echo "Pending dry-run listed the fixture migration and did not apply it."
