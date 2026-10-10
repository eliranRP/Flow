<a id="flow-913"></a>
# FLOW-913 · קבועים: a lighter list, swipe to close, and a row that opens all its payments
- **Type:** SMALL UI · **Status:** done · **Source:** the owner, 2026-10-10: on the קבועים screen the project names are cut ("…ny / Overhead"), and the ✕ is unclear and looks bad next to the chevron.
- [x] Layout A (owner 16:03Z): one line per row, the name and the amount (▲/▼ % on a change). Each section is a rounded card with inner space (owner 16:14Z).
- [x] A late row or a change closes for this user by a swipe over "סגירה"; the first visit peeks the top row once; "עריכה" shows "סגירה" on each closable row (owner 16:05Z, 16:15Z).
- [x] A party with several lines this month (RentRedi: three rents, $6,055) summed them all but opened only the newest ($2,054). `recurring_this_month` now says how many lines make the amount (`line_count`); such a row reads "N תשלומים" and opens Search on that party for this month.
- [x] The review card's "no company" in the owner's first screenshot came from the test viewer account at 14:16Z, before FLOW-911 (#542) went live; no "no company" refusal since. Nothing to change.
