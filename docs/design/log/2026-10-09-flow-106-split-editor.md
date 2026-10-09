# FLOW-106: the split editor "חלוקת התשלום"

- PR: #379
- Kind: screen
- Changed: Under the loan match sheet, "חלוקה אחרת" opens a sheet titled "חלוקת התשלום": the line's amount and date, the loan (a picker when more than one loan can take the line), and a segmented "לפי הלוח" / "סכומים מדויקים" ("לפי ריבית צבורה" for a demand loan). לפי הלוח has a new Stepper "מספר תשלומים" (1 to 12, the covered dates under it; none for a demand loan), an "עמלות" field taken off the top, and the parts it writes. סכומים מדויקים starts from those parts and takes the lender's four figures, with "חולקו … / נשאר …" under them. Fees above 0 ask "קטגוריה לעמלות" and offer "לשמור להלוואה הזו". One שמירה, off with one plain reason until the split is valid ("חסרים $100 כדי להגיע לסכום השורה.", "בחרו לאן נרשמות העמלות."). The parts are in body weight so סה״כ leads..
- New component: `Stepper` (app/src/ui/stepper.tsx): − and + with 44px targets, the value a spinbutton, an end that can't move is off.
- Rule: A form whose fields must add up to a total says what is still missing or over in one line under the fields, and its save stays off until they match.
- Source: FLOW-106 screens plan §3.4 (owner approved the plan 2026-10-08).
