import { describe, expect, it } from "vitest";
import { reviewPageSchema } from "./review-page.ts";

const item = {
  id: "r1",
  transaction_id: "t1",
  description: "מלט",
  doc_date: "2026-09-01",
  amount_net: -10000,
  direction: "expense",
  reason: null,
  project_id: null,
  category_id: null,
  supplier_name: null,
};

describe("reviewPageSchema (FLOW-984)", () => {
  it("parses a page with its total and the cursor of the next one", () => {
    const next = { doc_date: "2026-09-01", created_at: "2026-09-02T08:00:00.123456+00:00", id: "r1" };
    const page = reviewPageSchema.parse({ items: [item], total: 1287, next });
    expect(page.items[0]?.amount_net).toBe(-10000n);
    expect(page.total).toBe(1287);
    expect(page.next).toEqual(next);
  });

  it("the last page has a null cursor", () => {
    expect(reviewPageSchema.parse({ items: [], total: 0, next: null }).next).toBeNull();
  });

  it("refuses an old bare array and a page without its total", () => {
    expect(reviewPageSchema.safeParse([item]).success).toBe(false);
    expect(reviewPageSchema.safeParse({ items: [item], next: null }).success).toBe(false);
  });
});
