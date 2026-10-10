#!/usr/bin/env node
// The scripts the app's checks read, so the pre-push gate counts them as app inputs: the ones
// app/vite.config.ts, the Playwright configs and the e2e specs import or run, the bundle checks
// and build stamp the gate's build part runs, and the scripts that decide which app tests,
// stories and specs run. A change to any other script (its own tests included) runs the scripts
// suite, lint and typecheck, not the app's unit tests, Storybook and builds.
// scripts/app-scripts.test.mjs fails when the app reaches a script this list leaves out.
// Usage: node scripts/app-scripts.mjs   (prints the repo-relative paths, one per line)
import { fileURLToPath } from "node:url";

export const appScripts = [
  // app/vite.config.ts imports these, and the gate's build part runs them after vite build.
  "scripts/check-prod-bundle.mjs",
  "scripts/check-jev-bundle.mjs",
  "scripts/check-bundle-budget.mjs",
  "scripts/hosted-env.mjs",
  "scripts/stamp-build.mjs",
  // The e2e specs and the perf config.
  "scripts/clip-check.mjs",
  "scripts/serve-dist.mjs",
  // What runs: the related tests and stories, the e2e specs, the build skip and the sweep.
  "scripts/app-scripts.mjs",
  "scripts/e2e-specs.mjs",
  "scripts/gate-scope.mjs",
  "scripts/storybook-stories.mjs",
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const file of appScripts) console.log(file);
}
