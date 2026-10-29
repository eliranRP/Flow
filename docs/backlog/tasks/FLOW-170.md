<a id="flow-170"></a>
# FLOW-170 · Reports drill-down search: a snippet placed by layout, and the balance date sheet's "from the start" caption
- **Type:** BACKLOG NIT · **Status:** in-progress (#868) · **Depends on:** [FLOW-167](FLOW-167.md) · **Source:** the review of #865 (nits N3 to N6); the owner, 2026-10-29 ("why can't I choose all dates? From start"). The owner approved the batch on 2026-10-29 ("Implementing those tasks").

- [x] N3: a description that fits its three-line title with the matched word in it shows whole. The cut is placed by layout, not by a 24-character threshold (FLOW-310): each candidate is laid out and measured before paint (`app/src/screens/report-lines-snippet.tsx`). "Water heater replacement, unit 2" now shows whole at 320 and 393.
- [x] N4: with several words, the whole text first, then a cut before each match from the earliest (two words before it, then at its own word); the first that shows every matched word wins, else the one that shows the most, the earliest of a tie.
- [x] N5: a long description with no spaces is cut after the nearest / , - _ . : ; | before the match, or at the match itself.
- [ ] N6: at 320 a supplier cut in the hint can read "Quick …", a space before the "…". CSS has no way to trim the space before `text-overflow: ellipsis`; doing it would mean measuring every cut hint part in script, which FLOW-168 chose not to. Logged for the design lead (docs/design/log/2026-10-29-flow-169.md); left open.
- [x] The balance sheet's date sheet (נכון לתאריך) says, in one caption under the dates: "המאזן כולל את כל התנועות מההתחלה ועד התאריך שבוחרים", since a balance sheet already sums everything from the start (`BalanceDateSheet`, `app/src/screens/reports-sheets.tsx`).
