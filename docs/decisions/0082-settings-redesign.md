# Settings is one screen: account, connections, view, and more

**Date:** 2026-10-03
**Status:** Accepted

## Context

הגדרות is several headings, a company row that says עוסק מורשה, a separate Google row, a SUMIT block with a status row plus רענון plus ניתוק, and a second error path that also offers חיבור מחדש. עוזר is its own section under that block, with a long hint and a separate ניתוק row. Three switches are on the screen and disabled. The owner approved a quieter screen. The mock's exact pixels are not in this record. The copy below is the approved summary.

This amends the Settings section of [0080](0080-mcp-connector.md). Mint, revoke, scope, and the one active token stay as 0080 wrote them. [0022](0022-after-overhead-starts-off.md) still owns the overhead switch. The project screen keeps `overheadHint`.

0081 is the review-queue list, now on `main`. This record is 0082 so the two do not share a number.

## Decision

1. One screen, 390×844, light and dark, RTL, also checked at 320 and 360. Sections, in order: the account row, חיבורים, תצוגה, עוד, then the footer "Flow 0.1". With no company, תצוגה is hidden. Components come from `app/src/ui`. The structure is a quiet list and sheets. The palette does not change.
2. Amended by [0106](0106-rename-company-row.md): with a company, the business name is its own row that opens a rename sheet, and the Google email is a separate static row. No company means `company_id` is null in the live app. On the real `/settings` route, only `?preview=empty` is no-company. Other preview values keep their own sample, so sign-out is not shown there. ~~The account row shows the business name and the Google email, with the G icon.~~ (Superseded by 0106.) The account rows do not say עוסק מורשה or עוסק פטור. With no company the row is static: not a button, not disabled, and it has no click handler. It is the single-line row height, 53px. A row that also shows a hint is 72px. It shows only the Google email, in `<bdi dir="ltr">`. The email cuts off at the end, so the start stays visible at 320. "עדיין בלי עסק" is not used. If the email is empty, the row is not rendered. "אין עסק עדיין" is not on this row.
3. חיבורים has two rows. SUMIT, and "עוזר AI" with a spark icon (`SparkIcon` in `icons.tsx`). The row title is "עוזר AI" in every state. Each row shows a one-word status and opens one sheet, except the error row and the no-company עוזר row, which do not open a sheet. Loading is a skeleton row, not a busy connected row. The status words are: Q-C3-1, an expired עוזר AI shows "צריך לחבר מחדש", the same as SUMIT. Q-C3-2, with no company, SUMIT stays enabled and says "לא מחובר". Its sheet does not show the API-key form and does not call `sumit-connect`. It shows one line, "כדי לחבר את SUMIT צריך עסק.", and a link to onboarding (פרטי העסק). Q-C3-3, "אין עסק עדיין" is only the disabled עוזר AI row. Q-C3-4, a SUMIT sync failure that is not about the key keeps "מחובר", and the details stay in the sheet.
4. A failed status is one inline "ניסיון חוזר" on that row. SUMIT does not also show a form error, a חיבור מחדש button, and a ניתוק row for the same failure. עוזר does not add a second ניתוק row under the status. Disconnect stays inside that row's sheet. When ניתוק succeeds, that sheet closes with the confirm, and the close does not push another history entry. Browser Back closes the עוזר sheet the same way it closes the others. An expired connection is the reconnect state in §3 (Q-C3-1): the row says "צריך לחבר מחדש". 0080's confirm copy for ניתוק stays.
5. תצוגה has the categories row and the overhead switch. With no company, תצוגה is hidden, and `/settings/categories` redirects to `/settings`. The switch label is "רווח אחרי כלליות". The hint is "חלק מהכלליות נכנס לכל פרויקט". The switch still calls `set_after_overhead`.
6. עוד has install and sign out. Install stays hidden when the app is already installed.
7. Removed from the screen, with no behavior change: the פרויקטים row, the weekly summary switch, the waiting-items reminder switch, and the auto-approve switch. Those three stay off. They are not shown. Projects stay on `/projects`.
8. The עוזר sheet still has two steps, and a tap on a scope still does not mint. Step 1 is titled "חיבור עוזר AI". It leads with "בחרו מה העוזר יכול לעשות.", then "קריאה וכתיבה" (selected) and "קריאה בלבד", with no option descriptions, then "יצירת קוד". Step 2 title is "הקוד מוכן". One muted line says "גישה: קריאה וכתיבה. הקוד מוצג פעם אחת." Read-only uses "קריאה בלבד" in that line. כתובת and קוד are read-only fields on the input surface, then the link "איך מחברים ב־Claude", then "סיום". סיום uses the sheet's own close, so a second tap does not pop another history step. Closing the code sheet or the expired sheet keeps that step until the close animation ends, then clears the code and the expired step. Each field is monospace, LTR, one line that scrolls sideways, and selectable. An icon button inside the field, at the inline end, is at least 44px. The visible control stays the icon. The accessible name is "העתקה: כתובת", "העתקה: קוד", or "העתקה: פקודה". An empty value hides the button. The code is the secret only, shown once. The address is `VITE_FLOW_MCP_URL` when that is set, otherwise the flow-mcp URL derived from the Supabase URL. With no address, the command and that link are hidden. The connected sheet groups the status and scope line with last use, then a muted line "כדי לשנות את הגישה מנתקים ומחברים שוב." The help sheet title is "איך מחברים ב־Claude". It leads with "ב־Claude Code הריצו את הפקודה." The command is one read-only field, full width, on the input surface, with no separate "Claude Code" label. Its accessible name is "פקודת חיבור ל־Claude Code". The text is monospace and LTR, on one line that scrolls horizontally, and it is selectable. The same field holds the address and the code. This owner decision is in [PLAN.md](../PLAN.md). One muted line says Claude.ai needs the custom header `Authorization: Bearer <הקוד>.` That header stays on one line. There is no approval line and no הבנתי. The command is built in the app. It is not a second secret. Closing the help sheet or a ניתוק confirm leaves the sheet underneath open. The backdrop fades opacity only, so its stacking drops at once. A tap on the sheet underneath while that backdrop is still fading does not close it. A tap during the fade of the only open sheet does not reach the page. While step 2 shows the one-time code, a backdrop tap does not close that sheet. ✕ and סיום do, and Escape still does. The קטגוריות row has no counts.

## Alternatives rejected

A second settings route. Keeping עוסק מורשה on the account row. Leaving the three disabled switches in place. A SUMIT error that is a banner, a reconnect button, and a disconnect row at once. Measuring the redesign against Mercury's palette.

## Consequences

No migration. The ledger, the token, and `set_after_overhead` are unchanged. The status words are Q-C3-1 through Q-C3-4 in §3. D1 and D2 in [PITFALLS.md](../review/PITFALLS.md) edit the old 0080 table. This record replaces that visible copy, so those two are done and are not a separate edit.

## Cycles

Each cycle is its own pull request and works without the later ones. Cycle 1 is this record, pull request #9. The screen does not change here. Cycle 2 is pull request #10. Every cycle is checked at 320, 360, and 390, in light and in dark.

| Cycle | Pull request | What ships |
| --- | --- | --- |
| 1 | #9 | This decision |
| 2 | #10 | The account row, the section order, the removals, and the footer. With no company, תצוגה is hidden, including the overhead switch. Sign-out works in the empty preview. The עוזר heading is dropped. ניתוק lives inside the sheets, not as a second row under חיבורים, and a successful ניתוק closes that sheet. SUMIT stays enabled and says "לא מחובר", and with no company its sheet is the onboarding line. עוזר AI is disabled and says "אין עסק עדיין" |
| 3 | #12 | The SUMIT row: one status word, one sheet, one inline ניסיון חוזר. Q-C3-4 |
| 4 | #13 | The עוזר AI row: spark icon, one status word, and a skeleton. Q-C3-1, an expired עוזר shows "צריך לחבר מחדש" |
| 5 | #18 | The עוזר sheet, the address, the shown-once code, and the Claude help sheet |
| 6 | later | The 320, 360, and 390 check in light and dark is every cycle, not only this one |
