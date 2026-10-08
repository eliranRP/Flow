# Category rename in Settings → Categories

- **Lane:** UI lane 3 · **Date:** 2026-10-08 · **Ask:** the owner made renaming categories a priority (all category names in Hebrew).
- **What changed:** the ⋯ sheet gets "שינוי שם" after the P&L row, as drawn in the approved FLOW-405 mockup. It opens a one-field sheet titled "שינוי שם" with the current name and שמירה, the same pattern as the business name sheet (decision 0108). A save shows "השם נשמר" with ביטול.
- **Shared components:** none new; Sheet, TextField, Button and ListRow as they are.
- **Rule:** a rename is a one-field sheet with שמירה in the sheet's action slot and an undo toast; no confirm, since ביטול puts the old name back.
- **Stories:** Screens/Categories sheet → Rename, Rename 320, Rename dark.
