<a id="flow-131"></a>
# FLOW-131 · Loan balance checks follow-ups (#127 review)
- **Type:** BACKLOG NIT · **Status:** done (#129, #134) · **Depends on:** FLOW-123 (#127)
- [x] MCP `list_loans` returns only `balance_minor`, so the data agent cannot see a payment the bank sync flagged for review. Return `flagged_parts` (or the flagged transaction ids). (#129: both, migration `20261008080000`.)
- [x] A line posted while another write holds the loan is flagged even when it fits (`skip locked`). The owner has to clear it; consider a hint in the review UI (through the Mercury thread). Handed to the Mercury thread; the MCP side is covered by `flagged_transaction_ids`. (#134: `needs_review` is one boolean with no reason, so a busy loan, a payment past the balance and a re-synced amount look the same; the split card says "ייתכן שהתשלום סומן כי נרשם בזמן עדכון אחר של ההלוואה. עדכון החלוקה יבדוק את היתרה מחדש." above עדכון החלוקה, and a refused re-check toasts "התשלום גבוה מיתרת ההלוואה.". UI only.)
- [x] The lock order is checked by hand with two sessions. Add a two-session pgTAP test (dblink) if CI has it. (#129: `loan_lock_order.test.sql`.)
