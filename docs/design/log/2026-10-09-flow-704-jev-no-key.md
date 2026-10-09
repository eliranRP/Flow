# 2026-10-09 · FLOW-704 Jev Settings "no key" status

- PR: #329 (UI lane 4)
- What changed:
  - The תיוג חכם (Jev) row on Connections says "אין מפתח" when Jev is switched on and the server holds no Jev key (`jev_key_status()` says `missing`, #321). Without a key a switched-on Jev labels nothing, so the row says so instead of "פעיל · הצעות בלבד". No "פעיל" in front: the switch already shows on, and "פעיל" would imply Jev works without a key (design lead, sign-off on #329).
  - Off still says כבוי: a missing key does not matter while Jev is off. A key read that is pending or fails keeps the usual word, so the row never says אין מפתח on a guess.
  - Same row, same muted hint style; no new component. Stories: Screens/Jev settings › On no key at 390, 320 and dark 320.
- Rules: DESIGN-RULES few words, one status line; decision 0083 named אין מפתח as waiting on a real status source, which #321 adds.
