<a id="flow-971"></a>
# FLOW-971 · Search v2 and Review lists v2: the UX/UI rules review
- **Type:** UI (design approved) · **Status:** in-progress · **Depends on:** — · **Source:** a review of חיפוש (/search) and the review lists (the full list /review/all, a project's waiting list, /review/filed and the change sheet /review/change) against a UX/UI rule set. The owner approved the designs on 2026-10-26; on a card the same day: the change sheet saves on pick, with a 5s ביטול and field errors when it closes incomplete. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", the Search row and the Lists board on the Review row, with their findings notes.
- **Files:** `app/src/screens/search*.tsx`, `app/src/screens/review-screen.tsx`, `app/src/screens/filed-today-screen.tsx`, the project waiting list, `app/src/ui/change-sheet.tsx`, `app/src/ui/change-picker.tsx`, their CSS, stories and tests, a decision record, a design log entry.

**Search**
- [x] Clear, filter chips and segments are 44px; the field is 48px.
- [x] Failed and offline states.
- [x] The placeholder reaches 4.5:1.
- [x] The filter's project chips are one radio group.
- [x] The "רק ממתינים לאישור" switch's off track reaches 3:1.
- [x] The sheet grip reaches 3:1.

**Review lists**
- [x] A line with no project carries Review v2's missing mark in the full list.
- [x] Failed, offline and empty states on the full and waiting lists; filed today gets an empty state with one action.
- [x] The change sheet marks each missing field with its own message.
- [x] The full and waiting lists lead with Home v2's filled review button.
- [x] The hint line says the count and what is missing.
- [x] Group heads show totals; amounts are tabular.
- [x] Filed today shows a total and that a line can still change.
- [x] "לזכור לספק הזה" names the supplier and the category, and how to stop it (the project is not remembered and no settings page lists rules: decision 0221, open for the owner).
- [x] Close and "פיצול לפי קטגוריות" are 44px; type on the scale.
- [x] The change sheet saves on pick, with a 5s ביטול (owner call).
- **Acceptance:** stories of each new state; tests for the states, the marks, the field errors and the undo toasts; decision record; design log entry.
