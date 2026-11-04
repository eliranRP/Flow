<a id="flow-468"></a>
# FLOW-468 · Before the first rent: one clear note, and "שכירות" instead of "שכר"
- **Type:** SMALL UI · **Status:** claimed (UI/UX review, 2026-11-04, claude/flow-467-returns-ux-2) · **Source:** UX rules review 2026-11-04 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-454 (#925) and FLOW-464 (#950).
- **Files:** `app/src/screens/project-returns-info.ts`, `project-returns-cards.tsx`, `project-returns-learn.ts`.

- [ ] "השכר הראשון" / "לפני השכר הראשון" reads as a wage; use "השכירות הראשונה" / "לפני השכירות הראשונה" / "משכר הדירה הראשון" everywhere. Rule: forms-and-requests § 6.
- [ ] Before the first rent the total card keeps "על הכסף בעסקה" beside a note with no figure, and "תזרים ליחידה" shows "$0" while its siblings show the note. Hide the label while the note shows; the per-unit row shows the same note. Rule: feedback-and-states § 4.

**Acceptance:** the before-first-rent story shows the note once on the card and on all per-year rows, with no "$0".
