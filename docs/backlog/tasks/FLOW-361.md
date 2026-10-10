<a id="flow-361"></a>
# FLOW-361 · Loan setup story shows Hebrew letters in reverse order
- **Type:** SMALL BUG · **Status:** ready · **Depends on:** — · **Source:** FLOW-115 year-jump shots, 2026-10-10 (design lead: Storybook only, owner UI lane 4)
- **What:** In Storybook, the "Screens/Loan setup" Date Sheet Open story renders some Hebrew in reverse letter order: the lender field's value, the month title, the picked day's line and the בחירה and שמירה buttons, while the sheet title and the payment lines read correctly. The DateSheet component stories render fine, so the cause is likely the story's own wrapper, not the app.
- [ ] Find why the loan setup stories reverse those runs and fix it, so their shots read as the app does.
- **Acceptance:** shots of the Date Sheet Open stories at 390 and 320 read correctly; design lead sign-off.
