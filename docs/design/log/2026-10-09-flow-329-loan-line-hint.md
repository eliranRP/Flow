# FLOW-329 follow-up: the unsplit loan line's hint

- PR: #311
- Kind: screen
- Changed: the transaction card's locked "ברווח והפסד" row on a loan-category line with no loan split. It said "תשלום הלוואה · נספר לפי הפיצול"; it now says "תשלום הלוואה · לפי הקטגוריה". The matched case keeps "לפי חלקי ההלוואה" (#252).
- Rule: a hint says what really decides the number.
- Source: FLOW-329, follow-up from #252.
