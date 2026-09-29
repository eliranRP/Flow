# Control audit

Every interactive control on a product screen, sheet, or shared chrome. Storybook fixtures are not product controls. A control that cannot work yet is disabled, with a not-allowed cursor and a reason. An enabled control must navigate, open something, change state, or call the API.

Preview mode does not write. A save there toasts "במצב תצוגה זה לא נשמר." and stays on the screen. That toast is the feedback, not a no-op.

`result` is the Playwright pass on 2026-09-29. Every row below passed.

| screen | control | expected | disabled when | busy | success | error | result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tab bar | בית | Opens Home. Stays on Home when already there. | never | no | route `/` | none | pass |
| Tab bar | פרויקטים | Opens the project list. | never | no | route `/projects` | none | pass |
| Tab bar | הוספה (+) | Opens the add sheet over the current tab. When that sheet is already open, + closes it. | never | no | route `/add`, sheet title הוספה, or the sheet closes | none | pass |
| Tab bar | לאישור | Opens the review queue. | never | no | route `/review` | none | pass |
| Tab bar | הגדרות | Opens settings. | never | no | route `/settings` | none | pass |
| Shared | Back, חזרה, ✕ on a screen | Pops history when this visit pushed a screen. Otherwise opens the named parent. | while a split save is in progress | no | previous screen, or the parent | none | pass |
| Shared | Sheet ✕ | Closes the sheet. One history entry, so browser back does the same. | never | no | sheet gone, focus returns | none | pass |
| Shared | Text, amount, and percent fields | The input fills the box. A tap on the left edge, the centre, or the right edge focuses it and opens the keypad. Amounts and percents use `inputmode=decimal`. A whole number uses `numeric`. `autocomplete=off`, the name is not a contact field, and the font is at least 16px. | never | no | the field is focused. `9,999,999.99` fits at 320px (`scrollWidth` <= `clientWidth`) | none | pass |
| Shared | Confirm sheet, the confirm label | Runs the confirm action. | never | the write | the action's toast, sheet closes | the action's error toast, sheet stays | pass |
| Shared | Confirm sheet, ביטול | Closes without saving. | never | no | sheet gone | none | pass |
| Shared | Toast body | Tap or swipe dismisses it. | never | no | toast gone | none | pass |
| Shared | Toast action | Runs the labelled action (ביטול or ניסיון חוזר). | never | the retry | the action's result | the same error toast again | pass |
| Shared | Error state, ניסיון חוזר | Refetches the failed query. On a preview error, returns to the empty preview. | never | no | the screen loads, or the empty preview | the error state stays | pass |
| Sign-in | המשך עם Google | Starts Google sign-in. | no Supabase client | pending label while the redirect starts | route `/` or `/onboarding` | notice on `/sign-in` | pass |
| Sign-in | צריך עזרה בכניסה? | Opens help. Shown only after a failed sign-in. | never | no | route `/help` | none | pass |
| Sign-in | תנאי שימוש | Opens the terms screen. | never | no | route `/terms` | none | pass |
| Sign-in | מדיניות פרטיות | Opens the privacy screen. | never | no | route `/privacy` | none | pass |
| Help, terms, privacy | mail link | Opens `mailto:` for the help address. Help only. | never | no | mail client | none | pass |
| Help, terms, privacy | חזרה | Returns to the previous screen, or sign-in. | never | no | previous screen or `/sign-in` | none | pass |
| Onboarding | Back | Returns to sign-in. | never | no | route `/sign-in` | none | pass |
| Onboarding | עוסק מורשה / עוסק פטור | Selects the VAT kind. | never | no | the segment is selected | none | pass |
| Onboarding | המשך | Creates the company. | never | שומר inside the button | route `/` | toast "לא הצלחנו לשמור." | pass |
| Home, empty | חיבור SUMIT | Opens settings. | never | no | route `/settings` | none | pass |
| Home | period pill | Opens the period sheet. | never | no | sheet with the four periods | none | pass |
| Home | period row | Sets that period and closes the sheet. | never | no | pill label matches the choice | none | pass |
| Home | טווח מותאם | Opens the range sheet. | never | no | sheet title טווח מותאם | none | pass |
| Home | החודש / חודש קודם / מתחילת השנה | Sets the range chips. | never | no | the chip is pressed | none | pass |
| Home | range confirm | Applies the custom range and closes. | never | no | pill shows the range, hero explanation updates | none | pass |
| Home | month chevrons | Move the visible month. The next month is disabled when it would pass today. | the forward chevron when the cursor is the current month | no | the grid month changes | none | pass |
| Home | a day | Sets one end of the range. Future days are disabled. | a day after today | no | the day is in the range | none | pass |
| Home | pending or unpaid banner | Opens review when items are waiting, otherwise unpaid. | never | no | route `/review` or `/unpaid` | none | pass |
| Home | a leading project | Opens that project. | never | no | route `/projects/:id` | none | pass |
| Home | לכל הפרויקטים | Opens the project list. | never | no | route `/projects` | none | pass |
| Projects | search field | Filters the list. | never | no | rows match the query | none | pass |
| Projects | ניקוי החיפוש | Clears the query. Shown when the filter matches nothing. | never | no | the query is empty | none | pass |
| Projects | a project row | Opens that project. | never | no | route `/projects/:id` | none | pass |
| Projects | finished expander | Reveals finished projects. | never | no | the extra rows appear | none | pass |
| Projects | פרויקט חדש | Opens the project sheet. | never | no | sheet title פרויקט | none | pass |
| Projects | שמירה on the new-project sheet | Calls `upsert_project`. | never | the button is busy | toast "הפרויקט נשמר", sheet closes | toast "לא הצלחנו לשמור את הפרויקט." | pass |
| Projects | ביטול on the new-project sheet | Closes the sheet without saving. | never | no | sheet gone | none | pass |
| Projects | שם on the new-project sheet | A tap on the left edge, the centre, or the right edge focuses the field. | never | no | the text field is focused | none | pass |
| Projects | תקציב בשקלים, או ריק | A tap on the left edge, the centre, or the right edge focuses the field. `9,999,999.99` stays fully visible at 320px. | never | no | decimal keypad, `scrollWidth` <= `clientWidth`, ₪ inside the box | none | pass |
| Project | Back | Returns to the project list. | never | no | route `/projects` | none | pass |
| Project | עוד | Opens the more sheet. While the project is loading, the sheet only says it is still loading. | never | no | sheet title עוד | none | pass |
| Project | סיום הפרויקט / החזרה לפעיל | Opens the confirm sheet. | never | no | confirm sheet | none | pass |
| Project | confirm אישור | Calls `upsert_project` with the other status. | never | the confirm button | toast "הפרויקט סומן כהסתיים" or "הפרויקט חזר לפעיל" | toast "לא הצלחנו לעדכן את הפרויקט." | pass |
| Project | אחרי חלק בהוצאות כלליות | Calls `set_after_overhead` for this project. | never | the switch stays on the chosen side until the write fails | the profit figure follows the switch | toast "לא הצלחנו לשמור את התצוגה.", switch returns | pass |
| Project | כל הקטגוריות | Opens categories. | never | no | route `/settings/categories` | none | pass |
| Project | תנועות אחרונות | Reveals the project's recent transactions. Category amount rows are not links. | never | no | the transaction rows appear | none | pass |
| Project | a transaction row | Opens that transaction. | never | no | route `/transactions/:id` | none | pass |
| Project, empty | צילום חשבונית | Opens the add sheet. The capture row there is disabled. | never | no | route `/add` | none | pass |
| Review | צפייה | Opens today's auto-assigned list. | never, and only rendered when the count is above zero | no | route `/review/filed`, title "שויכו היום" | the shared error state on that list. ניסיון חוזר refetches. A preview error opens the empty list | pass |
| Review | banner סגירה | Hides the banner for this visit. | never | no | the banner is gone | none | pass |
| Review filed | a transaction row | Opens that transaction so the project and category can be changed. | never | no | route `/transactions/:id` | none | pass |
| Review filed | Back | Returns to the review queue. | never | no | route `/review` | none | pass |
| Transaction, opened from the filed list | Back | Returns to the filed list, then a second back returns to review. | never | no | the filed list | none | pass |
| Review | אישור | Accepts the suggestion with `resolve_review` and `p_remember: false`. A shared cost opens Split instead. | no project or category can be suggested, or the card is leaving. Cursor not-allowed. | שומר on the button | toast "הפריט אושר", the next card, meter advances | toast "לא הצלחנו לאשר." | pass |
| Review | toast ביטול after approve | Calls `reopen_review` and restores the previous assignment. | never | the retry | toast "הפריט חזר לתור, והשיוך הקודם שוחזר." | toast "לא הצלחנו לבטל." with ניסיון חוזר | pass |
| Review | שינוי | Opens the change sheet for this card. | never | no | route `/review/change` | none | pass |
| Review | דלג | Skips the card with `resolve_review`. | while the card is leaving | the button is busy | toast "דילגנו על הפריט", the next card | toast "לא הצלחנו לדלג." | pass |
| Review, empty | לדף הבית | Opens Home. | never | no | route `/` | none | pass |
| Change sheet | ✕ | Closes back to the review card. | never | no | route `/review` | none | pass |
| Change sheet | project row | Opens the project picker. | an income row has no project row | no | picker title בחירת פרויקט | none | pass |
| Change sheet | category row | Opens the category picker. | never | no | picker title בחירת קטגוריה | none | pass |
| Change sheet | a picker radio | Selects that row and returns to the summary. | never | no | the summary shows the name | none | pass |
| Change sheet | picker חזרה | Returns to the summary without a new choice. | never | no | the summary | none | pass |
| Change sheet | פרויקט חדש | Opens the name field, then `upsert_project`, and selects it. | never | שמירה is busy | toast "הפרויקט נשמר", the new project is selected | toast "לא הצלחנו לשמור את הפרויקט." | pass |
| Change sheet | פיצול בין פרויקטים | Opens Split for this transaction. Without a transaction id, a toast explains that. | never | no | route `/transactions/:id/split`, or the toast | none | pass |
| Change sheet | remember toggle | Includes `p_remember` on save. Expense only. | never | no | the switch moves | none | pass |
| Change sheet | שמירה ואישור | Calls `resolve_review` with action `changed`. | missing project (expense) or category; the click toasts "בחרו פרויקט וקטגוריה." or "בחרו קטגוריה." | the button is busy | toast "השיוך נשמר", back to review | toast "לא נשמר – אין חיבור" with ניסיון חוזר | pass |
| Add | צילום חשבונית | Does not run. Capture is not built. | always. Hint says camera or PDF. Cursor not-allowed. | no | none | none | pass |
| Add | הזנה ידנית | Does not run. Manual entry is not built. | always. Hint says it is only when needed. Cursor not-allowed. | no | none | none | pass |
| Add | ביטול and ✕ | Close the sheet back to the screen that opened it. | never | no | the sheet is gone | none | pass |
| Unpaid | Back | Returns to Home. | never | no | route `/` | none | pass |
| Unpaid | סימון כשולם | Opens the explanation sheet. Flow does not mark the invoice paid in SUMIT. | never | no | sheet title סימון כשולם | none | pass |
| Unpaid | הבנתי | Hides that row for this visit and closes the sheet. | never | no | the row leaves the list | none | pass |
| Transaction | Back | Returns to the project, or the filed list when that opened it. | never | no | the parent screen | none | pass |
| Transaction | עוד | Opens the more sheet. SUMIT rows explain they are not deleted here. A manual row shows מחיקה. | never | no | the sheet | none | pass |
| Transaction | מחיקה | Opens the delete confirm. Manual rows only. | never | no | confirm sheet | none | pass |
| Transaction | confirm מחיקה | Calls `delete_transaction`. | never | the confirm button | route `/` | toast "לא הצלחנו למחוק." | pass |
| Transaction | project row | Opens the change sheet. A shared cost opens Split instead. | never | no | the change sheet, or `/transactions/:id/split` | none | pass |
| Transaction | category row | Opens the change sheet. | never | no | the change sheet | none | pass |
| Transaction | חשבונית ותשלום | Expands the VAT line. | never | no | the VAT line is visible | none | pass |
| Transaction | פיצול בין פרויקטים | Opens Split. | never | no | route `/transactions/:id/split` | none | pass |
| Transaction change | שמירה / שמירה ואישור | `reassign_transaction`, or `set_transaction_category` when the row is shared. A closed row says שמירה. | missing project or category; the click toasts "בחרו פרויקט וקטגוריה." or "בחרו קטגוריה." | the button is busy | toast "השיוך נשמר", optional ביטול runs `undo_reassign` | toast "לא נשמר – אין חיבור" | pass |
| Split | ✕ | Closes to the transaction. | while saving | no | the transaction | none | pass |
| Split | שווה בין כל הפרויקטים | Selects an even split and enables שמירה. | never | no | the summary is the even sentence, שמירה enabled | none | pass |
| Split | שווה בין פרויקטים שאבחר | Opens the checklist. שמירה enables at two or more. | never | no | the checklist | none | pass |
| Split | a project checkbox | Ticks that project. The shekel share updates. | while saving | no | the tick and the share | none | pass |
| Split | לפי הכנסות | Selects the income split. | no income in the period. Reason "אין הכנסות בתקופה הזו". | no | summary "לפי הכנסות · N פרויקטים" | none | pass |
| Split | הצגת הפירוט / הסתרת הפירוט | Shows or hides the read-only shares. | while saving | no | the list toggles | none | pass |
| Split | חלוקה ידנית | Replaces the detail with percent fields. | while saving | no | one field per project | none | pass |
| Split | a percent field | Edits that share. A tap on the left edge, the centre, or the right edge focuses it, and 100 stays fully visible. The row focuses it too. | while saving | no | the remainder line updates | a field over 100% shows "עד 100%" | pass |
| Split | חזרה לאפשרויות | Restores the previous choice. | while saving | no | the three choices return | none | pass |
| Split | שמירה | Calls `save_split`. | no valid choice. Summary says why. | שומר… | toast "החלוקה נשמרה", back to the caller | toast "החלוקה לא נשמרה" with ניסיון חוזר | pass |
| Settings | חיבור SUMIT | Opens the connect sheet. Shown when SUMIT is not connected. | never | no | sheet title חיבור SUMIT | none | pass |
| Settings | חיבור | Calls the `sumit-connect` edge function. | never | the button is busy | toast "SUMIT מחובר. המפתח נשאר בשרת.", sheet closes | toast "החיבור נכשל. בדקו את המזהה ואת המפתח." or "לא הצלחנו להתחבר. נסו שוב." | pass |
| Settings | רענון עכשיו | Calls `sumit-sync`. | a bad key, or before `next_attempt_at`. The hint says why. Cursor not-allowed. | the row is busy | toast "הרענון הסתיים." | the Hebrew SUMIT error, or "הרענון נכשל." | pass |
| Settings | ניתוק | Opens the disconnect confirm. | never | no | confirm sheet | none | pass |
| Settings | confirm ניתוק | Calls `disconnect_sumit`. | never | the confirm button | toast "החיבור נותק. הספרים נשארו." | toast "לא הצלחנו לנתק." | pass |
| Settings | חיבור מחדש | Opens the connect sheet after a rejected key. | never | no | the connect sheet | none | pass |
| Settings | קטגוריות | Opens categories. | never | no | route `/settings/categories` | none | pass |
| Settings | פרויקטים | Opens the project list. | never | no | route `/projects` | none | pass |
| Settings | סיכום שבועי | Does not run. Notifications are not sent. | always. Hint "לא פעיל". | no | none | none | pass |
| Settings | תזכורת לפריטים ממתינים | Does not run. Notifications are not sent. | always. Hint "לא פעיל". | no | none | none | pass |
| Settings | אישור אוטומטי בביטחון גבוה | Does not run. There is no confidence score. | always. Hint "לא פעיל". | no | none | none | pass |
| Settings | רווח אחרי חלק בכלליות | Calls `set_after_overhead` for the company. | never | the switch waits for the write | the switch stays | toast "לא הצלחנו לשמור את התצוגה.", switch returns | pass |
| Settings | התנתקות | Signs out. | hidden in preview, because preview has no session | the row is busy | route `/sign-in` | toast "לא הצלחנו לצאת." | pass |
| Settings | התקנה למסך הבית | Opens the install screen. Hidden when the app is already installed. | never | no | route `/install` | none | pass |
| Categories | Back | Returns to settings. | never | no | route `/settings` | none | pass |
| Categories | הוצאות / הכנסות | Filters the list. | never | no | the matching names | none | pass |
| Categories | עוד on a row | Opens hide and merge. | never | no | the sheet | none | pass |
| Categories | הסתרה / החזרה לרשימה | Opens the confirm, then `set_category_hidden`. | never | the confirm button | the row moves | toast "לא הצלחנו לעדכן את הקטגוריה." | pass |
| Categories | מיזוג | Opens the target picker, then the confirm, then `merge_category`. | never | the confirm button | toast "הקטגוריות מוזגו" | toast "לא הצלחנו למזג." | pass |
| Categories | קטגוריה חדשה | Opens the name sheet. שמירה calls `create_category`. | never | שמירה is busy | toast "הקטגוריה נשמרה" | toast "לא הצלחנו ליצור את הקטגוריה." or "יש כבר קטגוריה בשם הזה." | pass |
| Categories | מוסתרות | Expands the hidden rows. | never | no | the hidden list | none | pass |
| Notifications | Back | Returns to settings. | never | no | route `/settings` | none | pass |
| Install | ✕ and לא עכשיו and הבנתי | Dismiss, back to settings. | never | no | route `/settings` | none | pass |
| Install | התקנה | Runs the browser install prompt. Android prompt only. | never | no | the browser sheet | none | pass |
| Install | העתקת קישור | Copies the page URL. Other-browser iPhone only. | never | no | toast "הקישור הועתק" | toast "לא הצלחנו להעתיק את הקישור." | pass |
