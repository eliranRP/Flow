<a id="flow-932"></a>
# FLOW-932 · Profit: the company summary, next month's card and the income/expenses chart, and category rows with bars
- **Type:** UI (design approved) · **Status:** ready · **Depends on:** [FLOW-140](FLOW-140.md) (the profit pages this changes) · **Related:** [FLOW-933](FLOW-933.md) (next month's numbers and the page the card opens), [FLOW-934](FLOW-934.md) (the same card and chart on the project page) · **Source:** the owner approved it on 2026-10-19. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", section "Profit (רווח)" (boards "Profit · prototype", "Project profit · Cedar St", "Profit · לפי קטגוריה", "Profit · month · לפי קטגוריה"), light versions; spec notes "Next month in project profit", "A month of a project, by category" and "Next month's forecast, the same on every related screen" at the end of the Profit row. The canvas page "What changed" lists it.
- **Files:** the company and project profit screens and the project month screen, three shared parts in `app/src/ui/` (the next-month card, the income/expenses chart, the category row with a bar) added to the Design guide, their stories and tests. Remove the company summary's two bars, the "מתחילת השנה" line, and the one-line "נובמבר · צפי" row.

**Shared parts (build once, used here and in FLOW-934)**
- [ ] Next-month card: dashed outline, radius 20, "<month>" + "צפי" tag, הכנסות צפויות (28/400, green with +, grey when $0) and הוצאות צפויות, each with a short caption, and under a divider the net in grey. The top-left text is a link with a chevron when the card opens something, plain grey text when it doesn't.
- [ ] Income/expenses chart: "הכנסות והוצאות לפי חודש" and a caption; two bars per month (income accent, expenses grey, one scale, 108px max, 4px radius), time right to left, next month dashed and unfilled ("<month> · צפי" in accent); legend הכנסות · הוצאות · צפי; one text label for screen readers with next month's numbers.
- [ ] Category row: name and amount, "% מההכנסות / % מההוצאות · N תנועות" (company: "· N פרויקטים"), a 4px bar against the biggest in its group; a row opens in place to its lines.

**Screens**
- [ ] Company profit: the summary becomes the project page's summary card (rows with dividers): הכנסות, הוצאות שנספרות ברווח, **רווח <month>** (bold), רווח מתחילת השנה. Then the next-month card ("7 פרויקטים וכללי", no link: every project's forecast plus the general costs) and the chart (six months and next month), then the chips.
- [ ] Company profit › לפי קטגוריה: two groups (הכנסות, then הוצאות) with totals, category rows.
- [ ] Project profit › לפי חודש: the next-month card (link "פירוט ועריכה" → [FLOW-933](FLOW-933.md)'s page) and the chart, above the months. Only in לפי חודש.
- [ ] A project's month › לפי קטגוריה: the same two groups and category rows.

- **Acceptance:** stories of the three parts (with and without a link, $0 income, a short history) and the four screens, dark and light, at 320 and 390; design review against the boards.
