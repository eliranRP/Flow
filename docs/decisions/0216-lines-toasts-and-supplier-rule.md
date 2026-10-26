# The transaction page's toasts hang under its bar, and a category change offers the supplier's next lines

**Date:** 2026-10-26
**Status:** Accepted (owner, 2026-10-26, FLOW-965: the Lines v2 board and its owner call. Extends [0212](0212-review-toast-under-header.md)'s top place to the transaction page; builds on [0063](0063-owner-ledger.md) and [0064](0064-review-round4.md)'s remembered category)

## Context

FLOW-965 reviewed a month's lines and the transaction page against a UX/UI rule set. On the transaction page a project, category or counts-in change toasted above the tab bar for 3 seconds (0182), far from the rows the owner had just changed, and gone before a thumb could reach ביטול. A category change also stayed with that one line: a supplier filed the same way every month had to be fixed line by line, though a sync already gives a supplier's new expense lines its remembered category (0063), which only an approval in לאישור could set (0064).

## Decision

1. On the transaction page, the project and category toast ("השיוך נשמר"), the counts-in switches' toasts ("נספר ברווח", "הוצא מהתזרים" and the others) and the rule's toasts hang under the page's top bar (`place: "top"`, the bar is the toast ceiling), and their ביטול stays 5s. A failure toasts there too, with 0182's times. Toasts the page's other cards raise (the recurring sheets, a loan split, notes and files) keep their own place.
2. A change of category on an expense line with a supplier, not a split or shared line, is followed by one offer under the project and category rows: "להכניס גם את השורות הבאות מ־<supplier> לקטגוריה <category>? שורות קודמות לא משתנות." with two outlined 44px answers of equal weight, כן, מעכשיו and רק השורה הזו.
3. כן, מעכשיו remembers the line's category for the supplier (`remember_line_category`); the supplier's next lines from a sync get it. Earlier lines never change. The toast says "מעכשיו כל השורות מ־<supplier> ייכנסו ל<category>" with ביטול for 5s, which puts back what the supplier had (`forget_line_category`), and is a conflict once the supplier remembers something else. רק השורה הזו closes the offer and writes nothing. A new pick or ביטול on the pick closes it too.
4. A loan category is not remembered (it is fixed by the loan), nor a line with no supplier: an income line has a customer, not a supplier, and no remembered category.
5. A project change has no offer. A sync never gives a new line a remembered project (0080's open question: nothing writes `remembered_project_id`), so the offer would promise what nothing does.
6. MCP `remember_supplier_category` is the same write, with undo kind `supplier_category`.

## Alternatives rejected

- A switch in the change sheet ("גם לשורות הבאות"), as לאישור's remember: the board puts the question after the change, where the owner sees it took.
- Offering on a project change and saving `remembered_project_id`: nothing reads it at sync, so the next lines would not follow.
- Moving the earlier lines too: the board and the owner's call say earlier lines stay; that is what moving a category's lines (0144) is for.
