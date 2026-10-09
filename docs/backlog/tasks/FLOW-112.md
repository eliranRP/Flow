<a id="flow-112"></a>
# FLOW-112 · Kept-out categories follow-ups (#67 review)
- **Type:** BACKLOG NIT · **Status:** done (#81) · **Depends on:** —
- [x] Default names: near-variant category names aren't matched, and a rename doesn't re-check the default. (#81: `private.pnl_name_key`; the trigger also runs on a rename into a default name.)
- [ ] A merely suggested kept-out category already removes the line from the P&L. Moved to [FLOW-121](FLOW-121.md).
- [ ] `get_project` doesn't report kept-out project income. Moved to [FLOW-121](FLOW-121.md).
- [x] Document the change in what `count` means in the P&L outputs. (#81, TOOLS.md)
- [x] An owner who is also a viewer is refused by `set_category_excluded_from_pnl`. (#81)
- [x] The default loan categories match by Hebrew name in several places (loan split check, income review filter, loan trigger). Move to a stable key or flag. (#81: `categories.loan_part` in the database checks; the app split sheet and the Mercury hint move in [FLOW-122](FLOW-122.md).)
