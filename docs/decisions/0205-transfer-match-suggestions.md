# A transfer between two Mercury connections is suggested, and the user decides

**Date:** 2026-10-21
**Status:** Accepted (the owner's rule of 2026-10-21, FLOW-941. Builds on [0203](0203-mercury-connections-and-synced-accounts.md))

## Context

Since [0203](0203-mercury-connections-and-synced-accounts.md) a company can hold several Mercury connections, one per organisation's key. A transfer between two synced accounts is skipped when Mercury names the other account (`own_account_transfer`, across connections too). Between two organisations Mercury may name a recipient instead of the other account's id, so the transfer cannot be matched at sync time and comes in as two lines: money out on one connection and money in on the other. Both then count as an expense and an income. The owner's rule (verbatim): "Yes match, but let the user decide if this match is correct or not, so the user can review this suggestion and decide if this is a real match or a coincidence."

## Decision

1. **The answer.** `transfer_matches` keeps the company's answer for a pair (`out_transaction_id`, `in_transaction_id`): a transfer (`same` true) or a coincidence (false). RLS on and no client grant: only the functions below read and write it. A line is in one confirmed pair at most (two partial unique indexes).
2. **The suggestion is worked out on read** (`private.transfer_match_pairs`), as the invoice bank match ([0133](0133-invoice-paid-marks.md) family) and the recurring suggestion ([0179](0179-recurring-match.md)) are. The sync does nothing new, so it is not slower, and the answer is the same however often it runs. Only a company with two or more chosen Mercury connections is read; the rest return at once. A pair is:
   - a posted Mercury money-out line (not a refund) and a posted Mercury money-in line,
   - each on a synced account (`sync_account_ids`, every listed account when null) of a different connection,
   - the same amount and currency (`amount_original`, `currency`), dated within 3 days,
   - both still counted in the profit (not already a transfer, a loan part or kept out; a guessed category does not count),
   - neither split by category, a loan payment, an invoice's linked deposit or in a confirmed pair,
   - and the pair not rejected.
   Each line is in one suggestion at most: the closest dates first, then a name hint (one side's payee shares a word of 3 letters or more, not a company suffix, with the other organisation's name), then the newest. Up to 100 pairs.
3. **Confirming** (`answer_transfer_match(out, in, true)`, owner or editor, [0167](0167-team-members.md)) files both lines the way Flow files a transfer to an own account it does not skip ([0086](0086-mercury.md)): the category העברות of the line's kind when the company has one (as the owner's pick: `user_assigned`, `category_assigned`), and out of the profit (`in_pnl_override` false) and the cash view (`in_cash_override` false) even if that category was renamed or deleted. An open review of either line is set aside as a skip with its fingerprint, so the sync does not queue it again; the skipped list can still reopen it. The pair must still fit rule 2's shape (posted Mercury lines, out then in, two connections, same amount and currency, 3 days) and neither line may be in another confirmed pair (`already matched`), split or a loan payment.
4. **Rejecting** (`false`) only records the answer: the lines stay as they are, the pair is never suggested again, and each line may pair with another one.
5. **Taking it back** (`null`, the app's ביטול and the MCP undo). A confirmed pair's lines get back, field by field, what the confirmation changed, while the field still holds what it wrote (an edit made since is kept); the reviews it set aside reopen while the line has no other open review. The answer row goes, so the pair is suggested again. `prior_same` comes back for the toast's undo.
6. **Where the user sees it.** Home's "דורש טיפול" box gets a count row under the review row, "2 העברות לבדיקה · בין חשבונות Mercury", only when there is one. It opens `/transfers` (העברות לבדיקה), a lazy screen: a short line on what a pair is, then one card per pair in the recurring match box's pattern (the tint, the question "זו העברה בין החשבונות שלכם?", the money out and the money in with account, last 4, organisation, date and amount, the days between and the name hint, then "כן, העברה" and "לא, צירוף מקרים"). Each answer hides the card and toasts with ביטול ("סומן כהעברה", "לא נציע שוב"). A viewer sees the cards with no answers.
7. **MCP ([0095](0095-mcp-first.md)).** `list_transfer_matches` reads the suggestions (any member); `confirm_transfer_match` and `dismiss_transfer_match` answer through `mcp_answer_transfer_match`, with the idempotency key, the write rate limit and undo kind `transfer_match` (id: the money-out line), a conflict once the pair was answered again.

## Alternatives rejected

**Match at sync time in the engine.** The two lines come from two connections, synced one after the other and each with its own cursor; a pair only exists once both are in, the engine would need the other connection's stored lines, and the owner's rule is that Flow never matches by itself.

**A stored suggestions table filled after sync.** It needs a job or a trigger to keep it in step with every edit, review and re-sync of either line, and a stale row when a line changes. Read time is cheap here: two Mercury lines a company already holds, joined on amount and currency, behind a two-connection gate.

**A card in the review queue.** The queue is one line at a time and its approve path needs a project for an expense; a pair is two lines and needs neither. Home's box already lists other questions (late bills, changed charges) as their own rows.

**Leave the categories alone and only switch the lines out of the profit and cash.** The line would keep asking for a category in review and read as a supplier's expense in search; העברות is how the books already show a transfer.

**A row on the Mercury connection page.** The owner opens it rarely; the question needs to reach them where the other questions do.

## Consequences

- Nothing changes until someone answers. A confirmed pair leaves income and expenses (the profit and the cash view) and both lines read העברות.
- A company with one connection, or none, never reads the pairs.
- A transfer inside one organisation is still skipped at sync time (0203); this covers only two organisations.
