<a id="flow-416"></a>
# FLOW-416 · Loan money counts in cash by default
- **Type:** TASK · **Status:** done (#494, decision 0171) · **Depends on:** FLOW-413 · **Source:** owner card, 2026-10-10 08:45Z, relayed by the coordinator and the lane manager
- [x] A new company's loan money category (כסף שהתקבל מהלוואות, or a new "loan proceeds" category) counts in the cash view (תזרים) by default. It stays out of the P&L.
- [x] Existing companies keep their current setting: nothing flips an existing category, so a company whose loan money is out of cash keeps it out until the owner switches it.
- [x] A database test covers the seed and the create default; a changelog fragment and a decision record say what changed.
