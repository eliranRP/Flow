#!/usr/bin/env bash
# Prints export lines for the local Supabase API started by `supabase start`.
# The service-role key is not printed. A non-local URL is refused.
set -euo pipefail

status="$(supabase status -o env)"
api_url="$(printf '%s\n' "$status" | sed -n 's/^API_URL=//p; s/^SUPABASE_URL=//p' | head -n 1 | tr -d '"')"
anon_key="$(printf '%s\n' "$status" | sed -n 's/^ANON_KEY=//p' | head -n 1 | tr -d '"')"

if [[ -z "$api_url" || -z "$anon_key" ]]; then
  echo "supabase status did not return a local API URL and anon key." >&2
  exit 1
fi

case "$api_url" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *)
    echo "Refusing to point Playwright at a non-local Supabase API." >&2
    exit 1
    ;;
esac

if [[ "$api_url" == *sxqpnetmtufkzowutduq* ]]; then
  echo "Refusing to point Playwright at the hosted project." >&2
  exit 1
fi

printf 'export FLOW_E2E_SUPABASE_URL=%q\n' "$api_url"
printf 'export FLOW_E2E_SUPABASE_ANON_KEY=%q\n' "$anon_key"
