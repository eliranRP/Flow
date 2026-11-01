<a id="flow-842"></a>
# FLOW-842 · A UX rules review of the UI changes every 3 days
- **Type:** SMALL CYCLE (docs) · **Status:** done (#926) · **Source:** the owner, 2026-11-01: a routine every 3 days that reviews the changes since its last run against a set of UX/UI rules; the first run now, over the last 3 days.
- **Files:** `.claude/skills/ux-ui-design-review-rules/` (new: SKILL.md and the rule files), `docs/runbooks/ux-rules-review.md` (new), `docs/backlog/README.md` (the review cycle row, where to find things), a changelog fragment.

- [x] The rules as a project skill, so any lane and the reviewers can load them.
- [x] The runbook: scope since the last run, the review, findings as tasks, the report.
- [x] A scheduled task every 3 days that fires into one review session. It lives outside the repo.

- **Production (2026-11-01):** the scheduled task is live (every 3 days, 10:43 Israel time); the first run covered 5acf0b5..feb53ad and filed FLOW-1012 to FLOW-1017 and FLOW-455 to FLOW-459 (#927).

**Acceptance:** the first run reviews the 3 days before 2026-11-01, files its findings as tasks, and reports.
