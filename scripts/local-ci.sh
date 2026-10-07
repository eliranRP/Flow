#!/usr/bin/env bash
# The pull-request gate. Pull requests have no GitHub CI: the pre-push hook (.githooks/pre-push) runs
# this script, and main runs the full suite on GitHub before each batch deploy.
#   default (about 3 minutes): lint, the migration checks, Deno, typecheck, unit and connector tests,
#     both dist builds, and the Storybook tests.
#   --full (about 12 minutes): adds the every-story smoke, local Supabase (pgTAP, db types, deploy
#     preflight, SUMIT cron), and the main Playwright suite. Needs Docker.
# `bash scripts/cloud-agent-install.sh` installs Deno, the Supabase CLI, and Playwright's Chromium.
# On success it writes .git/flow-local-ci with the commit it passed on, so the hook can skip a repeat.
set -euo pipefail

full=0
case "${1:-}" in
  "") ;;
  --full) full=1 ;;
  *) echo "Usage: local-ci.sh [--full]" >&2; exit 2 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
head="$(git rev-parse HEAD)"
started="$(date +%s)"

phase() {
  echo
  echo "== local-ci: $1 ($(( $(date +%s) - started ))s)"
}

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "local-ci: commit or stash your changes first, so the run tests the commit you push." >&2
  exit 1
fi

supabase_exit=""
if (( full )); then
  phase "Docker and local Supabase"
  if ! docker info >/dev/null 2>&1; then
    (sudo -n dockerd >/tmp/flow-dockerd.log 2>&1 &)
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
    docker info >/dev/null 2>&1 || { echo "local-ci: Docker is not running and could not be started." >&2; exit 1; }
  fi
  supabase_log="$(mktemp)"
  supabase_exit="$(mktemp)"
  rm -f "$supabase_exit"
  # Starts in the background while the static checks run. An instance that is already up is reset,
  # so it carries this branch's migrations and no rows from an earlier run.
  (
    rc=0
    if supabase status >/dev/null 2>&1; then
      supabase db reset >"$supabase_log" 2>&1 || rc=$?
    else
      supabase start -x studio,postgres-meta,logflare,vector,mailpit,imgproxy,supavisor,realtime >"$supabase_log" 2>&1 || rc=$?
    fi
    echo "$rc" >"${supabase_exit}.tmp"
    mv "${supabase_exit}.tmp" "$supabase_exit"
  ) >/dev/null 2>&1 &
fi

pnpm install --frozen-lockfile --silent
git fetch -q origin main || true

phase "lint and check: lint, static checks, and builds, side by side"
logs="$(mktemp -d)"
lint_part() {
  pnpm lint
}
static_part() {
  # The lock where this branch left main: the branch may only append to it. (A lock line main added
  # since then shows up as a merge conflict on the PR.)
  local fork
  fork="$(git merge-base HEAD origin/main 2>/dev/null || true)"
  if [[ -n "$fork" ]] && git cat-file -e "$fork:supabase/migrations.lock" 2>/dev/null; then
    local base
    base="$(mktemp)"
    git show "$fork:supabase/migrations.lock" >"$base"
    node scripts/check-migration-order.mjs --base "$base"
    rm -f "$base"
  else
    node scripts/check-migration-order.mjs
  fi
  node scripts/check-migration-transaction.mjs
  deno test --allow-env --config supabase/functions/flow-mcp/deno.json supabase/functions/flow-mcp
  pnpm typecheck
}
unit_part() {
  pnpm test:unit
  pnpm test:connectors
}
build_part() {
  pnpm build
  node scripts/stamp-build.mjs "$head"
  pnpm check:bundle
  rm -rf app/dist
  VITE_REVIEWER_BUILD=1 VITE_SUPABASE_URL="" VITE_SUPABASE_ANON_KEY="" pnpm build
  pnpm check:reviewer-bundle
  test ! -f app/dist/build.txt
}
# Runs the named parts at the same time and prints the log of each one that fails.
run_parts() {
  local part entry
  local pids=() failed=()
  for part in "$@"; do
    ( set -euo pipefail; "${part}_part" ) >"$logs/$part.log" 2>&1 &
    pids+=("$!:$part")
  done
  for entry in "${pids[@]}"; do
    wait "${entry%%:*}" || failed+=("${entry#*:}")
  done
  for part in "${failed[@]}"; do
    echo "---- local-ci: $part failed ----"
    cat "$logs/$part.log"
  done
  if (( ${#failed[@]} > 0 )); then
    echo "local-ci: failed: ${failed[*]}" >&2
    exit 1
  fi
}
run_parts lint static build
# The unit tests run alone: next to the builds, slow renders miss Testing Library's 1-second wait.
phase "check: unit and connector tests"
run_parts unit
rm -rf "$logs"

phase "check: Storybook"
pnpm --filter @flow/app exec playwright install chromium
pnpm test:storybook

if (( ! full )); then
  echo "$head" >"$(git rev-parse --git-dir)/flow-local-ci"
  phase "passed on ${head:0:7} (main runs the every-story smoke and e2e before each deploy)"
  exit 0
fi

pnpm build-storybook
pnpm test:storybook:smoke

phase "e2e: waiting for local Supabase"
while [[ ! -f "$supabase_exit" ]]; do sleep 2; done
if [[ "$(cat "$supabase_exit")" != 0 ]]; then
  cat "$supabase_log"
  echo "local-ci: local Supabase did not start." >&2
  exit 1
fi
rm -f "$supabase_log" "$supabase_exit"

phase "e2e: database checks"
bash scripts/mcp-function-smoke.sh
supabase test db supabase/tests/database
bash scripts/check-db-types.sh
db_url="$(supabase status -o env | sed -n 's/^DB_URL=//p' | head -n 1 | tr -d '"')"
FLOW_CD_PREFLIGHT_LOCAL=1 SUPABASE_DB_URL="$db_url" bash scripts/cd-preflight.sh
FLOW_CD_PREFLIGHT_LOCAL=1 SUPABASE_DB_URL="$db_url" bash scripts/cd-dry-run-pending.sh
SUPABASE_DB_URL="$db_url" bash scripts/check-sumit-cron.sh

phase "e2e: main Playwright suite"
eval "$(bash scripts/ci-local-supabase-env.sh)"
pnpm test:e2e

echo "$head" >"$(git rev-parse --git-dir)/flow-local-ci"
phase "passed on ${head:0:7}"
