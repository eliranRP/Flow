<a id="flow-351"></a>
# FLOW-351 · Phone polish after the October 9 afternoon deploy (cycle 10)
- **Type:** SMALL UI · **Status:** done (#372, #384) · **Depends on:** —
- **Source:** cycle 10 phone review of deploy a2503e3, 2026-10-09. Shots in the project files under `reviews/ui-ux-cycle-10/shots/`.
- [x] Transaction card at 320: with a five-digit assumed VAT, the amount's meta line ("לפני מע״מ · מע״מ משוער ₪15,300 · date") breaks right after a "·" and the date sits alone. Break before the separator, or drop the date part with its "·" first, as loan hints do (transaction-screen.tsx:513-524).
- [x] Period pill and Search chip words: after a pick, חודש reads "החודש", שנה reads "2026" and הכול reads "כל התקופה" on the breakdown pill, while 3 and 6 months repeat the row's name. Use the shared תקופה sheet's own words for every option (period.ts:168, :201-210).
- [x] Search chips: the row fades only its end, so once scrolled, הוצאות is cut hard at the start edge with no cue that תקופה is off screen. Fade the start edge too when the row is scrolled (chip-scroller.tsx, 31-chip-scroller.css).
- [x] Loans at 320: loan rows drop their icon under 360px but "הלוואה חדשה" keeps it, so its title starts about 36px further in and breaks the shared start edge. Drop it at the same width, or keep the plus as a start-edge glyph that lines up with the names (loan-setup.tsx:582-590).
- [x] Storybook: the Components/PeriodPicker "Open" story still draws the old period list through the options fallback (period-picker.tsx:127). Point it at the shared sheet or drop it.
- **Acceptance:** shots at 320, 390 and 375x667, light and dark; design lead sign-off.
