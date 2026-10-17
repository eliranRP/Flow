#!/usr/bin/env bash
# Builds the dev-fixture app the way app/playwright.config.ts's webServer does, then serves it for board-proof.
# The dev routes (/e2e/...) exist only in this build; a plain production build draws blank screens.
# Usage: bash scripts/board-proof-build.sh   (PORT defaults to 4173; FLOW_E2E_SUPABASE_URL / _ANON_KEY optional)
# PROOF_OUT sets the build directory; a worktree whose app/node_modules is a shared symlink needs its own.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
port="${PORT:-4173}"
out="${PROOF_OUT:-node_modules/.proof-dist}"
cd "$root/app"
NODE_ENV=development \
FLOW_E2E_BUILD=1 \
VITE_SUPABASE_URL="${FLOW_E2E_SUPABASE_URL:-http://127.0.0.1:54321}" \
VITE_SUPABASE_ANON_KEY="${FLOW_E2E_SUPABASE_ANON_KEY:-placeholder}" \
VITE_FLOW_MCP_URL="https://example.com/functions/v1/flow-mcp" \
pnpm exec vite build --mode development --outDir "$out" --emptyOutDir --logLevel error
exec node ../scripts/serve-dist.mjs "$out" "$port"
