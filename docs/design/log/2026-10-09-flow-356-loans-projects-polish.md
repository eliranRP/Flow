# 2026-10-09 · FLOW-356 (UI lane 4 items): paid-off loan page, פיצול copy, empty loan sheet, Projects title

- PR: UI lane 4 (after #418), with FLOW-115's skeletons.
- Paid-off loan page: the owner's FLOW-138 pick "Hide" now reaches the page, as #394 did for the list. A loan the list shows without a balance (paid off, or closed at zero) leads with the "נפרעה · 15/06/2026" pill alone: no figure, no יתרה, no תשלום חודשי row, and no מצב row repeating the status. A quiet "שינוי" beside the pill opens the status sheet, so reopening stays one tap away; a viewer gets no link.
- Loan split copy says פיצול (§3.6): "פיצול התשלום", "פיצול אחר", "אופן הפיצול", "פוצלו $x", "חסר חלק בפיצול.", "מתוך הפיצול של ההלוואה".
- Empty loan match sheet: one line, "אפשר להוסיף הלוואה חדשה, ואז לשייך אליה את התשלום.", and the 44px tint button "הלוואה חדשה". The reason ("אין עדיין הלוואה", "אין הלוואה בדולר") stays on the row's hint only.
- Projects tab: the 34px tab-root title, as the other tabs and its own empty state, and "רווח ב־3 חודשים" as Home says it.
- Rule: a status the page leads with is not repeated as a row; where the row was its only way to change, the change sits beside the status.
- Shots: mockups/flow-356-lane4/ in the project files.
