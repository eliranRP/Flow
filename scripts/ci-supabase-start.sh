#!/usr/bin/env bash
# Starts local Supabase for CI and does not let a hung start use up the job.
#   usage: bash scripts/ci-supabase-start.sh [arguments for `supabase start`, e.g. -x studio,vector]
# A start still running after FLOW_SUPABASE_START_TIMEOUT seconds (default 180) is killed.
# `supabase stop --no-backup` clears what it left, and the start runs once more. When the second
# attempt fails too, the script prints `docker ps -a` and the start log, and exits 1.
# The log is FLOW_SUPABASE_START_LOG (default $RUNNER_TEMP/supabase-start.log). The script prints
# it when it finishes, so a backgrounded run reads it from that file.
set -uo pipefail

start_timeout="${FLOW_SUPABASE_START_TIMEOUT:-180}"
stop_timeout="${FLOW_SUPABASE_STOP_TIMEOUT:-30}"
log="${FLOW_SUPABASE_START_LOG:-${RUNNER_TEMP:-/tmp}/supabase-start.log}"
: > "$log"

start_once() {
  local attempt="$1"
  shift
  echo "ci-supabase-start: attempt $attempt, limit ${start_timeout}s" >> "$log"
  timeout --kill-after=10 "$start_timeout" supabase start "$@" >> "$log" 2>&1
}

for attempt in 1 2; do
  start_once "$attempt" "$@"
  code=$?
  if [ "$code" -eq 0 ]; then
    cat "$log"
    exit 0
  fi
  if [ "$code" -eq 124 ] || [ "$code" -eq 137 ]; then
    echo "ci-supabase-start: attempt $attempt timed out after ${start_timeout}s" >> "$log"
  else
    echo "ci-supabase-start: attempt $attempt exited with $code" >> "$log"
  fi
  if [ "$attempt" -eq 1 ]; then
    echo "ci-supabase-start: supabase stop --no-backup, then one more attempt" >> "$log"
    timeout --kill-after=5 "$stop_timeout" supabase stop --no-backup >> "$log" 2>&1 || true
  fi
done

{
  echo "ci-supabase-start: both attempts failed. docker ps -a:"
  docker ps -a 2>&1 || true
} >> "$log"
cat "$log"
exit 1
