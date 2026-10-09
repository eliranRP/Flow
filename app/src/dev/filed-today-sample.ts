import type { FiledTodayRow } from "@flow/shared";

/**
 * Dev-only rows so the review banner can open a list that has a transaction. FLOW-309: the dev banner
 * counts these rows, so its number matches the list it opens, as live (both read `filed_today_rows`).
 * Kept out of the lazily loaded screen module, whose exports a production build keeps (#360).
 */
export const DEV_FILED_ROWS: readonly FiledTodayRow[] = [{
  id: "t-filed",
  description: "מלט",
  doc_date: "2026-09-29",
  amount_net: -350_000n,
  direction: "expense",
  supplier_name: "מנופים לדוגמה בע״מ",
  project_name: "שיפוץ הרצל 12",
  category_name: "חומרים",
}];
