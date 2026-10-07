# The business name is its own Settings row and opens a rename sheet

**Date:** 2026-10-07
**Status:** Accepted

## Context

[0082](0082-settings-redesign.md) §2 made the account row one static row: the business name, the Google email as its hint, and the G icon. FLOW-602 adds the owner-only RPC `public.rename_company` and the MCP tool `rename_company`. The app needs a place to call it. The backlog says it is a small focused sheet, not a Settings catch-all. The owner compared three mockups (a separate business row, a pencil button on the one row, a full business page) and chose the separate row on 2026-10-07.

## Decision

This amends 0082 §2 for a session with a company. The no-company row is unchanged.

1. With a company, the account area is two rows. The first is the business name with a building icon (`BuildingIcon`) and a chevron. It is a button named "שם העסק: <name>" and opens the rename sheet. The name is one line and ends in an ellipsis. The second is the Google email: static, the G icon, single line (53px), LTR, cut off at the end. It is omitted when the email is empty.
2. A viewer, or a session whose role is still loading or unknown (`useHoldWrites`), sees the business row static, with no chevron.
3. The sheet title is "שם העסק". It holds one `TextField` labelled "שם", filled with the current name, and one primary button, שמירה. There is no in-field clear button.
4. The name is trimmed. It must be 2 to 100 characters, the same bounds as the RPC. The check runs on blur and on save, not on every keystroke. A short name shows "שם קצר מדי – לפחות 2 תווים" on the field (`aria-invalid`). A long one shows "שם ארוך מדי – עד 100 תווים". An unchanged name closes the sheet with no write.
5. While saving, שמירה is busy and the field is disabled. The sheet does not close until the save finishes.
6. Success closes the sheet, returns focus to the business row, refreshes the dashboard query, and shows "שם העסק נשמר" with ביטול. ביטול writes the previous name back through the same RPC, then shows "שם העסק הוחזר".
7. A failed save keeps the sheet open with the typed name and shows the error toast "שם העסק לא נשמר". A dropped connection or a server error adds ניסיון חוזר. A database refusal (`42501`) shows "אין הרשאה לשנות את שם העסק." with no retry.
8. Preview and samples do not write. Saving there shows "במצב תצוגה זה לא נשמר."
9. ✕, Escape, Back and the scrim close the sheet without saving, and the typed name is discarded. This is an exception to save-on-leave in [0075](0075-save-on-tap-and-on-leave.md) §2. It follows the typed new-project name in 0075 §3, which also needs שמירה.

## Alternatives rejected

- A pencil button on the one account row. That makes one row with two tap targets and adds a tinted button to a quiet screen.
- A full business page. 0082 rejected a second settings route, and one input belongs in a sheet (implementation guide §3.3).

## Consequences

No migration. The RPC and the MCP tool ship in the FLOW-602 RPC pull request, so this screen merges after it. [CONTROLS.md](../qa/CONTROLS.md) and [DESIGN-RULES](../design/DESIGN-RULES.md) §4 "14 Settings" are updated to match.
