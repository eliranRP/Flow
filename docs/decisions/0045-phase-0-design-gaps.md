# Phase 0 design gaps

**Date:** 2026-09-28
**Status:** Accepted

## Context

The design review of the Phase 0 shell at `fd355ad` passed, and left six gaps that had no approved mockup or decision. [0044](0044-phase-0-shell-calls.md) already covers the preview banner, the first-run empty copy, and that Home's offline error follows `ld-08`. It does not say what `/help` contains, what a load failure looks like when the device is online, how to greet someone with no name, whether the Phase 0 band shows a period pill, what the Phase 0 Add sheet holds, or why the tab bar is taller than 52px when the bottom safe area is 0.

## Decision

1. `/help` is a plain template A page, reachable while signed out, so it does not mount the signed-in tab bar. The title is "עזרה". One short line says that sign-in help is by email. The address is a mailto link to ops@nromomentum.com. "חזרה" uses the link colour.
2. A load failure that is not offline keeps the band off, like `ld-08`. The title is "לא הצלחנו לטעון את הנתונים". The line is "נסו שוב בעוד רגע". The button is the same filled primary "ניסיון חוזר" as `ld-08`, with the refresh icon. `?preview=error` stays the offline screen. `?preview=error-server` opens this one.
3. With no name, the greeting is "שלום". No comma and no ellipsis. A known name stays "שלום, דנה".
4. The Phase 0 band has no period pill. The pill arrives when the real P&L is wired. The Home loading skeleton still follows `ld-01` without that pill: the band bars for the greeting, the label, the hero, the change pill, and income and expenses; a pending card; the real heading "פרויקטים מובילים"; and three row blocks. Text bars are 10–14px. The wordmark row matches the loaded band. The empty first run stays the shorter `es-01` screen, so leaving the skeleton for that screen changes the band. The skeleton's own bars do not.
5. The Phase 0 Add sheet shows the title "הוספה" and one hint, "בקרוב תוכלו להוסיף כאן הכנסה או הוצאה". No actions yet. Home stays mounted underneath, including on a direct load of `/add`. Closing the sheet returns focus to the + button.
6. The tab bar is 52px plus the bottom safe area, and at least 8px when that inset is 0. The floor is the token `--tabbar-min-inset: 8px`.

## Alternatives rejected

Putting the signed-in tab bar on `/help`. The page is opened from the failed sign-in note, before there is a session.

Keeping "שלום, …" as a stand-in for a missing name. The ellipsis reads as a broken sentence.

Drawing the period pill on the Phase 0 band before a period exists to change.

Filling the Phase 0 Add sheet with the photo, bank, and manual actions from screen 04. Those actions are not built yet.

Dropping the 8px tab-bar floor so a device with no inset sits the labels on the screen edge.

## Consequences

`?preview=error` is offline. `?preview=error-server` is the other load failure. Those two preview screens do not show "מצב תצוגה": the marker is only a demo aid, and these screens have no band to hold it. A project with no transactions uses the shared empty state and the `es-02` copy from the implementation guide. The "צריך עזרה בכניסה?" link is only on the failed sign-in note. [DESIGN-RULES.md](../design/DESIGN-RULES.md) points these Phase 0 calls here. The mockup files stay as they are.
