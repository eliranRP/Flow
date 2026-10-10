<a id="flow-343"></a>
# FLOW-343 · Phone polish after the October 9 builds (cycle 7)
- **Type:** SMALL UI · **Status:** done (#306) · **Source:** mobile UI/UX review cycle 7 (2026-10-09, deploy e1bec50), shots in the project's reviews/ui-ux-cycle-7/
- [x] (UI lane 4, #306: focus and scroll to the first field to fix; story SaveFocusesFirstEmpty) (high) Loan setup: a tap on שמירה with empty fields keeps focus on the button with the page scrolled down, so at 375 two of three errors sit above the fold. Move focus (and scroll) to the first empty field, as §2.8 says. Add a story and a test.
- [x] (UI lane 4, #306: only the part's red "פרויקט · חובה בהחזר"; the footer keeps ביטול השינוי and the sentence for screen readers) Split by categories, refund part with no project: the same missing project is said three times ("פרויקט · חובה בהחזר", "חלק החזר צריך פרויקט." and the footer). Keep it once, on the part's own line as the tap target (§3.7, a warning shows in one place only).
- [x] (UI lane 4, #306: also "שווה בין כל הפרויקטים", which repeated the same way) Split between projects, "שאבחר": the picked choice's hint and the pinned footer repeat "₪500 לכל אחד מ־2 פרויקטים". Show it once, in the footer.
- [x] (UI lane 4, #306) Transaction card, the refusal for a kept-out refund part with no project (#286): shorten to "לחלק ההחזר אין פרויקט." with a "לפיצול" action on the toast.
- **Acceptance:** shared components and stories, 320 and dark included; a design log entry; clip-check at 320/360/390; design review.
