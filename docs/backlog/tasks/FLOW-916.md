<a id="flow-916"></a>
# FLOW-916 · Lines detail: receipt thumbnail row once a receipt image path exists
- **Type:** UI (follow-up) · **Status:** ready · **Depends on:** [FLOW-369](FLOW-369.md) (the add sheet, which may add the receipt image path) · **Source:** FLOW-366 second visual round (PR #625), intentional difference
- **What:** The board's detail frame has a "חשבונית" card with a receipt thumbnail and the line "צולמה dd/mm • הקישו להגדלה". The app has no receipt row: the transaction detail carries no receipt image and main has no receipt image path. PR #625 leaves the row out rather than invent a data field.
- **Acceptance:** once the add sheet (FLOW-369) stores a receipt image for a line, the detail shows the card with its thumbnail, the capture date, and a tap that opens the image full size; without a receipt the card is not shown. Real-app shots at 390, light and dark, against the board frame.
- [ ] (UI lane) The receipt card on the transaction detail, under the recurring row, from the line's receipt image.
- [ ] (UI lane) Proof frames LinesDetail-dark and LinesDetailLight-light show the card, and the shot is compared to the board.
