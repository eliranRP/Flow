# FLOW-334 split items and FLOW-325: Split screens line up with the title

- PR: #286
- Kind: screen
- Changed: Split between projects. The choices card sits 8px from the screen edge, so its radios and text line up with the title at the 24px side gutter in light mode, where the card's surface doesn't show. In dark, the surface edge shows 8px in. The split footers use the 24px side gutter instead of 20px. Hints say "מתפצל שווה" instead of "מתחלק שווה". The split-by-category editor's bordered card keeps the 24px gutter. In that editor, a refund part in a kept-out category may keep the line's project: its project list offers "פרויקט השורה", and the part's own category stays listed so its project can change. Putting a line in the P&L when such a part has no project says why: "לחלק החזר בפיצול אין פרויקט. בחרו לו פרויקט בפיצול, ואז נסו שוב."
- Rule: A borderless card's row padding, not the card's margin, lines its content up with the title; a bordered card keeps the side gutter.
- Source: FLOW-334 (cycle 4 split items), FLOW-325 (#189 review).
