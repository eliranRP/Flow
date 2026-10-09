# FLOW-339 C6-3: בטל's hit area stays off the category row

- PR: #292
- Kind: pattern
- Changed: no visual change. The cycle 6 finding (בטל's 44px hit area covering the bottom 13px of the category row) does not reproduce. The `::after` grows down and sideways only (`inset-block: 0 calc(100% - var(--touch-min))`, since #231), and at 375 and 393 a point 1 to 13px above בטל hits the row. The ReviewCard "Jev filled" stories (light, dark, 320) now check this in their play, and they fail if the area is centered.
- Rule: A text link's 44px hit area may grow into empty space or space below it, never up or across into another control's box.
- Source: FLOW-339 (UI/UX review cycle 6, C6-3)
