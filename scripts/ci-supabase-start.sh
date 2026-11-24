#!/usr/bin/env bash
# Starts local Supabase for CI and does not let a hung start use up the job.
#   usage: bash scripts/ci-supabase-start.sh [arguments for `supabase start`, e.g. -x studio,vector]
# Healthy starts finish in 61 to 96 s. A start still running after FLOW_SUPABASE_START_TIMEOUT seconds
# (default 120) is killed, `supabase stop --no-backup` clears what it left, and the start runs again
# (at most FLOW_SUPABASE_START_ATTEMPTS, default 3, and only while the FLOW_SUPABASE_START_BUDGET of
# 330 s has room for another full attempt; the layers a killed pull finished are kept, so a retry resumes).
# Every call here, the diagnostics included, runs under a hard limit that also gives up on a process
# the kernel will not release (`timeout` alone waits for it for ever). When the last attempt fails the
# script prints the start log, `docker ps -a`, disk, memory and the supabase and docker processes, and
# exits 1.
# The log is FLOW_SUPABASE_START_LOG (default $RUNNER_TEMP/supabase-start.log). The script prints
# it when it finishes, so a backgrounded run reads it from that file (scripts/ci-supabase-wait.sh).
set -uo pipefail

start_timeout="${FLOW_SUPABASE_START_TIMEOUT:-120}"
stop_timeout="${FLOW_SUPABASE_STOP_TIMEOUT:-30}"
max_attempts="${FLOW_SUPABASE_START_ATTEMPTS:-3}"
budget="${FLOW_SUPABASE_START_BUDGET:-330}"
# How long past its limit a call may take to be killed before the script stops waiting for it.
grace="${FLOW_BOUNDED_GRACE:-10}"
kill_after="${FLOW_BOUNDED_KILL:-5}"
diag_timeout="${FLOW_SUPABASE_DIAG_TIMEOUT:-15}"
log="${FLOW_SUPABASE_START_LOG:-${RUNNER_TEMP:-/tmp}/supabase-start.log}"
: > "$log"

# bounded SECONDS COMMAND...: exit status of the command, 124 when it ran out of time. The command's
# output goes where the caller sent it. The command gets TERM at the limit and KILL `kill_after` seconds later; if it
# is still there `grace` seconds after that, it is abandoned.
bounded() {
  local limit="$1" code_file="" code="" ticks i pid
  shift
  code_file="$(mktemp "${TMPDIR:-/tmp}/ci-bounded.XXXXXX")"
  rm -f "$code_file"
  (
    timeout --kill-after="$kill_after" "$limit" "$@"
    echo "$?" > "$code_file.tmp"
    mv "$code_file.tmp" "$code_file"
  ) &
  pid=$!
  ticks=$(((limit + kill_after + grace) * 10))
  for ((i = 0; i < ticks; i++)); do
    if [ -f "$code_file" ]; then
      code="$(cat "$code_file")"
      rm -f "$code_file"
      wait "$pid" 2> /dev/null
      return "$code"
    fi
    sleep 0.1
  done
  kill -KILL "$pid" 2> /dev/null
  return 124
}

diagnostics() {
  {
    echo "ci-supabase-start: docker ps -a:"
    bounded "$diag_timeout" docker ps -a 2>&1
    echo "ci-supabase-start: disk and memory:"
    bounded "$diag_timeout" df -h / 2>&1
    bounded "$diag_timeout" free -m 2>&1
    echo "ci-supabase-start: supabase and docker processes:"
    # A file, not a pipe: a ps that had to be abandoned must not hold the pipe open.
    ps_out="$(mktemp "${TMPDIR:-/tmp}/ci-ps.XXXXXX")"
    bounded "$diag_timeout" ps -eo pid,etime,stat,args > "$ps_out" 2>&1
    grep -E 'supabase|docker|containerd|pull' "$ps_out" | grep -v grep
    rm -f "$ps_out"
  } >> "$log" 2>&1
  return 0
}

began=$SECONDS
for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  limit="$start_timeout"
  echo "ci-supabase-start: attempt $attempt, limit ${limit}s" >> "$log"
  bounded "$limit" supabase start "$@" >> "$log" 2>&1
  code=$?
  if [ "$code" -eq 0 ]; then
    cat "$log"
    exit 0
  fi
  if [ "$code" -eq 124 ] || [ "$code" -eq 137 ]; then
    echo "ci-supabase-start: attempt $attempt timed out after ${limit}s" >> "$log"
  else
    echo "ci-supabase-start: attempt $attempt exited with $code" >> "$log"
  fi
  # Another attempt needs its stop, its limit and the time to kill it.
  remaining=$((budget - (SECONDS - began) - stop_timeout - kill_after - grace))
  if [ "$attempt" -ge "$max_attempts" ] || [ "$remaining" -lt $((start_timeout / 2)) ]; then
    break
  fi
  echo "ci-supabase-start: supabase stop --no-backup, then one more attempt" >> "$log"
  bounded "$stop_timeout" supabase stop --no-backup >> "$log" 2>&1 || true
  # The next attempt gets what is left of the budget, so the retries never outrun it.
  remaining=$((budget - (SECONDS - began) - kill_after - grace))
  if [ "$remaining" -lt "$start_timeout" ]; then start_timeout="$remaining"; fi
done

echo "ci-supabase-start: gave up after $((SECONDS - began))s." >> "$log"
diagnostics
cat "$log"
exit 1
