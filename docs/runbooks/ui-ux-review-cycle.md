# Mobile UI/UX review cycle

A recurring review of the running app on real phone sizes. The owner asked for it on 2026-10-08. It finds pixel-level design bugs and one-handed UX problems and turns them into backlog tasks. The cycle never builds fixes itself.

## Each cycle

1. Run the dev server (`pnpm dev`, with no empty `VITE_SUPABASE_*` variables). The `/e2e/*` fixture routes carry sample data. The `?preview=1` routes show the real shell with the tab bar.
2. Capture every main screen with Playwright at 375x667 (iPhone SE), 393x852 (iPhone 15) and 412x915 (Pixel 7), in Hebrew RTL. Capture light everywhere, dark at 393, and a full page at 393. Save each element's tap box, any clipped text and the page height with the shots. The capture script and the shots live in the project's shared folder under `reviews/ui-ux-cycle-<n>/`.
3. A design reviewer compares the shots with [DESIGN-RULES.md](../design/DESIGN-RULES.md), the mockups in `design/screens/` and the [design checklist](../review/CHECKLIST-design.md).
4. A UX auditor reviews for a one-handed phone user:
   - primary actions out of thumb reach
   - taps per core job
   - dense screens and long scrolls
   - hidden or unclear actions
   - small targets
   - dead-end states
5. Findings become tasks in [TASKS.md](../backlog/TASKS.md), each with a "Source: cycle N" note. Polish goes in as `SMALL UI`. A change to a feature or a flow goes in as `PLAN FIRST` and waits for the owner's approval on a card.
6. The report is published as an artifact. UI building goes through the two UI lanes ([design team](../design/DESIGN-TEAM.md)), at most 2 dev tasks in parallel.
7. The design lead reads the [design log](../design/log/README.md) entries since the last cycle and copies each `Rule:` line into DESIGN-RULES in the cycle's backlog PR.

## Fixtures

- The `/e2e/*` fixtures of screens that have the tab bar draw it, on their own tab (FLOW-334).
- `/flow/expense?preview=1` and `/flow/income?preview=1` (and the lines they open) show invented figures on the dev server. There is no `/flow/out`: an unknown side lands on Home.
- `/reviewer/transaction/1` opens the first sample row.

## Known fixture gaps

- `/e2e/expense` and `/e2e/project` are not real screens.
