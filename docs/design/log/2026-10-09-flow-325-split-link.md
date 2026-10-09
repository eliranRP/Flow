# FLOW-325 §10: split by categories from the review card's שינוי sheet

- PR: #TBD
- Kind: pattern
- Changed: The change sheet's project list has a third link, "פיצול לפי קטגוריות" with the tag icon, under "פיצול בין פרויקטים" (owner chose option A, 2026-10-09). Pressing it approves the line with the project and category shown on the sheet, then opens the split-by-category editor in place of the sheet. The server refuses a split while the line's review is open, so the order is approve, then split. While the approve runs the link is busy and the list waits; a failed approve keeps the sheet open with the queue's "לא הצלחנו לאשר." toast. The link is not shown to a viewer, on a shared cost, on a split_mismatch card, or while the line still misses its project or category.
- Rule: A link that writes before it navigates shows busy in place, ignores presses until the write settles, and stays put when the write fails.
- Source: FLOW-325 plan §10, mockup `mockups/flow-325-s10/section10-a.png`.

## FLOW-347: one shape for every שויכו היום head

- Kind: polish
- Changed: The by-project heads on שויכו היום took three shapes: a one-line group showed "תנועה אחת" with no total, and a short name such as "בלי פרויקט" kept its count and total on the name line. Now every head is the name, then under it the count in muted meta and the totals, start-aligned, whatever the name's length or the group's size. A one-line group shows its total too, so every head reads the same way down the list.
- Rule: A repeated head keeps one shape down a list; a short name or a single line does not change where the figures sit.
- Source: mobile UI/UX review cycle 8, shot `sb-routes--filed-today-by-project--full.png`.

## Page titles under Back (owner, 2026-10-09)

- Kind: polish
- Changed: On the screenshots the owner said the header sizes and Back looked off. Every page under Back now takes a 28px title, one step under a tab root's 34px, so a page's sections no longer compete with its title. Back's chevron hangs past the 44px target's padding so its point lines up with the title's start edge; before, it sat 18px in. On שויכו היום the first project head stands 24px under the title, up from 8px.
- Changed, second pass: the owner asked that everything sit on one line. In every sheet head, Back's chevron point now sits on the rows' start edge and ✕ on their end edge, like the page header's Back; a page header's end icon does the same.
- Rule: Back's glyph, the title and the rows share one start edge, and an end icon's glyph sits on the content's end edge, in pages and sheets; a page under Back titles at 28px.
- Source: owner's phone screenshot of the built שויכו היום page, 2026-10-09.
