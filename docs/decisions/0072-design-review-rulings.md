# Design-review rulings for Split, toasts, and sample copy

**Date:** 2026-09-29
**Status:** Accepted

## Context

The r18 and r19 design reviews of Split v2 and the review screen asked for a fix where a manual split that is not 100% showed the wrong shekel on the last row, and for toast placement that stayed off-screen or over אישור. They also left ten open questions. [0070](0070-split-remainder-and-undo-log.md) already keeps the leftover agora on the last project of a valid split.

## Decision

1. When the basis points do not sum to 10000, each manual row shows `amount × bp / 10000` and takes no leftover agora. The summary stays the invalid message ("נשארו …% לחלק" or "הסך …%. צריך 100%."). A valid split still puts the leftover agora on the last project, as in [0070](0070-split-remainder-and-undo-log.md).
2. A toast is placed just under the page header or the open sheet header. Placement runs again while the sheet settles, and the top stays inside the viewport. It moves until it is clear of every control, trying under the header and above the controls. When no full slot is free, it shrinks into the largest open gap, or sits at the top edge inside the safe area, and it does not overlap a control. The host fallback is the safe area plus a spacing token.
3. "בחרו איך לחלק" is primary text. Invalid summary lines stay secondary.
4. "הסך 100%" sits clear of the sticky footer. The split page pads by the footer height.
5. A read-only check row uses the default cursor. A busy control uses `cursor: progress`. That is the loading cursor.
6. Split stories show "נתוני דוגמה · Example data". Sample names use gershayim, as in פ״ת and ת״א.
7. A project expense with a project and no category says "חסר קטגוריה, בחרו בשינוי", and אישור stays disabled. A category with no project still says "חסר פרויקט, בחרו בשינוי".
8. These open questions stay as built: manual rows are taller than 64px because the shekel line sits under the field (O1); one ticked project says "₪X לפרויקט אחד" (O2); an unchecked checklist row has no value (O3); the extra Split sentences in the product stay (O4); whether iOS offers AutoFill from a Hebrew "שם" label stays a device check, and the field attributes stay as they are (O6).
9. The preview notice "במצב תצוגה זה לא נשמר." uses the info tone, not the error tone. It still stays long enough to read.
10. When an even split's shekel parts are not exactly equal, the subline and the summary say "₪1,000 מתחלק שווה בין 3 פרויקטים". "₪X לכל אחד" stays only when every part is the same amount.
11. The empty שויכו היום copy stays, with a maqaf: "כש־SUMIT".
12. The שויכו היום story uses the same tab bar as the app route. The banner count and the sample list are the same number of rows.
13. A Hebrew prefix before a Latin word uses a maqaf: כש־SUMIT, ב־SUMIT, מ־SUMIT, ל־SUMIT, מ־Google. An ASCII hyphen is not that join.

## Alternatives rejected

Putting the leftover agora on the last row of an invalid percent total. Leaving the preview notice red. Saying "לכל אחד" when the last project receives a different agora. Rendering שויכו היום without the tab bar.

## Consequences

A 70% / 50% split of ₪1,000 reads ₪700 and ₪500, and שמירה stays off. An even three-way split of ₪1,000 names the whole ₪1,000. A toast on an opening sheet is on screen.
