# FLOW-115: A loan without a balance row is not paid off; the match sheet names the currency

- PR: #PR
- Kind: screen
- Changed: Settings → Loans, the project's loans and the loan match sheet. A loan with no balance row yet read "נפרעה" and was off in the sheet; it now shows its principal. When the only loans are in another currency, the sheet's empty line says "אין הלוואה בדולר." (or בשקלים, באירו) instead of "אין עדיין הלוואה.", which was untrue. New stories: Screens/Loan match, Picker other currency (+ 320 dark).
- Rule: an empty state says why it is empty; a missing number is never shown as zero.
- Source: FLOW-115 (loan screens UI follow-ups).
