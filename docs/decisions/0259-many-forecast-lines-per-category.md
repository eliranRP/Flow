# 0259 · A project's forecast takes as many added lines in one category as the owner wants

**Date:** 2026-11-06
**Status:** Accepted

## Context

The owner, 2026-11-06, from the phone: on קבועים with the הכנסות filter, הוספת קבוע opened the add sheet of a project whose forecast already had one recurring rent income in the rent category, and that category was not in the picker, so no second rent could be added. The owner's word: "There is a 2 payment for the same category we can't allow only one, the user should be able to add as many as he want."

The rule came with the first build of the forecast edits ([0186](0186-project-forecast-edits.md), design log [2026-10-18-project-forecast-edit](../design/log/2026-10-18-project-forecast-edit.md)): the category sheet left out every category the forecast already counted (an average's, a due charge's, an added line's), so a category was "not offered twice". No decision record named it; [0186](0186-project-forecast-edits.md) only limits the categories an added line may use (not hidden, not kept out of the profit, never the loan principal), and [0240](0240-month-end-forecast-counts-project-edits.md), [0243](0243-forecast-line-pace.md) and FLOW-1005 / FLOW-446 do not mention it.

The data side never had the limit: each `add` edit is its own row with its own id, its forecast row key is `add:<id>`, and the unique index `project_forecast_edits_row` covers only `kind <> 'add'`.

## Decision

1. The add sheet's category picker offers every usable category, the ones the forecast already counts included. Hidden categories, the loan principal and the ones kept out of the profit stay out.
2. A category the forecast already counts keeps its place (מוצעות לפרויקט when the project used it or a recurring charge files to it, otherwise כל הקטגוריות), and its hint says it is in the forecast, with the forecast's amount for it (its rows together): "כבר בצפי · $2,771", or "כבר בצפי" when that is zero.
3. Picking a category still sets the new line's side by the category's kind: an income category makes an income line.
4. Lines in one category live side by side on the project's next-month page, the month-end forecast and Home's expected rows; removing one leaves the others.

## Alternatives rejected

- Offering the category only when its forecast row is a recurring charge: the owner asked for as many lines as wanted, whatever the first line is.
- Opening the existing row's edit page instead of a new line: it changes the first line's amount; the owner has two payments.
- An income/expense switch on the add sheet: a separate decision.

## Consequences

- `forecastCategoryIds` is replaced by `forecastCategoryAmounts`, which feeds only the hint.
- No database change.
