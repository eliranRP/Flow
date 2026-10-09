<a id="flow-313"></a>
# FLOW-313 · Month dividers follow-ups (#98 review)
- **Type:** BACKLOG NIT · **Status:** done (#242) · **Depends on:** FLOW-302 (#98)
- [x] The month totals add rows by direction: a shared line counts at its full amount and a refund counts as income, so a month header is not that project's P&L for the month. Owner to decide whether that's fine or the header should follow the P&L rules (Decisions needed). (Owner 2026-10-08: keep cash in and out, so the header adds up the rows it sits over.)
- [x] Switching between the flat and the grouped list (a held order splitting a month, or a second month loading) remounts the rows, so a focused row loses focus. (The flat list is a headless section keyed by its first month, so its rows stay mounted when a month is added or removed; rows that move to another month's section still remount.)
- [x] Screen readers hear the figures with no separator ("הוצאות −₪2,200הכנסות +$1,500"); add a pause between figures and lines. (A hidden ", " before each figure but the first.)
- [x] A month with large ILS and USD figures makes a three-line pinned bar (about 85px) at 320 to 390px; consider one currency per line only when needed. (Currency lines now share a row while they fit and wrap only when needed; story `TwoCurrenciesOneRow` is 42px, was 61px. Nine-digit figures in two currencies still need the rows.)
- [x] `MonthList` takes a `className` no caller passes; drop it or use it. (Dropped.)
