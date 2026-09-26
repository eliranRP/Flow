# Home

**Status:** Approved. Build [01-home-v2](../wireframes/01-home-v2.png). The three-project [01-home](../screens.md#01-home) wireframe is superseded.
**Product:** Flow. Hebrew, right to left, mobile first.
**Numbers:** [calculations](../calculations.md). High-confidence rows are already approved before they reach this screen ([0011](../../decisions/0011-auto-approve-high-confidence.md)).

## Purpose

Answer "is the company making money in this period?" Company tiles include every project and overhead. The list shows where to look next.

## Entry points

| From | How |
| --- | --- |
| App open | Home is the first screen after the local store is ready. |
| Bottom nav | `בית` |
| Upload results, review empty, project back | When those flows return to the company summary. |

There is one user, the owner. No other home exists.

## Where taps go

| Tap | Goes to |
| --- | --- |
| `החודש` / `חודש קודם` / `מתחילת השנה` | Stays on Home. Recomputes every figure for that period, including the comparison arrows on this month and last month. [0019](../../decisions/0019-home-periods-and-comparison.md). The current PNG still shows only two segments and no arrows. |
| `לפי פעילות` / `הפסד קודם` | Stays on Home. Rebuilds the top 5 only. Tiles do not change. |
| A project row | That project's screen, project to date. |
| `עוד N פרויקטים` | Projects list. |
| Overhead row | Overhead screen, which reuses the project layout with no client, no budget card, and no finish action. |
| Pending banner | Review queue. |
| Center `+` | Add sheet. |
| `☰` | Settings. The screen behind that button is [draft](../settings.md) and is not approved. |
| `פרויקטים` / `לאישור` / `הגדרות` | Those tabs. |

## Elements and fields

Greeting `שלום, {first name}`. The name is the owner's given name from the company profile. Until Settings is approved, the proof of concept uses the name captured at signup. Signup fields are not specified beyond that one string.

Subtitle `סיכום החברה · {active project count} פרויקטים פעילים · {period label}`. Active means status `active`, not "had cash this month". The period label is the month name and year for this month and for last month, and the year alone for year to date.

| Element | Hebrew | Source and format |
| --- | --- | --- |
| Period | `החודש`, `חודש קודם`, `מתחילת השנה` | [Period filters](../calculations.md#period-filters). One is selected. Default is `החודש`. |
| Income tile | `הכנסות` | Company income for the period. Whole shekels, neutral color. Beside it, the [comparison arrow](../calculations.md#comparison-arrow) when the selected period is this month or last month. |
| Expenses tile | `הוצאות` | Company expenses for the period. Whole shekels, neutral color. Same arrow. |
| Profit tile | `רווח/הפסד` | Company profit. Whole shekels. Green if > 0, red with `−` if < 0, `₪0` if 0. This tile is visually emphasized. Same arrow. |
| Banner | `{n} פריטים ממתינים לאישור` | `n` = suggested rows. Hidden when `n` is 0. Badge on `לאישור` shows the same `n`, hidden at 0. |
| Section | `פרויקטים · 5 המובילים` | When fewer than 5 projects have lines in the period, the title is `פרויקטים` and the "5" is omitted. |
| Sort | `לפי פעילות`, `הפסד קודם` | [Activity and losses first](../calculations.md#overhead). |
| Project row | Project name, profit, bar | Profit is the project's counting lines for the Home period. Bar: gray = expenses, green = profit, red = the loss portion, on one shared scale across the visible rows. Name is one line, ellipsis if needed. |
| Collapsed row | `עוד {n} פרויקטים · {profit} רווח` or `הפסד` | Sum of projects not in the top 5. Hidden when `n` is 0. |
| Overhead | `הוצאות כלליות · תקורה` | Overhead profit for the period. Dashed row. Red with `−` when it is a net cost. |

All of these amounts are net of VAT. Dates are not shown on Home except the period label.

## States

**Loading.** If a previous successful sync is on the device, show those figures immediately and refresh in the background. If nothing has ever loaded, show the greeting and gray skeleton blocks for the three tiles and five rows. Do not flash `₪0` during that first load.

**Empty (first run, no projects and no transactions).** Greeting, three tiles at `₪0`, no banner, no project rows, no overhead row. One call to action: `+ פרויקט חדש`, which opens the create-project sheet. The center `+` still opens the Add sheet so a photo can be captured before the project exists.

**Normal.** Tiles, top 5, collapsed row when needed, overhead, no banner.

**Partial.** Same as normal, plus the pending banner. Tiles do not include suggested rows. The banner is the only "not final" signal.

**Error.** If refresh fails and cached figures exist, keep them and show `לא הצלחנו לרענן` with `נסו שוב`. If the first load fails, the empty skeleton is replaced by that message and the same retry. No tiles of invented zeros.

**Offline.** Cached Home stays usable. A caption `ממתין לסנכרון` appears when the queue of photos, manual entries, or statement files is non-empty, or when the last sync failed because there was no network. Review and browsing cached projects work. New AI guesses wait. Rules already on the device still auto-approve new rows once the file can be parsed locally.

## Edge cases

- **0 projects.** Empty state above. Company profit is `₪0`.
- **Fewer than five projects with activity.** List them all. No collapsed row. Overhead still shows once any transaction exists.
- **All projects profitable.** Losses-first still sorts by profit ascending, so the smallest profit is first. No red rows.
- **Overhead versus a project.** A job's profit never includes `הוצאות כלליות`. The company profit does. The overhead row is not a sixth project in the top 5.
- **Finished project.** Hidden from the picker and from Home unless it has counting lines in the selected period (a late payment). It stays in year-to-date and in its own project screen.
- **Very long Hebrew names.** One line and ellipsis on the row. The project screen shows the full name, wrapping up to three lines.
- **Moving a transaction after approval.** The next time Home is shown, tiles and rows use the new bucket. The past period changes. Flow does not keep a second "original" total on Home.
- **Duplicate statement or duplicate invoice.** Home does not move. Duplicates never create a second counting line. See [calculations](../calculations.md#duplicate-imports).
- **Non-Hapoalim file.** Nothing is imported, so Home is unchanged. The error is on upload results.
- **Refund.** Lowers expenses (or income, if the owner used an income category) in the period of the cash date. The row's project jumps in the activity sort because activity uses the absolute amount.
- **Split.** Each line counts on its own project. Company profit is unchanged by the split itself.
- **VAT-exempt line.** Counts at net. VAT of 0 does not change the tiles.
- **Client deposit with no project.** Stays suggested, so it is in the banner and not in the tiles, until the owner assigns a project or overhead.

## Acceptance criteria

- [ ] Company income, expenses, and profit equal the sums in [calculations](../calculations.md), including projects that are not on screen, and including overhead.
- [ ] Amounts are whole shekels, net of VAT. Losses use a red Unicode minus.
- [ ] `החודש` is the calendar month, `חודש קודם` is the previous calendar month, and `מתחילת השנה` is 1 January through today, `Asia/Jerusalem`.
- [ ] This month and last month show the comparison arrow on income, expenses, and profit. Year to date shows no arrow until that baseline is [decided](../../open-questions.md#year-to-date-comparison).
- [ ] Suggested rows are absent from the tiles and present in the banner count.
- [ ] Top 5 follows activity or losses-first. Overhead stays the last row. The collapsed row is the rest.
- [ ] With no projects and no transactions, the only emphasized action is `+ פרויקט חדש`.
- [ ] A Hapoalim row that auto-approves changes Home without a visit to the review queue.
- [ ] Offline, the last synced tiles remain visible and are labeled as not synced when the device has pending captures.
