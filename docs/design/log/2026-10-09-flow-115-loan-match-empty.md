# FLOW-115 and FLOW-138: loan match follow-ups, part 2 (empty sheet, other currency, long names); paid-off loans

- PR: UI lane 4.
- What changed:
  - The שיוך להלוואה sheet with no loan to pick is no longer a dead end. It says why ("אין עדיין הלוואה." or "אין הלוואה בשקלים."), says what to do in one line ("אפשר להוסיף הלוואה חדשה, ואז לשייך אליה את התשלום."), and offers הלוואה חדשה, which opens Settings → הלוואות with the new-loan sheet (the + sheet's quick action, FLOW-331). The link replaces the sheet's history entry, so Back from Loans returns to the line once.
  - Loans in another currency were already left out of the sheet; no change.
  - The matched row ("תשלום הלוואה · <loan>") wraps a long loan name to two lines at 320 instead of cutting it after one.
  - Whole units on the Settings → הלוואות balances: not done. FLOW-501 and decision 0120 keep the cents small with ".00" (design lead's call).
  - FLOW-138 (Eliran picked "Hide"): a paid-off loan on Settings → הלוואות shows only נפרעה and its date, with no balance. Closed (נסגרה) loans keep theirs.
- Rule: a sheet with nothing to pick says why and offers the next step (FLOW-115).
- Rule: a finished item drops the figure that no longer matters and keeps the words that say how it ended (FLOW-138).
- Shots: mockups/flow-115/built/ in the project files.
