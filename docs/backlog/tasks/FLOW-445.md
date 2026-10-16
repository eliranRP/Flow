<a id="flow-445"></a>
# FLOW-445 · Redesign: the Projects tab, the project page, new project, ⋯ menu, finish and delete
- **Type:** UI (design approved) · **Status:** claimed (server PR #631 and UI draft PR; UI work not started) · **Depends on:** [FLOW-363](FLOW-363.md) · **Related:** [FLOW-446](FLOW-446.md) (the השקעה והלוואות page), [FLOW-140](FLOW-140.md) (the profit rows open it), [FLOW-369](FLOW-369.md) (add to a project) · **Source:** the owner's approved redesign, handed off 2026-10-11. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", section "Projects tab" (boards: prototype, a flip in renovation, a rental, a client job, finished shown, new project sheet, new empty page, ⋯ menu, finish confirmation, menu with delete); rules on "Design guide", motion on "Flow & motion".
- **Files:** `app/src/screens/projects-screen.tsx`, `app/src/screens/project-detail-screen.tsx`, `app/src/screens/project-overview.tsx`, `app/src/screens/project-attention.ts`, `app/src/screens/project-transactions.tsx`, `app/src/project-cash.ts`, `app/src/ui/confirm-sheet.tsx`, `app/src/ui/investment-card.tsx`, `app/src/ui/css/09-sign-in-project.css` (project blocks only), `app/src/ui/css/32-project-page.css`, their stories and tests.

**List (flat rows)**
- [ ] Top: "+ פרויקט חדש" (text link) and search. Title פרויקטים 32/600, "N פעילים · תזרים <month> עד היום". Past 90px a compact bar slides down (240ms): + · פרויקטים · search.
- [ ] When lines have no project: one accent link "N שורות בלי פרויקט · $X · לשיוך" → the review queue.
- [ ] פעילים, biggest cash movement first. Row: initials circle, name, "<the owner's own type text> · <status>" (plus "· מעל התקציב" in the signal colour when spent > budget), this month's cash (income green with +, out neutral with U+2212, no movement grey $0).
- [ ] Overhead last: dashed circle, "הוצאות כלליות · תקורה · לא פרויקט" ([0101](../../decisions/0101-unassigned-and-overhead-project.md)).
- [ ] "הסתיימו · N" with הצג / הסתר; finished rows dimmed with a tick and their final result.
- [ ] Projects + overhead + unassigned add up to Home's month figure.

**Project page (cards, pushed in from the left)**
- [ ] Band: "← פרויקטים", ⋯, name 24/600, type · status, "תזרים <month> · עד היום", the figure 52/500, נכנס / יצא. On scroll the figure block fades from 40px to 200px, then a compact purple bar slides down: Back · "<name> · <cash>" · ⋯.
- [ ] דורש טיפול card when the project has pending lines → the review queue filtered to the project.
- [ ] תקציב card when a budget is set: "נוצל $X מתוך $Y", a thin bar (accent; signal when over), "נשארו $Z · N%" or "חריגה של $Z"; עריכה. No budget: a quiet "+ הוספת תקציב" at the end.
- [ ] Profit card: רווח <month> and רווח מתחילת הפרויקט (with since when); each opens the profit page (FLOW-140). A loss uses the signal colour.
- [ ] השקעה והלוואות card (properties only): purchase, renovation so far, ARV (flip) or value today (rental), loan balance; the equity figure and a two-part bar הון עצמי vs הלוואה; "לפרטים" opens FLOW-446. Client jobs have no investment card.
- [ ] חודשים קודמים card: month, a short note, the month's cash.

**New project, ⋯ menu, finish, delete**
- [ ] New project sheet, three fields: שם הפרויקט (required); סוג (optional free text, no preset options); תקציב (optional, $, "נראה כמה נוצל, ונסמן כשעוברים אותו"). Footer "רק השם חובה. פרויקטים מ־SUMIT נוספים לבד." יצירת פרויקט is disabled until the name has text; creating opens the new page, toast "הפרויקט נוצר"; the new project tops the list with "<type> · חדש". Empty page: band at $0, the תקציב card if set, and "אין עדיין תנועות" with one line on what will appear.
- [ ] ⋯ sheet titled with the name: עריכת פרטים (the same form pre-filled, שמירה, toast "הפרטים נשמרו"); השקעה והלוואות (properties only); סיום הפרויקט; מחיקת הפרויקט last, in the signal colour, only when the project has no transactions, invoices, months or pending lines.
- [ ] Finish confirmation "לסיים את <name>?": it moves to הסתיימו, leaves the project picker, keeps everything and can be reactivated; with pending lines, a signal line suggests approving them first. Finishing returns to the list with הסתיימו open and a toast.
- [ ] Delete confirmation "למחוק את <name>?" ("nothing changes, can't be undone"), an outlined מחיקה in the signal colour and ביטול; returns to the list with a toast.
- **Owner's answer (2026-10-12):** yes, build "הוספה לפרויקט" as a row in the ⋯ menu; it opens Add (FLOW-369) with this project filled in.
- [ ] Loading and empty: use the shared skeleton, empty state, inline spinner and sync strip of [FLOW-371](FLOW-371.md).
- **MCP:** `create_project` takes type text and budget if it doesn't yet (check, and extend with TOOLS.md). Finish, reactivate, edit details and delete are writes the MCP doesn't have today (TOOLS.md lists `rename_project` and `finish_project` as waiting): add `update_project` (name, type, budget, status) and `delete_project` (refuses a project with any line, invoice or month), each with an idempotency key, the write rate limit and undo.
- **Acceptance:** stories of the list (with unassigned lines, finished shown), each project kind's page, over budget, no budget, the empty new page, the sheets and both confirmations, at 320 and 393 with invented projects; a sample test that the rows add up to Home; a pgTAP test that `delete_project` refuses a project with a line and the owner can delete an empty one; a test that יצירת פרויקט stays disabled without a name; design review against the boards.
