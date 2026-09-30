#!/usr/bin/env bash
# Read-only check that the production Pages hostname serves this commit.
set -euo pipefail

sha="${1:-}"
if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Smoke failed. Expected the commit SHA."
  exit 1
fi

origin="https://flow-app-dx5.pages.dev"
matched=0
for attempt in $(seq 1 18); do
  body="$(curl -fsS --proto '=https' --max-time 20 "${origin}/build.txt?n=${attempt}" || true)"
  body="$(printf '%s' "$body" | tr -d '[:space:]')"
  if [[ "$body" == "$sha" ]]; then
    matched=1
    break
  fi
  echo "Smoke: build.txt is not ${sha} yet (attempt ${attempt})."
  sleep 10
done

if [[ "$matched" != 1 ]]; then
  echo "Smoke failed. ${origin} did not serve build ${sha}."
  exit 1
fi

html="$(curl -fsS --proto '=https' --max-time 20 "${origin}/?n=smoke")"
if [[ "$html" != *"name=\"flow-build\" content=\"${sha}\""* ]]; then
  echo "Smoke failed. The homepage did not include build ${sha}."
  exit 1
fi

echo "Smoke passed. ${origin} is serving ${sha}."
