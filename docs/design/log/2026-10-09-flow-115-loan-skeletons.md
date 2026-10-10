# 2026-10-09 · FLOW-115: loan skeletons hold the loaded layout

- PR: UI lane 4 (after #418)
- What: on a cold open, the loans list (Settings → הלוואות) drew 60px skeleton rows that grew to 74px when the read landed. The loan page drew a bare bar where the name, the balance and the status sit, so everything under it dropped 99px. The list and the loan page's rows now load at the loaded rows' height (two text lines). The loan page holds the name's line at the page title's size, the balance at display size, and a pill-sized bar for the status. Measured at 390 as the owner with a one-line name: 0px shift on both.
- The "ממתין לבדיקה" row already leads to the waiting line: it opens the loan's page, whose banner "תשלום אחד ממתין לבדיקה" opens that transaction (loan-detail-screen, since FLOW-110, #305).
- Rule: a skeleton takes the height of what it stands for; if loaded rows carry a hint, so does the skeleton's height.
- Shots: mockups/flow-115-skeletons/ in the project files.
