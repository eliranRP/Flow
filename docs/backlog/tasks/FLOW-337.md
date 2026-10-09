<a id="flow-337"></a>
# FLOW-337 · A period on the "לפי חודש" page
- **Type:** PLAN FIRST · **Status:** done (#239, decision 0150) · **Owner (2026-10-08):** the page always lists every month since the project started, whatever the band shows · **Depends on:** FLOW-411 (#199) · **Source:** mobile UI/UX review cycle 5
- **What:** "לפי חודש" follows the project's period, so at the default 3 חודשים it lists three months with about 300px empty, and seeing the year takes Back, שנה and לפי חודש again (two of them in the top third). Options: the page opens on the whole project ("מתחילת הפרויקט") whatever the band shows, or it gets a compact preset row of its own (`PeriodBar tone="page"`).
- **Acceptance:** owner's choice on a card; Back returns to the project with its own period unchanged.
