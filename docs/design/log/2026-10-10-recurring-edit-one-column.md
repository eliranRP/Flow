# קבועים in עריכה keeps one amount column

- PR: FLOW-428 (cycle 21, C21-1).
- Kind: component
- Changed: in עריכה on קבועים, a row with nothing to close, in a section where another row ends in "סגירה", keeps an end slot as wide as "סגירה". Its chevron stays where it sits outside עריכה, and the slot opens the row too. Under הגיעו החודש ₪1,320 and ₪410 now line up with ₪2,550. Outside עריכה nothing changes.
- Rule: every row in a list keeps the action's place, so its amounts form one column (§3.7).
- Source: cycle 21 phone review of production (design lead).
- Shots: Storybook Components/MissingBillList Editing, Editing dark, Editing 320.
