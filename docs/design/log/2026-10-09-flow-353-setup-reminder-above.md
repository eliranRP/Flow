# Setup step 5: the reminder card sits above the install demo

- PR: pending
- Kind: screen
- Changed: On setup step 5 (התקנה) the evening reminder card ("תזכורת בערב כשיש תנועות לאישור?") moves from under the numbered steps to above the install demo, right under the step's line. Its כן and לא עכשיו used to start under the pinned סיום, 200px down at 375x667. Now they show on arrival at 320x667, 375x667 and 390x844. The demo and the steps follow and scroll as before. When the card isn't asked (answered, iPhone tab, no push), the page is unchanged.
- Rule: A question on a step with a pinned action sits above the step's demo, so its answers show on arrival.
- Source: cycle 12 review, item 3 (FLOW-502 follow-up).
