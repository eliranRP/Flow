<a id="flow-456"></a>
# FLOW-456 · The report share sheet says why its button is off next to it, and picking projects starts from one
- **Type:** SMALL UI · **Status:** ready · **Source:** UX rules review 2026-11-01 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-991 to FLOW-993.
- **Files:** `app/src/screens/report-share-sheet.tsx`, `app/src/ui/css/61-reports.css`.

- [ ] The reason the share button is disabled ("בחרו לפחות פרויקט אחד", the column limit, the date range) is only at the end of the scrolling body, off screen with several projects. Put it in the sheet foot above the button, `role="status"`. Rule: feedback-and-states § 16 (don't disable without saying why).
- [ ] Turning off כל הפרויקטים sets no project, so the sheet is blocked at once and every project must be tapped from zero. Start from the current project, else all of them. Rule: forms-and-requests (smart defaults; the first action is not an error).

**Acceptance:** with 8 projects at 320, the blocked reason is visible beside the button; turning off כל הפרויקטים leaves the sheet shareable.
