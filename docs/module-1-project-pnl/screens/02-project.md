# Project

**Status:** [02-project-v2](../screens.md#02-project-v2) is pending owner approval and supersedes [02-project](../wireframes/02-project.png). The v2 image adds the after-overhead switch and the before / share / after card. Every number on it is example data.
**Numbers:** Project to date, [calculations](../calculations.md). Budget card only when a budget is set ([0014](../../decisions/0014-optional-project-budget.md)).

## Purpose

Answer "is this job making money?" from the first shekel through today, and show which categories the expenses went to.

Overhead opens the same layout. The title is `הוצאות כלליות`. There is no client line, no budget card, and no finish or delete.

## Entry points

| From | How |
| --- | --- |
| Home | Tap a project row or the overhead row. |
| Projects list | Tap a project row. |
| Review or change sheet | After save, the owner can open the project from the transaction that was just filed. The default return is the queue or the upload summary, not this screen. |
| Search on the projects list | A finished project opens here too. |

Back (`›` on the right, because the UI is RTL) returns to the screen that opened the project.

## Where taps go

| Tap | Goes to |
| --- | --- |
| Back | Home or the projects list. |
| `⋯` | Menu: `עריכת שם`, `עריכת לקוח`, `עריכת תקציב`, `סיים פרויקט` or `החזר לפעיל`. Delete appears only when the project has no transactions and no documents (`מחק פרויקט`). |
| A category row | The project's transactions filtered to that category. Same list as recent transactions, filtered. |
| A recent transaction | The change sheet, to move project or category. |
| `הכל` | Full transaction list for this project, newest cash date first. |
| Center `+` | Add sheet. A document or manual entry started here is suggested onto this project, still not auto-approved unless an invoice link or a rule says so. |

## Elements and fields

| Element | Hebrew | Source and format |
| --- | --- | --- |
| Title | Project name | Full name, up to three lines. |
| Subtitle | `לקוח: {name} · מתחילת הפרויקט` | Client is omitted when empty: `מתחילת הפרויקט` only. Finished projects add `· הסתיים`. |
| Income | `הכנסות` | Project-to-date income. Whole shekels, neutral. |
| Expenses | `הוצאות` | Project-to-date expenses. Whole shekels, neutral. |
| Profit | `רווח · {margin}` or `הפסד · {margin}` | [Margin rule](../calculations.md#income-expenses-profit-margin). Green or red. Percent omitted when income is 0. With the after-overhead view on, profit and margin use profit after [overhead share](../calculations.md#overhead-share). Income in that margin is still this project's income. |
| Overhead share | `חלק מהתקורה` | The switch starts off ([0022](../../decisions/0022-after-overhead-starts-off.md)). [02-project-v2](../screens.md#02-project-v2) draws it on and is pending owner approval. The card is shown only while the view is on and allocation is available. The signed share for this project. ₪0 when this project has no income and other projects do. |
| Budget | `הוצאות מול תקציב` | Hidden when budget is unset or 0. `{used} / {budget}`, bar, `{percent} נוצל`. Percent may exceed 100. The word `אופציונלי` is not shown in the product; it was a wireframe note that the card is optional. |
| Categories | `לפי קטגוריה` | The seven expense categories that have a non-zero project-to-date total, in the owner's category order, then any custom expense categories in that order. Zero categories are hidden. Amounts are whole shekels. Bar width is relative to the largest category. |
| Recent | `תנועות אחרונות` | Up to three counting lines, newest first. Source mark: invoice document linked, or bank, or manual. Second line `{category} · {dd/mm}`. Amount is signed cash, detail-display rule, green `+` for inflow, red `−` for outflow. |
| Menu edit name | `שם הפרויקט` | Required, 1–80 characters. |
| Menu edit client | `לקוח` | Optional, 0–80 characters. |
| Menu edit budget | `תקציב` | Optional. Whole shekels. Empty clears the budget and hides the card. |

Dates on rows are `dd/mm` when the year is the current year, and `dd/mm/yyyy` otherwise.

## States

**Loading.** Cached project, if any, paints immediately. First open shows skeleton tiles and three skeleton rows.

**Empty (project exists, no transactions).** Tiles `₪0`. Profit `₪0` with no margin. No budget card unless a budget was set, in which case used is `₪0` and the percent is `0%`. Category block hidden. Recent block replaced by `אין תנועות עדיין` and one call to action, `הוסף תנועה`, which opens the Add sheet.

**Normal.** Tiles, optional budget, categories, recent rows.

**Partial.** If this project has suggested rows, a line under the tiles reads `{n} ממתינים לאישור בפרויקט הזה` and opens review filtered to this project. Those rows are not in the tiles. The company-wide banner is not repeated here.

**Error.** Failed load with no cache: `לא הצלחנו לטעון את הפרויקט` and `נסו שוב`. Failed save of a rename: the old name stays, `לא נשמר` and retry.

**Offline.** Cached project is fully readable. Rename, client, budget, and finish queue locally and sync later. The Add sheet's capture queues locally. Category totals do not include queued items that are not yet approved.

## Edge cases

- **Optional budget.** No budget, no card. Setting one later shows the card on the next paint. Clearing it removes the card. Budget is not required to save the project.
- **VAT-exempt lines.** Included at net. They do not create a VAT slice in the tiles.
- **Refund / credit note.** A linked refund with an expense category reduces `הוצאות` and that category's bar. The recent row shows a green inflow.
- **Split.** Only the line assigned to this project appears. Its amount is the line, not the parent.
- **Move after approval.** Saving the change sheet removes the line from this project and adds it to the other on the next paint. Profit updates. A finished project's line can be moved away. Search can also move a line onto a finished project.
- **Finish.** `סיים פרויקט` sets status `finished`. Transactions stay. The project leaves the default picker and stays in reports. Confirm with `לסיים את הפרויקט?`. `החזר לפעיל` reverses it.
- **Delete.** Offered only with zero transactions and zero documents. Confirm `למחוק את הפרויקט?`. Overhead cannot be deleted or finished.
- **Category merge.** Rows that were on the merged-away category show the surviving category the next time this screen opens. Totals are unchanged except for the label.
- **Duplicate invoice.** Does not add a second recent row.
- **Client deposit that belonged here.** Appears only after it is approved onto this project.
- **Long name.** Title wraps up to three lines; the recent list still uses one line with ellipsis.
- **0 transactions and a budget.** The budget card shows `₪0 / {budget}` and `0% נוצל`.

## Acceptance criteria

- [ ] The after-overhead view starts off. Off, income, expenses, profit, and margin match project-to-date counting lines, and they do not include overhead or other projects.
- [ ] With the view on, income, own expenses, category bars, and the budget card stay those stored figures. Profit and margin use the overhead share. Company totals elsewhere do not change. If no project has income, the view does not switch and the screen says the allocation is unavailable.
- [ ] The overhead screen has no after-overhead toggle.
- [ ] The budget card is absent when no budget is set, and present with used / budget / percent when it is.
- [ ] Category amounts sum to the expenses tile, after refunds.
- [ ] Recent amounts are signed and net of VAT. VAT is not added into the tiles.
- [ ] A suggested row for this project is outside the tiles and inside the pending line.
- [ ] Delete is impossible once any transaction or document exists. Finish is possible and keeps the history.
- [ ] The empty project shows one action, `הוסף תנועה`.
