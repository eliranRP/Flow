<a id="flow-132"></a>
# FLOW-132 · Closed loan follow-ups (#132 review)
- **Type:** BACKLOG NIT · **Status:** done (#162) · **Depends on:** FLOW-106 part 1 (#132)
- [x] A removed line dated after a loan's `closed_on` keeps its parts; if it comes back it counts against the closed loan without a check. Check it when the line is restored, as decision 0121 does for the balance. (Its parts are flagged for review, and clearing the review checks again: migration `20261010090000`, decision 0132.)
- [x] Changing an attached line's `doc_date` to after its loan's `closed_on` is not checked. (Flagged for review the same way: migration `20261010090000`, decision 0132.)
- [x] `get_project`'s `loans[]` has no `status`, so a project lists paid-off and closed loans next to open ones. (`loans[]` has `status`, `closed_on` and `kind`: migration `20261010090000`, decision 0132.)
