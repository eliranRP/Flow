<a id="flow-444"></a>
# FLOW-444 · A project's month profit page names its project
- **Type:** BUG · **Status:** claimed · **Depends on:** — · **Related:** [FLOW-440](FLOW-440.md), [FLOW-443](FLOW-443.md) (the same pages) · **Source:** owner report 2026-10-11, with a phone shot of a project's month profit page (הפסד <month>). The shot holds real data, so it is not in the repo.
- **What happens:** Opening a month from the project's "לפי חודש" list shows "רווח <month>" or "הפסד <month>", its figure, הכנסות, הוצאות and the transactions. The project's name shows nowhere: Back is a bare arrow, and nothing in the title or the rows says which project this is. Decision [0156](../../decisions/0156-labelled-back-and-compact-bar.md) gives a stacked page with a parent a labelled Back ("‹ שיפוץ הרצל 12"), and the cash month page already labels its Back.
- [ ] The month profit page's Back carries the project's name, per 0156 (cut at about 16 characters), and the compact bar keeps it when the title scrolls off.
- [ ] Check the other project month pages (cash month, "לא נספר ברווח", the by-month list) for the same gap, and give each the project's name the same way.
- [ ] Nothing else on the page changes.
- **Acceptance:** a story of the month profit page with an invented project name at 320 and 393 shows "‹ <name>", including a long name cut with an ellipsis. A unit test that the Back label is the project's name and that it goes back to the project.
- **Redesign (2026-10-11):** the approved project month page ([FLOW-140](FLOW-140.md)) has Back "רווח <project>". Whichever ships first gives the page its project's name; the other keeps it.
