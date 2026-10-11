# Review card: the card or account name on the bank line

- PR: FLOW-439.
- Kind: component
- Changed: the לאישור card's bank line showed only the card's last 4 ("••8408"). It now adds the bank's name for the card, or the name of the account a transfer left from, after a dot ("••8408 · כרטיס חשמל"). No name from the bank: the last 4 alone, as before. A long name ellipsizes at 320; the last 4 never clips.
- Rule: the bank line names its source in a few words; the last 4 stay whole, the name gives way.
- Source: the owner, 2026-10-11 ("card / account name when approving transaction"). Small UI, reviewed by the lane's reviewer against DESIGN-RULES.
- Shots: review card stories MetaCardName, MetaCardLongName320, MetaAchAccount (390 light and dark, 320 light).
