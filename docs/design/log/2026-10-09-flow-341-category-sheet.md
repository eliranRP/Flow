# FLOW-341: A shorter ⋯ sheet in Settings → Categories

- PR: #TBD
- Kind: screen
- Changed: The category ⋯ sheet drops its four sentence hints (rehab, P&L, move, merge) and folds move and merge into one row, "העברה לקטגוריה אחרת". The picker gets a "להסתיר את {name}" switch above its list, off by default; on, a pick opens the merge confirm, whose consequence now says the category is hidden. A loan, hidden or empty category can only merge: its picker is titled "מיזוג אל" and has no switch. The separate "מיזוג אל" sheet on the screen is gone. The switch sits above the list, not below it as in the mockup, so a long list never hides it before the pick.
- Rule: A menu row is a short label with no sentence; the consequence lives on the sheet that does the write (the picker or the confirm). Two actions that differ by one side effect are one row, with the side effect as a switch on the next sheet.
- Source: owner's pick on 2026-10-09 (option A, card answered 06:41Z); mockups in the project's mockups/flow-341/, build shots in mockups/flow-341/built/.
