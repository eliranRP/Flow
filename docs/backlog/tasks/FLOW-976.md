<a id="flow-976"></a>
# FLOW-976 · First use v2: the UX/UI rules review of sign-in and setup
- **Type:** UI (design approved) · **Status:** in-progress · **Depends on:** — · **Source:** a review of sign-in (/sign-in) and the setup (/setup/welcome, steps 1 to 7, /setup/done) against a UX/UI rule set. The owner approved the design on 2026-10-26, with no owner call open; owner calls the same day: "+ עסק חדש" opens setup (on main since FLOW-514), and the push question is asked once. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", the First use row and its findings note "FIRST USE v2".
- **Files:** `app/src/screens/SignInScreen.tsx`, `app/src/ui/layout.tsx` (the sign-in parts), `app/src/ui/css/09-sign-in-project.css`, `app/src/setup/shell.tsx`, `app/src/setup/steps.tsx`, `app/src/setup/done.tsx`, `app/src/setup/copy.ts`, `app/src/setup/setup.css`, the field placeholder in `app/src/ui/css/02-fields-sheets.css`, their stories and tests, a decision record, a design log entry.

- [ ] Step 6's button is never greyed out: before the sample is approved it is a neutral button that says "אשרו את השורה למעלה" and takes focus to אישור.
- [ ] "+ פרויקט" is never greyed out; a tap with no name, a short one or a taken one says why under the field.
- [ ] A skipped row's "—" on the done screen reaches 4.5:1.
- [ ] "הקודם" and "דילוג על הכל" are 44px.
- [ ] Field placeholders reach 4.5:1 (the field edges are 3:1 since FLOW-972).
- [ ] Sign-in: the help link sits inside the error, and the button then reads "ניסיון חוזר עם Google".
- [ ] Sign-in: offline says so before the tap ("אין חיבור לאינטרנט. הכניסה תעבוד כשהחיבור יחזור.").
- [ ] Sign-in: the heading is 32px; the legal links keep their 44px targets.
- [ ] One push question: step 7's notifications answer is the same asked-once answer as the review card's, so a user who answered in setup is not asked again.
- **Acceptance:** stories of sign-in offline and failed, step 6 before approval, and the project field's note; tests for each of the above; decision record; design log entry.
