# Loan pages: figures that agree, one row style, whole parts at 320

- PR: FLOW-427 (cycle 20, C20-1 to C20-4).
- Kind: screen
- Changed: the תשלומים הבאים page starts the payments still to pay from the balance in the books, keeping the loan's own payment (the one the bank charges and the page leads with), its months of interest only and its balloon; the principal to the end now equals the יתרה on the loan page. A lower balance ends the loan sooner; a higher one leaves more for the last payment. Every row on that page has dark amounts in one column: rows that open something have a chevron, the part rows keep its place. "לכל השנים" is a tint link. A payment row counts only the parts with an amount (an interest-only payment with one part names it, "ריבית"; "N חלקים" starts at 2). The details' values and hints in parts ("ריבית בלבד · 12 מתוך 24 חודשים") wrap only between whole parts, through `HintParts`.
- Rule: one page, one debt; a row that opens nothing keeps the chevron's place.
- Source: cycle 20 phone review (design lead).
- Shots: reviews/flow-427/ in the project files.
