# 2026-10-10 · FLOW-314 follow-ups: the card walk reaches more lists

- PR: #563 (UI lane 2), the design lead's pick of the three open FLOW-314 follow-ups.
- What:
  - A card opened from a project's waiting list walks that list's card rows. A row with a change to review opens its own screen and stays out of the walk.
  - Home's breakdown lines (FLOW-301) open the card with their list. A line shown in parts is one card.
  - At the last loaded row of a paged list (a project category, the breakdown lines), הבאה stays and loads the next page. The card reads that page ahead once it shows. If it is still loading when הבאה is pressed, the card stays put, הבאה turns muted with a busy cursor, and the card moves to the first new row once the page lands. A swipe at that row waits for the page; it never shows an empty card. A page with nothing new ends the walk; a failed read leaves the card in place and הבאה can try again.
  - Unchanged: no movement at a list end, the edge and sheet guards, and reduced motion swapping on release.
- Rule: a list that loads in pages has no end for the walk until its last page is in; its next word stays, and shows busy while the page loads.
- Shots: /mnt/project-files/mockups/flow-314/ (next-page-loading and next-page-landed at 320 and 393).
