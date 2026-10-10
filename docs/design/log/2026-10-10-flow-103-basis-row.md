# Settings: one date for profit, the תזרים and the agent

- PR: pending (UI lane 1).
- Kind: screen
- Changed: Settings has a row "רווח ותזרים לפי" under מטבע העסק, with the company's choice as its hint (תאריך תשלום by default). It opens a sheet with two choices, תאריך תשלום ("כשהכסף יצא או נכנס בבנק") and תאריך חשבונית ("לפי תאריך המסמך, גם לפני התשלום"), and one line under them: "הרווח, התזרים והסוכן סופרים לפי התאריך הזה." A tap saves, closes the sheet and shows a toast with ביטול. Only the owner changes it; an editor or viewer sees the row without a chevron. Home, the breakdowns and the project page now count by the company's choice, so the app agrees with the MCP and the cash Home. Home names no basis.
- Rule: a company-wide setting is a Settings row with its value as the hint, a sheet that applies on tap, and an undo toast (like the currency, FLOW-504).
- Source: FLOW-103, the owner's card "Payment date" (2026-10-10); plan in plans/flow-103-basis-plan.md, decision 0170.
- Shots: reviews/flow-103-basis/ in the project files (row at 390 and 320, viewer, sheet at 390 light and dark and 375x667).
