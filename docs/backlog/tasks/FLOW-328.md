<a id="flow-328"></a>
# FLOW-328 · Mobile UI consistency pass (cycle 1)
- **Type:** SMALL UI · **Status:** done (#165; whole-unit amounts item open, conflicts with 0120) · **Depends on:** FLOW-326 · **Source:** cycle 1 (D4, D6, D7, D8, D10, D11, D13, D14, D15, D17, U10, U11, U13)
- [x] Change sheet rule preview: the arrow's space is inside the LTR bdi, so it renders on the wrong side ("ספק ␣␣←פרויקט"); spaces outside the bdi.
- [x] Split screen: remove the hairlines between choices, 24px side gutter like other screens, amount on the start side.
- [x] Install screen: remove step hairlines and centre the number circles on their text.
- [x] Change sheet: values at the same weight as the transaction detail; title-to-subtitle gap as mockup 06.
- [x] Project screen: more space between the band and the overhead switch (mockup 02).
- [x] Empty and error states use the standard button, not a 36px pill, and match each other.
- [x] The "מצב תצוגה" tag on the band sits on the start side, clear of the curve.
- [x] No minus sign on a figure already labelled expenses (project band, category rows).
- [x] Status chip "שולם" carries the ✓ like mockup 10.
- [x] Notifications uses the shared EmptyState, Hebrew only.
- [ ] Amounts in lists in whole units; agorot only when non-zero, on detail and edit fields (§3.5). (Not in this PR: transaction rows show cents, ".00" included, by the owner's decision [0120](../../decisions/0120-income-green-type-scale.md) option C; needs an owner call before it changes.)
- [x] Transaction list rows carry the trailing chevron, then drop the "אפשר לפתוח כל תנועה" explainer.
- [x] Empty Home names bank or SUMIT ("חיבור בנק או SUMIT"), opening the connections page.
- [x] (cycle 3) One word for splitting a line: the detail section says "פיצול" while older screens say "חלוקה". The owner chose "פיצול" (2026-10-08); use it on every screen and in the MCP copy.
- **Acceptance:** shared components and stories; clip-check; design review.
