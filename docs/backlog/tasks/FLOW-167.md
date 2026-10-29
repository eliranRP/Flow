<a id="flow-167"></a>
# FLOW-167 · Reports lines search: a long Latin description is cut at its start
- **Type:** BUG · **Status:** claimed (dev lane, 2026-10-29, flow-167-row-hints) · **Depends on:** [FLOW-161](FLOW-161.md) · **Source:** the review of #863 and the owner, 2026-10-29 (approved to start).

- [ ] On /reports/lines, a line found only by its description shows that description as one hint part. In the right-to-left row a Latin description loses its beginning when cut ("…lacement, unit 2 · 18/10"), so the matched word can be the hidden part; Hebrew is cut at its end.
- [ ] The fix keeps the matched word in view: the description moves to the row's title (a Latin title already runs left to right and is cut at its end) and the supplier to the hint.
- [ ] A story checks at 320 px that the matched word is in view, for a Latin and a Hebrew description.
