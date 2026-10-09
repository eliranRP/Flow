<a id="flow-308"></a>
# FLOW-308 · Return to the intended route after sign-in
- **Type:** SMALL UI · **Status:** done (#111; design reviewer's option C, built under the owner's standing UI rule) · **Depends on:** —
- **What:** Sign-in always lands on Home, so a deep link (for example the evening review nudge to `/review`) is lost. Return to the requested route after sign-in, through a strict allowlist like the existing `?return=` handling.
- **Acceptance:** e2e for a signed-out deep link to `/review`; an off-list route still goes Home.
