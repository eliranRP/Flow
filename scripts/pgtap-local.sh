#!/usr/bin/env bash
# Recreate a local Postgres 17 database and run the pgTAP suite with pg_prove.
# There is no Docker here. CI keeps using `supabase db start` and `supabase test db`.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
db="${PGTAP_DB:-flow_pgtap}"
cd "$root"

if ! pg_isready -q; then
  echo "PostgreSQL is not running. Start the 17 cluster with: sudo pg_ctlcluster 17 main start" >&2
  exit 1
fi

sudo -u postgres dropdb --if-exists --force "$db"
sudo -u postgres createdb "$db"
psql_q() {
  sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d "$db" "$@"
}

psql_q -f supabase/tests/bootstrap-local.sql
psql_q -c "alter database \"${db}\" set search_path to public, extensions"
psql_q -f supabase/migrations/20260927120000_schema_v1.sql
psql_q -f supabase/seed.sql
psql_q -f supabase/tests/helpers.sql

sudo -u postgres pg_prove --ext .sql -d "$db" supabase/tests/database
