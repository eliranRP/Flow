<a id="flow-455"></a>
# FLOW-455 · An account's page keeps its content while the period changes, and its year counts are whole
- **Type:** SMALL UI · **Status:** in-progress (#TBD) · **Source:** UX rules review 2026-11-01 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-171.
- **Files:** `app/src/screens/report-account-screen.tsx`.

- [x] Tapping השנה / מההתחלה changes the query key with no `placeholderData`, so the whole screen turns to a skeleton, the title falls back to "חשבון", and the control just tapped unmounts (focus lost). Add `placeholderData: keepPreviousData`, or skeleton only the movements. Rule: feedback-and-states § 2, visual-system-and-accessibility § 9 (focus kept).
- [x] Each year's count is the loaded rows, so while עוד תנועות shows the oldest year's count is partial beside the true total. Hide it while more pages remain, or read per-year counts. Rule: feedback-and-states § 4.

**Acceptance:** switching the period keeps the header and the control on screen; no year count is shown partial.
