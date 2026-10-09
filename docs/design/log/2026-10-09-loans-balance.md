# FLOW-339: Loan balances at the list amount size

- PR: (this PR)
- Kind: screen
- Changed: Settings → Loans. A balance is 17/400 (`amount`), with its cents small and raised on the same line (10.2px), ".00" kept as the Loans steps say. Before, it was 13px with the cents on a second line at 7.8px, because the FLOW-115 loan form's field wrapper also used `.ui-loan-amount` (flex column). The wrapper is now `.ui-loan-amount-field`; the loan form looks the same.
- Rule: a class that styles a figure is never reused as a layout wrapper.
- Source: FLOW-339 (mobile UI/UX review cycle 6).
