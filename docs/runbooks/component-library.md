# Component library

The shared controls are in `app/src/ui`. Screens import them. Decision [0057](../decisions/0057-component-library.md). Review is Storybook. Decision [0058](../decisions/0058-storybook.md).

## Storybook

```bash
pnpm storybook
pnpm build-storybook
pnpm test:storybook
```

`pnpm storybook` listens on port 6006. The toolbar switches בהיר and כהה. Both set `data-theme` on `<html>`. The default viewport is 390×844.

`pnpm build-storybook` writes `app/storybook-static`. That folder is gitignored. A checkpoint zips it to `storybook-static.zip` so a reviewer can open `index.html` locally without installing the repo.

Stories are dev-only. They are not imported by the app entry, and the Storybook packages are dev dependencies.

## What a screen may do

Compose components and call data hooks. If a control is missing, extend `app/src/ui` and add a stories file. Do not copy a button, row, sheet, or empty state into a screen.
