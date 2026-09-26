# The implementation guide is mandatory

**Date:** 2026-09-26
**Status:** Accepted

## Context

[0024](0024-design-system-approved.md) approves the token set and the boards. A screen can still drift from them if implementation and review have no required checklist.

## Decision

[implementation-guide.md](../../design/system/implementation-guide.md) is mandatory for every screen implementation and every PR review.

That includes its definition-of-done checklist and its PR review checklist ([section 12](../../design/system/implementation-guide.md#12-checklists)).

## Alternatives rejected

Treating the guide as optional reference. Reviewing a screen against the boards alone, without the checklist.

## Consequences

A screen is not done, and a PR is not ready, until that checklist is met. Where the guide and the boards disagree, follow the rule already written in the guide: the boards and `design-tokens.json` win.
