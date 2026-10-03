# Flow — Settings (Draft)

The visible screen follows [0082](../decisions/0082-settings-redesign.md). Cycle 3 is the SUMIT row in חיבורים. This page below that section is the old wireframe and is not the build.

### SUMIT row

The row title is SUMIT, with the document icon. Every settled state is one hint and one sheet, except the load error, which does not open a sheet.

| State | Hint | What opens |
| --- | --- | --- |
| Connected | מחובר | The SUMIT sheet: status, רענון עכשיו, ניתוק |
| Not connected, with a company | לא מחובר | The connect form: מספר חברה, מפתח API, חיבור |
| Not connected, no company | לא מחובר | "כדי לחבר את SUMIT צריך עסק." and פרטי העסק. No key form |
| Key rejected (`sumit_auth`) | צריך לחבר מחדש | A sheet titled SUMIT: "המזהה או המפתח לא התקבלו", the key form with primary חיבור מחדש, then ניתוק |
| Status failed to load | לא הצלחנו לטעון | Nothing. ניסיון חוזר refetches the status only |
| Loading | a skeleton bar | Nothing. It is not focusable and it does not say מחובר |

A sync failure that is not the key keeps מחובר. While רענון עכשיו is held, the sheet says הרענון נכשל and the retry time, with no "נסו שוב". A rate limit with no retry time says "הרענון נכשל. נסו שוב." A last-sync time is one line: "עודכן ב-HH:MM" today, "עודכן אתמול ב-HH:MM" yesterday, and "עודכן ב-D.M" after that. It refreshes at the next Israel midnight. A missing time is omitted. The · before מספר חברה and before the time stays with those words. Starting the company from that sheet returns only to `/settings?sheet=sumit`, after the company query has settled, and that visit replaces the sheet entry. Any other `return` finishes on Home. Opening from `?sheet=sumit` removes that param and keeps `?preview`. When that visit already has an earlier in-app entry, the sheet reuses it, so one Back after the sheet closes leaves Settings. A first entry in the tab pushes the sheet instead, so Back closes the sheet and stays on Settings. Reloading while a sheet is open drops that restored entry, so the first Back is not a dead step. A `?sheet=` address still opens the sheet.

### עוזר AI row

The row title is עוזר AI, with the spark icon. The no-company row stays `aria-disabled` and says "אין עסק עדיין".

| State | Hint | What opens |
| --- | --- | --- |
| Connected | מחובר · קריאה וכתיבה, or מחובר · קריאה בלבד | The עוזר AI sheet groups the status and scope line with last use, then a muted "כדי לשנות את הגישה מנתקים ומחברים שוב.", then ניתוק. Last use is "שימוש אחרון ב-HH:MM" today, "שימוש אחרון אתמול ב-HH:MM" yesterday, and "שימוש אחרון ב-D.M" after that. No use yet is "עדיין אין שימוש" |
| Not connected | לא מחובר | Step 1, titled חיבור עוזר AI. The lead is "בחרו מה העוזר יכול לעשות." Then קריאה וכתיבה (selected) and קריאה בלבד, with no option descriptions, then יצירת קוד. A tap on a scope does not mint |
| Expired | צריך לחבר מחדש | A status row: alert icon, heading "פג תוקף", muted "הקוד הפסיק לעבוד אחרי 90 יום.", then חיבור מחדש, which reveals step 1, titled חיבור עוזר AI, and focuses its title. ניתוק stays in that sheet |

Step 2 is titled הקוד מוכן. One muted line says "גישה: קריאה וכתיבה. הקוד מוצג פעם אחת." Read-only uses "קריאה בלבד" in that line. כתובת and קוד are read-only fields on the input surface. Each is monospace, LTR, one line that scrolls sideways, and selectable. The copy control is an icon button inside the field, at the inline end, at least 44px, named העתקה. Then the link איך מחברים ב־Claude, then סיום. סיום uses the sheet's own close, so a second tap does not pop another history step. Closing the code sheet or the expired sheet keeps that step until the close animation ends, then clears the code and the expired step. The code is the secret only, shown once. The address is `VITE_FLOW_MCP_URL` when that is set, otherwise the flow-mcp URL derived from the Supabase URL. When no address is configured, the command and the help link are hidden. The help sheet has the same title as the link, איך מחברים ב־Claude. The lead is "ב־Claude Code הריצו את הפקודה." The command is one read-only field, full width, on the input surface. Its accessible name is "פקודת חיבור ל־Claude Code". There is no separate Claude Code label. The text is monospace and LTR, on one line that scrolls horizontally, and it is selectable. The copy control is the same icon button. The command is `claude mcp add --scope user`, with the address in quotes and an Authorization bearer. The hint "אם Claude Code לא מותקן, התקינו אותו קודם." follows. One muted line says Claude.ai needs a custom header, `Authorization: Bearer <הקוד>.` That header stays on one line. It does not say to paste the address and the code. The help sheet has no approval line and no הבנתי. A failed העתקה says "העתיקו ידנית" in the sheet that owns that button. The command is built in the app. It is not a second secret. Closing a sheet pops only that layer, so the help sheet and a ניתוק confirm leave the sheet underneath open. ✕ and Escape return focus to the control that opened that sheet. A hint separator stays on the same line as the words after it. The קטגוריות row has no counts.
| Status failed to load | לא הצלחנו לטעון | Nothing. ניסיון חוזר refetches the assistant status only |
| Loading | a skeleton bar | Nothing. It is not focusable and it does not say מחובר |

The root shows one status word on each row. ניתוק and חיבור מחדש stay inside the sheets, including when SUMIT needs a key and the assistant has expired.

**Status: Draft.** The wireframe is [14-settings](screens.md#14-settings), pending owner approval. This screen is not approved. It does not override decisions 0001–0022. [Settings contents](../open-questions.md) stay open until the wireframe is accepted or replaced. The after-overhead default below is decided.

Every name, account, date, and the version string on the wireframe are example data.

## Entry

Bottom navigation `הגדרות` (Settings) opens this screen. The Home `☰` button is still an [open question](../open-questions.md#settings-screen). The unpaid list also names `☰`.

The proof of concept has one user, the owner ([0013](../decisions/0013-single-user-owner.md)). There is no role-based version of Settings.

## Proposed contents

The order matches [14-settings](screens.md#14-settings).

### Company details

| Field | Hebrew label | Notes |
| --- | --- | --- |
| Business name | `שם העסק` | Example `א.ב. בנייה ושיפוצים בע״מ`. |
| VAT id | `ח.פ` / `מספר עוסק` | Example `51-234567-8`. Included in the Excel export header. |
| VAT status | `סוג` | The wireframe shows `חברה בע״מ` only. The enum, including `עוסק פטור`, is not decided. |

### Phone sign-in

`טלפון`. The number the owner signed in with, example `050-123-4567`, and `קוד ב־SMS` ([0017](../decisions/0017-sms-sign-in.md)). Changing the number is [open](../open-questions.md#changing-the-phone-number). The wireframe does not draw a change flow.

### Bank Hapoalim

Not a build task. [0065](../decisions/0065-review-round5.md) point 40. The drawing below stays for history. Do not build a Hapoalim account or an upload from Settings.

`בנק הפועלים`. Connected account, example `••4521`. Last statement date, example `דוח אחרון 30/09/2026`. `העלה דוח` opens the statement upload.

Flow uses saved account numbers to drop own-account transfers: a row whose counterparty account equals another saved account on this company is removed and does not enter P&L. Other banks are not accepted ([0012](../decisions/0012-bank-hapoalim-first.md)).

If no account is saved yet, Flow does not auto-remove transfers. A row that merely looks like a transfer is suggested, and the owner can mark it `העברה בין חשבונות` on the review card, which excludes it. That empty bank card is not drawn.

### Categories and projects

`קטגוריות` opens the approved Categories screen ([0008](../decisions/0008-flat-categories-hide-or-merge.md)). `פרויקטים` opens the projects list.

### Recurring split rules

`כללי פיצול`. A row shows the payee and the method (equal, income share, or manual proportions). The example is `חומרי בניין השרון` · `לפי הכנסה`. `עריכה` opens the rule. `מחיקה` asks `למחוק את הכלל?`. The confirm is not on the wireframe. Deleting a rule does not rewrite transactions already approved. The next row from that payee will not auto-approve on the deleted rule; it goes to review unless an invoice link matches.

One-project rules are not on this image. They still exist ([0006](../decisions/0006-confirm-not-type.md)).

### Notifications

Two toggles, both drawn on:

- `סיכום שבועי` — Sunday 08:00.
- `תזכורת לאישור` — 18:00, only when something is waiting.

[0018](../decisions/0018-two-notifications.md) defines those two sends and did not add a settings screen for turning them off. Until [14-settings](screens.md#14-settings) is approved, both sends stay as 0018 describes, and these toggles are not built as off switches.

### After-overhead default

`רווח אחרי חלק מהתקורה`. Off by default ([0022](../decisions/0022-after-overhead-starts-off.md)). One preference with the switch on Home and the project screen. Off, those screens show stored project profit, which is what matches the bank and the accountant. On, they show profit after the overhead share. The option does not change stored lines or company totals. [0021](../decisions/0021-shared-costs-and-overhead.md).

### Auto-approve

[0011](../decisions/0011-auto-approve-high-confidence.md) auto-approves a unique invoice match and an existing supplier rule. It rejected an opt-in switch and a manual "Approve all" as the way those rows get into the books.

The wireframe draws `אישור אוטומטי` on, subline `חשבונית יחידה או כלל קיים`. **The off position is not part of the approved product.** Shipping a way to turn auto-approve off needs a new decision that supersedes 0011, or approval of this wireframe as that decision. Until then, Flow always auto-approves high-confidence rows, and this control is not built.

### Data export

`ייצוא לאקסל` and `ייצוא ל־CSV` download approved, paid lines (the counting set in [calculations](calculations.md), all dates, all projects and overhead). CSV is the same rows. Draft columns, in this order:

1. Date (`dd/mm/yyyy`)
2. Direction (`הכנסה` / `הוצאה`)
3. Counterparty
4. Net shekels (two decimals, signed)
5. VAT shekels (two decimals, ≥ 0)
6. Project code (blank for overhead)
7. Project name or `הוצאות כלליות`
8. Category
9. Source (`בנק` / `ידני` / `חשבונית`)
10. Invoice number
11. `חשבונית ישראל` allocation number, when the linked document has one
12. Statement value date, when the source is the bank

Hashavshevet format is out of scope ([0001](../decisions/0001-management-tool-alongside-accounting.md)). Whether a later move of a transaction must also export the previous project is an [open question](../open-questions.md). The export shows the current assignment only.

### Log out

`התנתקות` ends the session and returns to SMS sign-in.

### Version line

`Flow · 0.1.0` on the wireframe is example data. It is not a versioning policy.

## What this draft does not include

Pricing, a second user, credit-card importers, open banking, and VAT filing.
