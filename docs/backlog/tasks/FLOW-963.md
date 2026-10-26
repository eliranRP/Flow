<a id="flow-963"></a>
# FLOW-963 · Recurring v2: the UX/UI rules review of קבועים
- **Type:** UI (design approved) · **Status:** in-progress (#825) · **Depends on:** — · **Source:** a review of קבועים against a UX/UI rule set. The owner approved the design on 2026-10-26; on a card the same day the late-bill answers keep equal weight. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", the Recurring v2 row and its findings note.
- **Files:** migration `supabase/migrations/20261026155513_recurring_charge_reassign.sql` and its pgTAP file, flow-mcp's write tools, `app/src/screens/recurring-charge-pick.tsx`, `app/src/screens/recurring-screen.tsx`, `app/src/screens/recurring-charge-screen.tsx`, `app/src/ui/recurring-list.tsx`, `app/src/ui/recurring-match-box.tsx`, `app/src/ui/recurring-charge-parts.tsx`, `app/src/ui/related-charges.tsx` (the history chart), `app/src/ui/pace.ts`, the recurring CSS under `app/src/ui/css/`, their stories and tests, a decision record, a design log entry.

- [x] The month card's tracks, the history chart's bars and its empty months reach 3:1; the chart's label names every month.
- [x] The late-bill answers are 44px outlined buttons of equal weight; the match box's "לא" reads "לא, זה משהו אחר".
- [x] A failed read keeps the header and shows the failure card (נסו שוב, צריך עזרה?); offline with rows on screen shows the offline line, on the list and the charge page.
- [x] An ended charge's amount is muted text at 4.5:1.
- [x] On קבועים every toast sits under the header; an undo stays 5s, a plain note 4s.
- [x] The month card leads with its takeaway: "עד סוף החודש: לשלם עוד $x, לקבל עוד $y".
- [x] The history chart's title is the takeaway ("גבוה ב־38% מהרגיל" / "כמו בכל חודש"), under a small metric label.
- [x] Type scale only, amounts tabular.
- [x] "לא קבוע" is the last choice in the pace sheet.
- [x] "שינוי" and "החזרה" are 44px.
- [x] The פרויקט and קטגוריה rows open a picker (owner, 2026-10-26): a pick moves every payment of the charge, the earlier ones too, with one undo (`reassign_recurring_charge`, `undo_reassign_recurring_charge`), and flow-mcp's `reassign_recurring_charge`, undone by `undo_batch`. A shared cost and a line split into parts are left.
- **Acceptance:** stories of the list (late, ask, failed, offline) and the charge page (failed, offline, ended); tests for the answers, the takeaways, the toast place and times, the pace order; decision record; design log entry.
