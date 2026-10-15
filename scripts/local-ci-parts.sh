# Sourced by scripts/local-ci.sh, after the scoping it sets up (pr_fork, pr_files, skips, cache). The checks
# both the default run and the --part slices use, and the slices themselves (FLOW-832):
#   quick   the pre-push hook: eslint on the changed files, 20 s (the budget is in local-ci-guard.sh)
#   static  eslint on the changed files and the files that import them, the migration checks, the edge-function
#           typecheck when supabase/functions changed, the connector tests on a local run, and the scripts tests
#           when scripts/ changed (on a plain runner, not in the Playwright image). The connector tests need the
#           MERCURY_FIXTURE_DENYLIST secret, so on GitHub they and the deny-list check run on main only; the dist
#           builds run on main too.
#   types   the typecheck, the unused-code and CSS checks (FLOW-835: its own job, beside static, so the two run at once)
#   tests   the app unit and Storybook vitest tests the change reaches (--shard i/n passes through to vitest)
#   db      when supabase/ changed: local Supabase, a fresh database, the flow-mcp smoke, the pgTAP files that
#           name the change, and the db types check
# A slice runs in a fresh CI container too, so it keeps no marks: the caches above only make a local run faster.

# What eslint reads, with the files that import the changed ones (scripts/gate-scope.mjs). The static slice runs it.
# A config, tsconfig, manifest, lockfile, .d.ts, delete or rename lints all.
lint_part() {
  local scope
  if (( skips )) && [[ -n "$pr_fork" ]]; then
    scope="$(git diff --name-status "$pr_fork" HEAD | node scripts/gate-scope.mjs --lint)"
    if [[ -z "$scope" ]]; then
      echo "local-ci: lint skipped: this branch changes no file eslint reads (main lints all of it)."
      return 0
    fi
    if [[ "$scope" != all ]]; then
      echo "local-ci: linting the $(wc -l <<<"$scope") files this branch changes or that import them (main lints all of it)."
      xargs -d '\n' pnpm exec eslint --no-warn-ignored <<<"$scope"
      return
    fi
  fi
  pnpm lint
}

# The checks that read no app code: migrations, file size, the backlog index and the flow-mcp Deno tests.
static_checks() {
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
  node scripts/backlog-index.mjs --check
  deno test --allow-env --config supabase/functions/flow-mcp/deno.json supabase/functions/flow-mcp
}

# Type-checks every edge function with its own deno.json (scripts/check-edge-functions.sh).
edge_part() {
  bash scripts/check-edge-functions.sh
}

static_part() {
  static_checks
  edge_part
}

# The same tsc runs as pnpm typecheck, with --incremental: a tsbuildinfo per project in this
# container's cache keeps what the last run checked, and tsc re-checks only the files a change
# reaches (its own dependency tracking; a new TypeScript version starts over). --full, an
# unexpected typecheck script, or a package with another script runs the scripts as they are.
typecheck_part() {
  local info dir script
  info="$(cd "$cache" && pwd)/tsbuildinfo"
  node scripts/check-unused-app-code.mjs && node scripts/check-unused-css.mjs && node scripts/check-css-tokens.mjs # FLOW-819, 822, 363: no dead code, CSS or raw CSS values.
  if (( ! skips )) || [[ "$(node -p 'require("./package.json").scripts.typecheck')" \
    != 'tsc --noEmit -p scripts/tsconfig.json && pnpm -r --if-present --filter "!flow" typecheck' ]]; then
    pnpm typecheck
    return
  fi
  mkdir -p "$info"
  pnpm exec tsc --noEmit -p scripts/tsconfig.json --incremental --tsBuildInfoFile "$info/scripts.tsbuildinfo"
  for dir in app packages/*/; do
    dir="${dir%/}"
    script="$(node -p "require('./$dir/package.json').scripts?.typecheck ?? ''")"
    case "$script" in
      "") ;;
      "tsc --noEmit") (cd "$dir" && pnpm exec tsc --noEmit --incremental --tsBuildInfoFile "$info/${dir//\//-}.tsbuildinfo") ;;
      *) (cd "$dir" && pnpm run typecheck) ;;
    esac
  done
}

# Whether vitest can pick the tests the change reaches from $pr_fork: the app inputs the branch changes
# are all sources, specs, migrations, manifests or configs whose reach the module graph sees
# (scripts/storybook-stories.mjs, relatedRun). Anything else runs every test.
related_ok() {
  [[ -n "$pr_fork" ]] || return 1
  [[ "$(git diff --name-status "$pr_fork" HEAD -- "${app_inputs[@]}" \
    | node scripts/storybook-stories.mjs --related-run --base "$pr_fork")" == related ]]
}

# The jsdom tests on one worker per core: vitest's default (one fewer) left 16% of the CPU idle, since
# each test file spends about a second starting its own jsdom and setup.
# One vitest project of @flow/app. $2 is the commit the tests related to the change are picked from
# (empty runs every test of the project), $3 an optional shard i/n. Each shard runs the migration-
# globbing tests too: the module graph doesn't see a glob of the migrations.
vitest_project() {
  local project="$1" base="$2" shard="$3" args=() globbing
  [[ "$project" != unit ]] || args+=(--maxWorkers="$(nproc)")
  [[ -z "$shard" ]] || args+=(--shard "$shard")
  if [[ -z "$base" ]]; then
    pnpm --filter @flow/app exec vitest run --project "$project" "${args[@]}"
    return
  fi
  pnpm --filter @flow/app exec vitest run --project "$project" --changed "$base" --passWithNoTests "${args[@]}"
  globbing="$(git grep -l 'supabase/migrations' -- 'app/src/*.test.ts' 'app/src/*.test.tsx' || true)"
  if [[ "$project" == unit && -n "$globbing" ]] \
    && [[ -n "$(git diff --name-only "$base" HEAD -- supabase/migrations)" ]]; then
    # shellcheck disable=SC2086
    pnpm --filter @flow/app exec vitest run --project unit ${globbing//app\//}
  fi
}

# Starts or waits for the local API the flow-mcp smoke calls. The cloud container's edge runtime answers
# 503 until its npm cache is seeded from the host.
edge_ready() {
  local api
  api="$(supabase status -o env | sed -n 's/^API_URL=//p' | head -n 1 | tr -d '"')"
  [[ "$(curl -s -o /dev/null -w '%{http_code}' "$api/functions/v1/flow-mcp" || true)" == 405 ]] && return 0
  bash scripts/seed-edge-cache.sh || echo "local-ci: could not seed the edge runtime cache." >&2
  for _ in $(seq 1 15); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' "$api/functions/v1/flow-mcp" || true)" == 405 ]] && return 0
    sleep 2
  done
  echo "local-ci: flow-mcp still does not answer after seeding its cache." >&2
}

# quick (FLOW-832): eslint on the files this branch changes, and nothing they import. The importer walk
# (lint_part) runs in the static slice, on the PR check, in parallel. A file deleted on the branch is skipped.
slice_quick() {
  local files
  files="$(git diff --name-only --diff-filter=d "$pr_fork" HEAD | grep -E '\.([cm]?[jt]s|tsx|json)$' || true)"
  if [[ -z "$files" ]]; then
    echo "local-ci: lint skipped: this branch changes no file eslint reads."
    return 0
  fi
  echo "local-ci: linting the $(wc -l <<<"$files") files this branch changes (the importers are the static slice's)."
  xargs -d '\n' pnpm exec eslint --no-warn-ignored --cache --cache-strategy content \
    --cache-location "$cache/eslint-cache.json" <<<"$files"
}

slice_static() {
  static_checks
  lint_part
  if grep -q '^supabase/functions/' <<<"$pr_files"; then
    edge_part
  else
    echo "local-ci: edge-function typecheck skipped: this branch changes no supabase/functions file (main checks them all)."
  fi
  # The connector tests read the MERCURY_FIXTURE_DENYLIST secret, which GitHub's PR runs do not have: CI is set there.
  if [[ -z "${CI:-}" ]]; then pnpm test:connectors; fi
  if grep -q '^scripts/' <<<"$pr_files"; then
    node --test scripts/*.test.mjs
  fi
}

# FLOW-835: the typecheck and the unused-code and CSS checks run in their own job, beside static, so the
# two take the time of the slower one rather than their sum.
slice_types() {
  typecheck_part
}

slice_tests() {
  local base=""
  if related_ok; then base="$pr_fork"; fi
  if [[ -n "$base" ]]; then
    echo "local-ci: tests related to the changes since ${base:0:7}${shard:+, shard $shard}."
  else
    echo "local-ci: every app unit and Storybook test${shard:+, shard $shard}: the change reaches a file the module graph can't follow."
  fi
  # GitHub's Playwright image carries the browsers (CI is set there); a local run installs them here.
  if [[ -z "${CI:-}" ]]; then pnpm --filter @flow/app exec playwright install chromium; fi
  vitest_project unit "$base" "$shard"
  vitest_project storybook "$base" "$shard"
}

slice_db() {
  if ! grep -q '^supabase/' <<<"$pr_files"; then
    echo "local-ci: database checks skipped: this branch changes nothing under supabase/."
    return 0
  fi
  # Every service but the database, the REST API (kong and postgrest), auth and the edge runtime.
  if ! supabase status >/dev/null 2>&1; then
    supabase start -x studio,postgres-meta,logflare,vector,mailpit,imgproxy,supavisor,realtime,storage-api
  fi
  supabase db reset
  edge_ready
  bash scripts/mcp-function-smoke.sh
  local db_list db_specs=()
  db_list="$(node scripts/pgtap-specs.mjs <<<"$pr_files")"
  [[ -z "$db_list" ]] || mapfile -t db_specs <<<"$db_list"
  (( ${#db_specs[@]} == 0 )) || supabase test db "${db_specs[@]}"
  bash scripts/check-db-types.sh
}

# Runs the slice named by $slice, then exits from the caller. A failing check fails the run (set -e).
run_part() {
  mode="part $slice"
  case "$slice" in
    quick)
      slice_quick
      echo "local-ci: quick check passed; the PR check runs the rest."
      ;;
    static)
      phase "static: the migration checks, lint with its importers, and the edge functions when they changed"
      slice_static
      echo "local-ci: static checks passed."
      ;;
    types)
      phase "types: the typecheck, the unused-code and CSS checks"
      slice_types
      echo "local-ci: types checks passed."
      ;;
    tests)
      phase "tests: the app unit and Storybook tests this change reaches${shard:+, shard $shard}"
      slice_tests
      echo "local-ci: tests passed${shard:+ for shard $shard}."
      ;;
    db)
      phase "db: local Supabase, a fresh database, the flow-mcp smoke, pgTAP and the db types"
      slice_db
      echo "local-ci: database checks passed."
      ;;
  esac
}
