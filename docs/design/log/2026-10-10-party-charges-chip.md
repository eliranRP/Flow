# Transaction: "לעומת הרגיל" chip and the party's earlier charges

- PR: #530 (FLOW-431, "Related charges" lane).
- Kind: component
- Changed: the transaction screen gets one chip under its status pills, "▲ 92% לעומת הרגיל $11.99" (or "כמו הרגיל $11.99"), when the supplier or customer has a usual amount. A tap opens a sheet named for the party: the percent and the usual amount, 6 quiet month bars (only the line's month in colour, no axis, legend or figures) and its 12 newest charges, the open line tinted and the rest opening their own line. Income lists say "תקבולים קודמים". Shared components `ChargeChangeChip`, `ChargeMonthBars`, `PartyChargesBody`, `PartyChargesSheet` (ui/related-charges.tsx) with stories.
- Rule: a change percent is red only when it is bad news (an expense up or income down), green the other way.
- Rule: a percent against the usual amount always names that amount next to it.
- Source: the owner's pick B on the plan-first card (2026-10-10 13:15Z), with the usual amount added to the chip.
- Shots: mockups/built/flow-431/ in the project files (390, 320, dark, the sheet, income down).
