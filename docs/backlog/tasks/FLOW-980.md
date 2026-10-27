<a id="flow-980"></a>
# FLOW-980 · Faint grey text reads at 4.5:1 on every fill
- **Type:** SMALL UI · **Status:** in-progress · **Depends on:** — · **Source:** the coordinator's queue on 2026-10-27, from FLOW-976 (decision 0224): `--color-text-muted` on `--color-raised` is 4.31:1 in light, under the 4.5:1 body-text floor.
- **Files:** `design/system/implementation-tokens.css`, the raised-input placeholders (`44-add-entry`, `19-search-screen`, `50-forecast-edit`, `56-journal-composer`, wherever FLOW-974 put them), `app/src/light-tokens.test.ts`.

- [ ] `--color-text-muted` is at least 4.5:1 on `--color-raised`, `--color-surface` and `--color-bg` in both themes, and still lighter than `--color-text-secondary`.
- [ ] The placeholders on a raised input use `--color-placeholder`.
- [ ] `light-tokens.test.ts` checks muted on raised.
- **Acceptance:** the token test passes; story shots change only in the muted text's shade.
