<a id="flow-473"></a>
# FLOW-473 · Owner's calls on the returns: a minimum before a per-year figure; which loans show "סכום ששולם בסגירה"
- **Type:** SMALL UI · **Status:** in-progress (#969) · **Source:** UX rules review 2026-11-04 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: High (1) / Medium (2). These change FLOW-464 and FLOW-466 decisions.

- **Owner's pick (2026-11-04):** "Show 60 days as מעט נתונים; closing row only for Sub2". (1) Below 60 days since a first rent inside the period, the per-year figures read "מעט נתונים" with the day count, not a figure scaled from a few days. (2) "סכום ששולם בסגירה" shows only on a loan paid out at closing (Sub2 / taken over).

- [x] 1. A first rent a few days back scales cash-on-cash, cap rate and per-unit by 365/days with no minimum. Options: show "מעט נתונים" below about 60 days; show the unscaled figure; keep as is with the day count (FLOW-467). Rule: data-viz (no misleading figure).
- [x] 2. "סכום ששולם בסגירה · כל ההלוואה" shows on every project loan. Options: only on a loan paid out at closing (taken over / Sub2); keep on all. Rule: hierarchy-and-actions § 1.

**Acceptance:** the owner's picks are written here before any build.

**Built (decision [0253](../../decisions/0253-sixty-days-before-a-year.md)):** (1) `MIN_EARNING_DAYS` = 60; cash on cash (its loss a year too), cap rate, per unit and the total return's per-cent read "מעט נתונים" with "מהשכירות הראשונה · N ימים · מחושב לשנה מ־60 ימים"; ∞, DSCR and the amounts keep their figures; MCP `get_property_returns` adds `few_earning_days`, no SQL change. (2) The closing row shows on a loan its project's returns name in `taken_over_loans`, or on any project loan with an amount stored (so it can be cleared).
