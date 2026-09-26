# Confirmation sheets for destructive actions

**Date:** 2026-09-26
**Status:** Accepted

## Context

Delete, archive, hiding a category, and merging categories remove or combine something the owner may not mean to lose. [0008](0008-flat-categories-hide-or-merge.md) already says a used category is hidden or merged, not deleted outright.

## Decision

Destructive actions use a confirmation sheet: delete, archive, hide category, and a two-step merge of categories.

The confirm control is a soft bad-tint button. After the action, an undo toast.

Evidence: [20 light](../../design/screens/20-confirm-delete-light.png), [20 dark](../../design/screens/20-confirm-delete-dark.png), [21 light](../../design/screens/21-confirm-archive-light.png), [21 dark](../../design/screens/21-confirm-archive-dark.png), [22a light](../../design/screens/22a-merge-pick-light.png), [22a dark](../../design/screens/22a-merge-pick-dark.png), [22b light](../../design/screens/22b-merge-confirm-light.png), [22b dark](../../design/screens/22b-merge-confirm-dark.png), [23 light](../../design/screens/23-confirm-hide-light.png), [23 dark](../../design/screens/23-confirm-hide-dark.png).

## Alternatives rejected

A destructive action with no sheet. A hard filled red button. Merge as a single step.

## Consequences

Those four actions are not one tap. Merge is pick, then confirm. What `מחק` removes on transaction detail stays [open](../open-questions.md#delete-on-transaction-detail). This record is the sheet, not that answer.
