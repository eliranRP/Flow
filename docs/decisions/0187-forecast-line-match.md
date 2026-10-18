# A bank line the user's project forecast expects is filed as that forecast line

**Date:** 2026-10-18
**Status:** Accepted

## Context

Decision [0186](0186-project-forecast-edits.md) lets the user add a line to a project's next-month forecast: a category, a direction and an amount, once or on a pace. The owner asked: "If the user enters that he expects to spend 2,500 on rental for this project next month, and next month this expense comes, I would expect Jev to recognize it as the user put it in the forecast, with all the data he needed." The bank line should then arrive already filed to that project and category, with or without Jev, and the forecast should not count it twice.

## Decision

- **The match.** `private.forecast_line_match(company, ids)` finds, for each bank line, the best `add` edit it fits:
  - the same company, an active project, and a category a forecast line may take (0186);
  - the line's sign is the edit's direction: an expense is a negative amount, income a positive one (a refund never matches an expense line), and the line's direction is the edit's too;
  - the line's month (`doc_date`, the month the books file a line in) is the edit's `start_month` or a later month on its pace, and the added line is not removed from that month;
  - the line's currency is the company's base currency, the currency the project forecast shows;
  - the amount: the line's net or gross amount, without its sign, is within max(10% of the expected amount, 1.00 of the currency) of it. The expected amount is the added line's, or the change of that line for the month (the latest start wins, as in the forecast). Net or gross, because a user types the figure from the bank or the invoice;
  - a line whose category is firm (not a guess and not a default: a supplier rule or a bank hint) fits only an edit of that same category, since a rule of another category says it is another cost;
  - one line per edit and month. Of the pairs that fit, the closest amount wins, then the earliest edit, then the earlier line; a line or edit month already taken is skipped, and an edit month another line holds stays with it.
- **Remembered.** `public.forecast_line_matches` (company, edit, month, transaction, the expected amount, matched_at), unique on (edit, month) and on the transaction. RLS is on with no grants to the app's roles; only security-definer functions read it.
- **At sync, with Jev off too.** `upsert_connector_lines` runs `private.forecast_line_sync` over the lines that sync touched, just before `sync_review_queue`, after the supplier rules. A line nobody set (not `user_assigned`, `project_assigned` or `category_assigned`; not shared or overhead, at most one allocation) takes the edit's project (an expense with its one allocation, like Jev's pre-fill; `pnl_role` unchanged) and, unless its category is firm, the edit's category with `category_suggested`. So the forecast line wins the project, and wins the category only from a guess or no category. The match is recorded. A line the owner set is never changed: it keeps or gets a match only when its project and category already are the edit's. A touched line that no longer fits (the bank changed its amount) loses its match.
- **Dropped.** A trigger drops the match when its line is removed or voided, moves to another month, or is filed to another project or category (by the owner, a re-sync or Jev). Filing it elsewhere says it is not that forecast line. Deleting or resetting the added line drops it too (cascade). Approving the line as suggested keeps it.
- **Shown.**
  - `list_review` carries `forecast_match` `{month, amount_minor, category_name, project_name}`. The review card's reason line reads "לפי הצפי שהוספת לנובמבר: שכירות $2,500", with Jev off, and when Jev's reason is the forecast line; Jev's own reason wins when Jev suggests something else.
  - `private.jev_suggestions_for` gives reason `forecast_line` and `forecast_month` when the line has a match and Jev's suggestion agrees with its project and category. It comes before the party reasons.
  - The jev-tag job reads `jev_forecast_lines` and sends the model `expected_line` (month, amount, category and project names). A failed read tags the line without it.
- **The forecast.** `project_forecast_edits_for` gives an added line `matched_transaction_id` for the month. `applyForecastEdits` leaves a matched added line out of the rows and the totals and lists it under `arrived`, as the month forecast stops expecting a recurring charge seen this month.
- **MCP.** `list_review` (`forecast_match`), `get_jev_suggestions` (the reason, `forecast_month`) and `get_project_forecast_edits` (`matched_transaction_id`) say so. There is no new write: the owner files or re-files a line with the existing tools.

## Alternatives rejected

- Matching only in Jev: the owner wants it with Jev off, and a deterministic match is cheaper and explainable.
- The forecast line always winning the category: a supplier rule is the owner's own choice; it should not be overwritten by a guess.
- Matching any line to any edit of the project regardless of category: a supplier rule of another category would file a cost under the wrong forecast line.
- Keeping the match after the owner files the line elsewhere: the owner just said it is not that line, and the forecast would count it as arrived.
- A tolerance on the net amount only: an ILS invoice net of VAT would miss a figure the user typed with VAT.

## Consequences

- A line matches only when a sync touches it: an added line saved after its bank line came does not file that line until the next sync of it.
- A forecast line in another currency than the company's books never matches.
- The next-month page shows next month, which has not started, so `arrived` is empty there in practice; the logic keeps a line from being counted twice if one comes early.
- Approving the suggested line keeps the match: the forecast line counts as arrived for that month.
