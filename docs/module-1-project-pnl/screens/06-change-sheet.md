# Change sheet

**Status:** Approved. Build [06-change-sheet-v2](../wireframes/06-change-sheet-v2.png). The all-chips [06-change-sheet](../screens.md#06-change-sheet) wireframe is superseded.
**Rules:** Remember defaults on ([0006](../../decisions/0006-confirm-not-type.md)). Picker shape is [0009](../../decisions/0009-scalable-pickers.md).

## Purpose

Fix the project and the category in two taps, or split the amount, then save and approve. Works the same with 5 projects or 50.

## Entry points

| From | How |
| --- | --- |
| Review | `שינוי`, or a tap on a chip. |
| Project | A transaction row, including one that is already approved. |
| Full transaction list | Same. |
| Upload summary | Reopen on an auto-approved row. |

The sheet sits over the screen that opened it. Dismissing without `שמור ואשר` leaves the row unchanged.

## Where taps go

| Tap | Goes to |
| --- | --- |
| A suggested project chip | Selects it. |
| Search | Filters the list by name or code (`P-12`). |
| A list row | Selects that project. |
| `+ פרויקט חדש` | Create form (name required, client and budget optional). On create, that project is selected and the sheet returns. |
| `פצל בין פרויקטים` | Split mode, below. |
| A category chip | Selects it. |
| `עוד קטגוריות` | Full category list for the row's direction, with search. Hidden categories are absent. |
| `+ קטגוריה חדשה` inside that list | Name field, then the new category is selected. |
| Remember toggle | On writes a rule at save. Off approves this row only. |
| `שמור ואשר` | Persists, approves, closes. |
| Scrim or swipe down | Discards the draft. |

## Elements and fields

Header `שינוי שיוך`. Context `{counterparty} · {dd/mm}`. Amount is the row net, detail display, neutral color.

| Element | Hebrew | Behavior |
| --- | --- | --- |
| Project label | `פרויקט` and `מוצע` | |
| Three chips | AI pick (marked `✦` when it is the model's pick), last used for this supplier (`· אחרון`), one more | The three are distinct. Overhead is not forced into the three. A finished project is not in the three. |
| Search | `חיפוש פרויקט או קוד (P-12)…` | Substring on name or code. Finished projects appear only when the query matches. |
| List | `כל הפרויקטים · לפי פעילות אחרונה ({n})` | Active projects plus overhead, most recent cash activity first. Overhead is always in the list, pinned after the active projects, labeled `הוצאות כלליות`. `n` counts active projects, not overhead and not finished. |
| Finished note | `פרויקטים שהסתיימו מוסתרים – החיפוש מוצא אותם` | Hidden while a search query is non-empty. |
| Category label | `קטגוריה` and `מוצע` | |
| Category chips | Up to three suggestions, then `עוד קטגוריות` | Suggestions: the model's pick, the category last used for this supplier, and the next category in the owner's order. Same direction as the money (expense categories for an outflow, income categories for an inflow). |
| Remember | `לזכור לספק הזה` | Default on, except in split mode. Preview `{supplier} → {project} · {category}`, updated as the selection changes. `· פעיל` shows while the toggle is on. |
| Save | `שמור ואשר` | Disabled until a project or overhead and a category are selected. |

List rows show a radio, the code (overhead has none), the name (one line, ellipsis), and recency: `היום`, `אתמול`, `לפני {n} ימים`, or `לפני שבוע` when the last cash date is 7–13 days ago, otherwise `dd/mm`.

## Split mode

A dedicated sheet is drawn on [11-split](../screens.md#11-split) and is pending owner approval. Until that approval, this section is the rule, including one category for every line.

Title `פצל בין פרויקטים`. The amount at the top is the parent net.

| Control | Hebrew | Rule |
| --- | --- | --- |
| Mode | `סכום` / `אחוז` | Default `סכום`. |
| Line | Project picker (same search rules) and an amount or a percent | At least two lines. `הוסף שורה` adds another. |
| Remainder | `נותר {amount}` | Amount mode. Must reach `₪0` before save. |
| Percent total | `סה״כ {percent}%` | Must reach 100% before save. |
| Category | One category for every line | The category already selected on the sheet. |
| Remember | Off, disabled | A split does not write a rule. |
| Save | `שמור ואשר` | Enabled only when the [split sums](../calculations.md#splits) are exact in agorot. |

VAT is allocated by largest remainder. The owner does not type VAT per line.

## States

**Loading.** The sheet opens with cached projects. Categories are cached. No full-screen loader.

**Empty (0 projects).** No suggested project chips. The list contains only `הוצאות כלליות` and the create action. Note: `עדיין אין פרויקטים`. One emphasized action inside the sheet: `+ פרויקט חדש`. Save stays disabled until overhead or a new project is chosen, and a category is chosen.

**Normal.** Chips, search, list, categories, remember on, save.

**Partial.** Not separate. Opening the sheet from a suggested row and saving clears that suggestion.

**Error.** Save failure keeps the sheet open and shows `לא נשמר`. The selection remains.

**Offline.** Pickers use cached projects, categories, and rules. Save stores the approval locally and syncs later. Creating a project inline works offline the same way as the projects list.

## Edge cases

- **Already approved.** Save moves the line. Reports change. If remember is on, the rule is written or replaced for that supplier. Previous transactions are not bulk-updated.
- **Duplicate documents and duplicate statements.** Not created here.
- **Two invoices, partial payment, one payment covering several.** Those links are edited on the review card, not by this sheet. This sheet only sets project, category, or split lines.
- **Refund.** The category list is income categories when the signed net is positive and the owner has not chosen an expense category. The owner may switch to expense categories via `עוד קטגוריות` so a supplier refund reduces expenses. The list offers a segment `הוצאות` / `הכנסות` in that case.
- **Split sums.** Save blocked until lines match the parent net exactly. A percent split that cannot be represented evenly still sums exactly because of the largest-remainder rule.
- **Finish.** A finished project is hidden until searched. Selecting it is allowed.
- **Delete a project with transactions.** Not offered. If the selected project is deleted on another path while the sheet is open, save fails with `הפרויקט לא קיים` and the selection clears.
- **Category merge.** The merged-away category disappears from the chips. If it was selected, the surviving category replaces it.
- **Overhead.** Selectable from the list. A rule may point at overhead.
- **VAT-exempt.** The amount shown is the net. Split lines are of the net.
- **Client deposit, no project.** Sheet opens with no project selected. Last-used chip can still show if this supplier has history.
- **Non-Hapoalim.** No row exists to change.
- **Long names.** Chips stay on one line and ellipsize. The list row ellipsizes. The create field accepts 80 characters.
- **0 categories in that direction.** Should not happen: defaults are seeded. If the owner hid every expense category, the chips are empty and `עוד קטגוריות` opens a list whose only action is `+ קטגוריה חדשה`.

## Acceptance criteria

- [ ] Three project chips at most, then search, then a list ordered by recent activity.
- [ ] Finished projects are absent until the search query matches them.
- [ ] `שמור ואשר` is disabled without a project and a category.
- [ ] Remember defaults on and the preview names the supplier, project, and category that will be stored.
- [ ] A later row from that supplier auto-approves on the rule and skips review.
- [ ] Split save is impossible unless the lines sum to the parent net in agorot, and split does not write a rule.
- [ ] Reopening an auto-approved row uses this sheet and can change the row after it has already counted.
- [ ] With zero projects, the emphasized action is `+ פרויקט חדש`.
