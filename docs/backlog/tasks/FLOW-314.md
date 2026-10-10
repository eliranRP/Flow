<a id="flow-314"></a>
# FLOW-314 · Swipe between transactions on the card
- **Type:** SMALL UI · **Status:** done (#291, UI lane 2, built by UI lane 4; follow-ups done in #563) · **Depends on:** FLOW-303 (#100)
- **What:** Follow-up from FLOW-303. A sideways swipe on the card does what ˄ ˅ do: the finger moving right opens the next card (it enters from the left, like a screen push), left opens the previous one. Touch only; ignore a start within 24px of a screen edge, inside a sheet or a field, or while a sheet is open; decide after 10px and hand mostly vertical moves to the page scroll; the card follows the finger and commits past 30% of the width or a flick; no movement at a list end; reduced motion swaps on release.
- **Acceptance:** a touch probe on a phone, not only the clip check; CONTROLS row; design review.
- Follow-ups:
  - [x] (#563) From #100's design session: add the project's waiting list (card rows only) to the walk.
  - [x] (#563) ˅ at the last loaded category row loads the next page (Home's breakdown lines too).
  - [x] (#563) From #100's code review: the Home breakdown lines (FLOW-301) open a card with no list; pass the list there too.
  - [x] (#296) From #291's code review: the slide-in replays after Back from a pushed screen or a reload (`txnEnter` lives in history); clear it on `animationend` or honour it once per `location.key`.
  - [x] (#296) From #291's code review: the band-figure swipe (`period-swipe.tsx` `inEdgeZone`) still takes the 24th edge px; use `<=`/`>=` with `EDGE_PX` from edge-back, as the card does.
