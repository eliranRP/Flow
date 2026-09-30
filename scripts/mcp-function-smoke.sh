#!/usr/bin/env bash
# Cycle 1 smoke against the local flow-mcp function. No production secret.
set -euo pipefail

status="$(supabase status -o env)"
api_url="$(printf '%s\n' "$status" | sed -n 's/^API_URL=//p' | head -n 1 | tr -d '"')"
case "$api_url" in
  http://127.0.0.1:*|http://localhost:*) ;;
  *)
    echo "Refusing to call flow-mcp on a non-local API." >&2
    exit 1
    ;;
esac

base="${api_url}/functions/v1/flow-mcp"
body="$(mktemp)"
headers="$(mktemp)"
trap 'rm -f "$body" "$headers"' EXIT

code="$(curl -sS -D "$headers" -o "$body" -w '%{http_code}' -X GET "$base")"
test "$code" = "405"
grep -qi '^allow: POST' "$headers"
grep -qi '^x-flow-cf-connecting-ip: absent' "$headers"

code="$(curl -sS -o "$body" -w '%{http_code}' -X POST "$base" \
  -H 'Origin: https://evil.example' \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}')"
test "$code" = "403"

code="$(curl -sS -D "$headers" -o "$body" -w '%{http_code}' -X POST "$base" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}')"
test "$code" = "401"
grep -qi '^x-flow-cf-connecting-ip: absent' "$headers"

code="$(curl -sS -o "$body" -w '%{http_code}' -X POST "${base}/mint" \
  -H 'Origin: https://evil.example' \
  -H 'content-type: application/json' \
  -d '{"scope":"read"}')"
test "$code" = "403"

echo "flow-mcp local smoke passed."
