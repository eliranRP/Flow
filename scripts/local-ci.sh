#!/usr/bin/env bash
# The pull-request gate. Pull requests have no GitHub CI: the pre-push hook (.githooks/pre-push) runs
# this script, and main runs the full suite on GitHub before each batch deploy.
#   default (about 4 minutes cold, under 2 when the app is unchanged): lint, the migration checks,
#     Deno, typecheck, unit and connector tests,
#     both dist builds, and the Storybook tests.
#   --full (about 12 minutes): adds the every-story smoke, local Supabase (pgTAP, db types, deploy
#     preflight, SUMIT cron), and the main Playwright suite. Needs Docker.
# `bash scripts/cloud-agent-install.sh` installs Deno, the Supabase CLI, and Playwright's Chromium.
# On success it writes .git/flow-local-ci with the commit it passed on, so the hook can skip a repeat.
# FLOW-813: the default run skips the app parts (typecheck, builds, app unit tests, Storybook) whose
# inputs (the git tree of app, packages, design, _shared and the root configs) already passed here,
# and runs only the app tests related to the files changed since the last green commit when only
# .ts/.tsx sources changed. --full, or FLOW_LOCAL_CI_NO_SKIP=1, runs everything. The cache of green
# runs is $FLOW_LOCAL_CI_CACHE, or .git/flow-local-ci-cache.
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

# FLOW-813. A part whose inputs (git trees) passed before is skipped in the default run.
cache="${FLOW_LOCAL_CI_CACHE:-$(git rev-parse --git-common-dir)/flow-local-ci-cache}"
mkdir -p "$cache"
skips=1
if (( full )) || [[ -n "${FLOW_LOCAL_CI_NO_SKIP:-}" ]]; then skips=0; fi
# What the app reads: its sources, the shared packages, the design tokens, _shared and the
# migrations (tests import both), the scripts (vite.config.ts imports one), the root configs and the
# untracked .env (vite's envDir).
app_inputs=(app packages design supabase/functions/_shared supabase/migrations scripts package.json
  pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.js)
inputs_hash() {
  { git ls-tree -r HEAD -- "$@"; sha256sum .env 2>/dev/null || true; } | sha256sum | cut -c1-40
}
app_key="$(inputs_hash "${app_inputs[@]}")"
typecheck_key="typecheck-$app_key"
build_key="build-$app_key"
green() {
  (( skips )) && [[ -f "$cache/$1" ]]
}
mark_green() {
  touch "$cache/$1"
}
# The newest ancestor of HEAD (within 200 commits) where a test project last passed in full or in
# part, when every file changed since then is an app, shared or _shared .ts/.tsx source or a
# migration (a test globs them): the vitest module graph finds the tests those reach. Anything else
# (CSS, setup, config, scripts, lockfile, a deleted file) runs all.
changed_base() {
  local project="$1" commit
  (( skips )) || return 1
  local changed removed
  for commit in $(git rev-list --max-count=200 HEAD); do
    if [[ -f "$cache/commit-$project-$commit" ]]; then
      # A deleted or renamed file, the setup file, or anything but a source or migration runs all.
      # (No grep -q in a pipe: under pipefail its early exit would read as eligible.)
      changed="$(git diff --name-only "$commit" HEAD -- "${app_inputs[@]}")"
      removed="$(git diff --name-only --diff-filter=DR "$commit" HEAD -- "${app_inputs[@]}")"
      if [[ -n "$removed" ]] || grep -qx 'app/src/test-setup.ts' <<<"$changed" \
        || [[ -n "$(grep -vE '^(app/src|packages/shared/src|supabase/functions/_shared)/.*\.tsx?$|^supabase/migrations/[^/]+\.sql$' <<<"$changed" || true)" ]]; then
        return 1
      fi
      echo "$commit"
      return 0
    fi
  done
  return 1
}

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
  bash scripts/check-edge-functions.sh
}
typecheck_part() {
  pnpm typecheck
}
unit_part() {
  if (( ! skips )); then
    pnpm test:unit
  else
    # test:unit without the @flow/app suite, which app_unit_part runs (or skips) on its own.
    local script rest
    script="$(node -p 'require("./package.json").scripts["test:unit"]')"
    rest="${script/pnpm -r --if-present test/pnpm -r --if-present --filter !flow --filter !@flow/app test}"
    if [[ "$rest" == "$script" ]]; then
      echo "local-ci: test:unit changed shape; running all of it." >&2
      pnpm test:unit
      return
    fi
    bash -c "$rest"
  fi
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
# One vitest project of @flow/app: skipped when its inputs passed, only the related tests when a
# green base is near, else all of it. A pass records the tree and the commit.
app_tests() {
  local project="$1" base
  if green "$project-$app_key"; then
    echo "local-ci: $project tests skipped: these app inputs already passed."
    return 0
  fi
  if [[ "$project" == storybook ]]; then
    pnpm --filter @flow/app exec playwright install chromium
  fi
  if base="$(changed_base "$project")"; then
    echo "local-ci: $project tests related to the changes since ${base:0:7}."
    pnpm --filter @flow/app exec vitest run --project "$project" --changed "$base" --passWithNoTests
    # The module graph doesn't see a glob of the migrations: run the tests that read them by name.
    local globbing
    globbing="$(git grep -l 'supabase/migrations' -- 'app/src/*.test.ts' 'app/src/*.test.tsx' || true)"
    if [[ "$project" == unit && -n "$globbing" ]] \
      && [[ -n "$(git diff --name-only "$base" HEAD -- supabase/migrations)" ]]; then
      # shellcheck disable=SC2086
      pnpm --filter @flow/app exec vitest run --project unit ${globbing//app\//}
    fi
  elif [[ "$project" == unit ]]; then
    pnpm --filter @flow/app test
  else
    pnpm test:storybook
  fi
  mark_green "$project-$app_key"
  touch "$cache/commit-$project-$head"
}
# Runs the named parts at the same time and prints the log of each one that fails. A part named
# with key=part is skipped when that key passed before, and records it when it passes.
run_parts() {
  local entry part key
  local pids=() failed=()
  for entry in "$@"; do
    part="${entry#*=}"
    key=""
    [[ "$entry" == *=* ]] && key="${entry%%=*}"
    if [[ -n "$key" ]] && green "$key"; then
      echo "local-ci: $part skipped: these inputs already passed."
      continue
    fi
    ( set -euo pipefail; "${part}_part"; [[ -z "$key" ]] || mark_green "$key" ) >"$logs/$part.log" 2>&1 &
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
if (( skips )); then
  # The server tests are short and run beside the static checks.
  run_parts lint static unit "$typecheck_key=typecheck" "$build_key=build"
  rm -rf "$logs"
  # The app unit tests run alone: next to the builds, slow renders miss Testing Library's 1-second wait.
  phase "check: app unit tests"
  app_tests unit
else
  run_parts lint static "$typecheck_key=typecheck" "$build_key=build"
  # pnpm test:unit includes the app unit tests, so it runs alone (see above).
  phase "check: unit and connector tests"
  run_parts unit
  rm -rf "$logs"
fi

phase "check: Storybook"
if (( skips )); then
  app_tests storybook
else
  pnpm --filter @flow/app exec playwright install chromium
  pnpm test:storybook
fi

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
