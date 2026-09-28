#!/usr/bin/env bash
# Fail when packages/shared/src/database.types.ts drifts from CLI 2.118.0.
# CI runs this after `supabase test db`, so a types mismatch cannot hide the RLS suite.
#
# CLI 2.118.0 generates types in-process and does not pass a PostgREST version
# (there is no --postgrest-version flag). --local and --db-url therefore both
# omit __InternalSupabase. The API version is recorded in supabase/config.toml
# as `flow-postgrest-version`. When the CLI grows --postgrest-version, this
# script passes that tag on --db-url so the file stays byte-identical to --local.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
out="$(mktemp)"
trap 'rm -f "$out"' EXIT

postgrest_version="$(sed -n 's/^# flow-postgrest-version: //p' supabase/config.toml)"
if [[ -z "$postgrest_version" ]]; then
  echo "supabase/config.toml is missing '# flow-postgrest-version: <version>'" >&2
  exit 1
fi

# Capture help first. `grep -q` under pipefail can exit 1 before the CLI finishes writing.
help_text="$(supabase gen types typescript --help 2>&1 || true)"
db_url_flags=()
if [[ "$help_text" == *"--postgrest-version"* ]]; then
  db_url_flags+=(--postgrest-version "$postgrest_version")
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  # ${arr[@]+...} stays empty when the array is empty, including under `set -u`.
  supabase gen types typescript --db-url "$DATABASE_URL" --schema public \
    ${db_url_flags[@]+"${db_url_flags[@]}"} > "$out"
else
  supabase gen types typescript --local --schema public > "$out"
fi

if ! diff -u packages/shared/src/database.types.ts "$out"; then
  echo "Generated types differ from packages/shared/src/database.types.ts. Run: pnpm db:types" >&2
  exit 1
fi
echo "TYPES_OK"
