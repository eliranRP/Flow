<a id="flow-332"></a>
# FLOW-332 · Swipe back from the edge on pushed screens
- **Type:** SMALL UI · **Status:** merged (#238, UI lane 3) · **Owner (2026-10-08):** approved · **Depends on:** — · **Overlaps:** FLOW-314 (gesture rules) · **Source:** cycle 1 (U2)
- **What:** In the installed iOS app there is no system back gesture, so the only way back from a pushed screen is the chevron at the top corner (y≈12–43). Add a swipe from the start (right) edge on pushed screens, with the same gesture rules as FLOW-314, so it never fights horizontal scrolling or the transaction swipe.
- **Acceptance:** works on every pushed screen; doesn't trigger inside sheets or horizontal lists; e2e test with touch.
