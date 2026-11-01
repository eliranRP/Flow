# Charts, data visualisation and numbers

Rules from Design Motion (designmotionhq.com pattern pages + Design Motion reels). Anything not from Design Motion is marked "(standard, not from Design Motion)". Reel URLs: https://www.facebook.com/reel/<id>.

---

### 1. Put the reason on the peak

**Rule:** Annotate every notable spike or dip directly on the chart with its cause (e.g. "Launch day, Product Hunt" at Tuesday's peak).
**Why:** An unexplained spike turns into a comment thread of guesses ("why the jump on Tuesday?", "bot traffic maybe?", "tracking bug again"). The answer belongs on the data point.
**Schema:**
```
480 |        ┌ Launch day, Product Hunt
    |        ●
320 |       / \
160 |  ●──●     ●──●──●
  0 +-------------------
     Mon Tue Wed Thu Fri Sat Sun
```
**Good vs Bad:** Bad: spike to 412 with no note, 3 open comments. Good: label pinned to the point with the reason.
**How to check:** For each chart, find the max/min/outlier; each has an attached annotation (text, not only a tooltip).
**Source:** https://www.facebook.com/reel/2112714999632984, https://designmotionhq.com/patterns/charts-that-lie

### 2. Bar charts start at zero (line charts may skip zero, but label it)

**Rule:** Every bar axis starts at 0, no exceptions. A line chart may start above 0 only if the axis visibly says so.
**Why:** Truncated axes fake drama: signups 900→1,000 drawn from a 900 baseline look like "+300%" when the change is small; 47% vs 49% approval looks like a landslide but is a tie.
**Numbers:** Examples: axis "starts at 90" for values 90–100; "+300% truncated axis".
**Good vs Bad:** Bad: `yAxis.min = 900` on bars. Good: `yAxis.min = 0` for bars; for lines, a visible "axis starts at 90" label.
**How to check:** Read the lowest y tick on every bar chart = 0.
**Source:** https://www.facebook.com/reel/2112714999632984, https://www.facebook.com/reel/3087307248136449, https://designmotionhq.com/patterns/charts-that-lie

### 3. One accent colour, the rest grey

**Rule:** Highlight the one series the chart is about (e.g. "Pro" in teal) and render the others neutral grey. No rainbow of 5 categorical colours by default.
**Why:** Colour is encoding, not decoration; five colours compete equally and nothing stands out.
**Numbers:** 5 plans × 5 colours = rainbow (bad) → 1 accent + 4 grey (good).
**How to check:** Count saturated hues per chart; >1 needs a reason.
**Source:** https://www.facebook.com/reel/2112714999632984, https://www.facebook.com/reel/3087307248136449, https://designmotionhq.com/patterns/charts-that-lie

### 4. Label lines directly where they end

**Rule:** Put each series name at the line's end instead of in a separate legend.
**Why:** "Every line costs a trip" — each legend lookup is an eye round-trip between legend and line.
**Schema:** `────────── Pro` / `────── Enterprise` / `──── Team` (labels at right edge, no legend box)
**How to check:** Legend present on a line chart with ≤ a handful of series = flag; labels sit at the line endpoints.
**Source:** https://www.facebook.com/reel/2112714999632984, https://designmotionhq.com/patterns/charts-that-lie

### 5. Past a dozen series, switch to a sortable table

**Rule:** When a chart has too many series to read (e.g. usage for 12 customers), offer/replace it with a sortable table (Customer | Usage).
**Numbers:** Example: 12 lines → a table with values like 51.3k, 27.6k, 84.1k. (The exact readable limit isn't legible in the source; treat ~12 as the point where a chart stops answering.)
**How to check:** Count series; at ~12 a table or a "Switch to table" option must exist.
**Source:** https://www.facebook.com/reel/2112714999632984

### 6. Pick the chart for the question

**Rule:** Bars compare values, lines show change over time, pie breaks past 5 slices. "The question picks the chart — not your taste."
**Numbers:** Pie max 5 slices.
**How to check:** For each chart write the question it answers; check the type matches.
**Source:** https://www.facebook.com/reel/3087307248136449, https://designmotionhq.com/patterns/charts-that-lie

### 7. Kill the chartjunk: maximise data-ink

**Rule:** Strip gridlines, 3D, shadows, gradients and boxed legends until nearly every pixel is data.
**Numbers:** Example: data-ink 28% (cluttered) → 87% (clean).
**How to check:** List non-data elements (heavy gridlines, borders, backgrounds, 3D); each must earn its place.
**Source:** https://www.facebook.com/reel/3087307248136449, https://designmotionhq.com/patterns/charts-that-lie

### 8. Honest aspect ratio (bank to 45°)

**Rule:** Choose the chart's width/height so the average slope is near 45°. Same data, different ratio = different story.
**How to check:** Squash/stretch test: a flat trend must not look like a cliff because the chart is tall and narrow.
**Source:** https://www.facebook.com/reel/3087307248136449, https://designmotionhq.com/patterns/charts-that-lie

### 9. Title with the takeaway

**Rule:** "Revenue flat since March", not "Quarterly revenue".
**How to check:** Each chart title states a finding, not just a metric name.
**Source:** https://www.facebook.com/reel/3087307248136449, https://designmotionhq.com/patterns/charts-that-lie

### 10. Never encode meaning by colour alone

**Rule:** Pair colour with icons, arrows, patterns or labels.
**Numbers:** ~8% of users have colour vision deficiency (per the pattern page).
**How to check:** Greyscale screenshot: every distinction still readable.
**Source:** https://designmotionhq.com/patterns/color-accessibility

### 11. Dashboard KPIs need hierarchy, not four identical tiles

**Rule:** Make the primary metric bigger and give it context (e.g. "+12.5% from last month", breakdown "Subscriptions / One-time"); don't put four same-size, same-weight cards each with its own coloured icon tile. Shadows only on what floats (menus, popovers), not on every card. Replace "Welcome back, Name" with the real context, e.g. "Revenue · Aug 1 to Aug 31, 2026". Show changes in the right unit ("+0.4 pt" for a rate, not "+12.5%" pasted on every tile).
**Why:** These are the "AI-made dashboard" tells: gradients with nothing to say, four colours for four numbers, same size/weight, everything floating, filler copy.
**How to check:** Is one KPI visually dominant? Are icon tiles multi-coloured? Count shadowed non-floating cards. Does the header state the date range?
**Source:** https://www.facebook.com/reel/1562348875576398

### 12. Tabular, right-aligned numbers (merged)

See **tables-and-responsive.md § 7 (Numbers right, tabular figures)** — canonical rule; merged here to avoid duplication.

### 13. Abbreviate big values, exact on hover

**Rule:** Show compact values (3.4M) by default and the exact value (3,400,000) on hover/tap.
**Numbers:** 1K = 1,000; 1M = 1,000,000; 1B = 1,000,000,000.
**How to check:** Values over ~7 digits in KPIs/axes are abbreviated and the exact value is reachable.
**Source:** https://www.facebook.com/reel/28747148424888259

### 14. Relative time under a day, absolute after

**Rule:** "2h ago" for events under 24h; an absolute date ("Feb 27") for older ones.
**How to check:** Activity feeds: entries < 1 day relative, older absolute.
**Source:** https://www.facebook.com/reel/28747148424888259

### 15. Pin the currency symbol, align the decimals

**Rule:** In money columns, align decimals; the currency symbol may be pinned to the left of the cell rather than glued to each number.
**Good vs Bad:** Bad: `$1,000.00 / $9.99` glued and ragged. Good: `$ 1,000.00 / $     9.99` decimals stacked.
**How to check:** Decimal points in a money column form one vertical line.
**Source:** https://www.facebook.com/reel/28747148424888259

### 16. Honest averages in ratings

**Rule:** Fractional stars (4.4 = 4 full + 44% of the 5th), never rounded up; pair with the distribution.
**How to check:** A 4.4 rating doesn't render as 4.5 or 5 stars.
**Source:** https://designmotionhq.com/patterns/star-rating, https://www.facebook.com/reel/2106780266928548
