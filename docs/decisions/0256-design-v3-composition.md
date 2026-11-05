# Design v3: five screen patterns composed from the v2 parts

**Date:** 2026-11-05
**Status:** Accepted (owner, 2026-11-05: the design on the canvas, area by area, and "plan and build new design v3")

## Context

After the v2 redesign ([0181](0181-redesign-foundation.md), option C "full Mercury", [0120](0120-income-green-type-scale.md)) every screen had the right parts but its own arrangement. Home carried a split card, a next-month card and a reports card; the project page, the loans list and the recurring list each had a compact bar of their own; group heads were hand-rolled in four places; the attention rows were one tinted card that could not be put away. The owner liked the look and asked to keep it, and to make the screens feel the same.

## Decision

**Composition changes, components stay.** v3 rearranges today's `app/src/ui` parts into five repeated patterns (the handoff, [docs/design/v3/HANDOFF.md](../design/v3/HANDOFF.md) §2): Overview (band, attention row-cards, a segmented control, groups with sticky heads), List, Detail, Sheet, Hub. Every screen names its pattern. Where a board's inline value differs from a component, the component wins; a missing part is added once to `app/src/ui` with a story.

**Five parts are added, all additive** ([BUILD-PLAN §3](../design/v3/BUILD-PLAN.md)): the compact bar can dock a control (the bar grows by 60px when the in-page segmented control reaches it, and the sticky offsets follow); the segmented control's selected pill slides; a group head can be one line with its summary; attention rows are 56px row-cards that can be hidden per device until what they count changes; and a status mark (dashed ring, check on tint, dot) says due, late, paid or one-off by shape.

**Home changes what it holds.** The split card, the next-month card and the reports card leave Home. The month's activity takes their place: a filter (הכול / קבועים / נותר לשלם) over three groups, נותר לשלם (due and late charges), קבועים ששולמו (arrived), חד-פעמי (the month's lines that belong to no recurring charge). For that, `cash_month_lines` says per row whether it belongs to a recurring charge ([FLOW-1035](../backlog/tasks/FLOW-1035.md)), using the schedule's own matching ([0185](0185-recurring-charge-per-project.md)). Next month lives in the month drawer; profit stays in דוחות.

**Two reports only** (the owner): profit and loss and the balance sheet, under `/reports/pnl` and `/reports/balance`, with a hub at `/reports`. By project and by month are views of them, and a project or month row drills down on the same screen. The balance sheet by project composes the existing per-project read.

**Dismissals are client-only.** A hidden attention row is kept in localStorage per device and per screen, keyed by the row and what it counts. No server write, no MCP tool.

**Built in waves** ([BUILD-PLAN §2](../design/v3/BUILD-PLAN.md)): the shared parts and the server flag first; then Home, Projects, Reports and Loans at the same time on disjoint files; then the investor pages and the lists and details under Home.

## Alternatives rejected

- **A v3 component kit.** New components drawn to the boards' inline values (a 64px band bar, a 4-second toast, 8-row stagger). Rejected: the owner asked to keep v2's look, and two sets of parts would drift apart; where a board and a component differ, the component wins and the board is corrected.
- **A server-side "hidden" flag for attention rows.** Rejected: a dismissal is a per-device, per-moment choice ("not now"), it must come back when the count changes, and a server write would need a tool, an undo and a migration for no shared value.
- **Keeping the split card, the next-month card and the reports card on Home** under the new list. Rejected by the owner on the canvas: Home leads with the month's activity; profit stays in דוחות and next month in the month drawer.
- **One screen per report view** (`/reports/by-project`, `/reports/by-month`). Rejected: the owner's rule is two reports; a view is a filter on one of them, and a drill-down stays on the same screen so the totals visibly add up to the row tapped.
- **Building every area in one PR per wave.** Rejected: one review round cannot cover four tabs; disjoint file sets per task let the lanes merge independently.

## Consequences

- DESIGN-RULES §2.8's inventory grows by the four parts and the dock offsets (0, 64 and 124 under Home's band bar; 44 or 104 under the 44px list bar of a List screen; 56 or 116 under the 56px detail bar). The design lead folds the lanes' `Rule:` lines in after each wave.
- Settings' sub-pages, setup, sign-in, help, legal, install, the split and journal composer, and the next-month edit keep v2 (handoff §8). `/profit` stays until Reports v3 covers it; its retirement is a follow-up.
- The project kind (renovation, rental, client, overhead) is read from the data a project already has; a stored kind, if the new-project sheet needs it, is a nullable column added by FLOW-1044 with its MCP arguments.
