<a id="flow-420"></a>
# FLOW-420 · Phone polish after the profit-line deploy (cycle 16)
- **Type:** SMALL UI · **Status:** ready · **Depends on:** — · **Source:** cycle 16 phone review of main at 333b55f, 2026-10-10. Shots and findings are in the project files under `reviews/ui-ux-cycle-16/`. No owner card.
- [x] (UI lane 1, in the FLOW-415 step D PR) Payment page: the "נספר ברווח" switch row draws `ChartIcon` at its 36px default with a 1.6 stroke, while every other row on the page uses 24px with a 1.9 stroke, so its label starts 12px further in. Pass `size={24} stroke={1.9}` in `transaction-screen.tsx` and in the `charge-switches` story, so the three switch rows share one start edge.
- [x] (UI lane 4; done by UI lane 3) Review empty state, notifications card (FLOW-502): "התראה על תנועה חדשה ותזכורת בערב?" leaves "בערב?" alone on line 2 at 375, 393 and 412. Add `text-wrap: balance` to `.ui-prompt-question` (`css/30-prompt-card.css`).
- [ ] (UI lane 2, in open PR #514) לא הגיעו list: the new "project · category" hint has no line limit; a long project name runs 5 lines at 320. Clamp it to 2 lines like `.ui-row-project .ui-row-hint` (§3.7 FLOW-358), keeping "· category" whole.
