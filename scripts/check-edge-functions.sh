#!/usr/bin/env bash
# Type-checks every edge function with its own deno.json, the import map it deploys with.
# A bare `deno check` without --config cannot resolve the functions' bare imports (FLOW-205).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
checked=0
for config in "$root"/supabase/functions/*/deno.json; do
  dir="$(dirname "$config")"
  [[ -f "$dir/index.ts" ]] || continue
  deno check --quiet --config "$config" "$dir/index.ts"
  checked=$((checked + 1))
done
echo "deno check passed for ${checked} edge functions."
