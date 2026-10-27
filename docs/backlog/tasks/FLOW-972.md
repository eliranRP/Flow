<a id="flow-972"></a>
# FLOW-972 · Settings v2: the UX/UI rules review of הגדרות
- **Type:** UI (design approved) · **Status:** in-progress (#832) · **Depends on:** — · **Source:** a review of Settings (home, business, categories, notifications, team) against a UX/UI rule set. The owner approved the design on 2026-10-26; owner call: "+ עסק חדש" opens the first-use setup for a new business. Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", the Settings row and its findings note "SETTINGS v2". The connection pages (Mercury, SUMIT, AI) are the Connections v2 task.
- **Files:** `app/src/screens/settings-screen.tsx`, `app/src/screens/business-screen.tsx`, `app/src/screens/rename-company.tsx`, `app/src/screens/categories-screen.tsx`, `app/src/screens/category-sheet.tsx`, `app/src/screens/category-manage.ts`, `app/src/screens/notifications-screen.tsx`, `app/src/screens/team-screen.tsx`, `app/src/screens/team-sheets.tsx`, `app/src/screens/theme-sheet.tsx`, `app/src/screens/company-sheet.tsx`, `app/src/ui/top-toast.ts` (new), `app/src/ui/css/02-fields-sheets.css` (the field edge), the settings pages' CSS, their stories and tests, decision 0222, a design log entry.

- [x] Field edges and the dashed "+ עסק חדש" reach 3:1.
- [x] "+ עסק חדש" opens the first-use setup for a new business (it already did on main).
- [x] "יצירת הקטגוריה" is always enabled; the note under the field says what is wrong.
- [x] Saves say what they save: "שמירת השם", "יצירת הקטגוריה".
- [x] Offline, the pages say "אין חיבור · שינויים יישמרו כשהחיבור יחזור".
- [x] Toasts sit under the header, ביטול 5s and a note 4s.
- [x] Show/hide and small links are 44px.
- [x] Type scale only.
- **Acceptance:** stories of the offline state and the new-category note; tests for the toasts' place and times, the offline line and the category note; decision record; design log entry.
