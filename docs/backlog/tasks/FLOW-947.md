<a id="flow-947"></a>
# FLOW-947 · Gross-up contra effect: a gross-up part on either kind, nets its own category
- **Type:** FEATURE · **Status:** in-progress (feat/gross-up-contra, 2026-10-22, feat/gross-up-contra) · **Source:** the owner-approved design; decision [0207](../../decisions/0207-gross-up-contra-effect.md). Extends FLOW-946 / [0206](../../decisions/0206-gross-up-split-parts.md).
- **Files:** `supabase/migrations/20261022093629_gross_up_contra_effect.sql` (new), `supabase/migrations.lock`, `supabase/tests/database/gross_up_contra.test.sql` (new), `gross_up_split_parts.test.sql` (same-kind rejection dropped); `supabase/functions/flow-mcp/tools_schemas.ts`, `tools_write.ts`, `tools_specs.ts`, `tools_gross_up_test.ts`, `tools_writes_test.ts`; `app/src/line-split.ts`, `line-split-preview.ts`, `line-split-copy.ts`, `line-split.test.ts`, `use-company-profit.test.ts`, `app/src/screens/line-split-editor.tsx`; `docs/decisions/0207-gross-up-contra-effect.md` (new), `docs/decisions/README.md`, `docs/mcp/TOOLS.md`, `docs/changelog.d/2026-10-22-gross-up-contra-effect.md` (new).

**Server (one migration)**
- [x] `save_line_split`: drop the same-kind rejection (any kind is now allowed); keep the project-required, exact-amount and signed-sum rules; accept an optional per-part `effect` validated against the derived value.
- [x] `private.pnl_lines` line-split branch: derive a gross-up part's P&L sign from (category kind vs line direction): opposite kind = normal (byte-identical to 0206), same kind = contra (flip the sign). Non-gross-up path byte-identical; `cash_parts`/`breakdown_rows` carry it unchanged.
- [x] `get_line_split` reports a derived `effect` per gross-up part; `private.mcp_refused` drops `category kind must match the part sign`. No stored column, so undo/round-trip untouched.

**MCP (0095)**
- [x] `split_line`/`assign_expenses` accept and forward `effect`; the spec and `TOOLS.md` document it, any-kind, and that `category_kind_mismatch` no longer fires for gross-up; `get_expense` returns `effect`.

**App**
- [x] The parts editor lets a gross-up row pick either kind (the same-kind grossUp mark is kept, not cleared); the `gross-up wrong side` client block and copy are removed; the P&L drill-down shows the "paid from deposit" tag on a contra part (gross_up already flows through).

**Acceptance:** pgTAP `gross_up_contra` (a payment expense-contra nets a category to a credit, Other income 0, company net unchanged vs the two-sided version; a deposit income-contra lowers income; income-on-"+" and expense-on-"−" stay normal; `effect` derivation and an explicit mismatch refused; cash == invoiced in ILS and USD; undo restores; project still required; gross_up+percent/rest refused; company isolation); the existing line_split/mcp_split and the pinned speed pgTAP stay green; Deno (schema accepts `effect`, rejects gross_up+percent/rest, `get_expense` returns `effect`, `assign_expenses` forwards it); app vitest (editor either kind, buildPayload emits `effect`/`gross_up`, signed remaining hits 0, drill-down tag, the old wrong-side rejection gone).
