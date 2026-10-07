# Bank details per line

**Date:** 2026-10-07
**Status:** Accepted

## Context

Mercury sends each line with how the money moved, the card used, a memo, and the account, but the connector kept only the provider's kind and category. The owner had to open the bank to see which card paid or what the memo said (FLOW-304). The acceptance is strict: no account number beyond the last 4 anywhere.

## Decision

1. The connector keeps four more fields in `transactions.provider_meta`: `method` (`card`, `ach`, `wire`, `check`, `transfer`, `other`), `card_last4`, `memo` and `account_id` (the provider's account id, never an account number). `method` comes from the provider's kind and which routing block the line has; only the block's presence is read. `card_last4` comes from the card's "••1234" label and is kept only when it is exactly 4 digits. `memo` is the sender's memo, else the team's note, redacted and capped at 200 characters. Redaction replaces every run of 4 or more digits with `****` (the Mercury redactor), so a memo from Mercury keeps no number of 4 digits or more.
2. `private.clean_provider_meta` is the one allowlist for `provider_meta` on insert and update in `upsert_connector_lines`. Any other key is dropped. A run of 5 or more digits in the memo keeps its last 4 (`private.mask_long_digits`).
3. `public.get_line_meta(p_ids)` returns `{transaction_id, method, card_last4, memo, account, counterparty, bank_description}` for up to 200 lines of the caller's company. `account` is the connection's label for `account_id`, with masked digits dropped. Lines imported earlier get `method` from their stored kind. The memo and the bank text are masked again on read.
4. flow-mcp `get_expense`, `list_review` and `search_expenses` carry the same object as `meta`. A failed read fails the tool, so a row never looks like it has no bank details when the read was refused.
5. The app shows it as the design session's option A ([mockups](https://claude.ai/artifact/4Wsob4i3XEuLcMgX4SRj3M)), under the owner's standing rule for UI tasks: one compact line on the review card (an icon and ••4242, or ACH, העברה בנקאית, צ׳ק), a memo line when there is one, and a static "פרטי הבנק" section on the transaction screen (אמצעי תשלום, חשבון, נמען or משלם, הערה, תיאור בבנק), one row per known field. A line with no bank details looks as before.

The design session compared chips on the card with a collapsible row on the detail (rejected: chips read as tappable status, wrap at 320, and the detail hid the method behind a tap) and an ⓘ sheet (rejected: nothing readable without a tap, and a new sheet).

## Consequences

A re-sync fills the new fields on lines already imported; until then those lines show the method from their kind and no card digits. A Mercury memo shows `****` for any number of 4 digits or more, invoice numbers included ("Invoice 1042" reads "Invoice ****"); the database mask, which keeps the last 4 of a run of 5 or more, is the guard for any other writer. SUMIT lines carry no bank details yet.
