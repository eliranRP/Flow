<a id="flow-818"></a>
# FLOW-818 · vitest 4 bump (dependabot #566, #567)
- **Type:** SMALL CYCLE · **Status:** done (#569) · **Depends on:** — · **Source:** lane manager, 2026-10-10: dependabot opened #567 (app) and #566 (packages/shared), both vitest 3.2.7 → 4.1.11.
- [x] (bug lane, 2026-10-10, #569) One PR takes both bumps (and `@vitest/browser` with them), runs the full unit and story tests, and fixes what vitest 4 breaks without skipping or disabling a test; #566 and #567 close pointing at it. vitest 4 needed one config change: `browser.provider` takes `playwright()` from `@vitest/browser-playwright`. 2,035 unit, 166 shared and 1,645 story tests pass unchanged; `@storybook/experimental-addon-test` 8.6 lists vitest ≤3 as its peer, a warning only.
