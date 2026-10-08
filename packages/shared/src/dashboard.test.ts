import { describe, expect, it } from "vitest";
import { categoryRowSchema, dashboardSchema, projectDetailSchema, reviewRowSchema } from "./dashboard";

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

  it("parses excluded_categories_by_currency when present", () => {
    const parsed = projectDetailSchema.parse({
      ...project,
      categories: [],
      excluded_categories_by_currency: [{
        currency: "USD",
        id: "c",
        name: "Loan principal",
        amount_minor: 1000,
      }],
    });
    expect(parsed?.excluded_categories_by_currency?.[0]?.amount_minor).toBe(1000n);
  });

  it("parses the project's loans with a bigint balance, and a payload without them", () => {
    const parsed = projectDetailSchema.parse({
      ...project,
      categories: [],
      loans: [{ id: "l", name: "הלוואת דוגמה", currency: "USD", balance_minor: "12345" }],
    });
    expect(parsed?.loans?.[0]?.balance_minor).toBe(12345n);
    expect(projectDetailSchema.parse({ ...project, categories: [] })?.loans).toBeUndefined();
  });
});

describe("categoryRowSchema", () => {
  it("accepts excluded_from_pnl when present", () => {
    const row = categoryRowSchema.parse({
      id: "c",
      name: "Materials",
      kind: "expense",
      hidden: false,
      is_default: false,
      excluded_from_pnl: true,
    });
    expect(row.excluded_from_pnl).toBe(true);
  });

  it("parses rows from before the flag existed", () => {
    const row = categoryRowSchema.parse({
      id: "c",
      name: "Materials",
      kind: "expense",
      hidden: false,
      is_default: false,
    });
    expect(row.excluded_from_pnl).toBeUndefined();
  });
});

describe("dashboardSchema", () => {
  it("accepts optional excluded totals on the company payload", () => {
    const parsed = dashboardSchema.parse({
      company_id: "co",
      name: "Example Holdings LLC",
      vat_registered: true,
      basis: "cash",
      from: null,
      to: null,
      income_agorot: 0,
      direct_agorot: 0,
      shared_agorot: 0,
      overhead_agorot: 0,
      expense_agorot: 0,
      net_profit_agorot: 0,
      prev_income_agorot: null,
      prev_expense_agorot: null,
      prev_net_agorot: null,
      active_projects: 0,
      review_count: 0,
      projects: [],
      excluded_income_agorot: 100,
      excluded_expense_agorot: 50,
      by_currency: [{
        currency: "ILS",
        income_minor: 0,
        direct_minor: 0,
        shared_minor: 0,
        overhead_minor: 0,
        expense_minor: 0,
        net_profit_minor: 0,
        excluded_income_minor: 100,
        excluded_expense_minor: 50,
        excluded_count: 2,
        count: 0,
      }],
    });
    expect(parsed.excluded_income_agorot).toBe(100n);
  });
});

describe("reviewRowSchema (FLOW-305)", () => {
  const row = {
    id: "r",
    transaction_id: "t",
    description: "חשמל השרון",
    doc_date: "2026-10-05",
    amount_net: -120050,
    direction: "expense",
    reason: "missing_project",
    project_id: null,
    category_id: null,
    supplier_name: null,
  };

  it("keeps line_status and source", () => {
    const parsed = reviewRowSchema.parse({ ...row, line_status: "pending", source: "mercury" });
    expect(parsed.line_status).toBe("pending");
    expect(parsed.source).toBe("mercury");
  });

  it("parses an older payload without the fields", () => {
    const parsed = reviewRowSchema.parse(row);
    expect(parsed.line_status).toBeUndefined();
    expect(parsed.source).toBeUndefined();
  });

  it("drops an unknown value instead of failing the whole list", () => {
    const parsed = reviewRowSchema.parse({ ...row, line_status: "held", source: "hapoalim" });
    expect(parsed.line_status).toBeUndefined();
    expect(parsed.source).toBeUndefined();
  });
});
