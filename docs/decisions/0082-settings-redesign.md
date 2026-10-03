# Settings is one screen: account, connections, view, and more

**Date:** 2026-10-02
**Status:** Accepted

## Context

הגדרות is several headings, a company row that says עוסק מורשה, a separate Google row, a SUMIT block with a status row plus רענון plus ניתוק, and a second error path that also offers חיבור מחדש. עוזר is its own section under that block, with a long hint and a separate ניתוק row. Three switches are on the screen and disabled. The owner approved a quieter screen. The mock's exact pixels are not in this record. The copy below is the approved summary.

This amends the Settings section of [0080](0080-mcp-connector.md). Mint, revoke, scope, and the one active token stay as 0080 wrote them. [0022](0022-after-overhead-starts-off.md) still owns the overhead switch. The project screen keeps `overheadHint`.

0081 is the review-queue list, now on `main`. This record is 0082 so the two do not share a number.

## Decision

1. One screen, 390×844, light and dark, RTL, also checked at 320 and 360. Sections, in order: the account row, חיבורים, תצוגה, עוד, then the footer "Flow 0.1". Components come from `app/src/ui`. The structure is a quiet list and sheets. The palette does not change.
2. The account row shows the business name and the Google email, with the G icon. It does not say עוסק מורשה or עוסק פטור. With no company, the row is disabled and shows the Google email, or "עדיין בלי עסק" when there is no email. It does not say "אין עסק עדיין".
3. חיבורים has two rows. SUMIT, and "עוזר AI" with a spark icon (`SparkIcon` in `icons.tsx`). Each row shows a one-word status and opens one sheet. The exact status words wait for the mock. Loading is a skeleton row, not a busy connected row. "אין עסק עדיין" is only the disabled עוזר AI row when there is no company (Q-C3-3).
4. A failed status is one inline "ניסיון חוזר" on that row. SUMIT does not also show a form error, a חיבור מחדש button, and a ניתוק row for the same failure. עוזר does not add a second ניתוק row under the status. Disconnect stays available inside the sheet. 0080's confirm copy for ניתוק stays.
5. תצוגה has the categories row and the overhead switch. The switch label is "רווח אחרי כלליות". The hint is "חלק מהכלליות נכנס לכל פרויקט". The switch still calls `set_after_overhead`.
6. עוד has install and sign out. Install stays hidden when the app is already installed.
7. Removed from the screen, with no behavior change: the פרויקטים row, the weekly summary switch, the waiting-items reminder switch, and the auto-approve switch. Those three stay off. They are not shown. Projects stay on `/projects`.
8. The עוזר sheet still has two steps, and a tap on a scope still does not mint. Step 1 offers "קריאה וכתיבה" (selected) and "קריאה בלבד", then "יצירת קוד". Step 2 title is "הקוד מוכן". It has a כתובת row with העתקה, a קוד row with העתקה, the access line, the link "איך מחברים ב־Claude", and "סיום". The code is the secret only, shown once. The address is `VITE_FLOW_MCP_URL` when that is set, otherwise the flow-mcp URL derived from the Supabase URL. The help sheet opens from that link. Claude Code is first, as one copyable command: `claude mcp add` with the URL and an `Authorization: Bearer` header. A short Claude.ai note follows. The command is built in the app. It is not a second secret.

## Alternatives rejected

A second settings route. Keeping עוסק מורשה on the account row. Leaving the three disabled switches in place. A SUMIT error that is a banner, a reconnect button, and a disconnect row at once. Measuring the redesign against Mercury's palette.

## Consequences

No migration. The ledger, the token, and `set_after_overhead` are unchanged. D1 and D2 in [PITFALLS.md](../review/PITFALLS.md) edit the old 0080 table. This record replaces that visible copy, so those two nits are not a separate edit.

The one-word status strings are still open. They land with the mock, before the חיבורים pull request.

## Cycles

Each cycle is its own pull request and works without the later ones. Cycle 1 is this record. The screen does not change here.

| Cycle | What ships |
| --- | --- |
| 1 | This decision |
| 2 | The account row, the section order, the removals, and the footer. SUMIT and עוזר keep today's actions |
| 3 | The SUMIT row: one status word, one sheet, one inline ניסיון חוזר |
| 4 | The עוזר AI row: spark icon, one status word, skeleton, and the disabled empty row "אין עסק עדיין" |
| 5 | The עוזר sheet, the address, the shown-once code, and the Claude help sheet |
| 6 | תצוגה, עוד, and the 320, 360, and 390 pass in light and dark |
