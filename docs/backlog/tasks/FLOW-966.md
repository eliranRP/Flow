<a id="flow-966"></a>
# FLOW-966 · Add v2: the UX/UI rules review of the + sheet
- **Type:** UI (design approved) · **Status:** in-progress (#827) · **Depends on:** — · **Source:** a review of the + sheet against a UX/UI rule set. The owner approved the design on 2026-10-26; on a card the same day: an offline save is kept on the device and sent when back online, and amount, payee, project and category are all required ("בלי פרויקט" counts as a choice). Design: [Design canvas](https://claude.ai/artifact/9grt9spjshVCxerYWrRXiD), page "Ready for dev", the Add row and its findings note.
- **Files:** `app/src/screens/add-sheet.tsx`, `app/src/screens/add-entry-sheet.tsx`, `app/src/screens/add-entry-view.tsx`, `app/src/screens/add-entry-new.tsx`, `app/src/ui/css/44-add-entry.css`, their stories and tests, `app/src/add-entry.ts`, `app/src/ui/chip.tsx`, a decision record (0217), a design log entry.

- [x] Save is never disabled: each missing field shows its own error (aria-invalid, aria-describedby).
- [x] Field, chip and dashed "+ חדש" edges reach 3:1; placeholders 4.5:1.
- [x] ~~Camera access refused: "אין גישה למצלמה" with בחירת קובץ.~~ Dropped by the owner (card, 2026-10-26): the phone's camera opens through a file input, which can't tell a refusal from a cancel; revisit with an in-app camera.
- [x] ~~A receipt that couldn't be read: צילום שוב / מילוי ידני.~~ Dropped by the owner (card, 2026-10-26): the app does not read receipts (FLOW-306); revisit if receipt reading is built.
- [x] Chips and segmented controls are 44px; single-choice chips are a radiogroup.
- [x] The date has היום / אתמול presets.
- [x] The save button names what it saves (שמירת ההוצאה, שמירת ההכנסה).
- [x] Offline, a save writes nothing, keeps the form open and says so. The device queue ("שמירה במכשיר") is its own task, [FLOW-967](FLOW-967.md) (owner card, 2026-10-26).
- [x] Toasts sit under the header; an undo stays 5s.
- [x] "צירוף צילום" opens the picker (camera, gallery or a PDF); the payee field is dir="auto"; type scale only.
- [x] The project and category radiogroups have one tab stop and arrow keys that move and check; the "+ … חדש" buttons sit after the group.
- **Acceptance:** stories of each state (missing, offline, income cheque); tests for the errors, the presets, the offline save and the toast place; decision record; design log entry.
