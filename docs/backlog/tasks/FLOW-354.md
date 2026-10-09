<a id="flow-354"></a>
# FLOW-354 · The default income category in the money terms word
- **Type:** PLAN FIRST · **Status:** owner approved the rename on the money terms glossary (2026-10-09 13:44Z); built in #385, renamed categories untouched · **Source:** cycle 12 (§3.6 check)
- **What:** The default income category is still "תקבול מלקוח", while §3.6 says "הכנסה מלקוחות" (packages/shared/src/categories.ts:16, setup/copy.ts:33, demo/model.ts:186 and the first seed). New companies get the new word either way. The owner decides whether existing companies' category is renamed by a migration, or keeps the name they have.
- **Acceptance:** owner's pick on a card.
