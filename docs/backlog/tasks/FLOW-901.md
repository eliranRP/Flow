<a id="flow-901"></a>
# FLOW-901 · Deny-list test coverage gaps
- **Type:** SMALL CYCLE · **Status:** done (#322) · **Depends on:** —
- **What:** The fixture deny-list test misses connector rule files, subfolders and non-`.ts` top-level files; entries over 6 words never match; n-grams should cover 4+ words and strip punctuation. Extend it to scan `docs/`, stories and e2e too.
- **Acceptance:** a planted invented name in each new path fails the test.
