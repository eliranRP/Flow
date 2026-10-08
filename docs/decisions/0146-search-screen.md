# The search screen

**Date:** 2026-10-08
**Status:** Accepted (owner picked option A of the FLOW-323 mockup, 2026-10-08)

## Context

FLOW-323: finding a line by supplier took 4 to 6 taps, and only inside the selected period. The server part is [0140](0140-search-filters.md): `search_transactions` filters by text, direction, project, category, dates and a `pending` scope. FLOW-402 asked for a full list of one project's lines with filters. The owner picked option A of the mockup (an entry icon on Home and Projects, field and chips at the bottom) over option B (the review tab becomes a transactions tab).

## Decision

- **Entry: a search icon on Home and on Projects.** `SearchEntry` (`app/src/ui/search-entry.tsx`) is a 44×44 icon button with a thin-stroke outline magnifier (SVG, stroke 1.6), named "חיפוש תנועות". On Home it sits at the end of a band row above the period bar, as the project band places its actions; beside the period bar it would not fit at 320px. On Projects it sits at the end of the header bar, after פרויקט חדש (the header is stacked so the title never wraps). The icon opens `/search` with the field focused.
- **`/search` is a full screen with no tab bar** (template C). Back is the right-pointing SVG chevron. The results fill the screen top down: a count line ("N תנועות · ₪x יצא · ₪y נכנס", sums per currency, ILS first, shown once every row is loaded), then statement rows with month heads. The **field and the chips sit in a dock at the bottom**, fixed just above the keyboard (`--kb`), so the thumb types and filters without reaching up.
- **Chips**, one row that scrolls sideways: הוצאות, הכנסות (one side at a time), project (sheet, with בלי פרויקט), category (sheet, with בלי קטגוריה), period (the period sheet with כל התקופה first, and טווח מותאם), and לאישור. A pressed chip names its choice. The project or category a chip names is left out of each row's details.
- **Rows** are the review list's statement rows. The title is the customer on income and the supplier (else the description) on an expense; the typed text is tinted where it matches (`MatchText`, a `<mark>`). The second line reads "מחוץ לרווח" first when the line is kept out, then the date, then "ממתינה לאישור" in the accent, or the project and the category ("פוצלה ל־N" for a split line). A kept-out line adds nothing to the totals (0099). A row opens the transaction with the results as its ˄ ˅ list.
- **Reading:** typing waits 300ms, then one `search_transactions` call with only the filters that are set, 50 rows a page, "עוד תנועות" for the next page. The old rows stay while the next results load. Empty text with no chip lists every line, newest first. Nothing matched: "לא מצאנו ״…״" with ניקוי החיפוש (or ניקוי הסינון), one way out. Errors and offline use the shared error state with ניסיון חוזר.
- **State:** the chips and text start from the URL (`q`, `dir`, `project`, `category`, `review`, period keys) and then live on the screen; the history entry remembers them, so Back from a line restores the same search.
- **FLOW-402 is this screen**: the project page's "כל התנועות" opens `/search?project=<id>` with the project chip set and the field not focused.

## Alternatives rejected

- Option B: the review tab becomes a transactions tab with review as a filter. It moved the review queue the owner uses every day.
- The field at the top: out of thumb reach on a tall phone, and the keyboard covers the chips.
- Writing every keystroke to the URL: a replace per keystroke races the sheets' own history entries.

## Consequences

Home's band is one row (about 52px) taller. Projects' "פרויקט חדש" moved from the title row to the header bar. A separate per-project transactions page is not built; FLOW-402 is done by this screen.
