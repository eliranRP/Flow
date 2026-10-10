<a id="flow-913"></a>
# FLOW-913 · קבועים rows: a Latin project kept its end, and ✕ sat beside the chevron
- **Type:** SMALL UI · **Status:** in-progress · **Source:** the owner, 2026-10-10: on the קבועים screen the project names are cut ("…ny / Overhead"), and the ✕ is unclear and looks bad next to the chevron.
- [x] A Latin project name in a row's "project · category" line ellipsizes at its own end, so it keeps its start ("Example Holdings Compa…"). A Hebrew name is unchanged.
- [x] A list that can hide ends each row in one muted 44px eye-off button ("הסתרה, <name>") instead of ✕ plus the chevron. A row with nothing to hide keeps the button's place empty. A list that cannot hide keeps the chevron. Swipe toward the start still hides.
- [x] A party with several lines this month (RentRedi: three rents, $6,055) summed them all but opened only the newest ($2,054). `recurring_this_month` now says how many lines make the amount (`line_count`); such a row reads "N תשלומים" and opens Search on that party for this month.
- [ ] A lighter list (owner, 15:46Z): layout card A one line / B name + one hint (recommended) / keep; hide moves behind "עריכה". Waits on the owner's pick.
- [x] The review card's "no company" in the owner's first screenshot came from the test viewer account at 14:16Z, before FLOW-911 (#542) went live; no "no company" refusal since. Nothing to change.
