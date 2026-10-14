<a id="flow-373"></a>
# FLOW-373 · Expected (כ־) income figures get the "+"
- **Type:** BACKLOG NIT · **Status:** ready · **Depends on:** [FLOW-363](FLOW-363.md) (2c, the "+" on income) · **Source:** code review of FLOW-363 (2c), 2026-10-12.
- [ ] `app/src/ui/approx-amount.tsx` (~line 24) and `app/src/ui/missing-bill-list.tsx` (~line 248) draw expected income green with no "+". Decision 0181: income gets "+" everywhere it is drawn as money in. Give both the "+" inside the `bdi`, keep zero unsigned, and update their tests and stories.
- **Acceptance:** a unit test per component that expected income reads "כ־+₪…" (or the agreed order) inside `bdi[dir=ltr]`; design review of the two stories.
