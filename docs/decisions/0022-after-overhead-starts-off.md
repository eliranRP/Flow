# After-overhead share starts off

**Date:** 2026-09-26
**Status:** Accepted

## Context

[0021](0021-shared-costs-and-overhead.md) adds a view-only switch on Home and the project screen, `רווח אחרי חלק מהתקורה` (profit after overhead share). Turning it on does not move transactions. Company totals stay the same. The open question was whether that switch starts on.

The wireframes [01-home-v4](../module-1-project-pnl/screens.md#01-home-v4) and [02-project-v2](../module-1-project-pnl/screens.md#02-project-v2) draw the switch on, so the on state can be reviewed. Those images are example data and are still pending owner approval. They are not a picture of the first launch.

The numbers the owner checks against the bank, and the numbers the accountant sees, are the stored project profits and the overhead bucket. An overhead share is a management view on top of those numbers.

## Decision

The switch starts off. Home and the project screen share one preference. The first time either screen opens, it shows stored project profit, with no overhead share applied.

The owner turns the switch on when they want the overhead view. Settings has a display option for the same preference, and that option starts off too.

## Alternatives rejected

Starting the switch on, so the first project rows the owner sees are after an allocation the bank statement does not show.

## Consequences

Off is the default on a new company and for an owner who has never touched the switch. On does not write or move transactions, and company tiles stay the stored totals, as in 0021.

The display option lives in the [Settings draft](../module-1-project-pnl/settings.md). The rest of that screen is still not approved. This default is decided. Home, the project screen, and the Settings option are one preference: changing it in one place changes the other two.

[01-home-v4](../module-1-project-pnl/screens.md#01-home-v4) and [02-project-v2](../module-1-project-pnl/screens.md#02-project-v2) stay pending. They show the on state. They are not the default layout.
