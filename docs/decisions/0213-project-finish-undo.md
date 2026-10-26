# Finishing a project happens at once, with a 5s ביטול under the header

**Date:** 2026-10-26
**Status:** Accepted (owner, 2026-10-26, FLOW-961: the Project v2 board. Refines [0182](0182-toast-above-the-bottom-bar.md) for this one toast; follows [0212](0212-review-toast-under-header.md)'s top place)

## Context

FLOW-961 reviewed the Projects list and the project page against a UX/UI rule set. סיום הפרויקט opened a confirm sheet every time, though a finish changes no figure and החזרה לפעיל undoes it in one tap. A confirm on an action that can be undone is friction with no safety: the rule set asks for undo instead (feedback §10). The owner approved the Project v2 board, which drops the confirm.

## Decision

1. סיום הפרויקט in the ⋯ menu finishes the project at once. The page goes back to the Projects list with הסתיימו open, and a toast under the header says "<name> עבר ל״הסתיימו״" with ביטול for 5s. ביטול returns the project to active, with "<name> חזר לפעילים".
2. The menu row names what stays: "יש בו N פריטים לאישור. הם יחכו גם אחרי הסיום" when items wait, else "יעבור ל״הסתיימו״. אפשר לבטל מיד, ושום דבר לא נמחק". This is the warning the confirm used to carry.
3. A finished project's menu row is החזרה לפעילים, also at once, with its toast and no undo (it is the undo).
4. Deleting a project still asks first: it cannot be undone. The confirm's button names the act: מחיקת הפרויקט.
5. These toasts take `place: "top"`, as לאישור's do (0212): the list's header is where the eye lands after the page closes. A failure keeps ניסיון חוזר and 0182's times.

## Alternatives rejected

- Keeping the confirm: it asked the same question on every finish, for an action with nothing to lose.
- An undo above the tab bar (0182's place): the board puts it under the header, and the finished row it refers to opens at the top of הסתיימו.
