<a id="flow-364"></a>
# FLOW-364 · Redesign: Home, the month drawer, a past month, and the 4-tab bar
- **Type:** UI (design approved) · **Status:** in progress · **Depends on:** [FLOW-363](FLOW-363.md) · **Related:** [FLOW-139](FLOW-139.md) and [FLOW-447](FLOW-447.md) (the new tabs' screens), [FLOW-141](FLOW-141.md) (the forecast line opens it) · **Source:** the owner's approved redesign, handed off 2026-10-11. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", section "Home" (boards: Home prototype, scrolled with the compact bar, month drawer, past month); rules on "Design guide", motion on "Flow & motion".
- **Files:** `app/src/screens/HomeScreen.tsx`, `app/src/screens/attention-rows.tsx`, `app/src/screens/home-skeleton.tsx`, `app/src/ui/top-band.tsx`, `app/src/ui/band-company.tsx`, `app/src/ui/period-picker.tsx`, `app/src/ui/month-grid.tsx`, `app/src/ui/month-stepper.tsx`, `app/src/ui/change-pill.tsx`, `app/src/ui/tab-bar.tsx`, `app/src/add-trigger.ts`, `app/src/App.tsx` (tab routes), `app/src/ui/css/07-band-home.css`, `app/src/ui/css/08-tabbar-empty.css`, `app/src/ui/css/18-period-bar.css`, `app/src/ui/css/28-forecast.css`, their stories and tests.

**Progress:** server PR #618 merged (62751657). UI branch `claude/project-thread-flow364`: the band, figures, split card, attention box, drawer, compact bar, tab bar, skeleton and e2e are built; the e2e set for Home and the tabs passes on an isolated port. The board visual proof is open: the board PNGs were not in `/mnt/project-files/design/board-png`. Design choices: `docs/design/log/2026-10-16-flow-364.md`.

**Navigation**
- [x] 4 tabs: בית · פרויקטים · הלוואות · קבועים, no centre +. The review queue opens from Home's דורש טיפול, add (+) and search sit in Home's band, Settings behind the avatar. Until FLOW-139 and FLOW-447 land, הלוואות and קבועים open today's loan list and missing-bills screens; old paths (`/review`, `/settings/loans`, `/missing-bills`) keep working.

**Band (current month)**
- [ ] Company switcher ("<business> ▾") on the start side; +, search and the avatar (Settings) on the other side.
- [ ] Month pill: ‹ prev · "<month year> ▾" · next ›; the name opens the month drawer; next is disabled on the current month.
- [ ] Label "תזרים · עד היום"; the big figure is the month's net cash (in − out), 52/500, a minus but never red inside the band.
- [ ] נכנס and יצא rows, each with a change pill ▲/▼ + amount: grey when the change helps (more in, less out), red when it hurts. The current month compares to the previous month up to the same day; no pill for the first month with data.
- [ ] Forecast line "צפי לסוף <month>" = net so far + recurring income still due − recurring expense still due + open invoices, labelled הערכה, hidden when there is nothing to project; it opens FLOW-141. (The server sends a recurring expense as a negative figure; the app takes its absolute value before the sum.)
- [ ] Split card "ממה מורכב המינוס" (or "ממה מורכב התזרים" when positive): a bar and two rows, לא נספר ברווח (accent) and רווח החודש (green or red), with one explanation line. רווח החודש opens FLOW-140.
- [ ] דורש טיפול box (tint #2A2045, current month only): review queue count, open invoices with their amount, bills that didn't arrive, recurring charges that changed 20% or more. Each row opens its screen; the box is hidden when empty.

**Past month**
- [ ] The band turns #5A2DB0; "חזרה ל<current month>" replaces the band's icons; label "תזרים · חודש סגור"; pills compare full month to full month; no forecast line and no דורש טיפול. Swipe and arrows keep working across months.

**Month drawer**
- [ ] Bottom sheet over a dimmed screen (sheet motion). Close by ×, a tap outside, or picking a month. Year row ‹ 2026 › (disabled where there is no data). A 3×4 grid, one cell per month: name and net cash (a loss in red with U+2212). Selected: tinted cell with a 2px accent border. Future months: dashed, disabled, "עוד לא". Link "לכל החודשים ברשימה" to today's month list.

**Scroll**
- [ ] The band's figures fade as the page scrolls (opacity follows scroll from 60px to 220px). Past 220px the compact bar slides down (240ms): ‹ · "<month> ▾" with the net figure · ›; its arrows change month and its name opens the drawer. Back at the top it hides. Changing month from the drawer scrolls to the top; the arrows keep the scroll position.
- [ ] Loading and empty: use the shared skeleton, empty state, inline spinner and sync strip of [FLOW-371](FLOW-371.md).
- **MCP:** reads only; the figures come from the existing cash reads (`get_cash_months`, `get_recurring_changes`, `list_unpaid`, `get_missing_bills`, `list_review`). If the change pill's "same day last month" comparison needs a new field, add it to `get_cash_months` and TOOLS.md.
- [ ] From the FLOW-363 (2c) pixel review: with two currencies the band figure steps down to 40/400 (`hero.tsx`, `size={multi ? "display" : "hero"}`), and a long figure at 320 steps down too. Decide against the board (52/500) whether the band keeps 52 and wraps, or steps down; record it in the design log.
- **Acceptance:** stories of Home current month, scrolled (compact bar), drawer open, past month, and an empty דורש טיפול, at 320 and 393, invented figures only; a unit test that the pill colour follows "helps or hurts" for both directions; a unit test of the forecast line's sum and that it hides at zero; a test that the drawer disables future months and the next arrow on the current month; an e2e that the 4 tabs open their screens and the old paths still land; reduced motion shows the compact bar without sliding; design review against the boards.
