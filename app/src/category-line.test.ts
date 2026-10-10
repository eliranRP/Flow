// @vitest-environment node
import { projectCategorySchema } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { categoryRowsTotal } from "./category-line";

describe("category drill-down", () => {
  it("adds the page rows up to the category line", () => {
    const page = projectCategorySchema.parse({
      category_name: "הובלה",
      project_name: "אלפא",
      total_agorot: 7000,
      next_offset: null,
      rows: [
        { id: "a", description: "הובלה מאושרת", doc_date: "2026-09-02", amount_net: -3000 },
        { id: "b", description: "הובלה משותפת", doc_date: "2026-09-05", amount_net: -4000 },
      ],
    });
    expect(page).not.toBeNull();
    if (page == null) return;
    expect(categoryRowsTotal(page.rows)).toBe(page.total_agorot);
  });
});
