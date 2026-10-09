# FLOW-115: The שיוך row keeps its height while loans load

- PR: #PR
- Kind: screen
- Changed: the transaction card's "שיוך להלוואה" row. Its loading placeholder was 72px and the row 95px with a hint (one matching loan) or about 72px without (two or more), so the card moved when the read landed. The row now always has a hint: the lone loan's name, "N הלוואות" for two or more, "אין הלוואה בדולר" (the line's currency) for none. The placeholder is sized from the type tokens to the hinted row (94.6px at 390 and 320). New stories: Screens/Loan match, Match row two loans, Match row loading.
- Rule: a skeleton is the height of what replaces it.
- Source: FLOW-115 (loan screens UI follow-ups).
