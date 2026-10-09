# FLOW-353 items 3 and 4: dates stay whole at 320

- PR: #392 (UI lane 3).
- What changed:
  - Open invoices: the row hint's date, its age and the "סומן כשולם · ממתין לסנכרון" mark each stay on one line, and each part carries its "·" at its start, so at 320 the line breaks before a separator. A long project name may still wrap. A document from today says היום, and one from yesterday says אתמול.
  - Investment card: "עודכן" and its date stay on one line on the שווי היום row. A date in the current year drops its year ("עודכן 01/10"): at 320 the full date was clipped beside ₪1,650,000.
- Rule: a hint's date or age is never split across lines; a wrapping hint breaks before its "·" (as FLOW-351 part 2). A date in the current year drops its year when space is tight; it is never clipped.
- Shots: mockups/flow-353-build/ in the project files.
