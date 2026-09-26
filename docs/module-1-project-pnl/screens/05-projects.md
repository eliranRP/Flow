# Projects list and create

**Status:** Approved. Wireframe [05-projects](../wireframes/05-projects.png). The wireframe shows the create sheet already open over the list. In the product the sheet opens only after `+ פרויקט חדש`.

## Purpose

Every active project with profit since the job started, finished jobs tucked away, and a short form to add one.

## Entry points

| From | How |
| --- | --- |
| Bottom nav | `פרויקטים` |
| Home | The collapsed `עוד N פרויקטים` row. |
| Change sheet | `+ פרויקט חדש` creates a project and returns to the sheet with that project selected. It does not leave the owner on this list. |

## Where taps go

| Tap | Goes to |
| --- | --- |
| A project row | Project screen. |
| `+ פרויקט חדש` | Create sheet. |
| `⌕` | Search field. Filters active and finished projects by name or code. |
| `הסתיימו` / `הצג` | Expands finished projects. `הסתר` collapses them. |
| `צור פרויקט` | Creates the project and opens it. |
| Scrim | Closes the create sheet without creating. |
| Center `+` | Add sheet, not the create sheet. |

## Elements and fields

Title `פרויקטים`. Subtitle `{n} פעילים · רווח מתחילת הפרויקט`. `n` is the count of `active` projects.

| Element | Hebrew | Source and format |
| --- | --- | --- |
| Create button | `+ פרויקט חדש` | Opens the sheet. |
| Row name | Project name | One line, ellipsis. |
| Row profit | Profit to date | Whole shekels, green or red with `−`, from [project-to-date profit](../calculations.md#income-expenses-profit-margin). |
| Row meta | `{client} · פעיל · הכנסות {income}` | Client segment omitted when empty. Finished rows say `הסתיים` instead of `פעיל`. Income is whole shekels. |
| Finished header | `הסתיימו` | Count is not required. `הצג` / `הסתר`. Hidden entirely when there are no finished projects. |
| Name field | `שם הפרויקט` | Required. 1–80 characters. |
| Client | `לקוח (אופציונלי)` | 0–80 characters. Placeholder `שם לקוח`. |
| Budget | `תקציב (אופציונלי)` | Empty or a positive whole-shekel amount. Placeholder `₪`. Empty means no budget. |
| Submit | `צור פרויקט` | Disabled while the name is empty or only spaces. |

**Project code.** Assigned at create, not typed. The next code is `P-` plus the integer one higher than the highest existing code, including finished and deleted codes so a code is never reused. The first project is `P-01`. The code is not on this sheet. It shows in the change-sheet list and in the Excel export. Overhead has no code.

Search matches a substring of the name or the code. Matching is the same normalization as suppliers (trim, collapse space, strip diacritics). Finished projects are included in search results even when the finished section is collapsed. A query with no hits shows `אין פרויקט כזה`.

## States

**Loading.** Cached list if any. Otherwise skeleton rows. The create button is still tappable.

**Empty (no projects).** Title `פרויקטים`. Body `אין פרויקטים עדיין`. One call to action: `+ פרויקט חדש`. No search icon, no finished section.

**Normal.** Button, active rows, collapsed finished section when any exist.

**Partial.** A project with suggested rows still shows approved profit only. No badge on the row in the proof of concept; the company banner on Home is the pending signal.

**Error.** Failed load with no cache: `לא הצלחנו לטעון` and `נסו שוב`. Failed create: the sheet stays open, the typed name remains, `לא נשמר`.

**Offline.** The list is cached. Create queues locally, assigns the code on device, and the new project is visible immediately. Sync later reconciles by the client-generated id. Two devices creating while offline can collide on the code; that case is an [open question](../../open-questions.md). The proof of concept assumes one phone.

## Edge cases

- **0 projects.** Empty state. Company Home is also empty if there are no transactions.
- **Budget omitted.** Project is created with no budget. The project screen hides the budget card.
- **Budget entered.** Stored as whole shekels converted to agorot (`× 100`). The project screen shows the card.
- **Delete.** From the project screen, only when there are no transactions and no documents. The row disappears. The code is not reused.
- **Finish.** The row leaves the active list and appears under `הסתיימו`. Profit to date stays on the row. Transactions are not deleted.
- **Finish with transactions, then a late bill.** Search finds the finished project. The change sheet finds it only through search ([0009](../../decisions/0009-scalable-pickers.md)).
- **Category merge.** Does not change this list's profit, because profit is not grouped by category.
- **Move a transaction away.** The row's profit updates on the next paint.
- **Overhead.** Not a row on this list. It lives on Home.
- **Long names.** One line, ellipsis. The create field allows 80 characters and scrolls horizontally inside the field.
- **Duplicate names.** Allowed. The code tells them apart.
- **VAT, refunds, splits, non-Hapoalim files.** They affect profit through [calculations](../calculations.md). This list does not have its own import path.
- **Client deposit with no project.** Does not create a project and does not add a row.

## Acceptance criteria

- [ ] Each active row's profit and income match project-to-date counting lines.
- [ ] Create requires a name and does not require a client or a budget.
- [ ] A new project receives the next unused `P-` code, and the owner is not asked to type it.
- [ ] Finished projects are collapsed, still searchable, and still show historical profit.
- [ ] Empty list has one action, `+ פרויקט חדש`.
- [ ] Overhead is not listed.
- [ ] Suggested rows do not change the profit on the row.
