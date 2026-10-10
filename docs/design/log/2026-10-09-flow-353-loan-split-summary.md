# FLOW-353 item 1: the loan split editor's summary says what is missing or over

- PR: UI lane 4.
- What changed: in "חלוקת התשלום" with exact parts, the summary row's end now reads "חסרים $x" when the parts are short of the line, "עודף $x" in the error colour when they pass it, and "נשאר $0" when they match. The separate red line under the parts is gone, so nothing sits half under the sheet's foot at 375x667 and 320. The amount fields point at the summary for screen readers. The matched payment's own parts sheet (סה״כ row) is unchanged.
- Rule: a running total carries its own state; no second line repeats it (FLOW-353).
- Shots: mockups/flow-353-loan-split/built/ in the project files (before and after).
