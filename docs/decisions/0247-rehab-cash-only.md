# Renovation so far counts cash lines only

**Date:** 2026-11-02
**Status:** Accepted (owner, 2026-11-02: the renovation sheet of a real rental showed a depreciation entry as renovation, and was "scattered and too much data")
**Amends:** [0143](0143-project-investment.md)

## Decision

- Renovation so far (`rehab_minor`, `rehab_by_category`) sums only the lines the cash view counts: the owner's switch on the line, else the category (`private.line_in_cash`). A journal entry such as depreciation, which moves no money, is out, as it is from the property's returns since [0245](0245-returns-from-the-lines.md).
- The figure opens the same page as the other investment figures: what it counts, the categories that count adding up to it, and their transactions. What is kept out is one link to the category settings, not a list.
