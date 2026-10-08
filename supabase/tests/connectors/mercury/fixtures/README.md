# Mercury fixtures

Generated test data in the shape of Mercury API responses. Every file here is written by [`../generate_fixtures.ts`](../generate_fixtures.ts) from one seed. Nothing here was recorded from an account.

The generator draws ids, times, amounts, balances, merchant ids and page cursors from a seeded random stream. Each value has its own key, so adding a row does not move the others. Names are labels such as `Acme Garage Doors`, `Contractor B`, `Insurer A`, or `Person B`. The only real names are the ones the adapter rules match by design: the loan servicer prefixes in `rules.ts` and Mercury's own labels (`Mercury IO Cashback`, `Mercury Credit`, `Mercury Checking ••0000`, `Treasury`). Emails are `name@example.com`, card last-fours are `••0000`, and there are no account numbers, routing numbers, or street addresses.

Rebuild every file after changing the generator:

```sh
deno run --allow-read --allow-write supabase/tests/connectors/mercury/generate_fixtures.ts
```

`../fixtures_test.ts` fails when a committed file differs from the generator output by one byte, and when a JSON file here is not one the generator writes. Do not edit a fixture by hand; change the generator and rebuild. `canonical-snapshot.json` is `snapshotOf()` in `../replay_fixture.ts` over the two posted pages, so it is rebuilt with the rest.

The generated rows cover the edge cases the adapter handles: paired autopay legs between own checking and the own credit card, cashback, treasury liquidation pairs (one settling days later), transfers between own checking accounts, loan servicer payments, a card refund linked to its charge, one check deposit that failed five times and cleared once, failed debit card lines with an authorisation hold in a foreign merchant currency, and lines whose Jerusalem doc date and cash date differ.

The `MERCURY_FIXTURE_DENYLIST` Actions secret holds names and codes that must never appear here, one per line, at most six words each. `normalize_test.ts` checks every fixture and every Mercury test source against it, and CI on eliranRP/Flow fails when the secret is missing. Run the check locally with `MERCURY_FIXTURE_DENYLIST="$(cat <private file>)" pnpm test:connectors`.

| File | Request it stands for | Content |
|---|---|---|
| accounts.json | GET /accounts | 9 accounts (8 checking, 1 savings) |
| credit.json | GET /credit | 1 card account (not in /accounts) |
| treasury.json | GET /treasury | 1 treasury account (not in /accounts). Its id is the counterparty on the liquidation legs |
| categories.json | GET /categories | 23 custom categories |
| transactions-desc-page1.json | GET /transactions?limit=50&order=desc | the 50 newest lines, 2026-07-03..07-31, `page.nextPage` |
| transactions-desc-page2.json | same + start_after=<page1 nextPage> | the next 50 lines, 2026-06-10..07-03, `page.previousPage` + `nextPage`, no overlap |
| transactions-status-pending.json | ?status=pending | no lines |
| transactions-status-failed.json | ?limit=5&status=failed | 5 failed debit card lines |
| transaction-by-id.json | GET /transaction/{id} | one bare Transaction object (no wrapper), the first line of page 1 |
| transaction-not-found-404.json | GET /transaction/<zero uuid> | `{status:404, body:{_error:"{\"errors\":{\"notFound\":[…]}}"}}` |
| SYNTHETIC-treasury-transactions.json | GET /treasury/{id}/transactions | treasury interest, a dividend, and a withdrawal leg |
| SYNTHETIC-pending.json | none | a card line still pending, postedAt null |
| SYNTHETIC-pending-then-sent.json | none | the same id after posting |
| canonical-snapshot.json | none | the normalised posted lines, skips and counts |
