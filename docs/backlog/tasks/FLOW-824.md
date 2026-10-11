<a id="flow-824"></a>
# FLOW-824 · One copy of the code two screens duplicate
- **Type:** SMALL CYCLE · **Status:** claimed (temporary lane, owner request, 2026-10-11, claude/compassionate-goldberg-ubfcqg) · **Depends on:** — · **Source:** owner, 2026-10-11.
- [ ] jscpd finds 296 duplicated lines of production code: the company and project cash screens (129), the line split editor and the split screen (76), the basis and currency sheets, the card and period swipes, the loan list and loan match rows, and three edge functions' shared setup. Move each into one shared helper or component; behaviour and markup stay the same.
