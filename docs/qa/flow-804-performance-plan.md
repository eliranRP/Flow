# FLOW-804 · Performance pass: plan

Plan only. Nothing is built until the owner picks an option. Target, from [0034](../decisions/0034-cost-and-load-limits.md): Home is usable within 2 seconds on a mid-range phone on 4G.

## Where we are today (main at 59f15ad, measured 2026-10-09)

**Size.** The production build is one JavaScript file for the whole app. The only lazy chunk is the reviewer sample (6 KB). Every screen ships on the first load, so Home pays for Review, Settings, the split editor and the rest.

| File | Raw | gzip |
| --- | --- | --- |
| `index-*.js` (the whole app) | 1,346 KB | 397 KB |
| `index-*.css` | 138 KB | 24 KB |
| Rubik Hebrew fonts (4 weights, woff2) | loaded as used | |

What is inside the JavaScript file, from the source map:

| Part | Size | Share |
| --- | --- | --- |
| App screens (`src/screens`) | 281 KB | 22% |
| react-dom | 206 KB | 16% |
| Shared UI (`src/ui`) | 171 KB | 13% |
| zod (schemas) | 140 KB | 11% |
| Supabase client (auth, realtime, storage, postgrest) | 220 KB | 17% |
| react-router, React Query, vaul, Radix | 110 KB | 9% |
| Everything else | 160 KB | 12% |

**Existing guards.** None of them is about speed:
- #285 (FLOW-807) caps source files at 800 lines (tests at 1,200). It covers file length, not the size of what users download.
- `check-prod-bundle.mjs` and `check-jev-bundle.mjs` check that no secrets or real data end up in a build. They don't check its size.
- Vite prints a warning for chunks over 500 KB, and nobody acts on it.

**Load time.** The production build was served gzipped on this machine, with Chromium at 390×844, the service worker off, and the median of 5 runs. "Ready" means the Home screen and its tab bar are on screen. The page is `/?preview=1`, which is Home without sign-in and without the dashboard read. A real Home also waits for the session and one dashboard call, so a real open takes a bit longer than these numbers.

| Profile | Home ready | First paint | Main thread blocked |
| --- | --- | --- | --- |
| Desktop, no throttle | 0.41 s | 0.38 s | 75 ms |
| Mid-range phone on 4G (CPU ×4, 9 Mbps, 85 ms) | **2.06 s** | 1.76 s | 870 ms |
| Lighthouse mobile (CPU ×4, 1.6 Mbps, 150 ms) | 3.80 s | 3.54 s | 810 ms |

Home already misses the 2-second target on the 0034 profile before it reads any data. The cause is the single file: about 1.3 MB of JavaScript has to download, parse and run before anything shows.

**Phone tests.** Most e2e specs already set a phone-sized viewport (390 or 320 wide), and five use touch. None of them throttles the CPU or the network, and none walks a whole flow from start to finish on a phone profile.

## What to gate

1. **A size budget in CI.** A script reads the built `dist` and fails when a limit is passed. It runs in local CI and in the CI `check` job, like the file-size check. There are two limits:
   - **Home entry**: the gzip size of the JavaScript and CSS that `index.html` loads before Home shows.
   - **Total**: the gzip size of all JavaScript.
   - Budgets live in one file (`scripts/bundle-budget.json`), so raising one is a reviewed diff with a reason.
2. **A Home speed test.** A Playwright spec runs on the production build with the mid-range 4G profile above. It fails when Home is not ready within 2 s, taking the median of 3 runs with a 10% margin for noisy runners. It runs on main's CI and in the full local gate, not on every push, because it needs a build.
3. **Phone flow tests.** A Playwright "phone" project uses a touch phone profile at 390 and 320, with CPU ×4. It covers the five flows the owner uses most, in Hebrew:
   1. Home, then a project page, then back.
   2. Review: אישור, then ביטול on the toast.
   3. Review: שינוי, then pick a category, then save.
   4. Search for a supplier and open the line.
   5. Split a line between two projects.

   Each flow also fails if one step takes over 1 s after its tap. The tests run on the dev fixtures (`/e2e/...`), so they need no hosted data.

## Getting under the budget first

A gate set at today's size would only stop things getting worse. To meet 0034, Home has to load less first:
- Load each screen other than Home with `lazy()` (Review, Settings, Search, Transactions, Projects, the split editor, setup). Home and the tab bar stay in the entry, and a tap preloads the next screen.
- Keep zod out of the Home path. Parse the dashboard with the light shapes Home needs, and leave the full schemas to the screens that use them.
- Load the Supabase realtime and storage parts only where they are used. They are not needed on Home.
- Estimated result: a Home entry of about 180–220 KB gzip, down from 421 KB. That puts Home at about 1.2–1.4 s on the mid-range profile, which leaves room for the dashboard call. This estimate is from the source map shares above, not a measured build.

## Options for the owner

- **A, recommended: split first, then gate.** Do the code split above, then turn on all three gates with budgets set just over the new sizes: Home entry 230 KB gzip, total 450 KB, Home ready at most 2 s on the mid-range profile. Home then meets 0034, and the gates keep it there. This is about two PRs (split, then gates) with no visual change.
- **B: gate today's size only.** Add the size budget at today's numbers plus 5%, and report the Home timing without failing on it. No code split. Things can't get worse, but Home stays at about 2 s or more on a mid-range phone.
- **C: A, plus Lighthouse CI and real-user timings.** On top of A, run Lighthouse on main and have the app send its own load time from real phones to the database (a small table, owner-only, no amounts). This shows real phones on real networks. It adds a table, a privacy note and some running cost that 0034 caps, so it needs its own decision.

The phone flow tests are the same in all three options.
