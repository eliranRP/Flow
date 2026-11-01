<a id="flow-458"></a>
# FLOW-458 · Total return: marked partial when a source is missing, rows that hold at 320, bar shades that can be told apart
- **Type:** SMALL UI · **Status:** ready (after #925) · **Source:** UX rules review 2026-11-01 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-450.
- **Files:** `app/src/screens/project-returns-cards.tsx` (`TotalReturnCard`), `app/src/ui/css/26-returns.css` (`.ui-ret-source-*`, `.ui-ret-shade-*`).

- [ ] With עליית ערך and חיסכון מס missing, the hero reads 16.5% under "תשואה כוללת · שנה", not marked partial (54.4% once filled). Add "חלקי · חסרים …" under the figure. Rule: feedback-and-states (a partial number never passes as final).
- [ ] At 320 the source labels wrap to two lines (nowrap value, fixed 48px share column, 44px ⓘ). Keep the label on one line; show the share column only when there is a share; put "חסר" on the hint line. Rule: DESIGN-RULES Q-3, tables-and-responsive § 12.
- [ ] The four bar shades are the accent at 100/75/52/32%; the lightest is about 1.7:1 on white, and colour is the only link to the legend. Steps of 100/80/62/48 or direct labels. The % beside each source is a share of money in, not of the bar: name it "מהכסף בעסקה" or drop it. Rule: data-viz § 10, visual-system-and-accessibility § 7 (3:1).

**Acceptance:** the missing-inputs story at 320 shows "חלקי" and one-line labels; every shade is 3:1 against the card.
