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
for attempt in $(seq 1 18); do
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
  sleep 10
done

if [[ "$matched" != 1 ]]; then
  echo "Smoke failed. ${origin} did not serve build ${sha}."
  exit 1
fi

fetch "${origin}/?${bust}" "$home_body" "$home_headers"
home_code="$FETCH_CODE"
if [[ "$home_code" != "200" ]] || ! grep -Fq "name=\"flow-build\" content=\"${sha}\"" "$home_body"; then
  echo "Smoke failed. The homepage did not include build ${sha}."
  exit 1
fi

fetch "${origin}/settings?preview=1&${bust}" "$settings_body" "$settings_headers"
settings_code="$FETCH_CODE"
if [[ "$settings_code" != "200" ]] || ! grep -Eiq '^content-type:[[:space:]]*text/html' "$settings_headers"; then
  echo "Smoke failed. /settings returned ${settings_code}, not 200 HTML."
  exit 2
fi
if ! grep -Fq "name=\"flow-build\" content=\"${sha}\"" "$settings_body"; then
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
