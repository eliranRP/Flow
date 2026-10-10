<a id="flow-702"></a>
# FLOW-702 · Jev auto mode
- **Type:** PLAN FIRST · **Status:** done (server #200, decision 0145; app #231; held flagged line covered by a test and story; plan approved by the owner 2026-10-08) · **Depends on:** FLOW-703 (done, #177)
- **What:** When the mode is `auto` and confidence is at or above the threshold, pre-fill the tag marked as AI and undoable in one tap; anomalies above a level always go to review; the toggle is the kill switch. Needs atomic allocation writes first. Show the threshold as a percent choice only in auto mode.
- **Acceptance:** threshold edge tests; undo restores; audit trail.
- [x] Anomaly gate: no fill on a flagged line unless Jev scored the flag below 0.5 (decision [0145](../../decisions/0145-jev-auto-mode.md)).
- [x] Income lines auto filled: project (no allocation) and income category.
- [x] `jev_prefills` audit row per fill, `undo_jev_prefill` and MCP `undo_jev_prefill`; `get_jev_status` adds `prefilled_today` and `prefilled_open`, `get_jev_suggestions` adds `prefilled`.
- [x] Threshold edge tests (at the threshold and 0.001 below, expense and income); off or shadow stops new fills.
- [x] App (UI lane): Settings mode choice הצעות בלבד / מילוי אוטומטי with threshold chips 80/85/90/95% in auto only; "✦ מולא ע״י Jev" with בטל (`undo_jev_prefill`) on a filled card; a held flagged line shows its flag and no fill.
