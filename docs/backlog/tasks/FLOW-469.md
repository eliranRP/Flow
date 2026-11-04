<a id="flow-469"></a>
# FLOW-469 · All the cash out but losing: the hero says it is a loss, in few words
- **Type:** SMALL UI · **Status:** ready · **Source:** UX rules review 2026-11-04 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-1025 (#954).
- **Files:** `app/src/screens/project-returns-info.ts` (`coverLine`), `project-returns-cards.tsx`.

- [ ] The hero is a bare red "−$4,600" with no label, under a three-clause line that opens "כל הכסף חזר". Caption the hero "הפסד בשנה"; cut the line to "כל הכסף חזר · התזרים שלילי: מספיק לעוד כ־5 שנים". Rule: DESIGN-RULES §2.1 Light.
- [ ] The cash-on-cash row shows "−$6,600" where its siblings show %; label it "הפסד" with the amount. Rule: tables-and-responsive § 7.

**Acceptance:** the all-cash-out-losing story at 320 shows a labelled hero and a line of two lines at most.
