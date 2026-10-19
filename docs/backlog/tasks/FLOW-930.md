<a id="flow-930"></a>
# FLOW-930 · קבועים: ask if a missed charge is still recurring, the "לא הגיעו" box, income and expenses apart, the first days of the month
- **Type:** UI (design approved) · **Status:** ready · **Depends on:** [FLOW-447](FLOW-447.md) (the קבועים tab and the charge page this changes) · **Source:** the owner approved it on 2026-10-18. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", section "Recurring tab (קבועים)" (boards "Recurring · prototype", "Recurring · עדיין קבוע? (late, no match)", "Recurring · after "הסתיים"", "Recurring · start of month (03/10)"), light versions on "Light theme · ready for dev"; spec note "A missed recurring charge asks once · income / expenses" at the end of that row. The canvas page "What changed" lists it under 19/10.
- **Files:** `app/src/screens/recurring-screen.tsx`, `app/src/screens/recurring-charge-screen.tsx`, `app/src/recurring.ts`, the recurring read and a write for the answer (server, plus a migration if the recurring table can't hold it), their stories and tests.

**Still recurring?**
- [ ] A recurring charge or income that is past its usual day by 3 days or more, with no matching line, asks once: "לא התקבל ב־<date>. עדיין קבוע?" with "כן, עדיין קבוע" and "הסתיים". It shows under its row in "לא הגיעו" and on the charge page under the late banner. If Flow found a likely line ("אולי הגיע בשם אחר"), that question comes first.
- [ ] כן: the row stays in "לא הגיעו" with "אישרת · באיחור N ימים" and stays in the forecast; Flow asks again only if the next one is missed too. הסתיים: the row moves to a dimmed "הסתיימו" group at the end and leaves the forecast, the alerts and the month's totals; undo toast, and "החזרה לקבועים" on its page.
- **MCP:** the recurring read returns the answer (still / ended, and when); one write sets or clears it.

**The "לא הגיעו" box**
- [ ] The late items sit in their own box: accent tint, radius 20, a 36px clock badge, "לא הגיעו · N" and "היה אמור להגיע עד היום ומחכה להחלטה שלך.". The question card inside is the card colour. It stays above everything else.

**Income and expenses apart**
- [ ] The summary card has two columns, "נכנס החודש" (green, +) and "יוצא החודש", each with the month's expected total, a 6px bar of what arrived, and "התקבל / שולם $X" and "עוד $Y".
- [ ] The list is grouped under "הכנסות קבועות" then "הוצאות קבועות": a card-colour strip with a dot (green / grey) and "צפוי $X"; the category groups sit under it. Expected income rows show "+".

**The first days of the month**
- [ ] An item 0–2 days past its usual day is on its way: a grey second line ("בדרך כלל היום" or "עוד לא הגיע · N ימים"), no signal colour, no box, no question. From day 3 it moves to "לא הגיעו".

- **Acceptance:** stories for 11/10 (two late, one asked), after "הסתיים", and 03/10 (only one arrived), in dark and light; tests for the 3-day rule, the totals without ended items, and the answer surviving a reload; design review against the boards.
