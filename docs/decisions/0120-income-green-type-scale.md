# Income amounts are green; Mercury-style type scale

**Date:** 2026-10-07
**Status:** Accepted

## Context

The owner wants the clean text feel of Mercury: a big page title, clear date or month headers, quiet rows, lighter amounts, and income in green (FLOW-319). Flow had a flat hierarchy: section heads, month heads and row amounts were all 17/600, so a header did not read as a header. Secondary lines came in three sizes and greys. Income showed as "+₪" in the main text colour in rows, but with no sign in the Home and band summaries.

The design plan compared three options: A, colour only; B, Mercury's scale at the token level; C, full Mercury (cents in transaction rows, 400 row titles and list amounts, no hairlines anywhere, a 32px project name on the band). The design reviewer recommended B; the owner chose **C** after seeing both. C goes against "few numbers" and the whole-unit rule for transaction rows only; project rows, totals, Home and every summary stay whole units ([0041](0041-amounts-before-vat.md), guide §11.3).

## Decision

Amounts use the main text colour, with three exceptions that always carry meaning in words or a sign as well: a loss or negative change in `bad` with a minus or ▼; a positive change in `good` with ▲; and money in (an income transaction, an income total) in the `income` colour (#13703D light, #62CB8D dark) with no plus sign. Expenses keep the minus sign in the main text colour. Profit is never green. Nothing on the violet band is coloured green or red except inside the solid change pill.

Type (option C): page titles 34/1.15/600 with −0.01em tracking; a new `heading` style 20/1.3/600 for section and month heads; row titles 17/1.45/400 (inputs stay `body` 16/500); list amounts 17/1.45/400 (`amount`); row secondary lines 15/1.4/400 in `text-muted` (`meta`); the project name on the band 32/1.25/600 (`band-title`); the Home נכנס / יצא labels at 400. No row has a hairline anywhere; rows are separated by their padding, and month groups are 32px apart. Transaction rows show cents like Mercury, ".00" included, drawn smaller and raised; detail amounts do the same when agorot are not zero. Project rows, totals, Home and summaries stay whole units.

Supersedes: DESIGN-RULES §2.1 "Figures use the main text colour. Red and green only together with ▼ / ▲ or a minus sign."; guide §7.8 "Transaction amounts don't use red or green. The sign carries the meaning." and the "+₪150,000" example; the weight sentence in 0023/0024 and guide §5 ("600 titles and amounts", "400 hints only") for list amounts, row titles and row secondary lines; guide §11.3's whole-unit rule **for transaction rows only**; guide §7.7 and §7.8's row hairlines.

Details:

1. `income` is its own token, apart from `good` (which stays #15733F / #62CB8D for ▲), so the two meanings can move apart later. The light value is one step darker than `good` so it also passes on the pressed row tint: 6.15 on bg, 5.34 on tint, 4.64 on tint-pressed; dark 9.24 on bg, 8.52 on surface, 7.51 on tint, 6.29 on tint-pressed.
2. Green applies to transaction rows with money in, the income total in month heads, the Home נכנס amount (below the band), the income total on the income breakdown, and the transaction detail amount of an income. Only a figure that shows no minus turns green: a negative income figure (refunds beating income) keeps its minus in `text`.
3. Direction is never colour alone (WCAG 1.4.1): every expense carries "−", an income row has a visually hidden "הכנסה " before the figure, and month totals keep their hidden "הכנסות ". A refund line in an expense breakdown says "זיכוי" instead. The amount's sign wins over the direction: a negative income (an income credit) shows its minus in `text`, and a zero is never green. `formatAmountText` keeps its `plus` option for other callers; the app no longer passes it.
4. `title-1` gets letter-spacing −0.01em on page titles. The compact transaction title stays `title-3`. The project name on the band is `band-title` 32, two-line clamp.
5. Month heads keep their sticky `bg` fill but lose their hairline. `.ui-row` has no hairline anywhere (project rows, settings rows and lists included). Group separators that are not row hairlines (radio and check rows in sheets, field lines) stay. A row hint tied with `aria-describedby` (`t-hint`) stays `hint` 13.
6. Cents: the ".50" (or ".00" in a transaction row) sits in a child span at 0.58em, raised 0.62em, same colour. The accessible text is unchanged.

| Who | Call |
|---|---|
| Owner | Asked for Mercury-style header sizes and green income (FLOW-319) |
| Design reviewer | Recommended option B |
| Owner | Chose option C, full Mercury |

## Consequences

Rows grow from the 17px title and the 15px secondary line, transaction amounts widen by the cents, and longer titles and hints need a clip-check at 320. Weights now read: 400 hints, row titles, secondary lines, list amounts and the Home flow labels; 500 body, inputs and labels; 600 titles, heads, hero and display amounts; 700 wordmark only. Out of scope: the hard-coded px sizes in `setup-demos.css` and the lock-time line-height.
