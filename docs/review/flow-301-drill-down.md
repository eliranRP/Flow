# FLOW-301 · Income and expense drill-down from Home: plan

Status: Eliran approved option A on 2026-10-07. Questions 2 and 3 open (defaults apply to the screen PR).
Draft PR (planning claim): https://github.com/eliranRP/Flow/pull/85
Mockups (Claude Design canvas): https://claude.ai/artifact/YK8cfkUhsdZWYdCoyAc5u7

## Why this task

Third UI task in the backlog queue after FLOW-107 and FLOW-113 (taken by sibling threads); FLOW-602's screen is in its own thread.

## The problem

Home shows נכנס and יצא for the period, but they are dead text. To see where the money came from or went, the owner has to open each project, and lines with no project (FLOW-102's unassigned bucket) or overhead lines aren't reachable from Home at all.

## Options

| | What | For | Against |
|---|---|---|---|
| **A (recommended)** | Two levels. Tap נכנס/יצא opens a screen with the period total and grouped rows (default by category; a 3-way segmented control: קטגוריה · פרויקט · ספק/לקוח). Tap a group opens its lines (same row as the project category screen), tap a line opens the transaction. | Calm: few numbers per screen, detail on the next one (design principles). Reuses ProjectCategories + ProjectCategoryScreen rows. Scales to "all time" with hundreds of lines. | One more tap to see a line. |
| B | One screen: sticky group headers with each group's total, every line listed under its header, paging. | Every line one tap away; easy to scan a short month. | Long and dense for year-to-date and all time; sticky headers plus paging is heavier to build; overlaps FLOW-302's month dividers. |
| C | A bottom sheet over Home with the group totals only; tap a group opens its lines screen. | Lightest; Home stays in view. | A sheet holding a grouped list and a switch breaks guide §3.3 (sheets are for 1–3 inputs or short choices); period can't change inside it. |

## Option A in detail

- **Entry:** נכנס and יצא on Home become links (each a whole block covering every currency, ≥44px, pressed tint, chevron pointing left). The ChangePill note stays outside the link. Accessible name: "יצא החודש ₪x – פירוט", reading every currency.
- **Screen header:** title "נכנס" or "יצא", back to Home, the period pill in its tint (non-band) style. Home already keeps one in-memory period (`BooksProvider`), so changing it here changes Home too. A custom range shows as dates (01–30/09).
- **Total:** in the header, not a band (the band is Home and Project only). Same figure Home shows, per currency.
- **Group switch:** segmented control קטגוריה · פרויקט · ספק (expenses) / לקוח (income), group label "לפי". Default קטגוריה; the last choice is remembered on the device.
- **Group rows:** name, line count hint ("12 תנועות", or "12 תנועות · כולל חלק משותף"), amount (expenses with a minus, `$` for USD), chevron. Sorted by amount, largest first, held in place while open (`useHeldOrder`). Every currency's rows open their lines (today's project rows don't for USD; fixed here). A blank supplier or customer groups as "בלי ספק" / "בלי לקוח". Multi-currency: ILS groups first, then each currency, like the project screen.
- **Special rows:** under פרויקט, "בלי פרויקט" (unassigned) and the overhead project as their own groups. Decision 0101 says Home doesn't show these yet, so this needs your OK (question 2). Shared costs show by the project's share. Figures are stored ones; the after-overhead switch doesn't change them (same as the hero, 0032).
- **"לא נכלל בסכום" section:** a quiet section under the list. "מחוץ לרווח" (kept-out categories, 0099) opens those lines; "N ממתינים לאישור" opens Review. Neither adds to the total.
- **Rounding:** group rows are whole shekels, so they can miss the total by ₪1. Rule: the total is exact and rows round independently (question 3).
- **Group lines screen:** title = group name, subtitle "נכנס · החודש · 6 תנועות", the group total; rows: source icon, name, the other grouping plus date ("מגדל הים · 05/10"), amount (+ for income, − for expenses); "עוד תנועות" paging; tap opens the transaction.
- **States:** skeleton while loading, empty ("אין הוצאות בתקופה הזו" / "אפשר לבחור תקופה אחרת." with a "בחירת תקופה" button), error with retry, offline with cached data. Light and dark, 320 and 390px.

## Data and MCP

- New read RPC `public.flow_breakdown(p_company_id, p_direction, p_from, p_to, p_group_by, p_basis)` reading `private.pnl_lines`, so totals match `company_pnl` by construction (loan split parts, kept-out, overhead project, unassigned all follow the same rules). Returns groups `{key, name, currency, amount_minor, count}`, plus `excluded` and `pending` buckets.
- New read RPC `public.flow_lines(..., p_group_key, p_limit, p_offset)` for one group's lines.
- MCP: one read tool `get_breakdown` (`direction`, `from`, `to`, `group_by` = category | project | payer, optional `group` to list lines, limit/offset). Read annotations, no undo.

## Smallest PRs

1. Server: both RPCs, MCP tool, TOOLS.md, pgTAP (group totals sum to `company_pnl` on both bases, ILS and USD; loan parts by part; kept-out only in `excluded`; cross-tenant refusal with a positive control), decision, changelog.
2. Screens: Home rows become tappable, breakdown screen, group lines screen, stories (light/dark, 320/390, empty/loading/error, long Hebrew names, USD), CONTROLS.md rows, design review.

## Design review

The design reviewer recommends A and its fixes are folded in above (tint pill, total in the header, every currency opens, "לא נכלל בסכום" section, wording, empty state with a button, held order, blank-name fallback, basis follows Home's).

## Questions for Eliran

1. Option A (recommended), B or C?
2. Show "בלי פרויקט" and the overhead project as groups here (recommended: yes)? Decision 0101 left them off Home for now.
3. Rows round to whole shekels and may miss the total by ₪1. OK (recommended), or show agorot on this screen?
