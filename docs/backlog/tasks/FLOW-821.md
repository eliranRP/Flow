<a id="flow-821"></a>
# FLOW-821 · Faster local CI and main CI: build once, reuse it
- **Type:** SMALL CYCLE · **Status:** claimed (temporary lane, owner request, 2026-10-11, claude/compassionate-goldberg-ubfcqg) · **Depends on:** — · **Source:** owner, 2026-10-11: the pre-push gate is the slowest part, since every PR push runs it.
- [ ] Measure the default gate phase by phase on a typical push and cut the biggest phase.
- [ ] Main's `ci`: build Storybook once and share it with the seven story shards, instead of seven builds.
