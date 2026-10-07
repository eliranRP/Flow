#!/usr/bin/env bash
# Read-only check that the production Pages hostname serves this commit.
set -euo pipefail

sha="${1:-}"
if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Smoke failed. Expected the commit SHA."
  exit 1
fi

origin="https://flow-app-dx5.pages.dev"
root="$(cd "$(dirname "$0")/.." && pwd)"
bust="n=${sha}"
# build.txt and the homepage share this pause. Tests set SMOKE_RETRY_PAUSE=0.
pause="${SMOKE_RETRY_PAUSE:-10}"
if ! [[ "$pause" =~ ^[0-9]+$ ]]; then
  pause=10
fi
attempts=18

home_body="$(mktemp)"
home_headers="$(mktemp)"
settings_body="$(mktemp)"
settings_headers="$(mktemp)"
asset_body="$(mktemp)"
asset_headers="$(mktemp)"
trap 'rm -f "$home_body" "$home_headers" "$settings_body" "$settings_headers" "$asset_body" "$asset_headers"' EXIT

# Sets FETCH_CODE. A curl failure exits 1 and names the URL and the curl error.
fetch() {
  local url="$1"
  local body="$2"
  local headers="$3"
  local err
  err="$(mktemp)"
  if ! FETCH_CODE="$(curl -sS -D "$headers" -o "$body" -w '%{http_code}' --proto '=https' --max-time 20 "$url" 2>"$err")"; then
    echo "Smoke failed. Could not fetch ${url}: $(tr '\n' ' ' <"$err")"
    rm -f "$err"
    exit 1
  fi
  rm -f "$err"
}

matched=0
for attempt in $(seq 1 "$attempts"); do
  err="$(mktemp)"
  if ! body="$(curl -fsS --proto '=https' --max-time 20 "${origin}/build.txt?${bust}-${attempt}" 2>"$err")"; then
    echo "Smoke failed. Could not fetch build.txt (attempt ${attempt}): $(tr '\n' ' ' <"$err")"
    body=""
  fi
  rm -f "$err"
  # Last line only. A tag on an earlier line must not be glued onto the hash.
  if printf '%s' "$body" | node "$root/scripts/cd-output.mjs" equals "$sha" 2>/dev/null; then
    matched=1
    break
  fi
  echo "Smoke: build.txt is not ${sha} yet (attempt ${attempt})."
  sleep "$pause"
done

if [[ "$matched" != 1 ]]; then
  echo "Smoke failed. ${origin} did not serve build ${sha}."
  exit 1
fi

# Does not exit. A curl failure sets FETCH_OK=0 so the homepage loop can retry.
try_fetch() {
  local url="$1"
  local body="$2"
  local headers="$3"
  local err
  err="$(mktemp)"
  FETCH_OK=0
  FETCH_CODE=""
  if FETCH_CODE="$(curl -sS -D "$headers" -o "$body" -w '%{http_code}' --proto '=https' --max-time 20 "$url" 2>"$err")"; then
    FETCH_OK=1
  else
    echo "Smoke failed. Could not fetch ${url}: $(tr '\n' ' ' <"$err")"
  fi
  rm -f "$err"
}

home_matched=0
for attempt in $(seq 1 "$attempts"); do
  try_fetch "${origin}/?${bust}-${attempt}" "$home_body" "$home_headers"
  if [[ "$FETCH_OK" == 1 && "$FETCH_CODE" == "200" ]] && grep -Fq "name=\"flow-build\" content=\"${sha}\"" "$home_body"; then
    home_matched=1
    break
  fi
  echo "Smoke: homepage is not ${sha} yet (attempt ${attempt})."
  sleep "$pause"
done

if [[ "$home_matched" != 1 ]]; then
  echo "Smoke failed. The homepage did not include build ${sha}."
  exit 1
fi

# The deep-link fallback can lag the homepage at the edge, so the stamp check retries.
settings_matched=0
for attempt in $(seq 1 "$attempts"); do
  fetch "${origin}/settings?preview=1&${bust}-${attempt}" "$settings_body" "$settings_headers"
  settings_code="$FETCH_CODE"
  if [[ "$settings_code" != "200" ]] || ! grep -Eiq '^content-type:[[:space:]]*text/html' "$settings_headers"; then
    echo "Smoke failed. /settings returned ${settings_code}, not 200 HTML."
    exit 2
  fi
  if grep -Fq "name=\"flow-build\" content=\"${sha}\"" "$settings_body"; then
    settings_matched=1
    break
  fi
  echo "Smoke: /settings is not ${sha} yet (attempt ${attempt})."
  sleep "$pause"
done

if [[ "$settings_matched" != 1 ]]; then
  echo "Smoke failed. /settings did not include build ${sha}."
  exit 1
fi

fetch "${origin}/assets/no-such-file.js?${bust}" "$asset_body" "$asset_headers"
asset_code="$FETCH_CODE"
if [[ "$asset_code" != "404" ]]; then
  echo "Smoke failed. A missing asset returned ${asset_code}, not 404."
  exit 3
fi

echo "Smoke passed. ${origin} is serving ${sha}."
