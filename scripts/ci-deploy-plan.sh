#!/usr/bin/env bash
# Decides whether this main run tests and deploys. Pull requests are checked locally before the push
# (scripts/local-ci.sh), so main runs the full suite and the deploy in batches: once FLOW_DEPLOY_BATCH
# merges (default 5) have landed since the last successful production deploy, or on a manual run.
# Writes run=true or run=false to $GITHUB_OUTPUT.
set -euo pipefail

batch="${FLOW_DEPLOY_BATCH:-5}"
out="${GITHUB_OUTPUT:-/dev/stdout}"
gh_cmd="${FLOW_GH:-gh}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"

decide() {
  echo "run=$1" >> "$out"
  echo "$2"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    echo "$2" >> "$GITHUB_STEP_SUMMARY"
  fi
  exit 0
}

if [[ "${GITHUB_EVENT_NAME:-}" == "workflow_dispatch" ]]; then
  decide true "Manual run: the full suite runs, then the deploy."
fi

# The newest production deployment whose latest status is success.
last=""
while IFS=$'\t' read -r id sha; do
  [[ -n "$id" ]] || continue
  state="$("$gh_cmd" api "repos/${repo}/deployments/${id}/statuses?per_page=1" --jq '.[0].state // ""')"
  if [[ "$state" == "success" ]]; then
    last="$sha"
    break
  fi
done < <("$gh_cmd" api "repos/${repo}/deployments?environment=production&per_page=30" --jq '.[] | [(.id | tostring), .sha] | @tsv')

if [[ -z "$last" ]] || ! git cat-file -e "${last}^{commit}" 2>/dev/null; then
  decide true "No successful production deploy found in this history: the full suite runs, then the deploy."
fi

count="$(git rev-list --count --first-parent "${last}..HEAD")"
if (( count >= batch )); then
  decide true "${count} merges since the last deploy (${last:0:7}): the full suite runs, then the deploy."
fi
decide false "${count} of ${batch} merges since the last deploy (${last:0:7}). No CI or deploy this time. Run the ci workflow by hand to deploy now."
