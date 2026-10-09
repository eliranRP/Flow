<a id="flow-125"></a>
# FLOW-125 · Loan split follow-ups (#83 review)
- Renumbered from a second FLOW-121 (2026-10-07).
- **Type:** BACKLOG NIT · **Status:** done (#253) · **Depends on:** FLOW-107
- [x] (UI lane 3, 2026-10-08: the category drill-down, the project list, שויכו היום, a project's לאישור list and the breakdown lines pass the line's source through `rowSource`, so a Mercury line shows the bank icon) Transaction rows in the category drill-down, a project's recent list and "שויכו היום" always pass `source="invoice"` (`app/src/screens/project-category-screen.tsx`, `project-detail-screen.tsx`, `filed-today-screen.tsx`), so bank lines show the document icon. Have the list reads return the line's source and pass it on; do not special-case loan rows.
- [x] (UI lane 3, 2026-10-08: `ListRow` runs a Latin string title LTR, aligned to the row's start side, with or without a tag) A Latin row title is cut at its start in an RTL row at 320 ("…gate Home Loans"). Use `dir="auto"` on `.ui-row-title`, or `ltrTitle` when the description is Latin.
- [x] (UI lane 3, 2026-10-08: `useLoanMarks` counts the loan_splits rows of each line, and the hint says "2 חלקים", "3 חלקים", …) "3 חלקים" is a fixed string (`app/src/screens/loan-marks.tsx`). Carry the real part count in the mark if a split can ever have fewer or more parts.
