#!/usr/bin/env bash
# The pull-request gate. Pull requests have no GitHub CI: the pre-push hook (.githooks/pre-push) runs
# this script, and main runs the full suite on GitHub before each batch deploy.
#   default (about 4 minutes cold, under 2 when the app is unchanged): lint, the migration checks,
#     Deno, typecheck, unit and connector tests,
#     both dist builds, the Storybook tests, the built-Storybook layout specs and the every-story
#     check for the stories the change reaches (when the app changed, about 3.5 minutes), and the
#     e2e specs that reach the changed files (needs
#     Docker for local Supabase; about 3.5 more minutes for a screen change, see FLOW-813 in TASKS).
#   --full (about 12 minutes): adds the every-story smoke, local Supabase (pgTAP, db types, deploy
#     preflight, SUMIT cron), and the main Playwright suite. Needs Docker.
# `bash scripts/cloud-agent-install.sh` installs Deno, the Supabase CLI, and Playwright's Chromium.
# On success it writes .git/flow-local-ci with the commit it passed on, so the hook can skip a repeat.
# FLOW-813: the default run skips the app parts (typecheck, builds, app unit tests, Storybook) whose
# inputs (the git tree of app, packages, design, _shared and the root configs) already passed here,
# and runs only the app tests related to the files changed since the last green commit when only
# .ts/.tsx sources changed. --full, or FLOW_LOCAL_CI_NO_SKIP=1, runs everything. The cache of green
# runs is $FLOW_LOCAL_CI_CACHE, or .git/flow-local-ci-cache, and also $FLOW_LOCAL_CI_SHARED_CACHE, a
# folder every lane's container mounts (/mnt/project-files/ci/local-ci-cache when that is writable;
# set it empty to keep marks local), so one lane's pass counts for another. Marks name git trees, not
# commits, so a squash merge whose tree a lane passed counts too. Without Docker the default run leaves
# the e2e specs to main and says which.
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

pnpm install --frozen-lockfile --silent
git fetch -q origin main || true

# FLOW-813. A part whose inputs (git trees) passed before is skipped in the default run.
cache="${FLOW_LOCAL_CI_CACHE:-$(git rev-parse --git-common-dir)/flow-local-ci-cache}"
mkdir -p "$cache"
caches=("$cache")
if [[ -z "${FLOW_LOCAL_CI_SHARED_CACHE+set}" && -w /mnt/project-files/ci ]]; then
  FLOW_LOCAL_CI_SHARED_CACHE=/mnt/project-files/ci/local-ci-cache
fi
shared="${FLOW_LOCAL_CI_SHARED_CACHE:-}"
if [[ -n "$shared" ]] && mkdir -p "$shared" 2>/dev/null; then caches+=("$shared"); fi
head_tree="$(git rev-parse 'HEAD^{tree}')"
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
has_mark() {
  local dir
  for dir in "${caches[@]}"; do [[ -f "$dir/$1" ]] && return 0; done
  return 1
}
green() {
  (( skips )) && has_mark "$1"
}
# Marks a pass here and in the shared cache (a shared folder that can't be written is skipped).
mark_green() {
  local dir
  touch "$cache/$1"
  for dir in "${caches[@]:1}"; do touch "$dir/$1" 2>/dev/null || true; done
}
# Each ancestor of HEAD (within 200 commits) as "commit tree", newest first.
ancestors() {
  git log --max-count=200 --format='%H %T' HEAD
}
# What eslint reads: the TypeScript, JavaScript and JSON sources outside the folders it ignores, the
# lockfile (the plugin and type versions), and _shared, which linted tests import (the type-aware
# rules read its types).
lint_key="lint-$({ git ls-tree -r HEAD | grep -vE $'\t(docs|design|supabase)/'; git ls-tree -r HEAD -- supabase/functions/_shared; } \
  | grep -E $'\t(.*\\.([cm]?[jt]s|tsx|json)|pnpm-lock\\.yaml)$' | sha256sum | cut -c1-40)"
# The newest ancestor of HEAD (within 200 commits) where a test project last passed in full or in
# part, when every file changed since then is an app, shared or _shared .ts/.tsx source or a
# migration (a test globs them): the vitest module graph finds the tests those reach. Anything else
# (CSS, setup, config, scripts, lockfile, a deleted file) runs all.
changed_base() {
  local project="$1" commit tree
  (( skips )) || return 1
  local changed removed
  while read -r commit tree; do
    if has_mark "tree-$project-$tree"; then
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
  done < <(ancestors)
  return 1
}

# FLOW-813: the e2e specs that reach the files changed since the last commit whose specs passed here
# (or since main, which runs them all before each deploy). app/e2e/spec-sources.json maps each spec
# to the sources it exercises; scripts/e2e-specs.mjs follows their imports.
e2e_specs=()
e2e_left=0
if (( ! full )); then
  e2e_base=""
  if (( skips )); then
    while read -r commit tree; do
      if has_mark "tree-e2e-$tree"; then e2e_base="$commit"; break; fi
    done < <(ancestors)
  fi
  [[ -n "$e2e_base" ]] || e2e_base="$(git merge-base HEAD origin/main 2>/dev/null || true)"
  if [[ -z "$e2e_base" ]]; then
    echo "local-ci: no main to compare with, so the e2e specs are left to main." >&2
    e2e_left=1
  else
    e2e_list="$(git diff --name-only "$e2e_base" HEAD | node scripts/e2e-specs.mjs)"
    [[ -z "$e2e_list" ]] || mapfile -t e2e_specs <<<"$e2e_list"
  fi
fi

supabase_exit=""
if (( full || ${#e2e_specs[@]} > 0 )); then
  phase "Docker and local Supabase"
  if ! docker info >/dev/null 2>&1; then
    (sudo -n dockerd >/tmp/flow-dockerd.log 2>&1 &)
    for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
  fi
  if ! docker info >/dev/null 2>&1; then
    if (( full )); then
      echo "local-ci: Docker is not running and could not be started." >&2
      exit 1
    fi
    echo "local-ci: Docker is not running, so the e2e specs for this change are left to main: ${e2e_specs[*]}" >&2
    e2e_specs=()
    e2e_left=1
  else
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
fi
wait_supabase() {
  phase "e2e: waiting for local Supabase"
  while [[ ! -f "$supabase_exit" ]]; do sleep 2; done
  if [[ "$(cat "$supabase_exit")" != 0 ]]; then
    cat "$supabase_log"
    echo "local-ci: local Supabase did not start." >&2
    exit 1
  fi
  rm -f "$supabase_log" "$supabase_exit"
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
  node scripts/check-file-size.mjs
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
  mark_green "tree-$project-$head_tree"
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
  run_parts "$lint_key=lint" static unit "$typecheck_key=typecheck" "$build_key=build"
  rm -rf "$logs"
  # The app unit tests run alone: next to the builds, slow renders miss Testing Library's 1-second wait.
  phase "check: app unit tests"
  app_tests unit
else
  run_parts "$lint_key=lint" static "$typecheck_key=typecheck" "$build_key=build"
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

# The built-Storybook checks main runs in check (storybook) and check (stories): the layout, clip and
# secret specs, and the every-story check for the stories the change reaches (scripts/storybook-stories.mjs,
# at most FLOW_STORY_BUDGET stories, default 250). Skipped when these app inputs passed, or when nothing
# under app, packages or design changed since the last commit that passed them (or since main).
storybook_smoke() {
  if green "smoke-$app_key"; then
    echo "local-ci: Storybook smoke skipped: these app inputs already passed."
    return 0
  fi
  local base="" commit tree changed scope logs_dir
  logs_dir="$(mktemp -d)"
  if (( skips )); then
    while read -r commit tree; do
      if has_mark "tree-smoke-$tree"; then base="$commit"; break; fi
    done < <(ancestors)
  fi
  [[ -n "$base" ]] || base="$(git merge-base HEAD origin/main 2>/dev/null || true)"
  if [[ -n "$base" ]]; then
    changed="$(git diff --name-only "$base" HEAD)"
    if ! grep -qE '^(app|packages|design|supabase/functions/_shared)/|^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json)$|^scripts/(storybook-stories|e2e-specs|check-prod-bundle|hosted-env)\.mjs$' <<<"$changed"; then
      echo "local-ci: Storybook smoke skipped: no app change since ${base:0:7}."
      rm -rf "$logs_dir"
      return 0
    fi
  else
    changed="pnpm-lock.yaml"
  fi
  # Cloud containers ship a Chromium; use it when Playwright's own can't be downloaded.
  if ! pnpm --filter @flow/app exec playwright install chromium && [[ -x /opt/pw-browsers/chromium ]]; then
    echo "local-ci: using /opt/pw-browsers/chromium." >&2
    export FLOW_CHROMIUM_PATH=/opt/pw-browsers/chromium
  fi
  scope="$logs_dir/storybook-scope.txt"
  pnpm build-storybook >"$logs_dir/build-storybook.log" 2>&1 || { cat "$logs_dir/build-storybook.log"; return 1; }
  node scripts/storybook-stories.mjs --index app/storybook-static/index.json --budget "${FLOW_STORY_BUDGET:-250}" \
    <<<"$changed" >"$scope"
  if grep -qx all "$scope"; then
    echo "local-ci: the every-story check opens every story."
  else
    echo "local-ci: the every-story check opens the stories of $(grep -cvx partial "$scope" || true) files the changes since ${base:0:7} reach."
  fi
  # Two runs, as on main: next to the every-story shards, the focus specs miss their timing.
  pnpm test:storybook:smoke --reporter=line --grep-invert "every static story"
  FLOW_STORY_SCOPE="$scope" pnpm test:storybook:smoke --reporter=line --grep "every static story" \
    --workers="${FLOW_STORY_WORKERS:-4}"
  mark_green "smoke-$app_key"
  # Only a run that opened every story the change reaches moves the next run's base here.
  if grep -qx partial "$scope"; then
    echo "local-ci: more stories than the budget; main opens the rest."
  else
    mark_green "tree-smoke-$head_tree"
  fi
  rm -rf "$logs_dir"
}

if (( ! full )); then
  phase "check: Storybook smoke (layout specs and the stories this change reaches)"
  storybook_smoke
  if (( ${#e2e_specs[@]} > 0 )); then
    wait_supabase
    phase "e2e: ${#e2e_specs[@]} specs that reach the changes since ${e2e_base:0:7}"
    eval "$(bash scripts/ci-local-supabase-env.sh)"
    pnpm --filter @flow/app exec playwright install chromium
    # Playwright's default workers (half the cores): on every core the toast timing specs time out.
    pnpm --filter @flow/app exec playwright test --fully-parallel "${e2e_specs[@]}"
  fi
  # Only a run that checked every spec the change reaches moves the next run's base here.
  (( e2e_left )) || mark_green "tree-e2e-$head_tree"
  echo "$head" >"$(git rev-parse --git-dir)/flow-local-ci"
  phase "passed on ${head:0:7} (main opens every story and runs all e2e before each deploy)"
  exit 0
fi

pnpm build-storybook
pnpm test:storybook:smoke

wait_supabase

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

mark_green "tree-e2e-$head_tree"
echo "$head" >"$(git rev-parse --git-dir)/flow-local-ci"
phase "passed on ${head:0:7}"
