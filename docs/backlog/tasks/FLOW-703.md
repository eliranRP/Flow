<a id="flow-703"></a>
# FLOW-703 · Jev corrections write-back
- **Type:** SMALL CYCLE · **Status:** done (server side, #177); app part with the UI lane · **Depends on:** —
- **What:** Write the owner's corrections back as training signal; confirm on main that saving a change sheet seeded with a Jev guess never turns that guess into a supplier rule by default; make the split approve path atomic; expose a "no project / overhead" choice to the model; consider finished projects for lines dated before the finish.
- **Acceptance:** tests for the seeded change sheet and the correction write.
- [x] A change sheet seeded with Jev's category starts with "לזכור לספק הזה" off, so saving never turns the guess into a supplier rule by default (#175).
- [x] The review card shows Jev's "no project" answer (`no_project` from `jev_suggestions`, server in #177) as "תקורה · ללא פרויקט" (word order from design review r1, so 320 keeps תקורה) with the Jev pill (#175).
- [x] Corrections as signal: the party history carries Jev's earlier suggestion and whether the owner corrected it (#177, decision [0139](../../decisions/0139-jev-corrections.md)).
- [x] Auto prefill in one SQL call, `jev_prefill` (#177).
- [x] `approve_split_review(review, category)`: set the category and approve a split line in one call (#177).
- [x] A `none` project answer, never pre-filled, and the overhead project labelled (#177).
- [x] Finished projects offered on lines dated on or before their last line (#177).
- [x] #177 review nits (done in FLOW-702's server PR, decision 0145; a prefill does not set `pnl_role`): `jev_prefill` checks a finished project's date in SQL too; a line filed to the overhead project counts as a `no_project` match; the two-argument `approve_split_review` refuses an income or hidden category; drop the unused `PrefillWrite.allocation` and `categorySuggested`; decide whether a prefill sets `pnl_role` (a prefilled line stays unassigned until approved).
- [x] App (UI lane): the change sheet seeded with a Jev guess starts with remember off, with a test; the split approve calls `approve_split_review(p_id, p_category_id)` instead of two calls; show `no_project` on the card. Done in #175: remember off (above), one `approve_split_review(p_id, p_category_id)` call, `no_project` on the card.
