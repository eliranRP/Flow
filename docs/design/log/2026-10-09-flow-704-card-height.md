# FLOW-704: A Jev-filled review card keeps its height when it settles

- PR: #TBD
- Kind: component
- Changed: `ui/review-card.tsx` (the held ✦ line while `pending`), `css/17-action-bar.css` (`.ui-review-reason-slot`), `screens/jev-review-card.tsx` (the wait-and-settle harness: a fill with a reason, an auto fill with ביטול, one row filled, stored rows). Stories: Screens/Jev review "Wait and settle" at 390, 320 and dark 320. e2e: `jev-review.spec.ts` checks waiting and settled heights match at 390 and 320.
- Rule: while Jev's read waits, a review card holds the "✦" line under its rows (hidden, one hint line) whenever a row shows a skeleton, so the reason or "מולא ע״י Jev" line lands without moving the card or the action bar. A card whose rows are all stored holds nothing, since Jev fills nothing there. A split_mismatch card never holds it.
- Trade-off: when Jev answers nothing for a waiting row, the held line goes and the card closes up by one hint line. That case is rarer than a fill, and with both fields empty the "בחרו פרויקט וקטגוריה" line takes the space.
- Source: FLOW-704's last open item (#121 review), moved from UI lane 4 to UI lane 2 by the lane manager 2026-10-09.
