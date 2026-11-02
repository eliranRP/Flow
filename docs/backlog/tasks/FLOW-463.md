<a id="flow-463"></a>
# FLOW-463 · The land from the books: count the legs filed to the property
- **Type:** SQL · **Status:** claimed (dev lane, 2026-11-02, claude/compassionate-curie-mfpavd) · **Depends on:** [FLOW-461](FLOW-461.md) · **Source:** the production check after FLOW-461 shipped: no property got a land suggestion, though the land account holds a posting for each one. A journal entry files each leg to its property without the by-hand flag and leaves the line's project empty, and `private.project_account_balance` only took a leg's project when the flag was set.
- [ ] A property's postings to an account are its legs (`legs.project_id`), as the account's lines in the books show them, so the land suggestion and the account drill-down agree.
- **Acceptance:** pgTAP with journal legs filed to the property; the land suggestion shows on the real rentals after the deploy.
