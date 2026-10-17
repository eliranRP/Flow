<a id="flow-373"></a>
# FLOW-373 · Expected (כ־) income figures get the "+"
- **Type:** BACKLOG NIT · **Status:** built (branch task/FLOW-373, not pushed) · **Depends on:** [FLOW-363](FLOW-363.md) (2c, the "+" on income) · **Source:** code review of FLOW-363 (2c), 2026-10-12.
- [x] `app/src/ui/approx-amount.tsx` (~line 24) and `app/src/ui/missing-bill-list.tsx` (~line 248; moot: that file was deleted by the FLOW-447 redesign, so only the approx half is done here) draw expected income green with no "+". Decision 0181: income gets "+" everywhere it is drawn as money in. Give both the "+" inside the `bdi`, keep zero unsigned, and update their tests and stories.
- **Acceptance:** a unit test per component that expected income reads "כ־+₪…" (or the agreed order) inside `bdi[dir=ltr]`; design review of the two stories.
