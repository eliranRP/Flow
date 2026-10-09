# Notes for AI agents

Start with [docs/backlog/README.md](docs/backlog/README.md). It explains how the agent team works on this repo: the lanes and how many run at once, batching by area, the build cycle, reviews, merging, and how to claim a task so two agents never change the same files.

Before you start any task:

1. Read the open PRs and the `Claim` block in each body, and the "Lanes now" table at the top of [docs/backlog/TASKS.md](docs/backlog/TASKS.md). TASKS.md is generated: each task is its own file in `docs/backlog/tasks/`, and you edit only your own task files, then run `node scripts/backlog-index.mjs`.
2. Take a `ready` task (or a batch of related ones) that no open PR names and whose files no open PR changes.
3. Open a draft PR with a `Claim` block right away, and keep its `Progress` line current until the merge.

Then read [CONTRIBUTING.md](CONTRIBUTING.md). Everything here is public: never commit real data, secrets, or session ids.
