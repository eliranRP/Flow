# Review undo returns the item to the queue

**Date:** 2026-09-28
**Status:** Accepted. The undo sentence below is amended by [0063](0063-owner-ledger.md). The projects footer link is amended by FLOW-410: every active project shows, and the link reads `עוד M שהסתיימו` (`עוד פרויקט אחד שהסתיים` for one).

## Context

Approving a review item has to wait for `resolve_review` before the screen says it worked. The queue still needs an undo. There was no reopen function, and reversing the allocation inside the undo would invent a second ledger write the owner did not ask for.

## Decision

`reopen_review` sets that queue row back to `open` and clears `resolved_at`. [0063](0063-owner-ledger.md) amends the rest of this paragraph: undo restores the project, category, role, and allocations from the snapshot `resolve_review` stored. The toast says the previous assignment was restored.

## Alternatives rejected

Showing "אושר" before the write returns. That is the bug the code review rejected.

Deleting the allocation on undo. The owner asked to undo the queue decision, not to wipe the books.

## Consequences

Authenticated callers can execute `reopen_review`. `anon` cannot. The client calls it only from the success toast.

## Design calls from the second review

These sit with the undo because they are the same screen pass.

AI tagging is off. The review card still shows a suggestion block when the row already has a project or a category from a rule. The percent is shown only when that suggestion carries a confidence. With no project and no category, the block is hidden. `list_review` returns `confidence` as null until tagging exists.

Stat and StatGrid leave the library. Project figures are plain lines on the screen.

Empty states use the §8.2 sentences from the implementation guide.

The projects list shows a footer link, `עוד N פעילים · M הסתיימו`, instead of a finished-projects checkbox.

DatePicker stays out of the library. [0063](0063-owner-ledger.md) restores Toggle for the overhead switch, the supplier-memory switch, and the settings switches. RangeSheet keeps MonthGrid.

`נתוני דוגמה · Example data` is a Storybook sample label. The running app does not render it.

The home loading skeleton is the home route, composed from Skeleton bars inside TopBand. A signed-in load does not show `מצב תצוגה`. [0062](0062-audit-layout-calls.md) keeps that label on a preview load.

The rest of that review follows the implementation guide. The greeting is `t-label` and the example tag sits on that row in Storybook only. The pending card has 24px above it. Project rows are hairlines with 14px padding and no extra gap. The over-budget sentence states the real percent (the bar fill still stops at 100%). The checkbox focus ring is on the box, not the hidden input. Sign-in legal links are underlined hint text.

## Disabled cursor

A disabled or `aria-disabled` control shows `cursor: not-allowed`. One rule in `ui.css` covers `button`, `[role=button]`, `input`, `select`, `textarea`, and `a`, plus a label or field shell that contains a disabled control. That is Button (every variant), IconButton, Checkbox, RadioRow, Chip, SegmentedControl, PeriodPicker, MoneyField, SelectField, SearchField, a ListRow link, and a TabBar item.

The disabled element does not get `pointer-events: none`. That would hide the cursor. The `disabled` attribute blocks the click, or the handler does. A busy control uses `cursor: progress`.

DatePicker stays out of the library. Toggle is back, as [0063](0063-owner-ledger.md) says, and a disabled Toggle uses this same not-allowed rule on its 44px row. The computed-cursor test covers a disabled Button, a disabled IconButton, the checkbox row (`.ui-toggle`), and a disabled Toggle.
