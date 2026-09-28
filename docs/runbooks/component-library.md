# Component library

The shared controls are in `app/src/ui`. Screens import them. Decision [0057](../decisions/0057-component-library.md).

## Gallery

```bash
pnpm dev
```

Open [http://127.0.0.1:43123/dev/components](http://127.0.0.1:43123/dev/components). The page is not in the tab bar.

בהיר forces light. כהה forces dark. Both set `data-theme` on `<html>`.

Capture at 390×844. The page is long, so a full-page shot is the review image.

## What a screen may do

Compose components and call data hooks. If a control is missing, extend `app/src/ui` and add a specimen on the gallery. Do not copy a button, row, sheet, or empty state into a screen.
