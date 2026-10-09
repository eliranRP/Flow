<a id="flow-411"></a>
# FLOW-411 · Project screen: lines on open, honest period label
- **Type:** SMALL UI · **Status:** done (#199, with profit by period, decision 0141) · **Depends on:** FLOW-302
- **What:** From the 2026-10-07 tap-count review. Show a project's recent lines (the month list, capped) under its categories without the extra "תנועות אחרונות" tap; the band says the figure is since the project started; the "כל הקטגוריות" link that jumps to Settings goes. FLOW-402 keeps the full page with filters; FLOW-403 adds a period.
- **MCP:** none (`get_project` returns the lines).
- **Acceptance:** a project's lines are 2 taps from the Projects tab; the band names its period; empty and loading states; design review.
