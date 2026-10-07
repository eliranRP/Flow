# Income amounts are green; Mercury-style type scale

**Date:** 2026-10-07
**Status:** Accepted

## Context

The owner wants the clean text feel of Mercury: a big page title, clear date or month headers, quiet rows, lighter amounts, and income in green (FLOW-319). Flow had a flat hierarchy: section heads, month heads and row amounts were all 17/600, so a header did not read as a header. Secondary lines came in three sizes and greys. Income showed as "+₪" in the main text colour in rows, but with no sign in the Home and band summaries.

The design plan compared three options: A, colour only; B, Mercury's scale at the token level; C, full Mercury (agorot in every list, 400 row titles, no hairlines anywhere). B was chosen. C breaks "few numbers" and the whole-unit summary rule ([0041](0041-amounts-before-vat.md), guide §11.3), and reads thin in Hebrew.

## Decision

Amounts use the main text colour, with three exceptions that always carry meaning in words or a sign as well: a loss or negative change in `bad` with a minus or ▼; a positive change in `good` with ▲; and money in (an income transaction, an income total) in the `income` colour (#13703D light, #62CB8D dark) with no plus sign. Expenses keep the minus sign in the main text colour. Profit is never green. Nothing on the violet band is coloured green or red except inside the solid change pill.

Type: page titles 32/1.25/600; a new `heading` style 20/1.3/600 for section and month heads; list amounts 17/1.45/500 (`amount`); row secondary lines 15/1.4/400 in `text-muted` (`meta`). Transaction rows inside a month group have no hairline, and month groups are 32px apart. Detail amounts draw agorot smaller and raised; summaries stay whole units.

Supersedes: DESIGN-RULES §2.1 "Figures use the main text colour. Red and green only together with ▼ / ▲ or a minus sign."; guide §7.8 "Transaction amounts don't use red or green. The sign carries the meaning." and the "+₪150,000" example; the weight sentence in 0023/0024 and guide §5 ("600 titles and amounts") for list amounts and the 400 "hints only" rule for row secondary lines.

Details:

1. `income` is its own token, apart from `good` (which stays #15733F / #62CB8D for ▲), so the two meanings can move apart later. The light value is one step darker than `good` so it also passes on the pressed row tint: 6.15 on bg, 5.34 on tint, 4.64 on tint-pressed; dark 9.24 on bg, 8.52 on surface, 7.51 on tint, 6.29 on tint-pressed.
2. Green applies to transaction rows with money in, the income total in month heads, the Home נכנס amount (below the band), the income total on the income breakdown, and the transaction detail amount of an income. Only a figure that shows no minus turns green: a negative income figure (refunds beating income) keeps its minus in `text`.
3. Direction is never colour alone (WCAG 1.4.1): every expense carries "−", an income row has a visually hidden "הכנסה " before the figure, and month totals keep their hidden "הכנסות ". `formatAmountText` keeps its `plus` option for other callers; the app no longer passes it.
4. `title-1` gets letter-spacing −0.01em on page titles. The compact transaction title stays `title-3`; the project name on the band stays `title-2` 22.
5. Month heads keep their sticky `bg` fill but lose their hairline. Project rows, settings rows and other lists keep their hairline (guide §7.7).
6. Detail agorot: the ".50" sits in a child span at 0.58em, raised 0.62em, same colour. The accessible text is unchanged.

| Who | Call |
|---|---|
| Owner | Asked for Mercury-style header sizes and green income (FLOW-319) |
| Design reviewer | Recommended option B |

## Consequences

Rows grow about 2px from the 15px secondary line, and longer hints need a clip-check at 320. Weights now read: 400 hints and secondary lines; 500 body, labels and list amounts; 600 titles, heads, hero and display amounts; 700 wordmark only. Out of scope: the hard-coded px sizes in `setup-demos.css` and the lock-time line-height.
