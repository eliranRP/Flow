import { describe, expect, it } from "vitest";
import { projectDetailSchema } from "./dashboard";

const project = {
  id: "p",
  name: "בית הספר אלון",
  status: "active",
  state_label: null,
  budget_agorot: null,
  income_agorot: 0,
  direct_agorot: 0,
  shared_agorot: 0,
  profit_agorot: 0,
  transactions: [],
};

describe("projectDetailSchema", () => {
  it("keeps has_shared_share when a line includes a share", () => {
    const parsed = projectDetailSchema.parse({
      ...project,
      categories: [{ id: "c", name: "מלט", amount_agorot: 100, has_shared_share: true }],
    });
    expect(parsed?.categories[0]?.has_shared_share).toBe(true);
  });

  it("parses a category line from before the flag existed", () => {
    const parsed = projectDetailSchema.parse({
      ...project,
      categories: [{ id: "c", name: "מלט", amount_agorot: 100 }],
    });
    expect(parsed?.categories[0]?.has_shared_share).toBeUndefined();
  });
});
