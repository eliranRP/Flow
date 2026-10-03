#!/usr/bin/env bash
# Read cron.job after migrations are applied. Does not create or remove a job.
# Vault cron_secret decides whether flow-sumit-drain should exist.
# Vault flow_sync_url is the drain URL. It is required when the drain should exist.
# Neither value is printed.
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
    echo "check-sumit-cron: flow-sumit-drain is missing, its schedule or command is wrong, or Vault flow_sync_url is missing." >&2
    exit 3
    ;;
  *)
    echo "check-sumit-cron: status was not a known token. The check did not finish." >&2
    exit 1
    ;;
esac
