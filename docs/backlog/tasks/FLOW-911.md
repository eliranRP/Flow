<a id="flow-911"></a>
# FLOW-911 · A just-joined viewer kept an owner's controls
- **Type:** BUG · **Status:** done (#542) · **Source:** the owner, 2026-10-10: after accepting a viewer invite, changing the project on a review card failed with "no company".
- [ ] A role read with no company yet ("owner", so setup can create one) is never cached as fresh. A tab that read it before an invite was accepted in another tab reads the role again on its next mount or focus, and drops the write controls.
- [ ] A write the server refuses with "no company" (the books' write RPCs, for a user who only reads the company) shows the viewer line, "צפייה בלבד · שינויים נעשים על ידי בעל העסק", with no retry, and reads the role again. A "forbidden" keeps its screen's own words and also reads the role again.
