# Plan

## Assistant code field

Owner decision, Eliran, 2026-10-03. This supersedes the design nit that showed the Claude command as a labelled row, and it includes the copy control that sits inside the field.

The help sheet shows the `--scope user` command in one read-only field, full width, on the input surface. The text is monospace and LTR inside the RTL sheet, on one line that scrolls horizontally, with no mid-word wrapping. The field is selectable. Its accessible name is "פקודת חיבור ל־Claude Code". There is no separate "Claude Code" label.

The copy control is an icon button inside the field, at the inline end, at least 44px, named "העתקה". A successful copy shows the toast "הועתק". If the clipboard is refused, the field is selected and "העתיקו ידנית" is announced in that sheet.

כתובת and קוד on step 2 use the same field. Those two keep their visible labels.

Recorded in [0082](decisions/0082-settings-redesign.md).
