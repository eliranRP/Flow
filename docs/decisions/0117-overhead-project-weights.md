# Overhead project out of the overhead weights

**Date:** 2026-10-07
**Status:** Accepted

## Context

[0101](0101-unassigned-and-overhead-project.md) lets a company name one project as its overhead project. Its cost counts as overhead, but its income stayed in the weights of the after-overhead view (`private.overhead_share`). So when the overhead project had income, part of the overhead was charged back to the project that holds it, and the real projects carried less than all of it. Found in the #71 review (FLOW-116).

## Decision

- The overhead project is left out of the weights. `I` in [Overhead share](../module-1-project-pnl/calculations.md#overhead-share) is the income of every other project, and the overhead project's share is 0. Its income still shows on the project and counts in the company total.
- If the overhead project is the only project with income, `I` is 0 and the after-overhead view is unavailable, as for any company with no project income.
- MCP `undo` kind `overhead_project` is `conflict` when the project it would go back to was deleted since, like the other undo kinds. It was `refused` / `project not found`.
- The owner was asked on 2026-10-07; this is the recommended answer and can still be reversed.

## Alternatives rejected

- Keeping the overhead project in the weights: overhead charged back to the overhead project is circular and hides cost from the projects that cause it.

## Consequences

Company totals do not change. On a company with an overhead project that has income, each other project's overhead share grows and the overhead project's share drops to 0.
