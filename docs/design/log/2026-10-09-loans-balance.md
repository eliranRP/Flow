# FLOW-339: Loan balances at the list amount size

- PR: #293
- Kind: screen
- Changed: Settings → Loans and a project's loans list. A balance is 17/400 (`amount`), with its cents small and raised on the same line (10.2px), ".00" kept as the Loans steps say. Before, it was 13px, and in Settings → Loans the cents sat on a second line at 7.8px, because the FLOW-115 loan form's field wrapper also used `.ui-loan-amount` (flex column, nowrap). The wrapper is now `.ui-loan-amount-field`: the form's layout is the same, and a long message under the original amount can now wrap instead of running off at 320. In loan lists (`.ui-loan-list`) the name and the hint each keep up to two lines with an ellipsis after, so at 320 a name such as "משכנתא אלון" is never cut to "משכנת…"; the text column takes everything the balance and chevron leave.
- Rule: a class that styles a figure is never reused as a layout wrapper; a row whose name is its identity wraps before it truncates.
- Source: FLOW-339 (mobile UI/UX review cycle 6); title wrap asked by the design lead.
