# Review queue

**Status:** Approved. Wireframe [03-review-v2](../wireframes/03-review-v2.png). [03-review](../wireframes/03-review.png) is superseded.
**Queue:** Suggested rows only. A unique invoice match or an existing supplier rule never enters the card ([0011](../../decisions/0011-auto-approve-high-confidence.md)). Those rows show in the strip `12 אושרו אוטומטית` (the count is `{n} אושרו אוטומטית`). `הצג` opens the list. There is no `אשר הכל` button.

## Purpose

The owner confirms the rows Flow would not auto-approve. One card at a time. Approve, change, split, skip, or mark a transfer.

## Entry points

| From | How |
| --- | --- |
| Home banner | Opens the oldest suggested row. |
| Bottom nav `לאישור` | Same. The badge is the suggested count. |
| Upload results | `לאשר {n} פריטים` opens the queue filtered to that file's suggested rows. |
| Project pending line | Filtered to that project's suggestions. |

When the filtered set is empty but the company queue is not, show the filter's empty state rather than silently switching filters.

## Where taps go

| Tap | Goes to |
| --- | --- |
| `אישור` | Approves the suggested project and category shown on the card, in one tap. Disabled, with a not-allowed cursor, only when the card says there is no suggestion. |
| `שינוי`, or a chip | Change sheet. On save, the row is approved and the next card shows. |
| `פצל` | Split flow on the change sheet. |
| `דלג` | Leaves the row suggested. It moves behind the other rows in this visit and will come back. |
| Thumbnail | Document viewer: the photo or PDF, pinch zoom. Close returns to the same card. |
| `העברה בין חשבונות` | Marks the row as a transfer. It leaves the queue and never counts. Shown only on bank rows. |
| Invoice candidates | Ticking invoices is part of the card when candidates exist. |
| Back / nav | Leaves the queue. Skipped rows stay suggested. |

`אישור` is enabled when the card shows a complete suggestion, and disabled when it says `אין הצעה, בחרו בשינוי`. A deposit still needs a category. Overhead and an unsplit shared cost open Split instead of assigning one project.

## Elements and fields

Header `לאישור`. Subtitle `מה שה-AI לא היה בטוח בו`. Counter `{i} מתוך {n}` and a progress bar of `n` segments, `i` filled. `n` is the length of this visit's queue. Skip does not reduce `n`.

| Element | Hebrew | Source and format |
| --- | --- | --- |
| Thumbnail | `חשבונית` or none | The linked document. Bank rows with no document omit the thumbnail. |
| Source | `חשבונית מצולמת`, `שורת בנק`, or `הזנה ידנית` | The transaction source. |
| Counterparty | Supplier or payer name | Full wrap, up to three lines. |
| Date | `dd/mm/yyyy` | Cash date. |
| Amount | Net, whole or two decimals | [Detail display](../calculations.md#rounding). The big figure is net, neutral (it is not profit). |
| VAT | `לפני מע״מ · מע״מ {amount}` | `vat_agorot`. When VAT is 0, the line is `פטור ממע״מ`. |
| Project row | `פרויקט` | The suggested project. No confidence number. |
| Category row | `קטגוריה` | The suggested category. A project without a category is filled from the supplier rule, then history, then the default category, so the row is approvable. |
| Candidates | `חשבוניות אפשריות` | Unpaid invoices that might match. Each shows supplier, date, remaining net. |
| Next | `הבא בתור` | A dimmed preview of the following row: name, source, date, amount. Not tappable. |
| Transfer | `העברה בין חשבונות` | Text button under skip, bank rows only. |

The caption `אחרי שינוי – נזכור את הבחירה לספק הזה` sits under the buttons. It is accurate when the owner changes the suggestion: the change sheet's remember toggle defaults on. A plain `אישור` of the AI chips does not write a rule.

## States

**Loading.** Skeleton card. The badge stays at the last known count.

**Empty.** Title `לאישור`. Body `אין פריטים לאישור`. One call to action: `חזרה הביתה`. No approve button, no skip.

**Normal.** One card, as above.

**Partial.** This screen is the partial state of the company. There is no second "partial" mode. The counter is the work left.

**Error.** If the card's document fails to load, the card still shows the extracted fields and a broken thumbnail with `לא הצלחנו להציג את המסמך`. Approve still works. If the queue itself fails to load, `לא הצלחנו לטעון` and `נסו שוב`.

**Offline.** Rows already on the device can be approved, changed, and split. The decision syncs later. A row that still needs an AI guess and has no guess cached shows `ממתין לרשת` in place of the chips, and approve stays disabled until a suggestion exists or the owner opens the change sheet and picks both fields manually. Manual pick works offline.

## Edge cases

- **Duplicate invoice photo.** Never creates a second review card. The existing document is opened from Add.
- **Same statement twice, or overlapping dates.** Duplicate rows are not queued. See [calculations](../calculations.md#duplicate-imports).
- **One bank row, two invoices.** Both candidates show. Approve stays disabled until the owner ticks a set whose remaining nets sum exactly to the payment, or ignores the invoices and picks a project and category anyway. Ticking a set that sums exactly, then `אישור`, links them and approves. There is no auto-approve on this card.
- **Partial payment.** The owner links one invoice whose remaining net is larger than the payment. Flow asks `תשלום חלקי?` and, on confirm, links the payment and leaves the remainder unpaid and out of P&L.
- **One payment, several invoices.** The owner ticks more than one. `אישור` is enabled only when the ticked remainders sum to the payment in agorot. Otherwise the card shows the difference (`חסר {amount}` / `עודף {amount}`).
- **Refund or credit note.** The card shows a positive net (money in) in the detail format. The suggested category follows a supplier rule only if this row were high confidence; on this screen it is a guess. The owner can pick the expense category so the refund reduces expenses.
- **Split.** Lines must sum to the card's net before save. Remember-rule is off. Spec is on the [change sheet](06-change-sheet.md).
- **Move after approval.** Not done from this queue. Open the transaction on the project and use the change sheet.
- **Finish or delete a project that is the current suggestion.** If it was finished, the chip remains (the owner may still file a late bill). If it was deleted, the chip clears and approve disables until a new project is chosen.
- **Category merge.** A chip that pointed at the removed category now shows the surviving category.
- **Overhead.** The owner can assign overhead from the change sheet. The queue does not offer overhead as an AI chip unless the guess was overhead.
- **VAT-exempt.** VAT line reads `פטור ממע״מ`. The big number is the net.
- **Client deposit, no known project.** Project chip empty, approve disabled, subtitle on the chip `בחרו פרויקט`. Flow does not default the chip to overhead.
- **Non-Hapoalim file.** Produces no cards.
- **Long Hebrew names.** Counterparty wraps to three lines, then ellipsis.
- **0 projects.** The change sheet offers overhead and `+ פרויקט חדש`. Approve stays disabled until one of those is chosen.
- **Mark transfer.** The row is excluded. It does not count as approved income or expense. The undo is not in the proof of concept; the owner re-imports only if the file is not a byte-identical duplicate, so this action asks `להוציא מהרווח?` before it commits.

## Acceptance criteria

- [ ] No auto-approved row appears in the queue.
- [ ] `אישור` files the suggested project and category, and the next card is the next suggestion.
- [ ] `אישור` does nothing while project or category is empty.
- [ ] Two invoice candidates never auto-link. The owner has to tick a set that sums to the payment.
- [ ] A partial link leaves the unpaid remainder out of every report.
- [ ] Skip keeps the row suggested and out of the tiles.
- [ ] Empty queue has one action, `חזרה הביתה`.
- [ ] Amounts are net of VAT, dates are `dd/mm/yyyy`, and a negative cash amount is red with a minus.
