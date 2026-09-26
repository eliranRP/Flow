# Categories

**Status:** Approved. Wireframe [07-categories](../wireframes/07-categories.png).
**Rules:** [0008](../../decisions/0008-flat-categories-hide-or-merge.md). Flat list. No sub-groups.

## Purpose

Rename, reorder, hide, merge, or add categories. The defaults are already there. Most owners never need this screen. New categories can also be created from the change sheet without coming here.

## Entry points

Settings row `קטגוריות`, once Settings exists. Until the Settings draft is approved, this screen is still the categories manager and is reachable from the bottom nav `הגדרות`, which opens a one-row list whose only approved row is `קטגוריות`. That one-row list is a stand-in, not the draft Settings screen.

Back returns to that Settings entry point. Breadcrumb `הגדרות`.

## Where taps go

| Tap | Goes to |
| --- | --- |
| `הוצאות` / `הכנסות` | Switches the list. Expense defaults, or the two income defaults. |
| Drag handle `⋮⋮` | Reorders. The new order is what pickers prefer. |
| `⋯` | Menu: `שנה שם`, `הסתר`, `מזג לקטגוריה אחרת`, `מחק`. |
| `מוסתרות ({n})` | Expands hidden categories. Each has `החזר`. |
| `+ קטגוריה חדשה` | Name field on the current tab. |
| A row that is not the handle or the menu | Does nothing. There is no category detail screen. |

## Elements and fields

Title `קטגוריות`.

| Element | Hebrew | Rule |
| --- | --- | --- |
| Tabs | `הוצאות`, `הכנסות` | Expense tab is the default. |
| Row | Name, `{n} תנועות` | `n` is transactions currently on that category, any status, any date. One line, ellipsis. |
| Hidden | `מוסתרות ({n})` | Hidden when `n` is 0. |
| Add | `+ קטגוריה חדשה` | |
| Rename | `שנה שם` | 1–40 characters. Transactions keep the category and show the new name. |
| Hide | `הסתר` | Leaves pickers. History stays. Counts stay in reports under that name. |
| Merge | `מזג לקטגוריה אחרת` | Picker of other categories on the same tab, excluding hidden ones. Confirm `למזג את {source} אל {target}?`. Every transaction and every rule on the source moves to the target. The source is then deleted. |
| Delete | `מחק` | Enabled only when `n` is 0 and no rule points at the category. Otherwise the row is disabled and the menu shows `מחיקה אפשרית רק לקטגוריה ללא תנועות`. |
| Restore | `החזר` | Unhides. |

Seeded expenses: `חומרים`, `קבלני משנה`, `עבודה`, `ציוד והשכרה`, `הובלה`, `ביטוח`, `אחר`.

Seeded income: `תקבול מלקוח`, `הכנסה אחרת`.

When the visible list on a tab grows past 15, a note under the add button reads `יש הרבה קטגוריות. כדאי למזג`. It does not block adding.

## States

**Loading.** Cached list. First run uses the seeded lists immediately; they ship with the app, so there is no network wait.

**Empty.** There is no blank first run. The seeded lists are the first-time state. If the owner hides every category on a tab, the list area says `הכל מוסתר` and the single call to action is `+ קטגוריה חדשה`. The hidden group is expanded so restore is visible.

**Normal.** The wireframe: expense rows, counts, hidden group if any, add button.

**Partial.** Counts include suggested transactions. Merging them moves the suggestion too. Reports still ignore suggested rows.

**Error.** Rename or merge failure: `לא נשמר`, list unchanged.

**Offline.** Edits queue on the device and apply locally at once so pickers on the same phone see the new order. Sync later.

## Edge cases

- **Merge.** Transactions that were on `הובלה` show the target category on the project screen. Totals do not change except the label they are grouped under. A rule that pointed at `הובלה` now points at the target, so the next auto-approve uses the target.
- **Delete with transactions.** Disabled. Hide and merge remain.
- **Delete of a seeded category with zero transactions.** Allowed. It is not special-cased.
- **Hide.** The category disappears from the change sheet and from the project breakdown when its total is zero. If it still has a historical total, the project breakdown shows it until the total is zero; hiding only removes it from pickers.
- **Overhead versus project.** Categories are not buckets. Overhead is not a category.
- **VAT-exempt, refunds, splits.** They use whatever category the line has. A refund on `חומרים` reduces that row's transactions' effect on expenses; the count `תנועות` still counts the refund as one transaction.
- **Move after approval.** The count follows the line to the new category immediately.
- **Finish or delete a project.** Does not delete categories. Deleting a project that had no transactions does not change counts.
- **Duplicate invoice.** Does not increment the count, because no second transaction is created.
- **Long names.** 40-character limit. The row ellipsizes.
- **0 projects.** Categories are still editable.
- **Non-Hapoalim file.** No effect.
- **Income tab.** Same interactions. The wireframe draws the expense tab only.

## Acceptance criteria

- [ ] First launch shows the seven expense categories and the two income categories without a network call.
- [ ] Reorder changes the order of chips on the change sheet.
- [ ] Delete is disabled when the transaction count is not zero, and the explanation is visible.
- [ ] Merge moves every transaction and every rule, then removes the source category.
- [ ] Hide removes the category from pickers and does not remove it from historical totals.
- [ ] Above 15 visible categories, the merge hint is shown.
- [ ] Hiding every category on a tab leaves one action, `+ קטגוריה חדשה`.
