# FLOW-334: The sheet head is the title's height

- PR: #PR
- Kind: component
- Changed: `.ui-sheet-head` in `css/08-tabbar-empty.css`. The 44px ✕ set the head's height to 48px, so the line under a one-line title sat far below it (the change sheet's "₪8,500 • supplier" line, 22px glyph to glyph against about 10px in mockup 06). The ✕ now has an 8px negative block margin: its tap area is still 44px, and the head is 33.7px, the title's height. Every sheet with a ✕ moves its body up 14px; a two-line title is unchanged. Shots in the project's design/flow-334-sheet-gap (before and after, 390 and 320).
- Rule: a control's tap area doesn't set the height of the row it sits in.
- Source: FLOW-334 (stacked header follow-ups), design lead's review.
