# Disconnecting Mercury or SUMIT happens at once with ביטול; a rejected key is said under the field

**Date:** 2026-10-27
**Status:** Accepted (owner, 2026-10-26, FLOW-975. Extends [0222](0222-settings-toast-under-header.md) §1 and §2 to the connection pages: Mercury, SUMIT and חיבור ל־AI)

## Context

FLOW-975 reviewed the connection pages against the same UX/UI rule set as the other v2 screens. A key the provider refused had no state on the page: the button spun, then a toast said "החיבור נכשל". "חיבור" was greyed out until the key looked long enough, and a tap on it did nothing; the account picker's save did the same with no account checked. Disconnecting asked "לנתק את …?" first and could not be undone. The key toggle "הצגה" was 36px tall. The owner approved the Connections v2 board and, on a card, chose to disconnect at once with a 5s ביטול, the key kept for those 5s.

## Decision

1. Disconnecting Mercury (one connection, by its slot) or SUMIT has no confirm. The page shows the result at once (the key form, or the list of the connections left) and a toast under the header says "Mercury נותק. מה שכבר נכנס נשמר" or "SUMIT נותק. מה שכבר נכנס נשמר" with ביטול for 5s.
   - The write (`disconnect_connector`, `disconnect_sumit`) waits on that ביטול (`holdForUndo()` in `connection-undo.ts`) and is sent only once the 5s end. Until then the key stays on the server, so ביטול puts the connection back by sending nothing.
   - Leaving the app (the page turns hidden) ends the wait at once: nobody can tap ביטול any more, and the disconnect should not be lost with the page. A reload or a crash inside the 5s loses it; the connection then still shows as connected, which is true.
   - A failed disconnect puts the connection back and says "לא הצלחנו לנתק." with ניסיון חוזר.
   - The tapped ניתוק goes away with the connection, and ביטול goes away with its toast, so focus moves to the page title both times (`focusConnectionTitle()`), never to nothing.
2. A key the provider refuses (`auth`, `sumit_auth`) says so under the key field, with no toast: "Mercury לא קיבל את המפתח. בדקו שהוא Read Only ושהעתקתם אותו כולו." or "SUMIT לא קיבל את המפתח. בדקו את מספר החברה ואת המפתח.", and the button reads "חיבור מחדש". Typing clears it. The key is still cleared from the field after every attempt, as before.
3. "חיבור" is never greyed out. A tap with something missing says what under the key and sends nothing: "צריך את המפתח המלא, לפחות 8 תווים" (Mercury), "צריך מספר חברה (6 ספרות לפחות) ומפתח מלא" (SUMIT). The account picker's save is never greyed out either: with nothing checked it reads "בחרו לפחות חשבון אחד" and a tap sends nothing.
4. Every toast on the connection pages hangs under the header through `useTopToast()`, `topToast()` and `useWrite({ place: "top" })`: an undo 5s, a note 4s (0222 §2). That covers connect, refresh, the accounts' saves and the AI keys (a new key, revoke and its ביטול, הועתק). Setup's connect sheets keep their toasts and their place: the shared connect hooks take the top place only from the connection pages.
5. The key toggle (הצגה / הסתרה) is 44px tall. The key, company and date fields' edges are the 3:1 control edge, app-wide since FLOW-972 (0222 §5).

## Alternatives rejected

- Keeping "לנתק את …?": undo beats a question (the owner's call), and a disconnect is easy to take back while the key is still on the server.
- Deleting the key at once and keeping it in an undo record: the key is a Vault secret; holding the write for 5s needs no new server path and no copy of the secret.
- A toast for a refused key: it leaves before the owner has looked at the field, and says nothing the field cannot.
