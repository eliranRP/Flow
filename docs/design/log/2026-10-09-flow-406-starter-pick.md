# FLOW-406: the starter categories pick in setup

- PR: #420 (UI lane 3).
- What changed: right after the company is created, step 0 shows "קטגוריות לפתיחה" with three rows (השכרת נכסים, שיפוצים ופליפים, כללי), each with a few of its own categories as a hint, and one המשך button. It sits before step 1 because the set can only replace the default list while the books are empty, and step 1 brings lines in.
- Differences from the approved mockup (design lead, 2026-10-09):
  - כללי is picked on arrival and המשך is always enabled (DESIGN-RULES §3.7: an enabled save). With a default picked, דלג would do the same as המשך, so the screen has no דלג.
  - No counter and no back: the screen belongs to step 0, which has neither.
  - The hints name each set's real top-level categories, not the mockup's sample words.
- If the books already have lines, המשך moves on to step 1 and the default list stays, with no message.
- Rule: a setup choice with a safe default opens on that default and has one button.
- Shots: mockups/flow-406-starter/ in the project files.
