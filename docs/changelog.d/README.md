# Changelog fragments

A PR does not edit [docs/changelog.md](../changelog.md). It adds one file here instead, so two PRs never conflict on the changelog.

- Name: `YYYY-MM-DD-<id>.md`, lowercase, for example `2026-10-07-flow-112.md`. The date is the day the PR is opened. Use the task id, or a short slug when there is none.
- Content: the entry itself, one or more paragraphs, in the same style as the changelog. No heading; the date heading comes from the name.
- `node scripts/changelog-fold.mjs --check` validates the fragments. `scripts/changelog-fold.test.mjs` runs it in `pnpm test:unit`.
- `node scripts/changelog-fold.mjs` moves every fragment into `docs/changelog.md` under its date and deletes it. The coordinator runs it in its own PR, after a batch deploys, when no other open PR adds a fragment it would miss.
