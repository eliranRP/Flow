<a id="flow-165"></a>
# FLOW-165 · Reports: open a balance-sheet account's movements
- **Type:** MCP + UI (design approved) · **Status:** ready · **Depends on:** [FLOW-161](FLOW-161.md) · **Source:** the approved reports design (board ReportAccountDrill), 2026-10-28; left out of #855 because no read returns an account's lines.

- [ ] A read (database and MCP `get_account_lines`): one account's legs up to a date, per project, with the opening balance and each movement (line, date, party, amount), paged; another company's account is `not_found`.
- [ ] The balance sheet's account rows open it: the balance, the year's opening balance, the movements by month, each opening the transaction page; a loan's principal links its loan page.
