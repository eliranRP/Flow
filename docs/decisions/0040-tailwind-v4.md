# Styling uses Tailwind CSS v4

**Date:** 2026-09-26
**Status:** Accepted

## Context

[0038](0038-stack.md) said the front end uses plain CSS on the design tokens. Several people, including AI agents, will build screens. A shared utility layer keeps those screens on the same tokens.

## Decision

Styling uses Tailwind CSS v4. This replaces the plain-CSS line in 0038. The rest of 0038 stands.

The design tokens are the single source of truth: [implementation-tokens.css](../../design/system/implementation-tokens.css) and the [design system](../../design/system/design-system.md). They are mapped into Tailwind's `@theme`: colours, including light and dark, spacing, radii, the type scale, and shadows.

Screen code uses only those token-based values. An arbitrary value needs a justification.

RTL uses logical utilities (`ms-` / `me-` / `ps-` / `pe-`, `start` / `end`) and `dir="rtl"` at the root. Dark mode uses the same token set.

There is no ready-made component kit with its own look. Vaul stays for sheets.

## Alternatives rejected

Plain CSS for screen styles, the line in 0038. A component kit that brings its own visual style.

## Consequences

Screens stay on the approved tokens. Styles sit with the component. Only the classes that are used are shipped. The mapping is set up in [tech-plan.md](../tech/tech-plan.md) task P0-5, with a lint rule against arbitrary values.
