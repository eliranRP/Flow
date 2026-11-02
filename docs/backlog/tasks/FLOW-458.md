<a id="flow-458"></a>
# FLOW-458 · Total return: marked partial when a source is missing, rows that hold at 320, bar shades that can be told apart
- **Type:** SMALL UI · **Status:** in-progress (#TBD) · **Source:** UX rules review 2026-11-01 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-450.
- **Files:** `app/src/screens/project-returns-cards.tsx` (`TotalReturnCard`), `app/src/ui/css/26-returns.css` (`.ui-ret-source-*`, `.ui-ret-shade-*`).

- [x] With עליית ערך and חיסכון מס missing, the hero reads 16.5% under "תשואה כוללת · שנה", not marked partial (54.4% once filled). Add "חלקי · חסרים …" under the figure. Rule: feedback-and-states (a partial number never passes as final).
- [x] At 320 the source labels wrap to two lines (nowrap value, fixed 48px share column, 44px ⓘ). Keep the label on one line; show the share column only when there is a share; put "חסר" on the hint line. Rule: DESIGN-RULES Q-3, tables-and-responsive § 12.
- [x] The four bar shades are the accent at 100/75/52/32%; the lightest is about 1.7:1 on white, and colour is the only link to the legend. Steps of 100/80/62/48 or direct labels. The % beside each source is a share of money in, not of the bar: name it "מהכסף בעסקה" or drop it. Rule: data-viz § 10, visual-system-and-accessibility § 7 (3:1).

**Acceptance:** the missing-inputs story at 320 shows "חלקי" and one-line labels; every shade is 3:1 against the card.

**Done (claude/flow-457-returns-ux), re-checked against main after #925:** the total reads "חלקי · חסרים עליית ערך וחיסכון מס" (or "חלקי · חסר X") under the figure when a source is missing. The per-cent beside each source is dropped (it was a share of the money in, not of the bar, and repeated cash-on-cash), so a source row is dot | label | ⓘ | gap | amount; a missing source shows הוספה in the amount track and what is missing on its hint line ("חסר · שווי הקרקע"), and the label keeps one line at 320. Shades: the proposed 100/80/62/48 still fails (48% is 2.35:1 light, 2.66:1 dark), so the steps are 100/86/73/62. Computed WCAG contrast of `color-mix(accent p%, surface)` against the card: light 7.00 / 5.29 / 4.00 / 3.16 :1, dark 7.11 / 5.60 / 4.41 / 3.54 :1. The segments keep the legend's order.
