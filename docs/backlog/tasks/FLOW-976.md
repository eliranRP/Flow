<a id="flow-976"></a>
# FLOW-976 · First use v2: the UX/UI rules review of sign-in and setup
- **Type:** UI (design approved) · **Status:** in-progress (#836) · **Depends on:** — · **Source:** a review of sign-in (/sign-in) and the setup (/setup/welcome, steps 1 to 7, /setup/done) against a UX/UI rule set. The owner approved the design on 2026-10-26, with no owner call open; owner calls the same day: "+ עסק חדש" opens setup (on main since FLOW-514), and the push question is asked once. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", the First use row and its findings note "FIRST USE v2".
- **Files:** `app/src/screens/SignInScreen.tsx`, `app/src/ui/layout.tsx` (the sign-in parts), `app/src/ui/css/09-sign-in-project.css`, `app/src/setup/shell.tsx`, `app/src/setup/steps.tsx`, `app/src/setup/done.tsx`, `app/src/setup/copy.ts`, `app/src/setup/setup.css`, the field placeholder in `app/src/ui/css/02-fields-sheets.css`, their stories and tests, a decision record, a design log entry.

- [x] Step 6's button is never greyed out: before the sample is approved it is a neutral button that says "אשרו את השורה למעלה" and takes focus to אישור.
- [x] "+ פרויקט" is never greyed out; a tap with no name, a short one or a taken one says why under the field.
- [x] A skipped row's "—" on the done screen reaches 4.5:1.
- [x] "הקודם" and "דילוג על הכל" are 44px.
- [x] Field placeholders reach 4.5:1 (the field edges are 3:1 since FLOW-972).
- [x] Sign-in: the help link sits inside the error, and the button then reads "ניסיון חוזר עם Google".
- [x] Sign-in: offline says so before the tap ("אין חיבור · הכניסה תעבוד כשהחיבור יחזור", the shared offline line).
- [x] Sign-in: the heading is 32px; the legal links keep their 44px targets.
- [x] One push question: step 7's notifications answer is the same asked-once answer as the review card's, so a user who answered in setup is not asked again.
- **Acceptance:** stories of sign-in offline and failed, step 6 before approval, and the project field's note; tests for each of the above; decision record; design log entry.
