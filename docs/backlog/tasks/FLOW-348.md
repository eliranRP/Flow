<a id="flow-348"></a>
# FLOW-348 · Jev switched on with no key
- **Type:** SMALL UI · **Status:** done (UI lane 3; owner picked option A, 2026-10-09) · **Source:** mobile UI/UX review cycle 8 (2026-10-09, deploy ae88bfe), shots in the project's reviews/ui-ux-cycle-8/
- **What:** When the server holds no Jev key (`jev_key_status()` says `missing`), the "תיוג חכם (Jev)" switch on Connections locks off (the disabled switch look, not tappable) with one muted line under the title: "צריך מפתח Jev. פונים למנהל המערכת." No "אפשרויות" link while it is locked. A pending or failed key read keeps today's row, so it never locks on a guess. Replaces the "אין מפתח" hint from #329. Mockup: the project's mockups/plan-first/flow-348/a.png.
- **Acceptance:** stories at 390, 320 and dark 320; a design log entry; design lead sign-off.
