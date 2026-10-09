# FLOW-115: The שיוך row keeps its height while loans load

- PR: #PR
- Kind: screen
- Changed: the transaction card's "שיוך להלוואה" row. Its loading placeholder was 72px and the row 94.6px with a hint (one matching loan) or about 72px without (two or more), so the card moved when the read landed. The row now always has a hint, muted, on one line with an ellipsis: the lone loan's name, "N הלוואות" for two or more, "אין הלוואה בדולר" (the line's currency) when loans exist only in other currencies, "אין עדיין הלוואה" when none is offered. The sheet's empty line uses the same words. The placeholder is sized from the type tokens to the hinted row (94.6px at 390 and 320). New stories: Screens/Loan match, Match row two loans, Match row no loan in currency, Match row long name, Match row loading.
- Rule: a skeleton is the height of what replaces it.
- Source: FLOW-115 (loan screens UI follow-ups).
