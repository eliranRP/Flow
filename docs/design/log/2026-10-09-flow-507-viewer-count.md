# FLOW-507: A viewer's review queue says how many wait

- PR: #PR
- Kind: screen
- Changed: the לאישור queue header for a viewer. It showed the total as a bare number beside the thin visit meter. It now reads "N ממתינים" ("1 ממתינה" for one), like the breakdown's waiting row, and the meter is gone: a viewer doesn't work through the queue. The owner keeps "N מתוך M" and the meter. New story: Screens/Routes Categories viewer, which also shows the viewer's category rows are the owner's height (53px both, since FLOW-322 put the ⋯ beside the row).
- Rule: a read-only view shows state, not progress through a task it can't do.
- Source: FLOW-507 (viewer mode follow-ups).
