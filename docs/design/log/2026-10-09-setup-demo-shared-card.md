# FLOW-506: Setup demos draw the shared review card and tab bar

- PR: #356
- Kind: component
- Changed: The Jev and first-approval setup demos render the shared ReviewCard (document tile, signed amount, "לפני מע״מ" VAT line, project and category rows with their הצעה or הצעת Jev tags) instead of a hand-built copy. While Jev is still filling, the rows hold a still skeleton with no shine. The SUMIT demo ends on TabBarPicture, a router-free picture of the five-slot tab bar with the add button and the לאישור badge, instead of a three-tab copy. The approval demo's wrapper drops the home setup card's border, so the card is drawn once, and its אישור button sits under the card at the card's width.
- Rule: A demo or storyboard draws the shared component (or its presentational picture), never a hand-built copy, so the demo can't drift from the app.
- Source: FLOW-506 (backlog), lane manager order.
