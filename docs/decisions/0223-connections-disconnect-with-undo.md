# Disconnecting Mercury or SUMIT happens at once with ביטול; a rejected key is said under the field

**Date:** 2026-10-27
**Status:** Accepted (owner, 2026-10-26, FLOW-975. Extends [0222](0222-settings-toast-under-header.md) §1 and §2 to the connection pages: Mercury, SUMIT and חיבור ל־AI)

## Context

FLOW-975 reviewed the connection pages against the same UX/UI rule set as the other v2 screens. A key the provider refused had no state on the page: the button spun, then a toast said "החיבור נכשל". "חיבור" was greyed out until the key looked long enough, and a tap on it did nothing; the account picker's save did the same with no account checked. Disconnecting asked "לנתק את …?" first and could not be undone. The key toggle "הצגה" was 36px tall. The owner approved the Connections v2 board and, on a card, chose to disconnect at once with a 5s ביטול, the key kept for those 5s.

## Decision

1. Disconnecting Mercury (one connection, by its slot) or SUMIT has no confirm. The page shows the result at once (the key form, or the connections left) and a toast under the header says "Mercury נותק. מה שכבר נכנס נשמר" or "SUMIT נותק. מה שכבר נכנס נשמר" with ביטול for 5s.
   - The disconnect waits in a store outside the page (`connection-undo.ts`), keyed by provider and slot, and is sent when ביטול's toast closes (the toast's `onClose`). There is no second timer, so the wait lasts exactly as long as ביטול is on screen: a hover, focus or press that pauses the toast keeps the key. A toast that replaces it closes it, so a second Mercury disconnect sends the first. Until it is sent the key stays on the server, and ביטול sends nothing; a ביטול that comes too late says "החיבור כבר נותק".
   - Any visit to the page during the wait draws the connection as leaving, whatever a read says.
   - Leaving the app (the page turns hidden) sends every wait at once and takes its toast away: nobody can tap ביטול any more.
   - A new key waits for the provider's pending disconnects to go out first, so an old disconnect never deletes the new key.
   - A wait lives in memory only. A reload or a closed tab within it drops it: nothing is sent, the key stays, and the connection still shows as connected when the owner comes back, which is true. (Switching apps is covered: the page turns hidden and the disconnect goes out.) A server-side soft disconnect could keep it across a reload, if that is ever needed.
   - A wait is for the company the app showed at the tap. Opening another company sends the waiting disconnects first and waits for them; if the app shows another company (or none) by the time a wait ends anyway, nothing is sent and the toast says "הניתוק בוטל, עברת לעסק אחר". Signing out sends them first, while the session still works.
   - A role that is now viewer or editor (not one still loading or unknown) drops the wait: nothing is sent, the ביטול toast goes, and a toast says "החיבור נשאר: אין לך הרשאה לנתק".
   - Once the disconnect is sent, the page and the connections list draw it gone before the wait ends, so it never flickers back; during the wait the list reads "מתנתק…".
   - A failed disconnect puts the connection back and says "לא הצלחנו לנתק." with ניסיון חוזר.
   - The tapped ניתוק goes away with the connection, and ביטול goes away with its toast, so focus moves to the page title both times (`focusConnectionTitle()`), never to nothing.
   - A sample (stories, dev routes) sends nothing: it drops the connection in memory.
2. A key the provider refuses (`auth`, `sumit_auth`) says so under the key field, with no toast: "Mercury לא קיבל את המפתח. בדקו שהוא Read Only ושהעתקתם אותו כולו." or "SUMIT לא קיבל את המפתח. בדקו את מספר החברה ואת המפתח.", and the button reads "חיבור מחדש". The note is announced (`liveMessage`) and focus moves to the key. Typing clears it. The key is still cleared from the field after every attempt, as before.
3. "חיבור" is never greyed out, and is busy while a waiting disconnect goes out first, so a second tap sends nothing more. A tap with something missing says what on the first field that lacks it (SUMIT's company number, else the key), focuses that field and sends nothing: "צריך את המפתח המלא, לפחות 8 תווים" (Mercury), "צריך מספר חברה (6 ספרות לפחות) ומפתח מלא" (SUMIT). The account picker's save is never greyed out either: with nothing checked it reads "בחרו לפחות חשבון אחד", and a tap sends nothing and says so to a screen reader.
4. Every toast on the connection pages hangs under the header through `useTopToast()`, `topToast()` and `useWrite({ place: "top" })`: an undo 5s, a note 4s (0222 §2). That covers connect, refresh, the accounts' saves and the AI keys (a new key, revoke and its ביטול, הועתק). Setup's connect sheets keep their toasts and their place: the shared connect hooks take the top place only from the connection pages.
5. The key toggle (הצגה / הסתרה) is 44px tall. The key, company and date fields' edges are the 3:1 control edge, app-wide since FLOW-972 (0222 §5).

## Alternatives rejected

- Keeping "לנתק את …?": undo beats a question (the owner's call), and a disconnect is easy to take back while the key is still on the server.
- Deleting the key at once and keeping it in an undo record: the key is a Vault secret; holding the write while ביטול shows needs no new server path and no copy of the secret.
- A timer of the hold's own: it ran out while a paused toast still offered ביטול.
- A toast for a refused key: it leaves before the owner has looked at the field, and says nothing the field cannot.
