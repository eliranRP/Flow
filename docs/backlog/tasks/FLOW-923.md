<a id="flow-923"></a>
# FLOW-923 · In-app camera and receipt reading for the + sheet (board AddCamera, AddReading)
- **Type:** Feature · **Status:** ready · **Depends on:** — · **Source:** PR #703 board coverage: the AddCamera and AddReading frames have no screen in the app. Owner decision 2026-10-18: a follow-up, not part of #703.
- **Files:** `app/src/screens/add-sheet.tsx`, `app/src/screens/add-entry-sheet.tsx`, a new camera screen, `design/proof/add-map.json`.
- [ ] Today the + sheet opens the phone's own camera through a file input with `capture`. Build the board's in-app camera (AddCamera): a `getUserMedia` viewfinder, the framing guide, the scan line and the shutter; fall back to the file input when the camera is refused or missing.
- [ ] Build the reading state (AddReading, "קורא את הקבלה…") once receipt reading (OCR) exists, then fill the AddReceipt card with what was read: "Flow קרא את הקבלה / בדקו את מה שמסומן ושמרו" and the project hint from the supplier's earlier receipts. Until then the card keeps the honest "המסמך צורף / הפרטים ממלאים אתם".
- [ ] Map AddCamera and AddReading in `design/proof/add-map.json` and prove both under 3% in both themes.
