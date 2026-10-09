<a id="flow-809"></a>
# FLOW-809 · Public Storybook per PR head for reviewers
- **Type:** PLAN FIRST · **Status:** done (#313) except the owner's secrets; hosting approved by the owner 2026-10-09 · **Depends on:** —
- **What:** Reviewers can't download CI artifacts without a login. Publish the built Storybook (sample data only) per PR head, so design re-reviews cover only the changed stories.
- **Acceptance:** owner approves the hosting; no real data or hosted keys in the published build.
- [x] Workflow `storybook-preview.yml`: builds each same-repo PR head, checks the build for hosted keys and the Jev secret, deploys to Cloudflare Pages project `flow-storybook` as `pr-<n>`, and keeps one PR comment with the link and the changed stories. Storybook uses sample Supabase settings. (Dev lane 1, #313.)
- [ ] Owner: add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` to the GitHub environment `storybook-preview` (runbook ci-cd, "Storybook preview"). Until then the deploy is skipped.
