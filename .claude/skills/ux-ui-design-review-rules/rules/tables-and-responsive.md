# Tables, lists and responsive

Rules from Design Motion (designmotionhq.com pattern pages + Design Motion reels). Anything not from Design Motion is marked "(standard, not from Design Motion)". Reel URLs: https://www.facebook.com/reel/<id>.

---

### 1. Under 640px (or when the container is under ~700px), the table becomes a stack of 2-line cards

**Rule:** Don't shrink or horizontally scroll a table on a phone. Restructure each row into a card: line 1 = identity (name) left + value (amount) right; line 2 = state (status chip) + labelled date. A table "owns its breakpoint": switch on the table's container width, not the viewport.
**Why:** Shrunk to fit, text drops to ~15px and is unreadable; with swipe, half the row (often the status) sits off-screen ("Columns hide behind swipe"). A table placed in a 400px side panel on a 940px desktop also needs cards, which a viewport media query misses.
**Numbers:** Mobile check at 375px. Cards under 640px (dashboard responsive reel). Container query at max-width 700px for a 6-column table ("Under 700, cards"). Result: "2 lines, no scroll" per row.
**Schema:**
```
 ≥700px container                    <700px container
 Invoice | Customer | Amount | Status | Due      +-----------------------------------+
 INV-01  | A. Name  | 1,204.00 | Paid | Mar 04    | (AV) A. Name           $1,204.00 |
                                                 |      ● Paid   Due Mar 04          |
                                                 +-----------------------------------+
```
**Good vs Bad:**
```css
/* Bad: viewport-only, or overflow-x:auto on a 6-col table at 375px */
/* Good: the table decides */
.table-wrap { container-type: inline-size; }
@container (max-width: 700px) { table { display:none } .cards { display:grid } }
```
**How to check:** Render at 375px and inside the narrowest panel the table appears in. Any horizontal scroll, any column off-screen, or text under ~15px = fail.
**Source:** https://www.facebook.com/reel/1074809841592221, https://www.facebook.com/reel/2028487064377659, https://www.facebook.com/reel/952258174225932, https://www.designmotionhq.com

### 2. Rank fields by use, not by column position: Identity → Value → State

**Rule:** When columns must go (phone, card, narrow panel), keep them in priority order: identity (who/what), value (amount), state (status); then date. Invoice IDs and secondary columns go to the expanded view. On desktop, cut the table to the columns that matter.
**Why:** Leftmost columns (IDs) are often the least useful on mobile; the user scans for who, how much, what state.
**Numbers:** 6 desktop columns → 4 visible fields on the card (name, amount, status, due date); rest hidden behind "+3 fields".
**Schema:** `priority: 1 Customer · 2 Amount · 3 Status · 4 Due · (hidden) Invoice, Method, Terms`
**Good vs Bad:** Bad: card shows "INV-2041 · A. Name…" with amount cut off. Good: "A. Name  $1,204.00 / ● Paid  Due Mar 04".
**How to check:** For each table, write the column priority list; verify the narrow layout shows the top 3–4 and nothing else.
**Source:** https://www.facebook.com/reel/1074809841592221, https://www.designmotionhq.com (site test list: "Users table cut to the columns that matter")

### 3. Two lines per row: name left, amount right, state below

**Rule:** In card rows, line 1 = name (left) + amount (right); line 2 = status + date. Never 3+ lines of loose label/value pairs.
**Why:** Keeps the row scannable like a list; half-the-row-off-screen is gone.
**Numbers:** 2 lines per row (reel "2 lines – 27px – no scroll").
**How to check:** Every mobile row ≤2 lines; amount sits right-aligned on line 1.
**Source:** https://www.facebook.com/reel/1074809841592221

### 4. One slot for the amount, still a column of numbers

**Rule:** The amount always sits in the same place on every card (right edge, line 1) with tabular figures, so cards still read as a column of numbers.
**Why:** Moving the amount between lines/positions per row destroys comparison.
**Numbers:** `font-variant-numeric: tabular-nums`.
**Good vs Bad:** Bad: amount on line 2 for some rows, after the date for others. Good: amount right-aligned in one slot, all rows.
**How to check:** Draw a vertical line at the card's right edge; every amount's last digit touches it.
**Source:** https://www.facebook.com/reel/1074809841592221

### 5. Label the ambiguous, not the obvious

**Rule:** In cards (no column header), add a word to fields whose meaning isn't self-evident: "Due Mar 04", not "Mar 04". Don't label self-evident fields: "$1,204.00", not "Amount: $1,204.00". Show the active sort ("Sort · Due date").
**Why:** Dates can mean issued/due/paid; dollars are obviously the amount.
**Numbers:** "Dates get a label. Dollars don't."
**How to check:** For each card field ask "could this mean two things?" If yes it needs a 1-word label; if no, no label.
**Source:** https://www.facebook.com/reel/1074809841592221

### 6. Hidden isn't deleted: expand or sheet, never a new page

**Rule:** Fields dropped on mobile must still be reachable: inline expand ("+3 fields") or a bottom sheet with the full record. Don't force navigation to a separate page.
**Why:** Removing columns must not remove data access; a page change loses list context.
**Schema:** `row tap → expands in place (or sheet) → Full record: invoice no., issued, method, terms, owner`
**How to check:** Every desktop column value is visible somewhere on mobile within 1 tap, without leaving the list.
**Source:** https://www.facebook.com/reel/1074809841592221

### 7. Numbers right, text left, tabular figures; nothing centred

**Rule:** Labels/IDs left-aligned, numbers (and their headers) right-aligned, `tabular-nums` on every numeric column. Never centre numbers.
**Why:** "The eye cannot compare scattered digits"; right-aligned tabular digits read "like a receipt". With proportional digits "1,111" and "8,888" have different widths.
**Numbers:** `text-align: right; font-variant-numeric: tabular-nums;`
**Good vs Bad:** Bad: `text-align:center` + proportional → $1,204.00 / $89.50 / $12,480.75 staggered. Good: right + tabular → decimals stacked.
**How to check:** Inspect numeric cells: text-align right AND font-variant-numeric tabular-nums.
**Source:** https://www.facebook.com/reel/1268917731967815, https://www.facebook.com/reel/28747148424888259, https://designmotionhq.com/patterns/data-table, https://designmotionhq.com/patterns/reverse-engineered-linear

### 8. One hairline between rows; stripes only for very wide tables

**Rule:** Separate rows with a single 1px hairline and a hover highlight. Zebra stripes only when rows are very wide (~12 columns).
**Why:** "Stripes fight the content"; "every other row screams for nothing".
**Numbers:** Stripes earn it at ~12 columns wide.
**How to check:** Under ~12 columns + zebra = flag.
**Source:** https://www.facebook.com/reel/1268917731967815

### 9. Row height is a decision: Compact 40 / Default 48 / Comfortable

**Rule:** Pick density per use (Ops = compact, everyday = default, review = comfortable) and expose it as one token/control.
**Numbers:** Compact 40px, Default 48px (reel); pattern page cites 36/48/60px. Comfortable is larger than 48px.
**How to check:** Row height comes from a density token, not scattered paddings.
**Source:** https://www.facebook.com/reel/1268917731967815, https://designmotionhq.com/patterns/data-table

### 10. Sticky header, pinned identity column

**Rule:** `position: sticky; top: 0` on the header and `left: 0` on the identity columns (e.g. invoice + customer), with a subtle shadow once scrolled.
**Why:** "Scroll right, lose the row": with 12 columns and 6 on screen you no longer know whose row it is.
**Numbers:** Example: 12 columns, 6 on screen.
**How to check:** Scroll a wide table right and a long one down: identity column and header stay visible.
**Source:** https://www.facebook.com/reel/1268917731967815, https://designmotionhq.com/patterns/data-table

### 11. Cells: dash for missing, truncate (never wrap), numbers never truncate

**Rule:** Missing = "—" (not blank: "an empty cell is a question" — missing, zero or loading?). Long text truncates on one line with a tooltip on hover. Numbers are never truncated. One line per row, always.
**Good vs Bad:** Bad: `$12,48...`, or a 2-line wrapped company name. Good: `Priya Nataraja…` + full name in tooltip, `$12,480.75` whole.
**How to check:** Feed a 40-char name and a null value; row stays 1 line, null shows "—", amount intact.
**Source:** https://www.facebook.com/reel/1268917731967815

### 12. Real content: min-width:0, truncate the middle, wrap long strings

**Rule:** Test layouts with real data. (a) Flex children need `min-width: 0` or the ellipsis never fires and buttons get pushed out of the card. (b) For filenames/emails cut the middle, keep both ends ("quarterly_rep…nal_v3.pdf"). (c) Live numbers use tabular-nums so digits don't twitch. (d) URLs in text: `overflow-wrap: anywhere`, not `word-break: break-all` (which chops normal words).
**Numbers:** A single 30-character name breaks the layout. Test fixtures: empty, 1 character, 40 characters + an emoji.
**Good vs Bad:**
```css
.name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; } /* Good */
.message { overflow-wrap:anywhere; }  /* Good */  /* Bad: word-break: break-all */
```
**How to check:** Run the 3 fixtures through every list/card; action buttons stay inside, extension visible.
**Source:** https://www.facebook.com/reel/1051915977228458

### 13. Row actions: reveal on hover/focus; touch keeps a kebab; sort arrow only on the active column

**Rule:** Don't print an icon set on every row ("7 rows – 14 icons", "fifty rows, fifty pencils"). Show actions on hover or keyboard focus; on touch show a visible ⋮ kebab. Sort arrow appears only on the active sort column.
**How to check:** Count always-visible icons per row (target 0 on pointer devices, 1 kebab on touch); tab into a row and confirm actions appear.
**Source:** https://www.facebook.com/reel/1268917731967815, https://designmotionhq.com/patterns/hover-trap

### 14. Tri-state sort

**Rule:** Header click cycles asc → desc → original order.
**How to check:** Click a header 3 times; 3rd click restores the original order.
**Source:** https://designmotionhq.com/patterns/data-table

### 15. Selection: whole-row, three-state select-all, honest counts

**Rule:** Row tint + accent bar + checkbox; header checkbox empty / indeterminate / checked; "Select all 247 matching" updated live with filters; selection survives paging; destructive bulk = run + undo.
**How to check:** Select, change page, change filter — counts and selection stay correct.
**Source:** https://designmotionhq.com/patterns/data-table, https://designmotionhq.com/patterns/bulk-actions, https://www.facebook.com/reel/1481497547331280

### 16. Pagination: cursor for live data, truncated links, page in the URL

**Rule:** Use cursor pagination (`WHERE id < :lastId`, `?after=cursor`) for data that changes — OFFSET shifts when a row is inserted at the top, so the same item shows twice. Never render all links: keep first, last, current ±1 (`< 1 … 499 [500] 501 … 833 >`). Put `?page=` in the URL so refresh keeps the page and it can be shared. Pick the model by job: numbered = jump to any page; load more = user stays in control; infinite scroll = feeds.
**Numbers:** Example: 10,000 rows, 833 pages, "one jump to page 500"; OFFSET 10 LIMIT 10.
**How to check:** Insert a row while on page 2 → no duplicates; refresh on page 500 → still 500; count rendered page links (≤ ~7).
**Source:** https://www.facebook.com/reel/4488595424803425, https://designmotionhq.com/patterns/pagination

### 17. Scroll is state: restore it, offset sticky headers, don't bury the footer

**Rule:** Going back from a detail page lands on the same row: `history.scrollRestoration = 'manual'`, save scrollY per entry, `scrollTo(saved)` on return (client-side routes otherwise reset to 0). Subtract the sticky header height (`scrollTo(y - 88)` for an 88px header). Anchors use `scroll-margin-top` (e.g. 96px). Infinite feeds must not make the footer unreachable — use "Load more" or move footer links elsewhere.
**Numbers:** Example: feed position 1840px restored to 1840; header 88px; scroll-margin-top 96px.
**How to check:** Scroll down, open item, go back → same item at same position, not hidden under the header; try reaching the footer.
**Source:** https://www.facebook.com/reel/1862628335143062, https://www.facebook.com/reel/4488595424803425, https://designmotionhq.com/patterns/pagination

### 18. Filter chips show intent

**Rule:** Distinct on/off states, result count updates in the same frame, clear-all, one horizontally scrolling row on mobile, sticky active summary. OR within a group, AND across groups.
**How to check:** Tap a chip; count updates instantly; chips never wrap to 3 lines on 375px.
**Source:** https://designmotionhq.com/patterns/filter-chips, https://www.facebook.com/reel/1898356567528601

### 19. Big numbers: one line, capped size

**Rule:** KPI values never wrap (a wrapped "+€5.3M" leaves the plus sign alone on a line). `white-space: nowrap; font-variant-numeric: tabular-nums;` and cap the size on narrow cards.
**Numbers:** 48px wraps in a narrow card; cap at ~30px ("max ~30px").
**Good vs Bad:** `.kpi-value{white-space:nowrap;font-variant-numeric:tabular-nums;font-size:30px}` vs 48px wrapping.
**How to check:** At 375px, every KPI value is on one line.
**Source:** https://www.facebook.com/reel/2028487064377659

### 20. Inputs at least 16px on mobile, with the right keyboard

**Rule:** Input font-size ≥16px (under 16px iOS zooms in on focus). Set `inputmode`, `autocomplete`, `enterkeyhint`.
**Numbers:** 14px zooms; 16px doesn't.
**Good vs Bad:** `<input inputmode="numeric" autocomplete="cc-number" enterkeyhint="next" style="font-size:16px">`
**How to check:** Computed font-size of every input/select/textarea ≥16px at 375px.
**Source:** https://www.facebook.com/reel/2028487064377659, https://www.facebook.com/reel/952258174225932

### 21. Touch targets 44px, on touch only

**Rule:** Buttons min 44px tall on coarse pointers; mouse layouts stay dense. Gate hover-only affordances with `@media (hover:hover)`; pad hit area to 44px around a ~20px glyph.
**Numbers:** 28px buttons get missed; min 44px.
```css
@media (pointer: coarse) { button { min-height: 44px; } }
```
**How to check:** On a touch emulator, measure every tappable element ≥44px; find any action reachable only by hover.
**Source:** https://www.facebook.com/reel/2028487064377659, https://www.facebook.com/reel/1996169834388343, https://designmotionhq.com/patterns/hover-trap

### 22. Bottom bars: safe area and room below the last row

**Rule:** A fixed bottom bar (e.g. "Approve selected") must not cover the last row: pad the list by the bar height and add `padding-bottom: env(safe-area-inset-bottom)`.
**Good vs Bad:** Bad: `position:fixed;bottom:0` alone hides the last card. Good: + safe-area padding + list bottom padding.
**How to check:** Scroll to the end: last row fully visible above the bar; nothing under the home indicator.
**Source:** https://www.facebook.com/reel/2028487064377659, https://www.facebook.com/reel/952258174225932

### 23. Mobile navigation: bottom tabs (3–5), desktop sidebar

**Rule:** Hamburger only for secondary nav; breadcrumbs only for >2 levels; command palette is an accelerator, not the only path.
**How to check:** Primary destinations visible without opening a menu on each platform.
**Source:** https://designmotionhq.com/patterns/navigation-patterns, https://www.facebook.com/reel/1274160754364058

### 24. Thumb-zone actions and bottom sheets

**Rule:** Frequent actions at the bottom; sheets with snap points, drag-to-dismiss, scrim and scroll lock.
**Why:** The top of tall phones is a dead zone.
**How to check:** Frequent actions in the top-right on mobile = flag.
**Source:** https://designmotionhq.com/patterns/bottom-sheets, https://designmotionhq.com/patterns/modal-hierarchy

### 25. Tabs on mobile: segmented control under 5, sheet over 5; never wrap

**Rule:** Overflowing tabs scroll horizontally with edge fades.
**How to check:** Tab bar on 375px is one line.
**Source:** https://designmotionhq.com/patterns/tabs-system, https://www.facebook.com/reel/979499467901827

### 26. Swipe actions need a visible fallback

**Rule:** Hint the affordance, ≤2 actions per side, destructive swipe needs tap-confirm or undo, consistent colours/semantics.
**How to check:** Every swipe action is reachable another way.
**Source:** https://designmotionhq.com/patterns/swipe-actions, https://www.facebook.com/reel/886778010644415

### 27. Grid: 12 columns collapsing 12 → 6 → 4 → 1

**Rule:** Anchor to column edges; break the grid only on purpose.
**Source:** https://designmotionhq.com/patterns/grid-system
