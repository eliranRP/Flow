#!/usr/bin/env bash
# Read-only check of the database. A failed check does not push migrations.
# psql prints a command tag on its own line. The value is the last line, not the lines glued together.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

redact() {
  sed -E 's#(postgres(ql)?://)[^[:space:]'\''\"]+#\1***#g'
}

if [[ "${FLOW_CD_PREFLIGHT_LOCAL:-}" == "1" ]]; then
  node scripts/cd-db-url.mjs --local
else
  node scripts/cd-db-url.mjs
fi

psql_out="$(mktemp)"
psql_err="$(mktemp)"
dry_log="$(mktemp)"
trap 'rm -f "$psql_out" "$psql_err" "$dry_log"' EXIT

run_psql() {
  set +e
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q -At -F '|' --single-transaction "$@" >"$psql_out" 2>"$psql_err"
  local status=$?
  set -e
  redact <"$psql_err" >&2
  return "$status"
}

echo "Preflight: opening a read-only session."
if ! run_psql \
  -c "SET TRANSACTION READ ONLY" \
  -c "SELECT current_setting('transaction_read_only');"
then
  redact <"$psql_out" >&2
  echo "Preflight did not get a read-only session. Migrations were not pushed."
  exit 1
fi
if ! node scripts/cd-output.mjs read-only <"$psql_out"; then
  redact <"$psql_out" >&2
  echo "Preflight did not get a read-only session. Migrations were not pushed."
  exit 1
fi

echo "Preflight: running scripts/preflight-r23.sql"
if ! run_psql \
  -c "SET TRANSACTION READ ONLY" \
  -f scripts/preflight-r23.sql
then
  redact <"$psql_out" >&2
  echo "Preflight failed. Migrations were not pushed."
  exit 1
fi
if ! node scripts/cd-output.mjs counts <"$psql_out"; then
  redact <"$psql_out" >&2
  echo "Preflight counts were not readable. Migrations were not pushed."
  exit 1
fi

echo "Preflight: supabase db push --dry-run (no changes applied)"
if ! supabase --yes db push --db-url "$SUPABASE_DB_URL" --dry-run >"$dry_log" 2>&1; then
  redact <"$dry_log"
  echo "Preflight dry-run failed. Migrations were not pushed."
  exit 1
fi
redact <"$dry_log"
if ! kind="$(node scripts/cd-output.mjs dry-run <"$dry_log")"; then
  echo "Preflight did not return a readable dry-run. Migrations were not pushed."
  exit 1
fi
case "$kind" in
  "up-to-date remote")
    echo "Preflight passed. Remote database is up to date."
    ;;
  "up-to-date local")
    echo "Preflight passed. Local database is up to date."
    ;;
  pending)
    echo "Preflight passed. Pending migrations were listed and not applied."
    ;;
  *)
    echo "Preflight did not return a readable dry-run. Migrations were not pushed."
    exit 1
    ;;
esac
