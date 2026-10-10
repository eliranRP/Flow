# FLOW-355: a project row on Home's first screen

- PR: #403
- Kind: screen
- Changed: Home's band keeps the profit label, one period pill and the figure. The period tabs, the stepper and the "הכנסות פחות הוצאות" line are gone; the pill (the window, e.g. "אוגוסט – אוקטובר 2026", with ▼) opens the period sheet, and a sideways swipe on the figure still steps the period. The review and invoices rows (and the unpaid retry) move from above פרויקטים to under the first two projects; with two projects or fewer they follow the list. At 375x667 the first project row shows above the tab bar. The loading band matches: label, the real pill, the figure.
- Rule: On Home, attention rows sit under the first project rows, not above them, so the first screen always shows a project.
- Source: FLOW-355, owner picked "Both changes" (frame א), 2026-10-09 18:53Z.
