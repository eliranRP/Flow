# 2026-10-10 · קבועים: one surface, one amount column

- PR: (UI lane 2), a small bug from the owner's real-app screenshot (13:03Z).
- What: on the קבועים screen, a row with nothing to hide (a הגיעו החודש row with no change) drew on the page background with its amount shifted toward the edge, because only hideable rows sat on the swipe layer's surface and had the ✕. Every row now sits on the surface, and a row without a ✕ keeps the ✕'s 44px place empty, so the amounts line up in one column.
- Rule: in a list where some rows end in an action and some do not, every row keeps the action's place, so the figures line up; and every row in a list shares one fill.
- Not changed: "NEWREZ-SHELLPOIN" is the bank's own 16-character name, not a clipped label (longer names like "Pittsburgh Water & Sewer Authority" show whole). The last row behind the tab bar was mid-scroll; scrolled to the end, it clears the bar at 390 and 320.
