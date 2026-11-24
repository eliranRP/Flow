#!/usr/bin/env bash
# Waits for the background `ci-supabase-start.sh` of this job and fails when it failed.
#   usage: bash scripts/ci-supabase-wait.sh
# The start script writes $RUNNER_TEMP/supabase-start.exit (its exit status) when it ends and keeps its
# output in $RUNNER_TEMP/supabase-start.log as it goes. This script gives up after FLOW_SUPABASE_WAIT
# seconds (default 420, below the step's 8 minutes, so the step never ends silently). Then it prints the
# log so far, `docker ps -a` and the supabase and docker processes, so a stalled start shows what it was doing.
set -uo pipefail

dir="${RUNNER_TEMP:-/tmp}"
exit_file="${FLOW_SUPABASE_START_EXIT:-$dir/supabase-start.exit}"
log="${FLOW_SUPABASE_START_LOG:-$dir/supabase-start.log}"
limit="${FLOW_SUPABASE_WAIT:-420}"

while [ ! -f "$exit_file" ]; do
  if [ "$SECONDS" -ge "$limit" ]; then
    echo "supabase start did not finish within ${limit}s. Its log so far:"
    cat "$log" 2> /dev/null || echo "(no log)"
    echo "docker ps -a:"
    timeout --kill-after=5 15 docker ps -a 2>&1 || echo "(docker ps did not answer)"
    echo "supabase and docker processes:"
    ps -eo pid,etime,stat,args 2>&1 | grep -E 'supabase|docker|containerd|pull' | grep -v grep
    exit 1
  fi
  sleep 2
done

cat "$log"
test "$(cat "$exit_file")" = 0
