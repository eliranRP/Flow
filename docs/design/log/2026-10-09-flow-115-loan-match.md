# FLOW-115: loan match lines that say why and print only the difference

- PR: #375
- Kind: copy and states
- Changed: the loan parts sheet (`loan-match-row.tsx`): a flagged split's note says the line's amount went up or down and by how much ("סכום השורה עלה ב־₪100, אז החלקים צריכים בדיקה. בדקו ושמרו."); the sum line prints only the difference ("חסרים ₪150 כדי להגיע לסכום השורה." / "יש ₪150 יותר מסכום השורה."); a failed correction has its own toast and reads the parts again. The match sheet (`loan-match.tsx`): a dismiss waits for the save, focus goes back to the tapped loan on a failure, and to the שיוך row after a read retry. `RadioRow`: a busy row is `aria-disabled`, so it keeps focus. Stories: LoanPartsSheet "Does not add up" and "Needs review" carry the new copy.
- Rule: A line that asks the user to fix a sum prints the gap, not the target they must add up to. A waiting state says what changed. A row that is saving keeps focus.
- Source: FLOW-115 loan match items (lane manager's pick, 2026-10-09)
