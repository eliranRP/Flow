# Shared costs and overhead

**Date:** 2026-09-26
**Status:** Accepted

## Context

Some costs belong to jobs but not to one job: site workers' salaries, a generator rented for several sites. Other costs are the office: rent, the accountant, insurance. Those are overhead. Putting both through the same allocation would either explode every office bill into project lines, or hide a real site cost inside `הוצאות כלליות`.

[0006](0006-confirm-not-type.md) already splits one payment by amount or percent. A split did not write a rule, because a rule mapped a supplier to one project.

## Decision

Two different treatments.

**(a) Shared project costs.** Costs that belong to projects, and are shared, are split onto projects. The split sheet can target every active project, in one of three ways:

- Equal.
- Each project's income share in the period.
- Manual percent or shekels.

The owner can save that as a recurring split rule ("split like this every month"). The next payment from the same payee arrives already split. An income-share rule recalculates each month. An equal rule uses the projects that are active when the payment arrives.

**(b) True overhead.** Office rent, the accountant, insurance, and the rest stay in company overhead (`הוצאות כלליות`). They are not split into project transactions.

Home and the project screen get a view-only toggle, "profit after overhead share". It allocates overhead to projects by each project's income share in the selected period. Turning it on does not write or move transactions. Company totals stay the same.

## Alternatives rejected

Allocating overhead onto projects as transactions. One fixed allocation key for both shared job costs and overhead.

## Consequences

The formulas, the rounding that makes shares sum exactly, and the case where income is zero, are in [calculations](../module-1-project-pnl/calculations.md#overhead-share). A project with no income in the period gets no share. If every project has no income, the allocation is unavailable and the after-overhead view is not shown.

A split rule is a [Rule](../module-1-project-pnl/spec.md#data-model). It is applied like any other learned rule: after an invoice link, before an AI guess, and the row is auto-approved. Saving one replaces a one-project rule for that payee, and the reverse is also true. One payee has one rule.

The one-project remember toggle stays off on a hand-built split. The recurring control is separate, and it is off until the owner turns it on for that save.

Whether the after-overhead toggle starts on is [open](../open-questions.md#after-overhead-by-default). The wireframes are [11-split-v2](../module-1-project-pnl/screens.md#11-split-v2), [01-home-v4](../module-1-project-pnl/screens.md#01-home-v4), and [02-project-v2](../module-1-project-pnl/screens.md#02-project-v2). They are pending owner approval. Every number on them is example data.
