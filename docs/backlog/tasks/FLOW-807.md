<a id="flow-807"></a>
# FLOW-807 · Split the big screens file
- **Type:** SMALL CYCLE · **Status:** done (#219, #225, #227, #229, #232, #235, then the `flow-mcp/tools.ts` split, then the test files #251, #256, #257, #263, #268, #276, #277, #281: no code file is over 800 lines and no test file over 1,200; `scripts/check-file-size.mjs` keeps it that way) · **Depends on:** — (best between feature PRs, it conflicts with everything)
- **What:** `app/src/screens/flow-screens.tsx` holds most screens in one file, so builders read too much and PRs conflict. Move each screen to its own file with no behaviour change.
- **Acceptance:** no snapshot or test changes besides imports; bundle size unchanged within noise.
