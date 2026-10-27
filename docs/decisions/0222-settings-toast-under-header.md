# Settings toasts hang under the header; an offline page says changes wait; a field's edge is 3:1

**Date:** 2026-10-27
**Status:** Accepted (owner, 2026-10-26, FLOW-972. Extends [0212](0212-review-toast-under-header.md) §1 to §3 to הגדרות and its pages, as [0215](0215-recurring-toast-under-header.md) and [0220](0220-forecast-toast-under-header.md) did; supersedes [0137](0137-review-toast-above-bar.md), whose bar place the team page was the last to use; refines [0212](0212-review-toast-under-header.md) and [0216](0216-lines-toasts-and-supplier-rule.md) for useWrite's success note under the header, 3s to 4s)

## Context

FLOW-972 reviewed Settings (the menu, העסק, קטגוריות, התראות, צוות, מראה and החלפת עסק) against the same UX/UI rule set as the other v2 screens. Its toasts sat above the tab bar for 3s (the team page's above its pinned bar, the theme's undo 3s). A change made offline looked saved. A new category's save said only שמירה and sent an empty name to the server. A field's edge was the tint (1.35:1 on the card). The owner approved the Settings v2 board.

## Decision

1. Every toast on a settings page and its sheets takes `place: "top"`, through `useTopToast()` (the sheets' own toasts) and `useWrite({ place: "top" })` (the writes' success and failure toasts). The team page's toasts move there too. It was the last user of `place: "bar"` (0137), so that place, its CSS and its stories are removed.
2. Under the header an undo (ביטול) stays 5s and a note 4s: `topToast()` sets it, and `useWrite`'s success note under the header stays 4s, on every screen that puts it there (it was 3s under 0212 and 0216). A failure keeps useWrite's time (4s, 5s with ניסיון חוזר). The theme's undo is no longer 3s.
3. Offline, each settings page says under its head "אין חיבור · שינויים יישמרו כשהחיבור יחזור" with "מתחבר מחדש…". A write made offline waits and runs when the connection is back (React Query's online mode), as long as the app stays open: there is no persister, so a reload drops it. What cannot wait refuses offline with a note instead of trying:
   - התראות says "אין חיבור · אפשר לשנות התראות כשהחיבור יחזור" under its head, and its switches, this device and the test push say the same in a toast (they save through the browser and the server at once).
   - התנתקות and deleting the company say "אין חיבור · אפשר להתנתק כשהחיבור יחזור" and "אין חיבור · אפשר למחוק את העסק כשהחיבור יחזור", so neither runs by itself later.
   - החלפת עסק keeps its toasts under the header on Settings; from Home's band it keeps the default place.
4. A button that saves says what it saves: "שמירת השם" (the business and a category), "יצירת הקטגוריה". יצירת הקטגוריה is never greyed out: a name the kind already has says so under the field as it is typed, and a tap with no name says "כתבו שם לקטגוריה", or one under 2 characters "שם קצר מדי – לפחות 2 תווים" (the server's rule), there.
5. A text field's edge (`.ui-field-control`, every screen) and the dashed "+ עסק חדש" are `--color-control-edge`, 3:1 and more on the card. The choice sheets (currency, basis, theme and the other screens' radio sheets) draw at 17px with a 13px note.

## Alternatives rejected

- Keeping 0182's place above the floor on settings: the toast covered the page's last rows and the team page's bar.
- A disabled save until the name is valid: a grey button with no word does not say what is missing.
- A queue of offline changes with its own list: React Query already holds a paused write and runs it on reconnect; the line says so.
