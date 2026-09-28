#!/usr/bin/env bash
# Fail when packages/shared/src/database.types.ts drifts from CLI 2.118.0.
# CI sets no DATABASE_URL and uses `supabase gen types --local` after db start.
# A local Postgres URL checks the same file without Docker.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
out="$(mktemp)"
trap 'rm -f "$out"' EXIT

if [[ -n "${DATABASE_URL:-}" ]]; then
  supabase gen types typescript --db-url "$DATABASE_URL" --schema public > "$out"
else
  supabase gen types typescript --local --schema public > "$out"
fi

diff -u packages/shared/src/database.types.ts "$out"
