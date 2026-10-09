# FLOW-106: the loan match sheet says what one tap writes

- PR: #TBD
- Kind: screen
- Changed: In "שיוך להלוואה", each loan row carries a one-line description of what a tap records: "לפי הלוח · $599.55" (the schedule row for the line's date), "3 תשלומים לפי הלוח · $1,798.65" when the line equals 2 to 12 unpaid rows to the cent (the tap writes those rows together), or, for a demand loan, "ריבית צבורה $328.77 · השאר לקרן". Demand loans are offered now. A loan that cannot take the line stays in the list, off, with its reason in place of the description: "נסגרה ב־30/11/2025", "נפרעה ב־…", "לפני תחילת ההלוואה", "יש תשלום מאוחר יותר", "התשלום גבוה מיתרת ההלוואה". Loans that can take the line come first.
- Rule: A picker row whose tap writes something says what it writes in its description; a row that can't be picked says why in the same place.
- Source: FLOW-106 screens plan §3.4 (owner approved the plan 2026-10-08).
