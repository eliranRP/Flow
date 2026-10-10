<a id="flow-707"></a>
# FLOW-707 · The card's nickname from the bank, on the transaction and for Jev
- **Type:** SMALL UI · **Status:** in-progress · **Depends on:** — · **Source:** owner request 2026-10-10
- **What:** Mercury lets the owner name each card (a card per property's utilities, a general card). Bank sync keeps only the last 4. Read each card's nickname from Mercury's Cards API during sync, store it on the line's bank details (`card_name`), show it next to "כרטיס ••1234" under פרטי הבנק, return it from `get_line_meta` and MCP `get_expense`, and send it to Jev as a signal for the category and the project. The same for the bank account: its Mercury nickname becomes its label (the חשבון row), and Jev gets it as `account_name`.
- **Acceptance:** a sync test stores the nickname for a card line and nothing for a card without one; the transaction screen story shows "כרטיס ••1234 · <nickname>"; the Jev prompt carries the card name; design lead sign-off.
