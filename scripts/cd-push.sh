#!/usr/bin/env bash
# Apply pending migrations after the read-only preflight has passed.
# The workflow builds and checks the hosted dist before it calls this script.
# Does not reset the database, include seed, or repair migration history.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

bash scripts/cd-preflight.sh

redact() {
  sed -E 's#(postgres(ql)?://)[^[:space:]'\''\"]+#\1***#g'
}

echo "Pushing pending migrations with supabase db push --db-url"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
if ! supabase --yes db push --db-url "$SUPABASE_DB_URL" >"$log" 2>&1; then
  redact <"$log"
  echo "Migration push failed. The hosted build was not deployed."
  exit 1
fi
redact <"$log"
echo "Migrations pushed."
