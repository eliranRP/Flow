<a id="flow-823"></a>
# FLOW-823 · Shared package: drop exports nothing uses
- **Type:** SMALL CYCLE · **Status:** claimed (temporary lane, owner request, 2026-10-11, claude/compassionate-goldberg-ubfcqg) · **Depends on:** FLOW-819 · **Source:** owner, 2026-10-11.
- [ ] 21 exports of `packages/shared/src` are used by no app, edge function or script; delete them. 44 more are used only inside their own file; drop the `export` so the package's surface is what its callers use.
