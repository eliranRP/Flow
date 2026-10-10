#!/usr/bin/env bash
# The pull-request gate. Pull requests have no GitHub CI: the pre-push hook (.githooks/pre-push) runs
# this script, and main runs the full suite on GitHub before each batch deploy.
#   default (under 3 minutes for a UI push, about 5 for a migration): lint, the migration checks,
#     Deno, typecheck, unit and connector tests, both dist builds, and the parts scoped to what the
#     branch changes against main (git diff origin/main...HEAD), so a merge of main re-runs nothing
#     for main's own changes:
#     - the app unit and Storybook vitest tests those files reach;
#     - up to FLOW_E2E_MAX (6) e2e specs that reach them, the branch's own specs first (Docker);
#     - the Storybook build with its layout, clip and secret specs, only when a story spec or the
#       Storybook setup changes;
#     - for a migration, pgTAP, seed or flow-mcp change: a fresh local database (every migration applied), the
#       flow-mcp smoke, the db types check, and the pgTAP files that name what changed
#       (scripts/pgtap-specs.mjs).
#   Seconds instead when the branch's patch against main (git patch-id) already passed, as after a
#     merge of main that leaves the patch unchanged; the file-size check only when the branch
#     changes only docs/, Markdown or design images (a claim commit). Lint checks the changed files
#     and every file that imports them (scripts/gate-scope.mjs), and the dist builds run only when
#     the change reaches the built app: the rest is as main left it, and main's CI lints and builds
#     all of it. Each run appends a line to
#     gate-times.log beside the shared cache: time, branch, mode, diff kind, seconds, result, and
#     each phase's seconds (node scripts/gate-times.mjs sums it up).
#   --full (about 12 minutes): every story, local Supabase (all of pgTAP, db types, deploy
#     preflight, SUMIT cron), and the main Playwright suite. Needs Docker.
# `bash scripts/cloud-agent-install.sh` installs Deno, the Supabase CLI, and Playwright's Chromium.
# On success it writes .git/flow-local-ci with the commit it passed on, so the hook can skip a repeat.
# FLOW-813: the default run skips the app parts (typecheck, builds, app unit tests, Storybook) whose
# inputs (the git tree of app, packages, design, _shared and the root configs) already passed here.
# --full runs everything; FLOW_LOCAL_CI_NO_SKIP=1 only turns these skips off. CSS and token changes
# get their layout checks on main. The cache of green runs is
# $FLOW_LOCAL_CI_CACHE, or .git/flow-local-ci-cache, and also $FLOW_LOCAL_CI_SHARED_CACHE, a folder
# every lane's container mounts (/mnt/project-files/ci/local-ci-cache when that is writable; set it
# empty to keep marks local), so one lane's pass counts for another. Marks name git trees, not
# commits, so a squash merge whose tree a lane passed counts too. A run that needs Docker (a
# database change, or e2e specs that reach the change) starts it (containerd, then dockerd) and
# fails when it can't. No required phase is skipped; a phase left to main says why.
set -euo pipefail

full=0
case "${1:-}" in
  "") ;;
  --full) full=1 ;;
  *) echo "Usage: local-ci.sh [--full]" >&2; exit 2 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
export FLOW_E2E_FRESH_SERVER=1 # Playwright starts its own servers: one already on a port may serve an old build.
head="$(git rev-parse HEAD)"
started="$(date +%s)"

# Each phase's start (seconds into the run) and its short name, for gate-times.log.
ran=()
phase_key() {
  case "$1" in
    "docs only"*) echo lint ;;
    "lint and check"*) echo lint-build ;;
    "check: app unit tests"* | "check: unit and connector tests"*) echo units ;;
    "check: Storybook smoke"*) echo storybook-smoke ;;
    "check: Storybook"*) echo storybook ;;
    "Docker and local Supabase"* | "e2e: waiting for local Supabase"*) echo supabase ;;
    "database:"* | "e2e: database checks"*) echo pgtap ;;
    "e2e:"*) echo e2e ;;
    "passed"*) echo end ;;
    *) echo other ;;
  esac
}
phase() {
  echo
  echo "== local-ci: $1 ($(( $(date +%s) - started ))s)"
  ran+=("$(( $(date +%s) - started )) $(phase_key "$1")")
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
# One line per run in gate-times.log, next to the shared cache when there is one, tab-separated: time,
# branch, mode, diff kind, seconds, result, and the seconds of each phase ("lint=40 units=95").
# scripts/gate-times.mjs sums it up against the targets; the lane manager posts that every hour.
mode="$( (( full )) && echo full || echo default)"
kind="unknown"
times_log="$cache/gate-times.log"
[[ -z "$shared" ]] || times_log="$(dirname "$shared")/gate-times.log"
log_time() {
  local rc=$? total i start key next phases=""
  total="$(( $(date +%s) - started ))"
  for (( i = 0; i < ${#ran[@]}; i++ )); do
    start="${ran[i]%% *}"
    key="${ran[i]#* }"
    [[ "$key" != end ]] || continue
    next="$total"
    (( i + 1 >= ${#ran[@]} )) || next="${ran[i + 1]%% *}"
    phases+="${phases:+ }$key=$(( next - start ))"
  done
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(git rev-parse --abbrev-ref HEAD)" "$mode" \
    "$kind" "$total" "$( (( rc == 0 )) && echo pass || echo "fail $rc")" "$phases" >>"$times_log" 2>/dev/null || true
}
trap log_time EXIT
skips=1
if (( full )) || [[ -n "${FLOW_LOCAL_CI_NO_SKIP:-}" ]]; then skips=0; fi
# What the app reads: its sources, the shared packages, the design tokens, _shared and the
# migrations (tests import both), the scripts its checks read or that pick what they run
# (scripts/app-scripts.mjs), the root configs and the untracked .env (vite's envDir). Any other
# script runs the scripts suite, lint and typecheck only.
mapfile -t app_scripts < <(node scripts/app-scripts.mjs)
(( ${#app_scripts[@]} )) || { echo "local-ci: scripts/app-scripts.mjs listed no scripts." >&2; exit 1; }
app_inputs=(app packages design supabase/functions/_shared supabase/migrations "${app_scripts[@]}"
  package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.js)
inputs_hash() {
  { git ls-tree -r HEAD -- "$@"; sha256sum .env 2>/dev/null || true; } | sha256sum | cut -c1-40
}
app_key="$(inputs_hash "${app_inputs[@]}")"
# The typecheck also checks every script (scripts/tsconfig.json).
typecheck_key="typecheck-$(inputs_hash "${app_inputs[@]}" scripts)"
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
  printf '%s' "${2:-}" >"$cache/$1"
  for dir in "${caches[@]:1}"; do printf '%s' "${2:-}" >"$dir/$1" 2>/dev/null || true; done
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
# The files this branch changes against main (git diff origin/main...HEAD). Main's own changes, which
# a merge of main brings in, already passed on main, so the default run never re-checks them.
pr_fork="$(git merge-base HEAD origin/main 2>/dev/null || true)"
if [[ -z "$pr_fork" ]] && (( ! full )); then
  echo "local-ci: no origin/main to compare with. Run git fetch origin main, or push with FLOW_LOCAL_CI=full." >&2
  exit 1
fi
pr_files=""
[[ -z "$pr_fork" ]] || pr_files="$(git diff --name-only "$pr_fork" HEAD)"
# Docs, Markdown and the design images (rendered screens, logo files): nothing the app, its
# tests or Storybook reads. The app reads only design/system's CSS from design/.
docs_files='^docs/|\.md$|^design/.*\.(png|jpe?g|webp|gif|svg)$'
# The diff kind gate-times.log groups by: migration, server (other supabase/), docs (docs_files
# only), ui (app, packages, design), else scripts.
if grep -q '^supabase/migrations/' <<<"$pr_files"; then kind=migration
elif grep -q '^supabase/' <<<"$pr_files"; then kind=server
elif [[ -n "$pr_files" ]] && ! grep -qvE "$docs_files" <<<"$pr_files"; then kind=docs
elif grep -qE '^(app|packages|design)/' <<<"$pr_files"; then kind=ui
else kind=scripts
fi
# The branch's own patch against main. A run that passes marks it with the main commit it forked
# from, so a merge of main that leaves the patch unchanged needs no second run, unless main changed a
# migration, flow-mcp, packages/shared or the seed since that fork (scripts/gate-base-risk.mjs): the
# same patch can break on a new main there (#364's viewer checks under #383's RPCs).
patch_id=""
[[ -z "$pr_fork" ]] || patch_id="$(git diff "$pr_fork" HEAD | git patch-id --stable | cut -d' ' -f1)"
passed() {
  echo "$head" >"$(git rev-parse --git-dir)/flow-local-ci"
  [[ -z "$patch_id" ]] || mark_green "patch-$patch_id" "$pr_fork"
}
# The fork a patch mark was written on (empty for a mark from before the fork was stored).
mark_fork() {
  local dir fork
  for dir in "${caches[@]}"; do
    fork="$(head -c 40 "$dir/$1" 2>/dev/null || true)"
    [[ -z "$fork" ]] || { echo "$fork"; return; }
  done
}
# When main did change one of those areas, only the phases that area can affect run again (base_only):
# database (a migration, the seed) the database step, with every pgTAP file on a database branch, and
# the e2e specs; flow-mcp its Deno tests and the smoke; shared the typecheck, unit tests and builds.
# A mark with no fork, or a fork no longer under main, runs the whole gate.
base_risk=0
base_only=0
base_areas=""
if (( skips )) && [[ -n "$patch_id" ]] && has_mark "patch-$patch_id"; then
  risk_out="$(node scripts/gate-base-risk.mjs "$(mark_fork "patch-$patch_id")" "$pr_fork")" && {
    mode="same patch"
    echo "local-ci: this branch's patch against main already passed; main's own changes are main's CI's."
    echo "$head" >"$(git rev-parse --git-dir)/flow-local-ci"
    exit 0
  }
  grep -v '^areas=' <<<"$risk_out" || true
  base_risk=1
  base_areas="$(sed -n 's/^areas=//p' <<<"$risk_out" | tr ',' ' ')"
  if [[ -n "$base_areas" && "$base_areas" != all ]]; then
    base_only=1
    mode="base risk"
    echo "local-ci: the same patch passed on an older main; re-running only what main's change reaches: $base_areas."
  else
    echo "local-ci: the same patch passed, but the mark can't show what main changed since; running the gate."
  fi
fi
# Whether this run re-checks area $1: always, unless only main's risky areas are re-run.
base_area() {
  (( ! base_only )) || [[ " $base_areas " == *" $1 "* ]]
}
# Only docs_files against main: lint and the file-size check, nothing else.
if (( ! full )) && [[ -n "$pr_files" ]] && ! grep -qvE "$docs_files" <<<"$pr_files"; then
  mode="docs"
  phase "docs only: the file-size check"
  echo "local-ci: lint skipped: eslint reads no docs, Markdown or design images (main lints all of it)."
  node scripts/check-file-size.mjs
  passed
  phase "passed on ${head:0:7} (docs only)"
  exit 0
fi
# The files changed since $1 that this branch also changes against main.
branch_changes() {
  local since
  since="$(git diff --name-only "$1" HEAD)"
  if [[ -z "$pr_fork" ]]; then
    printf '%s\n' "$since"
    return
  fi
  [[ -n "$since" && -n "$pr_files" ]] || return 0
  grep -Fxf <(printf '%s\n' "$pr_files") <<<"$since" || true
}

# Where this branch left main, when every app input the branch changes is an app, e2e, shared or
# _shared .ts/.tsx source, a migration (a test globs them), app CSS (no test imports it), or a
# manifest, tsconfig or lockfile whose change the tests don't read: the vitest module graph finds the
# tests and stories those reach. Anything else (setup, config, the design package, scripts, a
# dependency, a deleted or renamed file) runs all (scripts/storybook-stories.mjs, relatedRun).
changed_base() {
  (( skips )) || return 1
  [[ -n "$pr_fork" ]] || return 1
  [[ "$(git diff --name-status "$pr_fork" HEAD -- "${app_inputs[@]}" \
    | node scripts/storybook-stories.mjs --related-run --base "$pr_fork")" == related ]] || return 1
  echo "$pr_fork"
}

# FLOW-813: the e2e specs that reach the files changed since the last commit whose specs passed here
# (or since main, which runs them all before each deploy). app/e2e/spec-sources.json maps each spec
# to the sources it exercises; scripts/e2e-specs.mjs follows their imports.
e2e_specs=()
e2e_left=0
sweep_routes=""
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
    e2e_list="$(branch_changes "$e2e_base" | sed '/^$/d' | node scripts/e2e-specs.mjs)"
    [[ -z "$e2e_list" ]] || mapfile -t e2e_specs <<<"$e2e_list"
    # The no-op sweep specs open only the routes whose files the change reaches, a sweep spec with
    # none of them is left out, and one with some runs (scripts/gate-scope.mjs --sweep, from the
    # routes in spec-sources.json). The gate names each route it sweeps and why.
    sweep_out="$(branch_changes "$e2e_base" | sed '/^$/d' | node scripts/gate-scope.mjs --sweep)"
    sweep_routes="$(cut -f2 <<<"$sweep_out" | sed '/^$/d')"
    mapfile -t e2e_specs < <(
      { printf '%s\n' "${e2e_specs[@]}" | grep -v '^e2e/controls-sweep-' || true; cut -f1 <<<"$sweep_out"; } | sed '/^$/d' | sort -u
    )
    for spec in $(grep '^e2e/controls-sweep-' <<<"$e2e_list" || true); do
      grep -q "^$spec"$'\t' <<<"$sweep_out" \
        || echo "local-ci: $spec sweeps none of its routes: this change reaches no file they draw."
    done
    if [[ -n "$sweep_out" && "$(cut -f3 <<<"$sweep_out" | sort -u | wc -l)" == 1 ]]; then
      echo "local-ci: the no-op sweep opens $(wc -l <<<"$sweep_routes") routes, all because $(head -n 1 <<<"$sweep_out" | cut -f3)."
    elif [[ -n "$sweep_out" ]]; then
      echo "local-ci: the no-op sweep opens the $(wc -l <<<"$sweep_routes") routes this change reaches:"
      awk -F'\t' '{ print "  " $1 " " $2 ": " $3 }' <<<"$sweep_out"
    fi
    # At most FLOW_E2E_MAX specs (default 6), the branch's own changed specs first; main runs the rest.
    if (( ${#e2e_specs[@]} > ${FLOW_E2E_MAX:-6} )); then
      mapfile -t e2e_specs < <(
        printf '%s\n' "${e2e_specs[@]}" | grep -Fxf <(sed -n 's|^app/||p' <<<"$pr_files") || true
        printf '%s\n' "${e2e_specs[@]}" | grep -vFxf <(sed -n 's|^app/||p' <<<"$pr_files") || true
      )
      echo "local-ci: ${#e2e_specs[@]} e2e specs reach this change; running ${FLOW_E2E_MAX:-6}, main runs the rest: ${e2e_specs[*]:${FLOW_E2E_MAX:-6}}"
      e2e_specs=("${e2e_specs[@]:0:${FLOW_E2E_MAX:-6}}")
      e2e_left=1
    fi
  fi
fi

# FLOW-813: a branch that changes a migration, pgTAP, the seed or flow-mcp gets a fresh database (every
# migration applied by the reset), the flow-mcp smoke, the db types check, and the pgTAP files that
# name what it changed (scripts/pgtap-specs.mjs). Main runs every pgTAP file.
db_specs=()
db_change=0
if (( ! full )) && grep -qE '^supabase/(migrations/|tests/|seed\.sql$|config\.toml$|functions/flow-mcp/)' <<<"$pr_files"; then
  db_change=1
  db_list="$(node scripts/pgtap-specs.mjs <<<"$pr_files")"
  [[ -z "$db_list" ]] || mapfile -t db_specs <<<"$db_list"
  if (( base_risk )) && base_area database; then db_specs=(supabase/tests/database); fi
  # Main moved only flow-mcp or the shared package: the smoke and the types check, no pgTAP.
  if (( base_only )) && ! base_area database; then db_specs=(); fi
  if (( base_only )) && ! base_area database && ! base_area flow-mcp; then db_change=0; fi
fi
# The e2e specs read the database: they run again only when main moved it.
if (( base_only )) && ! base_area database; then
  (( ${#e2e_specs[@]} == 0 )) \
    || echo "local-ci: this patch already passed its e2e specs, and main has not moved the database since; skipping them: ${e2e_specs[*]}"
  e2e_specs=()
  e2e_left=1
fi

# Starts Docker when it is down. In cloud containers dockerd alone can fail with "timeout waiting
# for containerd", so containerd starts first and dockerd is pointed at its socket.
start_docker() {
  local sock=/run/containerd/containerd.sock retried=
  docker info >/dev/null 2>&1 && return 0
  start_dockerd() {
    if [[ -S "$sock" ]]; then
      (sudo -n dockerd --containerd="$sock" >/tmp/flow-dockerd.log 2>&1 &)
    else
      (sudo -n dockerd >/tmp/flow-dockerd.log 2>&1 &)
    fi
  }
  # The socket file appears before containerd serves it, and dockerd started then exits with
  # "connection refused": ask containerd itself whether it answers.
  containerd_serving() {
    if command -v ctr >/dev/null 2>&1; then
      sudo -n ctr --address "$sock" version >/dev/null 2>&1
    else
      grep -q "containerd successfully booted" /tmp/flow-containerd.log 2>/dev/null
    fi
  }
  if ! pgrep -x dockerd >/dev/null 2>&1; then
    # A socket left from an earlier containerd doesn't mean one is serving: start it whenever
    # none runs. Either way, start dockerd only once containerd answers, for at most 30 seconds.
    if ! pgrep -x containerd >/dev/null 2>&1; then
      (sudo -n containerd >/tmp/flow-containerd.log 2>&1 &)
    fi
    for _ in $(seq 1 30); do
      containerd_serving && break
      sleep 1
    done
    start_dockerd
  fi
  for i in $(seq 1 30); do
    docker info >/dev/null 2>&1 && return 0
    # dockerd exits at once when containerd wasn't ready yet; start it once more.
    if [[ -z $retried ]] && (( i >= 5 )) && ! pgrep -x dockerd >/dev/null 2>&1; then
      retried=1
      start_dockerd
    fi
    sleep 1
  done
  return 1
}

supabase_exit=""
if (( full || db_change || ${#e2e_specs[@]} > 0 )); then
  phase "Docker and local Supabase"
  if ! start_docker; then
    if (( full )); then need="the full run"
    elif (( db_change )); then need="this change touches the database"
    else need="these e2e specs reach this change: ${e2e_specs[*]}"
    fi
    {
      echo "local-ci: Docker is not running and could not be started, and $need. Nothing is left to main."
      echo "  Start it, then push again:"
      echo "    sudo containerd &   # wait until /run/containerd/containerd.sock exists"
      echo "    sudo dockerd --containerd=/run/containerd/containerd.sock &"
      echo "  Logs: /tmp/flow-containerd.log, /tmp/flow-dockerd.log"
    } >&2
    exit 1
  else
    supabase_log="$(mktemp)"
    supabase_exit="$(mktemp)"
    rm -f "$supabase_exit"
    # An instance that is already up keeps its database when it carries this tree's migrations, seed
    # and config (the last reset here recorded them) and no reached spec reads the database. A spec
    # reads it when it or an e2e helper it imports reads FLOW_E2E_SUPABASE_URL, the local API it signs in
    # and writes rows through (signed-out screens only reach auth). Anything else resets it.
    db_tree="$(git ls-tree -r HEAD -- supabase/migrations supabase/seed.sql supabase/config.toml | sha256sum | cut -c1-40)"
    db_readers=()
    for spec in "${e2e_specs[@]}"; do
      readers=("app/$spec")
      while IFS= read -r helper; do readers+=("app/e2e/$helper.ts"); done \
        < <(sed -nE 's/.*from "\.\/([^"]+)".*/\1/p' "app/$spec" 2>/dev/null)
      if grep -q FLOW_E2E_SUPABASE "${readers[@]}" 2>/dev/null; then db_readers+=("$spec"); fi
    done
    db_reset=""
    if (( full )); then db_reset="the full run"
    elif (( db_change )); then db_reset="this change touches the database"
    elif [[ "$(cat "$cache/supabase-db-tree" 2>/dev/null)" != "$db_tree" ]]; then
      db_reset="its migrations, seed or config differ from the last reset here"
    elif (( ${#db_readers[@]} > 0 )); then db_reset="these specs read the database: ${db_readers[*]}"
    fi
    if supabase status >/dev/null 2>&1; then
      if [[ -n "$db_reset" ]]; then echo "local-ci: resetting local Supabase in the background: $db_reset."
      else echo "local-ci: local Supabase is up with this tree's migrations, seed and config, and no reached spec reads the database; keeping it without a reset."
      fi
    fi
    # Starts in the background while the static checks run. A reset instance carries this branch's
    # migrations and no rows from an earlier run.
    # A stack that is still starting (another run's start, or containers coming back after a restart)
    # fails the first reset or start: wait for its database to answer, then try once more.
    (
      up() {
        if supabase status >/dev/null 2>&1; then
          [[ -n "$db_reset" ]] || return 0
        else
          # A start can reuse an older database volume, so only a reset records the tree.
          rm -f "$cache/supabase-db-tree"
          supabase start -x studio,postgres-meta,logflare,vector,mailpit,imgproxy,supavisor,realtime >>"$supabase_log" 2>&1 || return
          [[ -n "$db_reset" ]] || return 0
          echo "local-ci: started local Supabase on its old database; resetting it: $db_reset." >>"$supabase_log"
        fi
        rm -f "$cache/supabase-db-tree"
        supabase db reset >>"$supabase_log" 2>&1 || return
        printf '%s' "$db_tree" >"$cache/supabase-db-tree"
      }
      rc=0
      if ! up; then
        echo "local-ci: local Supabase was not ready; waiting for it and trying again." >>"$supabase_log"
        # The CLI refuses a database container whose health check still reads "starting".
        for _ in $(seq 1 60); do
          health="$(docker inspect -f '{{.State.Health.Status}}' supabase_db_flow 2>/dev/null || echo missing)"
          [[ "$health" == healthy || "$health" == missing ]] && break
          sleep 2
        done
        up || rc=$?
      fi
      echo "$rc" >"${supabase_exit}.tmp"
      mv "${supabase_exit}.tmp" "$supabase_exit"
    ) >/dev/null 2>&1 &
  fi
fi
# flow-mcp answers 503 in a cloud container until the edge runtime's npm cache is seeded from the host.
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
wait_supabase() {
  phase "e2e: waiting for local Supabase"
  while [[ ! -f "$supabase_exit" ]]; do sleep 2; done
  if [[ "$(cat "$supabase_exit")" != 0 ]]; then
    cat "$supabase_log"
    echo "local-ci: local Supabase did not start." >&2
    exit 1
  fi
  grep '^local-ci: ' "$supabase_log" || true
  rm -f "$supabase_log" "$supabase_exit"
}

phase "lint and check: lint, static checks, and builds, side by side"
logs="$(mktemp -d)"
# The lint rules read types, so a file's result can change only when the file or something it
# imports changes: the branch's changed files and every file that imports them, all the way up
# (scripts/gate-scope.mjs). A config, tsconfig, manifest, lockfile, .d.ts, delete or rename lints all.
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
  node scripts/backlog-index.mjs --check
  deno test --allow-env --config supabase/functions/flow-mcp/deno.json supabase/functions/flow-mcp
  bash scripts/check-edge-functions.sh
}
# The same tsc runs as pnpm typecheck, with --incremental: a tsbuildinfo per project in this
# container's cache keeps what the last run checked, and tsc re-checks only the files a change
# reaches (its own dependency tracking; a new TypeScript version starts over). --full, an
# unexpected typecheck script, or a package with another script runs the scripts as they are.
typecheck_part() {
  local info dir script
  info="$(cd "$cache" && pwd)/tsbuildinfo"
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
  node scripts/check-deny-list.mjs
}
# Both dist builds. Skipped when every app input the branch changes is one the built app never
# reads (tests, stories, e2e specs, test setups: scripts/gate-scope.mjs --build). Both run vite
# build alone: the app's build script adds tsc --noEmit, the typecheck part's own check of the same
# inputs (it runs beside this one, or passed on them before).
build_part() {
  if (( skips )) && [[ -n "$pr_fork" ]] \
    && [[ "$(git diff --name-status "$pr_fork" HEAD -- "${app_inputs[@]}" | node scripts/gate-scope.mjs --build)" == skip ]]; then
    echo "local-ci: app builds skipped: this branch changes only tests, stories and specs, which the built app doesn't read (main builds it)."
    return 0
  fi
  pnpm --filter @flow/app exec vite build
  node scripts/stamp-build.mjs "$head"
  pnpm check:bundle
  rm -rf app/dist
  VITE_REVIEWER_BUILD=1 VITE_SUPABASE_URL="" VITE_SUPABASE_ANON_KEY="" pnpm --filter @flow/app exec vite build
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
  # The jsdom tests on one worker per core: vitest's default (one fewer) left 16% of the CPU idle,
  # since each test file spends about a second starting its own jsdom and setup (the full suite on
  # 4 cores: 203 s on 3 workers, 178 s on 4; 4 and 6 passed every test twice).
  local workers=()
  [[ "$project" != unit ]] || workers=(--maxWorkers="$(nproc)")
  if base="$(changed_base "$project")"; then
    echo "local-ci: $project tests related to the changes since ${base:0:7}${workers:+, on $(nproc) workers}."
    pnpm --filter @flow/app exec vitest run --project "$project" --changed "$base" --passWithNoTests "${workers[@]}"
    # The module graph doesn't see a glob of the migrations: run the tests that read them by name.
    local globbing
    globbing="$(git grep -l 'supabase/migrations' -- 'app/src/*.test.ts' 'app/src/*.test.tsx' || true)"
    if [[ "$project" == unit && -n "$globbing" ]] \
      && [[ -n "$(git diff --name-only "$base" HEAD -- supabase/migrations)" ]]; then
      # shellcheck disable=SC2086
      pnpm --filter @flow/app exec vitest run --project unit ${globbing//app\//}
    fi
  elif [[ "$project" == unit ]]; then
    pnpm --filter @flow/app test "${workers[@]}"
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
if (( base_only )); then
  # Lint reads only this branch's unchanged sources. The static part holds flow-mcp's Deno tests.
  parts=()
  if base_area database || base_area flow-mcp; then parts+=(static); fi
  if base_area shared; then parts+=(unit "$typecheck_key=typecheck" "$build_key=build"); fi
  (( ${#parts[@]} == 0 )) || run_parts "${parts[@]}"
  rm -rf "$logs"
  if base_area shared; then
    phase "check: app unit tests"
    app_tests unit
  fi
elif (( skips )); then
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
if (( base_only )); then
  echo "local-ci: Storybook skipped: this branch's stories passed, and main changed none of their inputs it can reach."
elif (( skips )); then
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
  local base="" commit tree changed scope logs_dir setup
  logs_dir="$(mktemp -d)"
  if (( skips )); then
    while read -r commit tree; do
      if has_mark "tree-smoke-$tree"; then base="$commit"; break; fi
    done < <(ancestors)
  fi
  [[ -n "$base" ]] || base="$(git merge-base HEAD origin/main 2>/dev/null || true)"
  if [[ -n "$base" ]]; then
    changed="$(branch_changes "$base")"
    # The vitest Storybook project above already ran the stories the change reaches. The build and
    # its layout, clip and secret specs run when a story spec or the Storybook setup changes; a
    # manifest, tsconfig or lockfile counts only when the part the build reads changed.
    setup="$(node scripts/storybook-stories.mjs --setup --base "$base" <<<"$changed")"
    if [[ "$setup" != yes* ]]; then
      echo "local-ci: Storybook build and smoke skipped: no story spec or Storybook setup change (main runs them)."
      rm -rf "$logs_dir"
      return 0
    fi
    echo "local-ci: Storybook build and smoke run: ${setup#yes } changed, which they read."
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
    ${base:+--base "$base"} <<<"$changed" >"$scope"
  if grep -qx all "$scope"; then
    echo "local-ci: the every-story check opens every story."
  elif [[ -s "$scope" ]]; then
    echo "local-ci: the every-story check opens the stories of $(grep -cvx partial "$scope" || true) files the changes since ${base:0:7} reach."
  else
    # A layout, clip or secret spec change runs those specs; the every-story check doesn't read them.
    echo "local-ci: the every-story check skipped: the changes since ${base:0:7} reach no story (main opens every story)."
  fi
  # Two runs, as on main: next to the every-story shards, the focus specs miss their timing.
  pnpm test:storybook:smoke --reporter=line --grep-invert "every static story"
  if [[ -s "$scope" ]]; then
    FLOW_STORY_SCOPE="$scope" pnpm test:storybook:smoke --reporter=line --grep "every static story" \
      --workers="${FLOW_STORY_WORKERS:-4}"
  fi
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
  if (( base_only )); then
    echo "local-ci: Storybook smoke skipped (base risk only)."
  else
    storybook_smoke
  fi
  if (( db_change )); then
    wait_supabase
    phase "database: the flow-mcp smoke, db types, and ${#db_specs[@]} pgTAP files that name the change"
    edge_ready
    bash scripts/mcp-function-smoke.sh
    (( ${#db_specs[@]} == 0 )) || supabase test db "${db_specs[@]}"
    bash scripts/check-db-types.sh
  fi
  if (( ${#e2e_specs[@]} > 0 )); then
    (( db_change )) || wait_supabase
    phase "e2e: ${#e2e_specs[@]} specs that reach the changes since ${e2e_base:0:7}"
    eval "$(bash scripts/ci-local-supabase-env.sh)"
    pnpm --filter @flow/app exec playwright install chromium
    # One worker per core but one: on every core the toast timing specs time out, and Playwright's
    # default (half the cores) left a core idle (the review set: 293 s on 2 of 4 cores, 246 s on 3).
    e2e_workers="$(( $(nproc) > 2 ? $(nproc) - 1 : 1 ))"
    echo "local-ci: running the e2e specs on $e2e_workers Playwright workers ($(nproc) cores)."
    FLOW_SWEEP_ROUTES="$sweep_routes" pnpm --filter @flow/app exec playwright test --fully-parallel --workers="$e2e_workers" "${e2e_specs[@]}"
  fi
  # Only a run that checked every spec the change reaches moves the next run's base here.
  (( e2e_left )) || mark_green "tree-e2e-$head_tree"
  passed
  phase "passed on ${head:0:7} (main opens every story and runs all e2e before each deploy)"
  exit 0
fi

pnpm build-storybook
pnpm test:storybook:smoke

phase "Home speed test (FLOW-804)"
pnpm build
pnpm --filter @flow/app test:perf

wait_supabase

phase "e2e: database checks"
edge_ready
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
passed
phase "passed on ${head:0:7}"
