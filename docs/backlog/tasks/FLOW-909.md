<a id="flow-909"></a>
# FLOW-909 · A kept-out line's name uses the row's width
- **Type:** BUG (small UI) · **Status:** in-progress (#541) · **Source:** the owner, 2026-10-10: in the lists, a row marked "לא נספר ברווח" cuts its name ("City Of Pri…") even with room, while counted rows show the full name.
- [ ] A set-aside row's name keeps the ellipsis only when the row is really too narrow. Cause: FLOW-352 took the name's width out of the text column's content size so the kept-out words are never cut, but the column didn't grow, so it shrank to the hint. It now takes the row's free width. Story "Set Aside Short Name" checks it.
