# Mercury fixtures

Synthetic data in the shape of Mercury API responses. No value here comes from a real account.

The files keep the structure of real GET responses: the same fields, kinds, statuses, page cursors, and edge cases (paired autopay legs, treasury liquidation pairs, a card refund, failed check deposits, lines whose Jerusalem doc date and cash date differ). Counterparty names, descriptors, codes, bank names, GL names, the business name, ids, dates, balances, and amounts are generated. Names are labels such as `Acme Garage Doors`, `Contractor B`, `Insurer A`, or `Person B`. The only real names are the ones the adapter rules match by design: the loan servicer prefixes in `rules.ts` and Mercury's own labels (`Mercury IO Cashback`, `Mercury Credit`, `Mercury Checking ••0000`, `Treasury`). Emails are `name@example.com`, card last-fours are `••0000`, and there are no account numbers, routing numbers, or street addresses.

UUIDs are consistent across files, so cross-references still match. `canonical-snapshot.json` is the output of `postedSnapshot()` in `../replay_fixture.ts` over the two posted pages. Regenerate it with that function after any fixture change.

Never commit recorded data here. The `MERCURY_FIXTURE_DENYLIST` Actions secret holds the names and codes that must never appear, one per line, at most six words each. `normalize_test.ts` checks every fixture and every Mercury test source against it, and CI on eliranRP/Flow fails when the secret is missing. Run the check locally with `MERCURY_FIXTURE_DENYLIST="$(cat <private file>)" pnpm test:connectors`.

| File | Request | Content |
|---|---|---|
| accounts.json | GET /accounts | 9 accounts (8 checking, 1 savings) |
| credit.json | GET /credit | 1 card account (not in /accounts) |
| treasury.json | GET /treasury | 1 treasury account (not in /accounts). Its id is the counterparty on the liquidation deposits |
| categories.json | GET /categories | 23 custom categories |
| transactions-desc-page1.json | GET /transactions?limit=50&order=desc | 50 lines, 2026-07-03..07-31, `page.nextPage` |
| transactions-desc-page2.json | same + start_after=<page1 nextPage> | 50 lines, 2026-06-10..07-03, `page.previousPage` + `nextPage`, no overlap |
| transactions-status-pending.json | ?status=pending | 0 lines (the filter works: ?status=failed returned only failed) |
| transactions-status-failed.json | ?limit=5&status=failed | 5 failed debit card lines |
| transaction-by-id.json | GET /transaction/{id} | one bare Transaction object (no wrapper) |
| transaction-not-found-404.json | GET /transaction/<zero uuid> | `{status:404, body:{_error:"{\"errors\":{\"notFound\":[…]}}"}}` |
| SYNTHETIC-treasury-transactions.json | none (derived) | treasury interest, a dividend, and a withdrawal leg |
| SYNTHETIC-pending.json | none (derived) | a card line set to pending, postedAt null |
| SYNTHETIC-pending-then-sent.json | none (derived) | the same id after posting |
