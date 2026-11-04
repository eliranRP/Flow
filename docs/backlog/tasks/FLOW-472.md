<a id="flow-472"></a>
# FLOW-472 · The closing-paid sheet shows its default and checks as you type
- **Type:** SMALL UI · **Status:** done (#963) · **Source:** UX rules review 2026-11-04 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-466 (#951).
- **Files:** `app/src/screens/loan-closing-paid-sheet.tsx`, `app/src/screens/loan-detail-screen.tsx` (no change needed there), `app/src/ui/money-field.tsx` (an empty field mirrors its placeholder, so the prefix sits beside it).

- [x] The field is empty with a "$" prefix; the default (the whole loan) shows only in a hint naming "HUD-1". Put the principal as the placeholder; hint "מהטופס של הסגירה. ריק = כל ההלוואה". Rule: forms-and-requests § 2.
- [x] Range errors show only after save: validate on blur. Rule: forms-and-requests § 4.
- [ ] Whether the row shows for every project loan or only a loan paid out at closing is the owner's call (FLOW-473). Not in this PR: which loans show the row is unchanged.

**Acceptance:** the closing-paid-sheet story shows the placeholder and an inline error on blur.
