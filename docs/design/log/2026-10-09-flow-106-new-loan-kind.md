# FLOW-106: the kind field on the new-loan form

- PR: #382
- Kind: screen
- Changed: The new-loan sheet opens with "סוג" (רגילה by default, so a mortgage takes no extra tap). A tap opens "סוג ההלוואה" inside the same sheet, the way פרויקט does: four radio rows with the loan page's one-line descriptions, and Back returns to the form. ריבית בלבד adds "חודשי ריבית בלבד" (default 12) and the preview reads "תשלום אחרי חודשי הריבית"; בלון adds "פריסה (חודשים)" (default 360) and the last line reads "בלון בסוף התקופה"; לפי דרישה hides the term, מסים וביטוח and עוד, the date label becomes "תאריך התחלה", and the preview is one line, "ריבית יומית על היתרה, לפי 365 יום. בלי לוח תשלומים." Loan setup's error retry is the tint pill now, and `.ui-btn-retry` is deleted (FLOW-334).
- Rule: A form field whose value comes from a short list of more than three choices opens a picker view inside the same sheet, not a segmented control.
- Source: FLOW-106 screens plan §3.3 (owner approved the plan 2026-10-08).
