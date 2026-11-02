<a id="flow-457"></a>
# FLOW-457 · A property's returns: one minus per expense, true counts, a name for ∞, one label per figure
- **Type:** SMALL UI · **Status:** in-progress (#TBD) · **Source:** UX rules review 2026-11-01 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-450, FLOW-451, FLOW-453.
- **Files:** `app/src/screens/project-returns-parts.tsx` (`FormulaLine`), `project-returns-info.ts`, `project-returns-screen.tsx`, `project-returns-cards.tsx`, `project-investment-cards.tsx`.

- [x] Formula rows show the operator and a signed amount: "−  −$8,400" reads as subtracting a negative (seen in the תזרים ⓘ sheet). Show the magnitude next to the operator. Rule: visual-system-and-accessibility (one signal per figure).
- [x] החישוב's count is hardcoded "5 שורות" over six rows; מחוץ לחישוב shows a bare number. Derive it, with a unit. A one-row section is not collapsible. Rule: feedback-and-states § 4.
- [x] The all-cash-out "∞" has no accessible name: `aria-label="כל ההון חזר"`. Rule: visual-system-and-accessibility § 9.
- [x] Rows and their sheets name a figure twice ("קרקע" / "שווי הקרקע", "יחידות" / "מספר יחידות"); use one. The purchase row from the lines has no press state; add `m-press` and "מהתנועות · לפירוט ולתיקון". Rule: forms-and-requests § 2.

**Acceptance:** the info-sheet story shows one minus per expense; the counts match the rows.

**Done (claude/flow-457-returns-ux), re-checked against main after #925, which fixed none of these:** a "+"/"−" formula row now shows its operator by the figure's sign and the figure without a sign (`signedRow`), so a cost reads "− $8,400" and a refund that adds back reads "+". החישוב counts the rows it draws ("6 שורות"); מחוץ לחישוב reads "2 שורות" or "שורה אחת", and a one-row section does not fold (`ReportSection fixed`). ∞ is `role="img"` named "כל ההון חזר", on the card and on the metric pages. A figure has one name everywhere: "שווי הקרקע", "מספר יחידות" (rows, sheets, formula rows and the per-unit page). Every row of נתוני הנכס that opens something has `m-press`; the purchase from the lines reads "מהתנועות · לפירוט ולתיקון".
