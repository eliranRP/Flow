# Project budget stays optional

**Date:** 2026-09-26
**Status:** Accepted

## Context

A project can carry a budget, and the project screen can show expenses against that budget. The create sheet already labels budget optional (`תקציב (אופציונלי)`), and the project wireframe captions the budget bar `אופציונלי`. The open question was whether the proof of concept should require a budget on every job.

## Decision

Budget stays optional. Budget versus actual appears on the project screen only when a budget is set.

A project with no budget still has income, expenses, and profit. The budget card is omitted.

## Alternatives rejected

Requiring a budget on every project in the proof of concept.

## Consequences

Create project still requires a name only. Client and budget can be empty and filled later from the project menu. Reports do not invent a budget, and a missing budget is not an error. The example on [02-project](../module-1-project-pnl/screens.md#02-project) shows the card because that job has a budget of ₪1,000,000.
