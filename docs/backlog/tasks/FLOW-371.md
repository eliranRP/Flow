<a id="flow-371"></a>
# FLOW-371 · Redesign: skeletons, empty states and loaders
- **Type:** PLAN FIRST · **Status:** plan-first (design drawn, pending the owner's approval; build only once the approval is written here) · **Depends on:** [FLOW-363](FLOW-363.md) · **Related:** every redesign screen task uses these parts: [FLOW-364](FLOW-364.md), [FLOW-365](FLOW-365.md), [FLOW-366](FLOW-366.md), [FLOW-367](FLOW-367.md), [FLOW-445](FLOW-445.md), [FLOW-446](FLOW-446.md), [FLOW-139](FLOW-139.md), [FLOW-447](FLOW-447.md), [FLOW-140](FLOW-140.md), [FLOW-141](FLOW-141.md), [FLOW-512](FLOW-512.md), [FLOW-368](FLOW-368.md), [FLOW-369](FLOW-369.md), [FLOW-370](FLOW-370.md), [FLOW-513](FLOW-513.md), [FLOW-514](FLOW-514.md) · **Source:** the redesign handoff, 2026-10-11. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "In design · for approval", boards "Loading skeletons", "Empty states" and "Loaders in context"; rules on "Design guide", motion on "Flow & motion".
- **Approval:** waiting. When the owner approves, write "approved by the owner, <date>" here and set the status to `ready`. Until then screen tasks keep today's skeleton and empty parts and don't invent new ones.
- **Files:** `app/src/ui/skeleton.tsx`, `app/src/ui/empty-state.tsx`, `app/src/ui/error-state.tsx`, `app/src/ui/screen-state.tsx`, `app/src/ui/screen-phase.ts`, `app/src/ui/progress-bar.tsx`, `app/src/ui/button.tsx` (busy state), `app/src/screens/home-skeleton.tsx`, `app/src/screen-suspense.tsx`, a sync strip component under `app/src/ui/`, `app/src/ui/css/08-tabbar-empty.css` (empty blocks only), `app/src/ui/index.ts`, their stories and tests.

**Skeleton (first load)**
- [ ] The real header, title and bottom bar, plus blocks shaped like the rows and cards to come: #251F33 on the background, rgba(255,255,255,.16) on the band. The blocks pulse together (opacity 1 → .55, 1.2s).
- [ ] Shown only after 300ms of waiting; then a 200ms crossfade to the content, followed by the page-enter motion (FLOW-363).
- [ ] Designed: Home, month lines, Projects, Loans, קבועים, Profit, transaction page. Every other screen reuses the closest one.

**Empty state**
- [ ] A 64px tint circle with an outline icon (#B894FF), title 24/600, one or two lines at 15/400 #B1A8C4, and at most one action: a primary pill when it is the next step, an outline pill when it only helps, none when the user just waits. The screen keeps its header, title and totals ($0 muted).
- [ ] Designed: Home without a bank (card "חברו את הבנק" and manual add; this replaces the sample-data idea in FLOW-514's skip-all), month lines for a project with nothing this month, Projects none, Loans none, קבועים still learning (2 months of history needed), Profit for a new project, Forecast all arrived, Team only you. Already drawn elsewhere and moved onto this part: הכל מאושר (FLOW-365), הכל שולם (FLOW-367), search nothing found (FLOW-368), a new project's empty page (FLOW-445).

**Loaders (four kinds)**
- [ ] Skeleton, as above.
- [ ] Inline spinner (16 to 18px ring, 800ms a turn) inside the button or field of an action the user started; the button keeps its size, shows the action's label (שומר…, מתחבר…), and is disabled with `aria-busy`.
- [ ] Sync strip for a background refresh: a 3px indeterminate line at the top and, after 200ms, a pill "מסנכרן עם Mercury…". The content stays usable.
- [ ] Progress for long known jobs (first sync, import): an 8px bar, a count ("N מתוך כ־M תנועות"), the step list, and always a way to leave.

**Rules**
- [ ] No full-screen spinner; nothing shows under 300ms; a failure shows one line with "נסו שוב"; under reduced motion the animations stop but the text still says what is loading.
- [ ] Remove the loading and empty parts these replace, with their stories and CSS.
- **MCP:** none (display only).
- **Acceptance:** stories of each designed skeleton, empty state and loader kind at 320 and 393, dark and light, with invented data; a test that nothing renders before 300ms and the skeleton crossfades after; a test that a busy button keeps its width and sets `aria-busy`; a test that reduced motion stops the pulse and the strip but keeps the text; design review against the approved boards.
