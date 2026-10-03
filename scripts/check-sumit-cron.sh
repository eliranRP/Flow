#!/usr/bin/env bash
# Read cron.job after migrations are applied. Does not create or remove a job.
# The Vault secret it reads is cron_secret. Its scope is whether flow-sumit-drain should exist.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "check-sumit-cron: SUPABASE_DB_URL is missing. The check did not finish." >&2
  exit 1
fi

run_psql() {
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q -At --single-transaction \
    -c "SET TRANSACTION READ ONLY" \
    "$@"
}

if ! cron_flag="$(run_psql -c "select case when to_regclass('cron.job') is null then 'f' else 't' end;")"; then
  echo "check-sumit-cron: could not read cron.job. The check did not finish." >&2
  exit 1
fi
cron_flag="${cron_flag//$'\n'/}"
case "$cron_flag" in
  f)
    echo "check-sumit-cron: cron.job is missing. pg_cron is not installed." >&2
    exit 4
    ;;
  t) ;;
  *)
    echo "check-sumit-cron: cron.job probe was not t or f. The check did not finish." >&2
    exit 1
    ;;
esac

if ! status="$(run_psql -f "$root/scripts/check-sumit-cron.sql")"; then
  echo "check-sumit-cron: the job query failed. The check did not finish." >&2
  exit 1
fi
status="${status//$'\n'/}"
case "$status" in
  ok)
    echo "SUMIT cron jobs match."
    exit 0
    ;;
  bad-daily)
    echo "check-sumit-cron: flow-sumit-daily is missing or its schedule or command is wrong." >&2
    exit 2
    ;;
  bad-drain)
    echo "check-sumit-cron: flow-sumit-drain does not match Vault cron_secret and pg_net." >&2
    exit 3
    ;;
  *)
    echo "check-sumit-cron: status was not a known token. The check did not finish." >&2
    exit 1
    ;;
esac
