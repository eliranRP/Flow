# 2026-10-10 · FLOW-106: edit a matched split, and lock a loan's own categories

- PR: UI lane 4
- What: a matched loan payment's parts sheet has a quiet "עריכת הפיצול" under סה״כ. It opens the split editor "פיצול התשלום" in סכומים מדויקים, prefilled with the stored parts, on the loan the line is matched to: no loan picker and no לפי הלוח, since the schedule would count this line as already paid. Each part keeps its stored scheduled figure and category; fees can take a category and keep it on the loan, as from "פיצול אחר". A flagged split shows no link: its own correction stays. In Settings → Categories, a category a loan names for interest, escrow or principal shows the locked line "קטגוריה של הלוואה · <loan> · ריבית" in its ⋯ sheet, and loses the P&L action, the rehab switch, the parent row and delete, as the built-in loan categories do. A fees category stays free (decision 0130).
- Rule: the copy says פיצול where the plan said חלוקה (FLOW-356). A category a loan's part writes to is locked the same way whether it is built in or the loan's own.
- Shots: mockups/flow-106-edit/ in the project files.
