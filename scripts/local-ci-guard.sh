# Sourced by scripts/local-ci.sh: its phases, each phase's time budget, and the cleanup of what it starts.
#
# The gate runs in its own process group (setsid), so when it ends (pass, fail, a budget, Ctrl-C or
# kill) the wrapper stops every process it left behind: wrangler, Playwright's servers, vitest
# workers. A gate stopped at 10:52 once left a `wrangler pages dev` that hung the next gate's
# Storybook tests for 24 minutes. Docker's daemons start detached (`detach`), outside the group.
# Without setsid (macOS) the gate runs as before, and a budget stops only the gate's own children.

# Seconds a phase may run before the gate stops with its name: well past the slowest pass in
# gate-times.log (storybook p90 102 s, max 337; smoke max 1341; e2e max 340; --full's whole e2e suite
# gets twice that). FLOW_LOCAL_CI_BUDGET=0 turns budgets off.
declare -A budgets=([storybook]=600 [storybook-smoke]=1800 [e2e]=$(( ${full:-0} ? 1800 : 900 )))

# Runs this script again as its own process group and waits; returns at once inside that run.
guard_session() {
  # Only the run this wrapper started (its child) is inside: a script a test or a gate part runs
  # inherits the variables but has another parent, so it gets its own group and flag.
  if [[ "${FLOW_LOCAL_CI_GROUP:-}" == "$PPID" ]]; then
    stop_flag="$FLOW_LOCAL_CI_STOP_FLAG"
    return 0
  fi
  stop_flag="$(mktemp)"
  export FLOW_LOCAL_CI_STOP_FLAG="$stop_flag"
  command -v setsid >/dev/null 2>&1 || return 0
  export FLOW_LOCAL_CI_GROUP=$$
  local rc=0
  # A background child of a shell without job control is no group leader, so setsid needs no fork:
  # its pid is the new group's id.
  setsid bash "$0" "$@" <&0 &
  gate_group=$!
  trap 'echo "signal" >"$stop_flag"; stop_group "$gate_group"; rm -f "$stop_flag"; exit 130' INT
  trap 'echo "signal" >"$stop_flag"; stop_group "$gate_group"; rm -f "$stop_flag"; exit 143' TERM HUP
  wait "$gate_group" || rc=$?
  stop_group "$gate_group"
  rm -f "$stop_flag"
  exit "$rc"
}

# Stops every process left in group $1: TERM, then KILL after 5 seconds.
stop_group() {
  local left
  left="$(pgrep -g "$1" | wc -l || true)"
  (( left > 0 )) || return 0
  echo "local-ci: stopping $left processes the gate left running." >&2
  kill -TERM -- "-$1" 2>/dev/null || true
  for _ in $(seq 1 10); do
    pgrep -g "$1" >/dev/null || return 0
    sleep 0.5
  done
  kill -KILL -- "-$1" 2>/dev/null || true
}

# Starts a daemon that outlives the gate (dockerd, containerd) in its own session.
detach() {
  if command -v setsid >/dev/null 2>&1; then setsid "$@"; else "$@"; fi
}

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
  budget_arm "$(phase_key "$1")" "$1"
}

# A watchdog for the phase that starts: past its budget it names the phase and stops the gate. A
# bash with no TERM trap stops at once, mid-command, and still runs its EXIT trap (log_time).
budget_pid=""
budget_arm() {
  if [[ -n "$budget_pid" ]]; then
    pkill -P "$budget_pid" 2>/dev/null || true
    kill "$budget_pid" 2>/dev/null || true
    budget_pid=""
  fi
  local secs="${budgets[$1]:-0}" gate=$$ kids
  [[ "${FLOW_LOCAL_CI_BUDGET:-1}" != 0 ]] && (( secs > 0 )) || return 0
  (
    sleep "$secs"
    echo "budget $1" >"$stop_flag"
    echo "local-ci: the \"$2\" phase ran past its ${secs}s budget; stopping the gate (FLOW_LOCAL_CI_BUDGET=0 turns budgets off)." >&2
    # The gate's children but this watchdog, taken before the gate stops and they lose their parent.
    kids="$(pgrep -P "$gate" | grep -vx "$BASHPID" || true)"
    kill -TERM "$gate"
    [[ -z "$kids" ]] || kill -TERM $kids 2>/dev/null || true
  ) &
  budget_pid=$!
}

# On exit: ends the watchdog, and gives the code log_time records (a run a budget or a signal
# stopped reads as failed, not passed).
guard_exit_rc() {
  local rc="$1" why
  budget_arm none
  why="$(cat "$stop_flag" 2>/dev/null || true)"
  case "$why" in
    budget*) echo 124 ;;
    signal) echo 143 ;;
    *) echo "$rc" ;;
  esac
}
