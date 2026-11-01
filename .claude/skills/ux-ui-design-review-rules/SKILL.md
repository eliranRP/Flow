---
name: ux-ui-design-review-rules
description: Use this when reviewing or improving an existing app screen, flow or design against practical UX/UI rules (hierarchy, onboarding, forms, tables on mobile, permissions, charts, motion).
---

# UX/UI design review rules

Rules distilled from Design Motion's public pattern breakdowns (https://designmotionhq.com/patterns). Sources: designmotionhq.com/patterns pages and Design Motion Facebook reels (captions, transcripts, on-screen text). Labels: "reel demo" = illustrative example from a reel; "(standard, not from Design Motion)" = industry standard such as WCAG.

**Open `rules/00-cheatsheet.md` first**: key numbers (value, rule, file §) and the top 15 checks. Then open the full rule file for anything you flag.

## Rule format
Each rule is `### n. Title` with these fields (some omit fields that don't apply):
- **Rule**: what to do.
- **Why**: the reason / user effect.
- **Numbers**: concrete values and thresholds.
- **Schema**: ASCII/mermaid diagram of layout, states or timing.
- **Good vs Bad**: concrete examples.
- **How to check**: a testable inspection step.
- **Source**: pattern page and reel URLs.

Rules titled "(merged)" are one-line cross-references to the canonical rule in another file.

## Inputs
- The screen(s) or flow: live URL, screenshots, Figma, or code.
- Who it's for and the main task of each screen (if unknown, infer and state the assumption).
- Target viewports: always check desktop and ~375px mobile.

## How to run a review
1. For each screen, state its purpose and its single primary action.
2. Pass through the rule files in this order: hierarchy-and-actions → tables-and-responsive → forms-and-requests → onboarding-and-empty-states → feedback-and-states → data-viz → motion → visual-system-and-accessibility. Skip files that don't apply.
3. Exercise states, not just the happy path: empty, loading, error, offline, long data, keyboard-only, touch.
4. Record only real findings with evidence (what you saw, where).

## Output format
One row per finding, sorted by severity:

| # | Screen / element | Finding | Rule (file § n) | Severity | Concrete fix |

Severity: **High** = blocks a task, loses data, misleads, or fails accessibility; **Medium** = slows or confuses; **Low** = polish.
A fix must be specific (values, copy, component), e.g. "Right-align Amount column, font-variant-numeric: tabular-nums".
End with the top 3 fixes to do first.

## Rule index (142 rules)
- `rules/00-cheatsheet.md`: key numbers + top 15 checks — open first
- `rules/hierarchy-and-actions.md`: Hierarchy, emphasis, containers, navigation, actions (14 rules)
- `rules/onboarding-and-empty-states.md`: Onboarding, empty states, success and progress (14 rules)
- `rules/forms-and-requests.md`: Forms, inputs, permissions, checkout, settings (21 rules)
- `rules/tables-and-responsive.md`: Tables, lists, mobile and responsive (27 rules)
- `rules/data-viz.md`: Charts and data visualisation (15 rules)
- `rules/feedback-and-states.md`: Feedback, loading, errors, notifications, undo, autosave (20 rules)
- `rules/motion.md`: Motion, gestures and animation (14 rules)
- `rules/visual-system-and-accessibility.md`: Tokens, type, colour, accessibility, CSS state (17 rules)
