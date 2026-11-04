<a id="flow-467"></a>
# FLOW-467 · A per-year metric says how many days it is scaled from
- **Type:** SMALL UI · **Status:** ready · **Source:** UX rules review 2026-11-04 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: High (a first rent a few days back shows a cap rate or cash-on-cash many times too high, marked only "מחושב לשנה"). From FLOW-464 (#950).
- **Files:** `app/src/screens/project-returns-info.ts` (`metricCaption`, `ANNUALIZED`), `project-returns-cards.tsx`.

- [ ] A scaled metric's row caption names the days: "מחושב לשנה · 21 ימים" (the metric page already does). Rule: feedback-and-states (say how sure a figure is); data-viz (no misleading figure).
- [ ] Whether to hide a scaled figure below a minimum of days is the owner's call (FLOW-473); this task does not change any figure.

**Acceptance:** the cap-rate-annualized story's row reads its day count at 320 without wrapping the figure.
