/**
 * Starter category sets, decision 0164 (FLOW-406 server 3). The rows live in SQL
 * (private.starter_categories); this list mirrors only the keys and the labels the setup
 * screen shows. starter-categories.test.ts checks the keys against the migration.
 */
export const STARTER_SETS = [
  { key: "rentals", label: "השכרת נכסים" },
  { key: "renovation", label: "שיפוצים ופליפים" },
  { key: "general", label: "כללי" },
] as const;

export type StarterSetKey = (typeof STARTER_SETS)[number]["key"];
