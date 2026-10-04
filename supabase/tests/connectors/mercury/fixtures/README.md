# Mercury fixtures

Recorded from a Read Only token, GET only, then pseudonymised for a public repository.

Personal names are replaced with Person labels on the counterparty and the description. Business names the category rules match are unchanged: loan servicers (NEWREZ, Lakeview, Servease), insurers, utilities, and the other merchants on the lines. `counterpartyNickname` is null, including the lines whose street names had only their digits masked. Emails are `name@example.com`. Notes, memos, and tracking numbers are null. Card last-fours are `••0000`. Account numbers, routing numbers, and street addresses are not in these files.

Every UUID (ids, accountId, counterpartyId, cardId, category ids, and page cursors) is pseudonymised consistently across files, so cross-references still match. The salt was not stored. Kinds, statuses, dates, and amounts are the recorded values. The token was never written to disk.

| File | Request | Content |
|---|---|---|
| accounts.json | GET /accounts | 9 accounts (8 checking, 1 savings) |
| credit.json | GET /credit | 1 card account (not in /accounts) |
| categories.json | GET /categories | 23 custom categories |
| transactions-desc-page1.json | GET /transactions?limit=50&order=desc | 50 lines, 2026-09-04..10-02, `page.nextPage` |
| transactions-desc-page2.json | same + start_after=<page1 nextPage> | 50 lines, 2026-08-12..09-04, `page.previousPage` + `nextPage`, no overlap |
| transactions-status-pending.json | ?status=pending | 0 lines (the filter works: ?status=failed returned only failed) |
| transactions-status-failed.json | ?limit=5&status=failed | 5 failed check deposits |
| transaction-by-id.json | GET /transaction/{id} | one bare Transaction object (no wrapper) |
| transaction-not-found-404.json | GET /transaction/<zero uuid> | `{status:404, body:{_error:"{\"errors\":{\"notFound\":[…]}}"}}` |
| SYNTHETIC-pending.json | none (derived) | a card line set to pending, postedAt null |
| SYNTHETIC-pending-then-sent.json | none (derived) | the same id after posting |
