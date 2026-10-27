<a id="flow-971"></a>
# FLOW-971 · Search v2 and Review lists v2: the UX/UI rules review
- **Type:** UI (design approved) · **Status:** in-progress · **Depends on:** — · **Source:** a review of חיפוש (/search) and the review lists (the full list /review/all, a project's waiting list, /review/filed and the change sheet /review/change) against a UX/UI rule set. The owner approved the designs on 2026-10-26; on a card the same day: the change sheet saves on pick, with a 5s ביטול and field errors when it closes incomplete. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", the Search row and the Lists board on the Review row, with their findings notes.
- **Files:** `app/src/screens/search*.tsx`, `app/src/screens/review-screen.tsx`, `app/src/screens/filed-today-screen.tsx`, the project waiting list, `app/src/ui/change-sheet.tsx`, `app/src/ui/change-picker.tsx`, their CSS, stories and tests, a decision record, a design log entry.

**Search**
- [ ] Clear, filter chips and segments are 44px; the field is 48px.
- [ ] Failed and offline states.
- [ ] The placeholder reaches 4.5:1.
- [ ] The filter's project chips are one radio group.
- [ ] The "רק ממתינים לאישור" switch's off track reaches 3:1.
- [ ] The sheet grip reaches 3:1.

**Review lists**
- [ ] A line with no project carries Review v2's missing mark in the full list.
- [ ] Failed, offline and empty states on the full and waiting lists; filed today gets an empty state with one action.
- [ ] The change sheet marks each missing field with its own message.
- [ ] The full and waiting lists lead with Home v2's filled review button.
- [ ] The hint line says the count and what is missing.
- [ ] Group heads show totals; amounts are tabular.
- [ ] Filed today shows a total and that a line can still change.
- [ ] "לזכור לספק הזה" names the supplier, the project · category and where to undo it.
- [ ] Close and "פיצול לפי קטגוריות" are 44px; type on the scale.
- [ ] The change sheet saves on pick, with a 5s ביטול (owner call).
- **Acceptance:** stories of each new state; tests for the states, the marks, the field errors and the undo toasts; decision record; design log entry.
