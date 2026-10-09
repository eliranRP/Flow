#!/usr/bin/env bash
# Fills the local edge runtime's Deno cache from the host, so flow-mcp answers on a fresh machine.
# In a cloud container the runtime's own container has no route to npm (it can't use the agent
# proxy), so it answers 503 "Failed loading https://registry.npmjs.org/..." until its packages are
# cached. The host's deno can reach npm. Best effort: a laptop with network needs none of this.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

volume="supabase_edge_runtime_flow"
container="supabase_edge_runtime_flow"

if ! command -v deno >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "seed-edge-cache: no deno or no Docker, nothing to seed."
  exit 0
fi
if ! docker volume inspect "$volume" >/dev/null 2>&1; then
  echo "seed-edge-cache: no edge runtime volume yet; local-ci seeds it after supabase start."
  exit 0
fi

# --no-lock: caching must not rewrite the functions' deno.lock files (local-ci refuses a dirty tree).
for config in supabase/functions/*/deno.json; do
  dir="$(dirname "$config")"
  [[ -f "$dir/index.ts" ]] || continue
  deno cache --quiet --no-lock --config "$config" "$dir/index.ts" \
    || echo "seed-edge-cache: could not cache $dir; its function may answer 503 locally." >&2
done

deno_dir="$(deno info --json | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{process.stdout.write(JSON.parse(s).denoDir)})')" \
  || { echo "seed-edge-cache: could not find deno's cache folder." >&2; exit 0; }
mount="$(docker volume inspect -f '{{.Mountpoint}}' "$volume")" \
  || { echo "seed-edge-cache: the edge runtime volume went away." >&2; exit 0; }
as_root=()
[[ "$(id -u)" == 0 ]] || as_root=(sudo -n)
for part in npm remote; do
  [[ -d "$deno_dir/$part" ]] || continue
  ${as_root[@]+"${as_root[@]}"} cp -a "$deno_dir/$part" "$mount/" \
    || { echo "seed-edge-cache: could not write $mount (needs root)." >&2; exit 0; }
done

# A container restart leaves the runtime stopped while the database is up, so a db reset alone
# never brings it back.
if [[ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null || true)" == false ]]; then
  docker start "$container" >/dev/null || echo "seed-edge-cache: could not start $container." >&2
fi
echo "seed-edge-cache: edge runtime cache seeded from $deno_dir."
