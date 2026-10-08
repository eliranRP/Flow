# Flat categories, hide or merge when used

**Date:** 2026-09-26
**Status:** Accepted. Delete with lines replaced by [0144](0144-category-delete-and-move.md).

## Context

Contractors need enough categories to see where a job's money went, and few enough that a thumb can pick one. A tree of subcategories looks thorough and slows every review. Deleting a category that already has transactions would rewrite history or leave rows untagged.

## Decision

The proof of concept ships a flat list.

Seven expense categories are preloaded:

| Label | Meaning |
| --- | --- |
| `חומרים` | Materials |
| `קבלני משנה` | Subcontractors |
| `עבודה` | Labor |
| `ציוד והשכרה` | Equipment and rental |
| `הובלה` | Transport |
| `ביטוח` | Insurance |
| `אחר` | Other |

Two income categories are preloaded: `תקבול מלקוח` (payment from a client) and `הכנסה אחרת` (other income).

Categories are managed in Settings → Categories (`הגדרות` → `קטגוריות`): rename, add, drag to reorder, hide, and merge into another category. Delete is allowed only when the category has no transactions. A hidden category leaves the pickers and stays available to restore. New categories can also be created inline from the change sheet.

When the list grows past about 15 categories, the product hints that it is time to merge.

One level of grouping is a post-proof-of-concept option. It is not in the proof of concept.

## Alternatives rejected

Category sub-groups in the proof of concept, and allowing delete of a category that already has transactions.

## Consequences

The change sheet and the project "by category" breakdown use this flat list. Order in Settings is the order suggestions prefer. Merge reassigns existing transactions to the surviving category so reports stay tagged. Hide does not remove historical totals. The income and expense lists are separate tabs because a row is one direction.

[0086](0086-mercury.md) adds seeded `תשלומי הלוואה` (loan payments, expense) and `העברות` (transfers, one expense and one income). All three are excluded from P&L. The seven expenses above are unchanged. There is no balance-sheet model. The category flag is the exclusion. [0088](0088-loans.md) adds `ריבית משכנתא` and `מסים וביטוח`. Those two stay in the P&L.
