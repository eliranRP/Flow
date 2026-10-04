# Mercury is a read-only bank connector

**Date:** 2026-10-03
**Status:** Accepted

## Context

The owner has a Mercury account. SUMIT does not carry those lines. [0036](0036-sumit-read-only.md) keeps SUMIT read-only. Open banking and statement-file import stay out of scope ([0065](0065-review-round5.md) point 40). Mercury is neither of those: the owner pastes a token.

## Decision

The owner pastes Mercury's Read Only token in Settings. Flow calls GET only. The token is sealed with `MERCURY_KEK`. New seals use envelope format 3, which binds the company id and the provider. The client never receives it.

Import every Mercury line, in and out, including income. There is no switch to hide a direction. Skip only a transfer between the company's own accounts. SUMIT lines and Mercury lines never describe the same movement, so nothing is deduped.

A Mercury line has no VAT. The VAT amount is 0 and the status is `source`.

A pending line appears in לאישור (the review queue) with the tag ממתין (pending). It is in no P&L and no total until it is posted. A failed, cancelled, reversed, or blocked line leaves the books.

A payment whose counterparty is NEWREZ, Lakeview, or Servease is hinted to the seeded expense `תשלומי הלוואה` (loan payments). That category is excluded from P&L and still shows as cash in לאישור. A transfer to an own account that is not connected is hinted to `העברות` (transfers). The expense row and the income row are both seeded and both excluded from P&L, and the hint matches the line's direction. An `IO Cashback` credit is hinted to `הכנסה אחרת` (other income). A card refund stays an expense in the original category. The flag and the sums are in the [connector contract](../tech/connector-contract.md).

Account numbers, routing numbers, emails, and attachment URLs are not stored. The card account id used for the own-account check comes from `GET /credit` and is kept only as an id in the skip set, not as a stored account number.

The field rules, status map, and allowlist are in [the connector contract](../tech/connector-contract.md).

## Alternatives rejected

A read-write token. Skipping income. Deduping against SUMIT. Treating a Mercury line as VAT-inclusive. Hiding pending lines. Keeping failed lines as expenses. Importing per checking account and missing the card. Storing account or routing numbers.

## Consequences

Card spend is one expense line. The autopay that moves money from checking onto the card is skipped, so it is not a second expense. A window of lines is not a full listing, so a missing page does not delete history.

Loans and amortization are accepted in [0088](0088-loans.md).
