# Storybook replaces the component gallery route

**Date:** 2026-09-28
**Status:** Accepted

## Context

[0057](0057-component-library.md) put every shared control in `app/src/ui` and rendered them on `/dev/components` so a reviewer could compare light, dark, and the variants. That route is part of the app. It ships in the same bundle as Home, and it is a second place to keep in sync with the components. Eliran left the review surface open. This record chooses it.

Numbers 0051 through 0056 stay on the remainder branch and are not reused.

## Decision

Review is Storybook 8 with the Vite builder (`@storybook/react-vite`). The packages are dev dependencies of `@flow/app`. Nothing in the app entry imports a story, so Storybook does not ship in the production bundle. There is no `/dev/components` route.

Global decorators set `lang="he"` and `dir="rtl"` on the document, load Rubik and the token CSS through `app/src/styles/app.css`, and wrap stories in the app frame. A toolbar switches `data-theme` between בהיר and כהה. The default viewport is 390×844.

Each shared component has one `*.stories.tsx` next to it, covering the states that component can show: default, disabled, loading, error, empty, long Hebrew, and large amounts. Composed screen stories (Home, sign-in, help, projects, review) are built only from library components and mock data. They do not mount the live screens.

The a11y addon runs in CI through `@storybook/experimental-addon-test` (the Storybook 8 Vitest addon) as `pnpm test:storybook`. A violation fails the job. `heading-order` and `page-has-heading-one` are off because a story is a fragment, not a document. The disabled Google button turns the check off on that one story: the brand treatment is 38% opacity. The calendar grid uses explicit rows so the open date picker can pass.

`pnpm storybook` and `pnpm build-storybook` are the scripts. Each checkpoint includes `storybook-static.zip` for a reviewer who opens the static build locally.

## Alternatives rejected

Keeping `/dev/components` beside Storybook. Two galleries drift.

Leaving the gallery as an app route and skipping Storybook. The route is in the bundle the owner installs.

Storybook 9. The app is Vite 7, and this record pins the 8.6 Vite builder. A later major is a separate decision.

## Consequences

[0057](0057-component-library.md) still decides the library: one inventory, typed props, light and dark, RTL, 44px targets, and screens composed from it. Only the review surface changes. A new control gets a stories file in the same change. The books screens that still contain local controls move onto the library next, before any new screen.
