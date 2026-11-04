<a id="flow-471"></a>
# FLOW-471 · Returns sheets and headers: one definition per figure, plain words, true counts, a header that fits 320
- **Type:** SMALL UI · **Status:** in-progress (#964) · **Source:** UX rules review 2026-11-04 (`docs/runbooks/ux-rules-review.md`, rules in `.claude/skills/ux-ui-design-review-rules/`). Severity: Medium. From FLOW-460..462 (#939), FLOW-466 (#951).
- **Files:** `app/src/screens/project-returns-sheets.tsx`, `project-returns-learn.ts`, `project-returns-info.ts`, `project-returns-cards.tsx`, `project-returns-detail-screen.tsx`, `project-returns-screen.tsx`, `app/src/ui/css/26-returns.css`.

- [x] A figure's ⓘ sheet defines it twice (the body, then "מה זה"); keep one. The sheet's last paragraph scrolls under the fixed סגירה with no cue: pad the body. Rule: DESIGN-RULES §2.1.
- [x] Gloss BRRRR once; the three learn heads (מה זה / איך לקרוא / בשביל מה) at caption weight under the sheet title. Rule: visual-system § 3.
- [x] "תשואה כוללת · שנה", the ⓘ and "איך מחושב" wrap at 320: "שנה" goes to a subtitle, the ⓘ stays by the title. Rule: tables-and-responsive § 1.
- [x] The החישוב count includes the result row (8 for 7 categories): count the rows only, on the rehab and acquisition pages. Rule: feedback-and-states § 4.

**Acceptance:** the total card header is one line at 320; sheet bodies end above סגירה; counts match the rows.

**Done (2026-11-04):** the building cost, money in and השבחה pages had the same "+1" in their החישוב count; they count the rows too. The heads are `.ui-ret-learn-head` (caption size and weight, secondary). The period caption under the title reads "לשנה".
