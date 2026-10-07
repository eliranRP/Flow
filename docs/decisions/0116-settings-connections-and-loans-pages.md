# Settings opens two pages: Connections and Loans

**Date:** 2026-10-07
**Status:** Accepted

## Context

[0082](0082-settings-redesign.md) §1 made הגדרות one screen, and rejected a second settings route. Since then the screen grew: חיבורים has four connectors (SUMIT, Mercury, תיוג חכם (Jev), עוזר AI), and the loans section (balances and הלוואה חדשה) sits between תצוגה and עוד. FLOW-110 adds a loan detail page, reorder, edit and delete, and FLOW-106 adds loan types. A loan list with detail pages does not fit inside a settings section. A viewer could not see loans at all (U10).

The FLOW-501 plan compared three layouts against tap counts from Home: (A) two rows in Settings that open two pages, (B) the הגדרות tab becomes "עוד" with Settings one level down, and (C) a connectors row on Home with loans under Projects. The owner approved option A on 2026-10-07.

## Decision

This supersedes 0082 §1's "one screen" and its rejection of a second settings route. 0082 §2–§8 still hold for the rows and sheets themselves; only their host screen moves.

1. Settings, in order: the account rows ([0108](0108-rename-company-row.md)); one group with no section head, holding חיבורים and הלוואות; תצוגה; עוד; the footer. With no company, הלוואות and תצוגה are hidden.
2. חיבורים (`PlugIcon`) opens `/settings/connections`. Its hint is "N מתוך M פעילים". One connector that needs reconnecting turns the row warning with the alert icon and "<name>: צריך לחבר מחדש"; two or more say "N חיבורים צריכים חיבור מחדש". A viewer cannot reconnect, so an expired connector counts as off for a viewer. While a status loads the hint is a skeleton; a failed read says "לא הצלחנו לטעון" with no retry, because the retry lives on the page. The hint reads the same queries the page uses.
3. הלוואות (`LoanIcon`) opens `/settings/loans`. Its hint is the count ("N הלוואות", "הלוואה אחת", "אין הלוואות עדיין"), never a total balance: mixed currencies have no honest total, and Settings stays figure-free.
4. Both pages are template A with the tab bar; `tabSection` keeps הגדרות current for `/settings/*`. Each has the kicker הגדרות and Back to `/settings`. Back from a page puts focus on the row that opened it. An open sheet closes first on Back (sheet history, [0075](0075-save-on-tap-and-on-leave.md)).
5. Connections: "ספרים ובנק" holds SUMIT and Mercury; "עזרים" holds תיוג חכם (Jev) and עוזר AI. Each row is the shared `ConnectorRow` (`app/src/ui/connector-row.tsx`) with its one-word status and one sheet, unchanged. The page stays open with no company, so SUMIT and Mercury can offer פרטי העסק (0082 Q-C3-2). `?sheet=sumit|mercury|assistant` opens that sheet once. The old `/settings?sheet=…` links redirect with `replace` to the Connections page with the same query. `safe-return.ts` accepts `/settings/connections?sheet=sumit` and still accepts the old path, which then redirects. Onboarding from the SUMIT sheet returns to the new path.
6. Loans: the balances (name, hint, and the balance with small cents, ".00" included) and then הלוואה חדשה. A row tap opens the project sheet (FLOW-119) until FLOW-110 replaces it with `/settings/loans/:id`, which this route shape leaves free. Loading is two skeleton rows; an error is the error layout "לא הצלחנו לטעון את ההלוואות" with ניסיון חוזר and no new-loan action; the empty state is "אין הלוואות עדיין" with one primary הלוואה חדשה. With no company the page redirects to `/settings`, like Categories.
7. Viewers (DESIGN-RULES §2.8) open both rows. Connections shows static rows with no chevrons. Loans shows the balances as static rows, with no chevron and no הלוואה חדשה; its empty state says "כשיתווספו הלוואות הן יופיעו כאן." with no button. This closes U10.
8. The tab bar and Home do not change. No MCP tool is added: this is a layout move, and every action on these pages already has a tool or is app-only by design ([0095](0095-mcp-first.md), [0080](0080-mcp-connector.md)).

## Alternatives rejected

- B, the הגדרות tab becomes "עוד": categories and the overhead switch go from 2 taps to 3, the owner loses a tab label he knows, and it changes DESIGN-RULES §2.8 and 0082 for no gain on loans or connectors.
- C, a connectors row on Home and loans under Projects: it adds a permanent row to Home's figure budget, gives connectors two entry points, and pushes the Projects list down.
- A section head (for example "ניהול") over the two rows: it would only repeat the row titles. Revisit if a third page joins.
- Opening a broken connector's sheet straight from the Settings row: not in the first PR. The row already names it; a direct `?sheet=` jump is cheap later.

## Consequences

No migration and no MCP change. DESIGN-RULES §4 gains 14a Connections and 14b Loans; [CONTROLS.md](../qa/CONTROLS.md) gains the two Settings rows and the Back on both pages, and the moved connector and loan rows are re-pointed to their page. Connecting or fixing a connector goes from 2 taps to 3, which the row hint offsets. A broken connector on Home's attention card is a later task.
