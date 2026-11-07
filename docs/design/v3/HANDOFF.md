# Flow v3: design handoff for the dev team (2026-11-05)

Everything the dev team needs to build v3 from the approved canvas. Read this file first, then [BUILD-PLAN.md](BUILD-PLAN.md) (the order, the PRs, the shared parts' contract), then open the canvas.

- **Canvas:** https://claude.ai/artifact/Rq2HmKi3E9WEQCFe9eXuyt (private: the owner shares it from its Share menu).
  - **Ready for dev:** 47 approved screens, with notes for order, interactions and tokens next to each area. Press **Play** on any board to tap through.
  - **In review:** the screen map.
- **Approved by the owner:** 2026-11-05, area by area (Home and what it opens, Projects, Reports, Loans, project entries and investor pages).
- **Reviewed against:** the UX rules skill (`.claude/skills/ux-ui-design-review-rules/`, 142 rules), and Flow's tokens in `design/system/implementation-tokens.css`. A script checked every colour, type size, weight, radius, duration and easing in the boards. No off-token values remain.

## 1. The one rule: change composition, not components

The owner liked v2's look and asked to keep it. v3 rearranges today's components into five repeated screen patterns, so every screen feels familiar.

- **Use the existing components:** `TopBand`, `HomeMonthPill`, `HomeSwipeFigures`, `ForecastRow`, `HomeCompactBar`, `ListRow`, `SegmentedControl`, `Chip`, `Banner`, `Sheet` (Vaul), `Button`, `FailureLine`, and the skeletons.
- **Where the boards differ:** the boards are HTML mockups with inline values. Where a value differs from today's component, the component wins. Do not restyle the band or the rows.
- **Copy:** take it from the boards. It is short, gender-neutral Hebrew, with amounts wrapped in `<bdi dir="ltr">` and U+2212 for minus.
- **Sample data:** invented. Never copy it into fixtures as real data.

## 2. The five patterns

| # | Pattern | Anatomy, top to bottom | Screens |
| --- | --- | --- | --- |
| 1 | **Overview** | Band (period pill with arrows, big figure, two supporting rows, optional forecast row), then "דורש טיפול" row-cards, then a segmented control, then groups with sticky heads | Home, Projects, project page, project profit, Reports (each report), Loans, loan page, loans summary, investment |
| 2 | **List** | Back link, page title (32/600), summary line, figure (40), segmented control or chips, then 64px rows in groups with sticky heads | Month lines, Recurring, Charges changed, Unpaid, Transfers, Search, Loan payments, Lines with no project |
| 3 | **Detail** | Back link, status line (14/500, coloured), name (24/600), figure (40), meta line, fact card, related list, one primary action pinned at the bottom | Transaction, Recurring charge, Invoice, Review queue item, Calculation pages |
| 4 | **Sheet** | Scrim at 50%, top radius 24, 40×4 grab handle, title (20/600), fields or options, one 52px primary button | Add, New project, New loan, Month drawer, Company switcher, Project menu, Budget edit, Close loan, Assign project, Investment inputs |
| 5 | **Hub** | Page title, then one card per destination with its headline figure, a decorative mini chart and two facts | Reports tab only |

### Behaviours shared by every pattern

- **Compact bar (Overview and List):**
  - The band's figures fade over the first 140px of scroll.
  - At 120px the compact bar slides in from the top (`transform`, 280ms, `--ease-enter`). It shows the screen name and the figure, with a back arrow on inner screens.
  - Overview bars are violet (the band colour). List bars use the surface colour.
- **Docking filter:**
  - When the in-page segmented control reaches the compact bar, the bar grows by 60px to hold it (280ms), and the in-page copy fades out (160ms).
  - The selected pill slides between options (`transform`, 280ms).
  - On the band, the selected pill is white with violet text.
  - Picking an option while docked scrolls the list top under the bar.
- **Sticky group heads:**
  - Heads stick under the compact bar with a 1px `--color-line` under them. The next head pushes the previous one out.
  - The sticky offset follows the bar: 0, 64px, or 124px when docked under Home's band bar. Under the 44px list bar of a List screen it is 44px, or 104px when docked; under the 56px detail bar 56px, or 116px (the component's bars win over the boards' 56px).
- **Dismissable row-cards ("דורש טיפול"):**
  - 56px tall, surface fill with a line border, radius 16 (`--radius-card-tight`), icon or dot, one-line title, chevron, and a 44px X with `aria-label="הסתרה: <title>"`.
  - The X slides the card 24px toward it, then folds it: `max-height` 220ms `--ease-exit`, opacity 160ms.
  - "N הוסתרו · הצגה" restores. When every card is hidden, the section folds to one line, "אין מה לטפל · הכול נסקר", with הצגת הכול (FLOW-1102: brings back every card; ביטול is only the toast's).
  - A hidden card stays hidden on this device until its content changes. Key it by row kind plus what it counts. Keep it in localStorage, with every read and write in try/catch.
- **Status marks on rows:** the same three marks on every list. Shape tells them apart, not colour alone.
  - **Dashed ring:** due or expected. It uses the signal colour when late.
  - **Check on tint:** paid or arrived.
  - **6px dot:** one-off.
- **Toasts:**
  - Bottom 100px (32px on screens without the tab bar), raised fill, radius 14 (`--radius-toast`), and a 4 s life on the boards; the component's 5 s with an action stays ([BUILD-PLAN §5](BUILD-PLAN.md#5-decisions-already-made-so-no-lane-asks)).
  - Every reversible action shows ביטול: approve, mark paid, assign, finish project, close loan, dismiss.
  - Destructive actions use undo, not "are you sure?". The exceptions are finishing a project and closing a loan, which confirm inside their sheet because they move the item to another list.
- **Forms:**
  - Save is never disabled. Tapping it with a required field missing shows a red border and one line under the field saying what to fill, with `role="alert"`.
  - Labels sit above the fields. Inputs are 16px or larger.
- **Press feedback:** scale 0.97 over 120ms (`--motion-press`) on every tappable element.
- **Reduced motion:** with `prefers-reduced-motion`, every transition and animation drops to 1ms (`--dur-reduced`).
- **List entrance:** rows rise 8px and fade in over 280ms, staggered 40ms apart (`--motion-stagger`) for the first 8 rows.

## 3. Screens, routes and what each tap opens

Board names are the canvas file names. The routes are today's routes. "New" means the screen or sheet has no route today.

### Home and what it opens

| Board | Pattern | Route | Opens |
| --- | --- | --- | --- |
| `V3-Home` (+ `V3-Home-Light`) | Overview | `/` | Company name → `V3-Company` · + → `V3-Add` · search → `V3-Search` · recurring icon → `V3-Recurring` · avatar → `V3-Settings` · month pill and forecast-row arrow → month drawer (in place) · next-month arrow → drawer on next month with its forecast · נכנס/יצא → `V3-Lines` · forecast row → `V3-Forecast` · attention rows → `V3-Changes`, `V3-Charge`, `V3-Unpaid` · due and paid recurring rows → `V3-Charge` · one-off rows → `V3-Transaction` |
| `V3-Forecast` | Overview-lite | `/forecast` | Rows → `V3-Charge` |
| `V3-Lines` | List | `/cash/:month/:side/:currency` | Rows → `V3-Transaction`. Order chips: by date, recurring or one-off (new), project, category |
| `V3-Recurring` | List | `/recurring` | Late row-cards (dismissable) · rows → `V3-Charge` |
| `V3-Changes` | List | `/recurring/changes` | Rows → `V3-Charge` · X marks a change as seen |
| `V3-Charge` | Detail | `/recurring/:direction/:partyId` | "Maybe it came under another name?": yes, no, or ignore this month, each with undo · facts → edit · history → `V3-Transaction` |
| `V3-Transaction` | Detail | `/transactions/:transactionId` | Pinned אישור / שינוי bar · approve shows a toast with undo |
| `V3-Unpaid` | List | `/unpaid` | Check button marks paid (undo) · rows → `V3-Invoice` |
| `V3-Invoice` | Detail | `/unpaid/:invoiceId` | Pinned "סימון כשולם" (undo) |
| `V3-Review` | Detail queue | `/review` | One item at a time, a progress bar of 3, the card slides out on אישור or דלג, then a "הכול אושר" end state |
| `V3-Transfers` | List | `/transfers` | Pair cards with "כן, העברה" or "לא, צירוף מקרים", toast with undo |
| `V3-Add` | Sheet | `/add` | Amount first, then grouped rows (who, when, method, project) |
| `V3-Search` | List | `/search` | Idle shows "שווה לבדוק" and recent searches · typing shows grouped results · zero results never a dead end |
| `V3-Settings` | Settings | `/settings` | Grouped rows with live hints · מראה opens a sheet that switches the theme live |
| `V3-Company` | Sheet | (sheet over the band) | Radio dot animates, the band figure cross-fades, the sheet closes |

### Projects

| Board | Pattern | Route | Opens |
| --- | --- | --- | --- |
| `V3-Projects` | Overview | `/projects` | + → `V3-NewProject` · attention → `V3-Unassigned`, project page, `V3-Charge` · rows → project page by type |
| `V3-Project` / `-Rent` / `-Client` | Overview | `/projects/:projectId` | "⋯" → actions sheet (edit details, investment, profit since start, finish with confirm and undo) · budget or contract "עריכה" → amount sheet · rental "פירוט" → investment · "דוחות" → P&L by project · "השקעה והלוואות" → `V3-Investment(-Rent)` · "רווח מתחילת הפרויקט" → `V3-ProjectProfit*` · rows → `V3-Charge` or `V3-Transaction` |
| `V3-ProjectProfit` / `-Flip` / `-Client` | Overview | `/projects/:projectId/profit` | By month or by category · rows → lines · on a renovation, a line explains that renovation is not in monthly profit |
| `V3-Unassigned` | List | **New** (today: link from the projects list) | "שיוך" → project sheet with a suggested project → row folds, toast with undo |
| `V3-NewProject` | Sheet | Existing new-project sheet | Fields change with the type: renovation (purchase, budget, ARV), rental (purchase, rent), client (contract), overhead (none) |
| `V3-Investment` / `-Rent` | Overview | `/projects/:projectId/investment` | "איך מחושב" sheet · "חסר לחישוב" cards open input sheets · breakdown parts → calculation pages · tabs נכס / מדדים / הלוואות · loans → loan page |
| `V3-Calc` / `-Coc` / `-Cap` / `-Rehab` | Detail | `/projects/:projectId/investment/:section` | ⓘ → "מה זה" sheet · + − = rows → their source · transactions by month |

### Reports

The owner's rule: there are only two reports, profit and loss and the balance sheet. Every other view is a breakdown of one of them.

| Board | Pattern | Route | Opens |
| --- | --- | --- | --- |
| `V3-Reports` | Hub | `/reports` | P&L card, balance-sheet card, and three shortcuts: P&L by project, P&L by month, balance sheet by project |
| `V3-Report` (+ `-PLProj`, `-PLMonth`) | Overview | `/reports` (P&L) | Views: category, project, month · **a project or month row drills into its own P&L on the same screen** (band changes to that project or month, list split into income and expense categories, "‹ לפי פרויקט" back) · totals add up to the row tapped |
| `V3-Report-BS` (+ `-BSProj`) | Overview | `/reports` (balance sheet) | Views: assets, liabilities and equity, project · a property row drills into its own assets and liabilities |

### Loans

| Board | Pattern | Route | Opens |
| --- | --- | --- | --- |
| `V3-Loans` | Overview | `/loans` | Band → `V3-LoansSummary` · + → `V3-NewLoan` · rows → loan page by type |
| `V3-Loan` / `-Bridge` / `-Partner` / `-Note` | Overview | `/loans/:loanId` | "התשלום הבא" and "כל התשלומים" → `V3-LoanPayments` · paid card (since start or 2026) · project → project page · "⋯" or "סגירת ההלוואה" → close sheet (how it closed, amount, undo) · the Jev-found note opens with a "הפרטים נכונים" / עריכה card |
| `V3-LoanPayments` | List | `/loans/:loanId/payments` | Paid or upcoming · rows → transaction |
| `V3-LoansSummary` | Overview | `/loans/summary` | Since start or 2026 · what payments were made of · per loan |
| `V3-NewLoan` | Sheet | Existing loan setup | Fields change with the type: amortising, interest only, on demand |

### Shared

| Board | What |
| --- | --- |
| `C-Nav` | The tab bar. Every board imports it, so tabs work across the prototype |
| `V3-States` | Loading skeleton, failed band with retry, offline line, empty list, and long-content stress rows, for all patterns |

## 4. What Home loses and gains

- **Leaves Home:**
  - "ממה מורכב התזרים" (the split card). Profit stays in דוחות.
  - The next-month card. Next month moves to the month drawer, opened by the pill's next arrow.
  - The reports card on Home. The Reports tab stays.
- **New on Home:**
  - "תנועות החודש": the הכול / קבועים / נותר לשלם filter with three groups. **נותר לשלם** holds due and late recurring charges. **קבועים ששולמו** holds arrived ones. **חד-פעמי** holds the month's lines that are not recurring.
  - Attention rows as dismissable row-cards.

## 5. Data the build needs

| Need | Status |
| --- | --- |
| Each `cash_month_lines` row says whether it belongs to a recurring charge (`recurring boolean`), using the schedule's party, merge and project matching | **New.** Task [FLOW-1035](../../backlog/tasks/FLOW-1035.md), wave A of the build plan. Home's one-off group depends on it |
| Recurring schedule states (arrived, late, soon, later) and amounts | Exists (`recurring_schedule`) |
| Dismissal of attention rows | Client only (localStorage), keyed by kind plus content |
| Next month's forecast in the month drawer | Exists (the next-month card's read) |
| P&L by project and by month, with each row's category split for the drill-down | Check the report queries. The category split per project or month may need a filter on the existing report reads |
| Balance sheet by project (value, loans, accumulated depreciation per property) | **Likely new.** Property value and loans exist on the investment page. Confirm a per-project equity read |
| Loan payment splits (principal, interest, escrow) and next payment | Exists |
| Property returns and calculation sections | Exists (`/projects/:projectId/investment/:section`) |
| Project profit with the general-expenses share | Exists (project profit screen) |

## 6. Motion and tokens

| What | Value | Token |
| --- | --- | --- |
| Press | scale 0.97, 120ms | `--motion-press` |
| Sheet in / out | 280ms `--ease-enter` / 220ms `--ease-exit` | `--motion-sheet-in`, `--motion-sheet-out` |
| Scrim | 50% black, fade in with the sheet | `--motion-scrim` |
| Compact bar, docking, segment pill | 280ms `--ease-enter` | `--motion-page` |
| Fades (copy, toast out) | 160ms | `--motion-toast-out` |
| Card fold on dismiss | 220ms `--ease-exit` | `--motion-sheet-out` |
| Bars that grow (budget, paid, parts) | 480ms `--ease-enter` | `--motion-bar-grow` |
| Row entrance stagger | 40ms, first 8 rows | `--motion-stagger` |
| Skeleton pulse | 1.2s | `--motion-pulse` |
| Toast life | 4 s, with undo | n/a |

Animate only `transform` and `opacity`, plus `max-height` for the dismiss fold. Everything respects reduced motion.

Type roles used: band 52/500, detail 40/400, title 32/600, card figure 28, name 24/600, sheet and section 20, body 17, button 17/500 and 16/500, line2 15, meta and chip 14, caption 13. The radii, colours and spacing come from `implementation-tokens.css`, the 20px side margin included.

## 7. Accessibility checklist (per screen)

- Every tap target is 44px or more. Chips are 36px visually with a 44px hit area (`ui-chip`). Segments are 40px in a 48px track.
- Icon-only buttons have `aria-label`. Decorative SVG and mini charts are `aria-hidden`, with the figure written next to them.
- Segmented controls are `role="radiogroup"`, with `role="radio"` and `aria-checked` on each option.
- Sheets are `role="dialog"` with a label. Focus moves into the sheet and returns on close (Vaul).
- Attention sections and toasts are live regions. Field errors use `role="alert"`.
- Amounts sit in `<bdi dir="ltr">`. Status is never shown by colour alone: shape plus text.
- Contrast is 4.5:1 for text and 3:1 for controls, in both themes.

## 8. Out of scope for v3 (owner, 2026-11-05)

Settings sub-pages (Business, Connections, Notifications, Team, Categories), setup and onboarding, sign-in, help and legal, install, and the transaction tools (split, journal composer, next-month edit) keep their v2 design.

## 9. How to build it

1. **The tasks are filed** ([BUILD-PLAN §2](BUILD-PLAN.md#2-order-and-waves)): FLOW-1035 and FLOW-1036 for Home, FLOW-1043 for the shared parts, FLOW-1044 to FLOW-1049 for Projects, Reports, Loans, the investor pages and the screens under Home. The build plan supersedes the earlier draft PRs that carried the handoff and the two Home tasks.
2. **Each lane claims its task** with a draft PR and builds it on the shared parts.
3. **Build in this order:**
   1. The shared behaviours: the compact bar with a docking segment, sticky heads, dismissable row-cards, and the toast with undo. Build them once as components, since every screen reuses them.
   2. Home.
   3. Projects, Reports and Loans, in parallel lanes. They touch different files.
4. **For each PR:**
   - Write stories for every state on `V3-States`.
   - Shoot the stories at 320 and 393px, dark and light.
   - Add a design log entry citing this file and the canvas board.
