<a id="flow-466"></a>
# FLOW-466 · Newly let rentals: total return, tax savings and appreciation; what a loan paid at closing
- **Type:** SQL + MCP + UI · **Status:** claimed (dev lane, 2026-11-03, claude/compassionate-curie-mfpavd) · **Depends on:** [FLOW-464](FLOW-464.md) · **Source:** the owner, 2026-11-03: "analyze the other metrics so we do not have this behavior when a property is less than 12 months" ("Fix all three"), and on Wickliff's purchase price, $300,375 on the property against $76,925 on its page: "Why this is a different number?" ("Add a field per loan").
- [ ] The total return scales from a first rent inside the period; tax savings run from the first rent; appreciation runs from the first value in the period and waits for a second (decision 0250).
- [ ] Each loan has "סכום ששולם בסגירה" (from the settlement statement; the whole loan by default), set in the app and with MCP `set_loan_closing_paid` (undo `loan_closing_paid`). The price counts it.
- [ ] The "רכישה וסגירה" page shows the calculation when a loan paid at closing: bank lines + loan at closing = purchase price.
- **Acceptance:** pgTAP for the total, the tax savings, appreciation from the first value, the closing amount, its owner check and its MCP write and undo; Deno tests; guard tests; app tests and stories; design log.
