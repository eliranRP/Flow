# FLOW-408: Waiting and filed-today lines keep their currency

- PR: #311
- Kind: screen
- Changed: the lines filed today and a project's waiting lines. A USD line read "₪" with its dollar amount; it now reads "$", like the same line on the project page and in Search. No layout change.
- Rule: an amount is always shown in its own currency.
- Source: FLOW-408 (currency in project lists), item 2.

## FLOW-329 follow-up: the unsplit loan line's hint

- Changed: the transaction card's locked "ברווח והפסד" row on a loan-category line with no loan split. It said "תשלום הלוואה · נספר לפי הפיצול"; it now says "תשלום הלוואה · לפי הקטגוריה". The matched case keeps "לפי חלקי ההלוואה" (#252).
- Rule: a hint says what really decides the number.
