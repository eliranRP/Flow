<a id="flow-844"></a>
# FLOW-844 · The root package.json drops the Vite 7 peer rule
- **Type:** SMALL CYCLE (infra) · **Status:** in-progress (#948) · **Source:** the daily security scan, 2026-11-03: after the move to Vite 8 (#938), `pnpm.peerDependencyRules.allowedVersions` still allows `vite` 7.
- **Files:** `package.json` (the `pnpm.peerDependencyRules` block), a changelog fragment.

- [x] Remove the `peerDependencyRules` block. Its only entry let a package whose `vite` peer range left out the installed version pass without a warning. Every package in the lockfile that declares a `vite` peer now accepts Vite 8, so the rule matches nothing, and it still names Vite 7.
- [x] `pnpm install --frozen-lockfile` passes and prints no peer warning.

**Acceptance:** `package.json` has no `peerDependencyRules`, the lockfile is unchanged, and an install shows no unmet `vite` peer.
