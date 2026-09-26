# After-overhead switch on keeps Home's big number as company net profit

**Date:** 2026-09-26
**Status:** Accepted

## Context

[0021](0021-shared-costs-and-overhead.md) adds a view-only switch, `רווח אחרי חלק מהתקורה`. [0022](0022-after-overhead-starts-off.md) starts that switch off. Company totals stay the stored figures either way. The open question was what Home's big number shows once the owner turns the switch on.

## Decision

Home's hero number always shows company net profit: income minus all expenses, including overhead. Overhead is already inside that number. Toggling the switch does not change it.

With the switch on, the band's small figures show profit before overhead and the overhead amount. Each project row shows profit after its overhead share, allocated by income share.

The project screen with the switch on shows before overhead, then the overhead share, then after.

Evidence: [18 light](../../design/screens/18-home-overhead-on-light.png), [18 dark](../../design/screens/18-home-overhead-on-dark.png), [19 light](../../design/screens/19-project-overhead-on-light.png), [19 dark](../../design/screens/19-project-overhead-on-dark.png).

## Alternatives rejected

Changing Home's hero number when the switch is on.

## Consequences

The switch still starts off, as in 0022. Turning it on does not move transactions and does not replace the company net profit. It changes the small band figures, the project rows, and the project screen's before / share / after line.
