<a id="flow-461"></a>
# FLOW-461 · שווי הקרקע from the books
- **Type:** SQL + MCP + UI · **Status:** claimed (dev lane, 2026-11-02, claude/compassionate-curie-mfpavd) · **Depends on:** [FLOW-454](FLOW-454.md) · **Source:** the owner, 2026-11-02, on the land row of a rental's investment page: "Do we have this in the books categories already? If so let's add the number or suggest the user a transaction match to this field." The books already split each purchase into land and building, on a land asset account posted per property.
- [ ] The company names its land account once (`set_land_account`, MCP `set_land_account`, undo kind `land_account`); every property then reads its land from its own postings to that account. A typed land still wins (decision 0248).
- [ ] With no account named, `get_property_returns` suggests one: an asset account whose name says land (קרקע or land, not improvements) with a balance on the property. The land row shows it as one tap: "מהספרים: <account> · $X · השתמש".
- [ ] A land from the books says so under the figure ("מהספרים"), and opens the account's lines for the property.
- **Acceptance:** pgTAP for typed, books, suggestion, the owner check and the MCP write and undo; Deno tests for the tool; the guard tests; stories at 320 and 393, light and dark; design log entry.
