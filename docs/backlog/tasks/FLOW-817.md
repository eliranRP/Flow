<a id="flow-817"></a>
# FLOW-817 · Docs-only merges don't count toward the deploy batch
- **Type:** SMALL CYCLE · **Status:** claimed (dev lane 4, 2026-10-10, claude/flow-601-team-invites-dbh8bx) · **Depends on:** — · **Source:** lane manager, 2026-10-10: #548 was a docs-only backlog merge and still counted toward the batch of 5.
- [ ] `scripts/ci-deploy-plan.sh` counts only the merges since the last good deploy that change something outside `docs/`. A manual run and the deploy-status lookup are unchanged. On main's history, a4952f4..dd76b5b counts 4 instead of 5, because #548 changed only docs.
