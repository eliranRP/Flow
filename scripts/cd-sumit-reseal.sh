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

# The runner masks the value. The header is stdin, not a process argument.
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
  echo "::add-mask::${secret}"
fi
printf 'content-type: application/json\nx-flow-cron: %s\n' "$secret" \
  | curl -fsS -X POST "https://sxqpnetmtufkzowutduq.supabase.co/functions/v1/sumit-reseal" \
      -H @- \
      --data '{}'
echo
