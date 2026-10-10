# Home's first run names the תזרים

- PR: pending (UI lane 1).
- Kind: screen
- Changed: Home is the cash view (FLOW-413), but its first run still promised profit. The band now reads "כאן יופיע התזרים של העסק" and the body "התזרים יופיע כאן אחרי חיבור בנק או SUMIT.". The profit view's first run keeps "כאן יופיע הרווח של העסק". Every empty state's one line now wraps with `text-wrap: pretty`, so ".SUMIT" no longer sits alone at 320.
- Rule: an empty state promises what its screen shows (§2.8); its line never ends on a lone word.
- Source: FLOW-362 (cycle 15, C15-2).
- Shots: reviews/flow-362-cash-home-empty/ in the project files (390 and 320, light and dark).
