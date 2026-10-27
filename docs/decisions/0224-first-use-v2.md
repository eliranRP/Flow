# First use: sign-in says it is offline and keeps its help in the error; setup never greys a button; one push question

**Date:** 2026-10-27
**Status:** Accepted (owner, 2026-10-26, FLOW-976. Refines [0201](0201-push-device-row-and-test-push.md)'s asked-once push prompt so setup's step 7 answers it too)

## Context

FLOW-976 reviewed sign-in and the setup (welcome, steps 1 to 7, done) against the same UX/UI rule set as the other v2 screens. A failed sign-in put its help link under the button, apart from the error, and offline the page said nothing until the tap failed. Step 6 greyed its bottom button until the sample was approved (2.46:1), "+ פרויקט" greyed out before a name was typed, a skipped row's "—" on the done screen was 3.22:1, הקודם and דילוג על הכל were 40px, and a field's prompt was the browser's grey. Step 7's notifications switch subscribed the device but did not record the answer, so the review card could ask the same question again later. The owner approved the First use v2 board with no call open, and asked for one push question.

## Decision

1. **Sign-in.** Offline, the page says "אין חיבור · הכניסה תעבוד כשהחיבור יחזור" before the tap; a tap while offline stays on the page with the failure notice instead of opening Google. A failed sign-in keeps "צריך עזרה בכניסה?" inside the error notice (44px), and the button then reads "ניסיון חוזר עם Google". The heading is 32px; the legal links keep their 44px targets.
2. **Never greyed out.** Step 6's bottom button is neutral and enabled before the approval: it says "אשרו את השורה למעלה" and takes focus to the sample's אישור. "הוספה" on step 3 is always enabled; a tap that cannot add says why under the field ("כתבו שם לפרויקט", "שם קצר מדי – לפחות 2 תווים", "כבר יש פרויקט בשם הזה").
3. **Contrast and size.** A skipped row's "—" is `--color-text-muted` (4.95:1 light and 5.99:1 dark on the card). הקודם and דילוג על הכל are 44px. A text field's prompt is the new `--color-placeholder` on every screen (`.ui-field-control::placeholder`): #6E6682 light, 4.71:1 on the field's raised fill and 5.4:1 on white; #978EAB dark, 5.12:1 on the raised fill. It stays lighter than secondary text, so it does not read as a value. `--color-text-muted` was not enough: 4.31:1 on the light raised fill. The edge is already `--color-control-edge` (0222).
4. **One push question.** Step 7's answer is the review card's asked-once answer (`answer_push_prompt`, through the one `useRecordPushAnswer()` both use): a subscribed device records yes, the switch turned off records no, a refused permission records no. A subscribe that fails for another reason is not an answer, so the review card can still ask later. A step skipped with "לא עכשיו" records nothing either. The switch's hint says what a yes turns on, as the review card does: "התראה על תנועה חדשה ותזכורת בערב" (it promised a Sunday summary, which is its own switch in הגדרות and a yes does not turn on).

## Alternatives rejected

- A disabled step 6 button with a hint: the rule set's point is that a control never goes dead; the button already says what to do.
- Asking about push only on the review card and dropping step 7's switch: the approved board keeps the switch in setup, where installing to the Home Screen is taught.
- Keeping the help link under the button: after a failure the way out belongs with the error that needs it.
