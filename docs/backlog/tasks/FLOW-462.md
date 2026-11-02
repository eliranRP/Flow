<a id="flow-462"></a>
# FLOW-462 · ⓘ on every returns page: how to read the figure and what it is for
- **Type:** UI · **Status:** claimed (dev lane, 2026-11-02, claude/compassionate-curie-mfpavd) · **Depends on:** [FLOW-460](FLOW-460.md) · **Source:** the owner, 2026-11-02, on the Cap rate page: "For each page metric add an info button so when the user clicks there is an explanation how an investor should read this metric and what is the goal of the metric, so he can better understand his investment with this metric."
- [ ] Every returns page (the four sources, the total, cash on cash, cap rate, DSCR, per unit, and the equity and part pages) has an ⓘ beside its title. It opens the existing sheet with three short parts: מה זה, איך לקרוא, בשביל מה (`project-returns-learn.ts`).
- [ ] The rules of thumb are the book's, said as a reading guide; nothing the owner has to set.
- **Acceptance:** a test that every page key has its text and the ⓘ opens it; stories at 320 and 393, light and dark; design log entry.
