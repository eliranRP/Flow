#!/usr/bin/env bash
# FLOW-826: the checks to run after removing code, in the order that keeps a pass meaning something.
# Usage: pnpm check:cleanup   (stops at the first failure; fix it and run it again from the top)
#
# 1-2. The dead-code scans first. A deletion can leave its helpers, imports and CSS unused, so a
#      fix sends you back here until both scans pass with nothing more to delete.
# 3-4. Lint (unused imports and locals a deletion leaves) and typecheck (a caller of what went).
# 5-6. Every unit and Storybook test, not only the related ones: a deleted file reaches tests the
#      module graph no longer shows.
# 7.   The hosted build, its bundle checks, and the load report against main (FLOW-826).
# 8.   The Storybook build with its layout, clip and secret specs. The pre-push gate leaves these to
#      main for CSS changes, so a removed rule that a layout needed would otherwise pass here and
#      turn main red. Every story opens on main, before each deploy.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n== check:cleanup %s\n' "$1"; }
step "1/8 unused app code";  node scripts/check-unused-app-code.mjs
step "2/8 unused CSS";       node scripts/check-unused-css.mjs
step "3/8 lint";             pnpm lint
step "4/8 typecheck";        pnpm typecheck
step "5/8 unit tests";       pnpm test:unit
step "6/8 Storybook tests";  pnpm test:storybook
step "7/8 build and load";   pnpm build && pnpm check:bundle && node scripts/load-report.mjs
step "8/8 layout and clip";  pnpm build-storybook && pnpm test:storybook:smoke --grep-invert "every static story"
printf '\ncheck:cleanup: passed. Push; the gate and main run the rest.\n'
