<a id="flow-138"></a>
# FLOW-138 · A paid-off loan's leftover balance has no word
- **Type:** PLAN FIRST · **Status:** owner picked "Hide" (2026-10-09 18:49Z): a paid-off loan shows only נפרעה and its date; a closed loan hides a zero balance. UI lane 4, with FLOW-115 · **Source:** cycle 12 (loans at 320)
- **What:** A loan marked נפרעה still shows a balance ($1,240) beside the word, with nothing saying what the money is (screens/loan-list.tsx:59-61, :103). Either the balance is a leftover the books haven't closed and needs a word, or a paid-off loan should show no balance.
- **Acceptance:** owner's pick on a card.
