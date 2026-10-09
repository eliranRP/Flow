# FLOW-502: Setup step 5 offers the evening reminder

- PR: #377
- Kind: screen
- Changed: Setup step 5 (התקנה) shows the review screen's quiet card, "תזכורת בערב כשיש תנועות לאישור?" with כן / לא עכשיו, under the numbered steps and above סיום. It is the same component and the same asked-once answer, so answering on either screen hides both. On step 5 the card spans the body like the steps (the review empty state keeps its narrower measure). When the card closes with focus in it, focus goes to the step's own button. An iPhone tab is not asked on step 5: iOS delivers web push only to the app installed on the Home Screen, so a tab would be offered something it can't receive. The step already teaches the Home Screen, and the card asks again from the installed app. New stories: Screens/Setup Install step, evening reminder / dark / 320.
- Rule: a one-time question shown in two places shares one answer.
- Source: FLOW-502 (last box: setup step 5 offers it).
