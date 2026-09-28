# Add sheet

**Status:** Approved. Wireframe [04-add](../wireframes/04-add.png), drawn over Home. The sheet is the same from every tab.
**Bank files:** Not a build task. The add sheet has no bank row ([0066](../../decisions/0066-review-round7.md)). Bank lines come from the SUMIT sync.

## Purpose

The single entry for new data: an invoice photo or PDF, or a manual cash/cheque line. There is no bank row. The owner does not type a classification on this sheet. Flow classifies afterwards.

## Entry points

The center `+` on any tab. Tap outside the sheet or `ביטול` closes it and changes nothing.

If Home's empty state button `+ פרויקט חדש` was used, that opens the create-project sheet, not this one.

## Where taps go

| Tap | Goes to |
| --- | --- |
| `צלם חשבונית` | The camera, several photos in a row, or a PDF or image from files on the phone. [0020](../../decisions/0020-capture-from-the-phone.md). |
| Bank lines | Not on this sheet. They arrive with the SUMIT sync. |
| `הזנה ידנית` | Manual form, below. Not on the wireframe. |
| `ביטול` or the scrim | Dismiss. |

## Elements and fields

Sheet title `הוספה`. Subtitle `ה-AI ישייך לפרויקט ולקטגוריה – אתה רק מאשר`.

| Row | Hebrew | What it captures |
| --- | --- | --- |
| Invoice | `צלם חשבונית` / `מצלמה או PDF · קורא ספק, סכום, מע״מ ותאריך` | Several photos in one visit, or one PDF or image picked from the phone. Each file is its own document. Android, once Flow is installed, can share one image or PDF into this same path. iPhone cannot, and the sheet does not offer a share action. A WhatsApp or email forwarding address is after the proof of concept ([open questions](../../open-questions.md#forwarding-address)). |
| Bank lines | — | Not a row. SUMIT brings them. |
| Manual | `הזנה ידנית` / `סכום, פרויקט וקטגוריה – במקרה הצורך` | Cash or cheque. |
| Cancel | `ביטול` | |

### Manual form

Opened from `הזנה ידנית`. This is the paid-cash path. Saving creates an approved transaction only after project and category are set; otherwise it cannot be saved. There is no AI step, because the owner is the one who knows the cash left their pocket. The remember toggle is on the form, default on, same as the change sheet.

| Field | Hebrew | Rule |
| --- | --- | --- |
| Amount net | `סכום לפני מע״מ` | Required. Agorot. Detail display. |
| VAT | `מע״מ` | Default from [the VAT rule](../calculations.md#vat). The owner can set 0. |
| Date | `תאריך` | `dd/mm/yyyy`. Default today, `Asia/Jerusalem`. |
| Direction | `הוצאה` / `הכנסה` | Default expense. |
| Counterparty | `ספק / לקוח` | Required. |
| Project | `פרויקט` | The change-sheet picker, including overhead. Required. |
| Category | `קטגוריה` | Required. Income categories if direction is income, otherwise expense. |
| Remember | `לזכור לספק הזה` | Default on. Writes a rule when on. |

Primary button `שמור`. Disabled until amount, counterparty, project, and category are set.

### Invoice capture result

Extraction reads supplier, net, VAT, date, invoice number, and the `חשבונית ישראל` allocation number when it is printed. A duplicate match opens the existing document and does not create another. See [duplicates](../calculations.md#duplicate-imports).

When supplier, net, and date are all present, Flow saves the document as unpaid and shows a short confirmation `נשמר כחשבונית שלא שולמה`. It does not enter the review queue and does not enter P&L. When any of those three is missing, Flow opens a correction form with the same fields, empty ones marked, and saves only when the three are filled. Whether the owner should confirm every scan, including complete ones, is an [open question](../../open-questions.md).

## States

**Loading.** The sheet itself has no spinner. After a tap, the camera or picker is the system UI. While a file is copying into the local queue, the sheet shows `שומרים…` on that row and ignores a second tap.

**Empty.** The sheet always shows the three rows, including on a brand-new company. There is no separate empty state. The company's empty state lives on Home.

**Normal.** Three rows and cancel.

**Partial.** Not a state of the sheet. After a statement import, partial work is the upload-results screen.

**Error.**

| Failure | What the owner sees |
| --- | --- |
| Camera permission denied | `אין גישה למצלמה` and `אפשר במערכת` plus the PDF picker still available. |
| Unreadable photo (extraction threw, or the image is blank) | `לא הצלחנו לקרוא את החשבונית` and one action, `צלם שוב`. Nothing is stored as a transaction. The photo stays in the local queue so a later retry can run without reshooting, with a secondary `מחק`. |
| Not a spreadsheet | Not a build task. There is no statement import. |
| Empty spreadsheet | Not a build task. There is no statement import. |

**Offline.** The photo, PDF, and manual entry are stored on the device and the sheet confirms `נשמר בטלפון. יסונכרן כשיהיה רשת`. Manual save with project and category completes locally and counts on Home immediately (it is approved and paid). There is no statement file to parse. AI guesses that need the network stay suggested with `ממתין לרשת` on the review card. Invoice extraction that needs the network stays queued; the confirmation appears after it runs.

## Edge cases

- **Duplicate invoice.** Existing document opens. Copy explains `החשבונית כבר שמורה`. No second unpaid balance.
- **Same statement twice.** Error on upload results, zero new rows.
- **Overlapping dates.** New rows only. Summary says how many were skipped.
- **Two invoices for one later payment.** Not handled on this sheet. The document is stored unpaid. Matching runs when the bank row arrives.
- **Partial payments.** Not created here unless the manual amount is the cash that moved. The owner enters the cash amount, not the invoice total.
- **Refund.** Manual direction `הכנסה` with an expense category reduces expenses. The form allows that combination on purpose.
- **Split.** Not on this sheet. After the manual line exists, the owner can split it from the project transaction.
- **0 projects.** Statement import still runs. Rows that need a project go to review. Manual save requires a project, so the picker offers overhead and `+ פרויקט חדש`.
- **VAT-exempt company.** Manual VAT defaults to 0. A photographed invoice keeps the VAT printed on it.
- **Long Hebrew supplier.** The confirmation and the later review card wrap to three lines.
- **Credit-card company file.** Treated as non-Hapoalim. Not imported.

## Acceptance criteria

- [ ] `+` from every tab opens this sheet. Cancel and the scrim discard nothing because nothing was written yet.
- [ ] Several photos in one visit each become their own document. A PDF or image picked from the phone does the same.
- [ ] An Android share of an image or PDF lands in that same capture path. iPhone is not offered a share action.
- [ ] A complete invoice photo becomes an unpaid document and is absent from P&L and from the review queue.
- [ ] A duplicate invoice does not create a second document.
- [ ] A non-Hapoalim file and an unreadable photo create no transactions.
- [ ] Manual save is impossible without net, counterparty, project, and category, and the saved line counts immediately as approved and paid.
- [ ] Offline, the capture remains on the device and the owner is told it will sync.
- [ ] The label `העלה דוח בנק/אשראי` is unchanged, and a credit-card file is still rejected.
