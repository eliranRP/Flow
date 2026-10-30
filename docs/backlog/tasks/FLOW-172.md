<a id="flow-172"></a>
# FLOW-172 · List rows: a cut hint part can end in a space before "…"
- **Type:** BACKLOG NIT · **Status:** in-progress (#873) · **Depends on:** [FLOW-168](FLOW-168.md) · **Source:** the review of #865 (nit N6), moved out of FLOW-170 in the review of #868. For the design lead.

- [x] At 320 a supplier cut in a transaction row's one-line hint can read "Quick …": the cut falls after a space, so a gap shows before the "…" (the reports drill-down, /reports/lines). CSS has no way to trim whitespace before `text-overflow: ellipsis`. Trimming it means measuring each cut hint part in script (the shared `app/src/ui/list-row.tsx` hint parts), which FLOW-168 chose not to do. Decide whether the look is worth that cost; if so, cut the part's text at its last word boundary that fits, or trim the trailing space of the drawn text.

Decided: the owner chose to fix it in code on 2026-10-30 ([log](../../design/log/2026-10-30-flow-172.md#7-flow-172-no-space-before-a-cut-parts-)). Built in #873: `HintText` (`app/src/ui/hint-cut.tsx`, measuring in `hint-cut-measure.ts`) draws an overflowing part's cut at the last letter that fits.
