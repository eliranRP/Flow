# FLOW-507: A viewer's review queue says how many wait

- PR: #PR
- Kind: screen
- Changed: the לאישור queue header for a viewer. It showed the total as a bare number beside the thin visit meter. It now reads "N ממתינות" ("1 ממתינה" for one), agreeing with the subtitle "תנועות שמחכות לשיוך" and the project page's "N ממתינות לאישור", and the meter is gone: a viewer doesn't work through the queue. The owner keeps "N מתוך M" and the meter. The review-bar stories' tab badge now agrees with the one queued line. New story: Screens/Routes Categories viewer, which also shows the viewer's category rows are the owner's height (53px both, since FLOW-322 put the ⋯ beside the row).
- Rule: a read-only view shows state, not progress through a task it can't do.
- Source: FLOW-507 (viewer mode follow-ups).
