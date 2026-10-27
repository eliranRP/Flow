# Settings toasts hang under the header; an offline page says changes wait; a field's edge is 3:1

**Date:** 2026-10-27
**Status:** Accepted (owner, 2026-10-26, FLOW-972. Extends [0212](0212-review-toast-under-header.md) §1 to §3 to הגדרות and its pages, as [0215](0215-recurring-toast-under-header.md) and [0220](0220-forecast-toast-under-header.md) did; ends [0137](0137-review-toast-above-bar.md)'s bar place on the team page)

## Context

FLOW-972 reviewed Settings (the menu, העסק, קטגוריות, התראות, צוות, מראה and החלפת עסק) against the same UX/UI rule set as the other v2 screens. Its toasts sat above the tab bar for 3s (the team page's above its pinned bar, the theme's undo 3s). A change made offline looked saved. A new category's save said only שמירה and sent an empty name to the server. A field's edge was the tint (1.35:1 on the card). The owner approved the Settings v2 board.

## Decision

1. Every toast on a settings page and its sheets takes `place: "top"`, through `useTopToast()` (the sheets' own toasts) and `useWrite({ place: "top" })` (the writes' success and failure toasts). The team page's toasts move there too, so 0137's bar place no longer applies there.
2. Under the header an undo (ביטול) stays 5s and a note 4s: `topToast()` sets it, and `useWrite`'s success note under the header stays 4s, on every screen that puts it there. A failure keeps useWrite's time (4s, 5s with ניסיון חוזר). The theme's undo is no longer 3s.
3. Offline, each settings page says under its head "אין חיבור · שינויים יישמרו כשהחיבור יחזור" with "מתחבר מחדש…". A write made offline waits and runs when the connection is back (React Query's online mode).
4. A button that saves says what it saves: "שמירת השם" (the business and a category), "יצירת הקטגוריה". יצירת הקטגוריה is never greyed out: a name the kind already has says so under the field as it is typed, and a tap with no name says "כתבו שם לקטגוריה" there.
5. A text field's edge (`.ui-field-control`, every screen) and the dashed "+ עסק חדש" are `--color-control-edge`, 3:1 and more on the card. The choice sheets (currency, basis, theme and the other screens' radio sheets) draw at 17px with a 13px note.

## Alternatives rejected

- Keeping 0182's place above the floor on settings: the toast covered the page's last rows and the team page's bar.
- A disabled save until the name is valid: a grey button with no word does not say what is missing.
- A queue of offline changes with its own list: React Query already holds a paused write and runs it on reconnect; the line says so.
