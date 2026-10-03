#!/usr/bin/env bash
# Invoke sumit-reseal before db push. Reads vault cron_secret and does not print it.
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL is missing" >&2
  exit 1
fi

secret="$(psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q -At \
  -c "select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret' limit 1;")"
if [[ -z "${secret}" ]]; then
  echo "vault cron_secret is missing" >&2
  exit 1
fi

curl -fsS -X POST "https://sxqpnetmtufkzowutduq.supabase.co/functions/v1/sumit-reseal" \
  -H "content-type: application/json" \
  -H "x-flow-cron: ${secret}" \
  --data '{}'
echo
