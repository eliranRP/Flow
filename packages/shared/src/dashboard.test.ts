import { describe, expect, expectTypeOf, it } from "vitest";
import {
  categoryRowSchema,
  dashboardSchema,
  mercuryStatusSchema,
  type MercuryStatus,
  projectDetailSchema,
  projectGroupDetailSchema,
  reviewRowSchema,
} from "./dashboard";
import type { Database } from "./database.types.ts";

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

  it("keeps a transaction's line_status, and drops a missing or unknown one", () => {
    const line = { id: "t", description: "דוגמה", doc_date: "2026-06-10", amount_net: -100, direction: "expense", category: null };
    const parsed = projectDetailSchema.parse({
      ...project,
      categories: [],
      transactions: [{ ...line, line_status: "pending" }, line, { ...line, line_status: "held" }],
    });
    expect(parsed?.transactions.map((t) => t.line_status)).toEqual(["pending", undefined, undefined]);
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

describe("reviewRowSchema receipts (FLOW-309)", () => {
  const row = {
    id: "r",
    transaction_id: "t",
    description: "לקוח לדוגמה",
    doc_date: "2026-10-05",
    amount_net: 1200000,
    direction: "income",
    reason: "missing_project",
    project_id: null,
    category_id: null,
    supplier_name: null,
  };

  it("reads the paired receipts with bigint agorot", () => {
    const parsed = reviewRowSchema.parse({
      ...row,
      receipts: [{ transaction_id: "rc", doc_date: "2026-10-12", amount_gross: "1416000", currency: "ILS" }],
      paid: true,
      paid_on: "2026-10-12",
    });
    expect(parsed.receipts?.[0]?.amount_gross).toBe(1416000n);
    expect(parsed.paid).toBe(true);
    // list_review's jsonb sends bigint agorot as a JSON number.
    const fromSql = reviewRowSchema.parse({ ...row, receipts: [{ transaction_id: "rc", doc_date: "2026-10-12", amount_gross: 1416000, currency: "ILS" }] });
    expect(fromSql.receipts?.[0]?.amount_gross).toBe(1416000n);
    expect(parsed.paid_on).toBe("2026-10-12");
  });

  it("parses a payload from before the pairing server", () => {
    const parsed = reviewRowSchema.parse(row);
    expect(parsed.receipts).toBeUndefined();
    expect(parsed.paid).toBeUndefined();
    expect(parsed.paid_on).toBeUndefined();
  });

  it("drops a malformed receipt list instead of failing the whole queue", () => {
    const parsed = reviewRowSchema.parse({ ...row, receipts: [{ doc_date: 5 }], paid: "yes", paid_on: null });
    expect(parsed.receipts).toBeUndefined();
    expect(parsed.paid).toBeUndefined();
    expect(parsed.paid_on).toBeNull();
  });
});

describe("project groups (FLOW-406)", () => {
  const row = { ...project, profit_before_shared_agorot: 0, group_id: "g" };
  const group = {
    id: "g",
    name: "צפון",
    sort_order: 1,
    project_count: 1,
    income_agorot: 100,
    direct_agorot: 40,
    shared_agorot: 0,
    profit_before_shared_agorot: 60,
    profit_agorot: "60",
    by_currency: [{ currency: "ILS", income_minor: 100, direct_minor: 40, shared_minor: 0, profit_minor: 60 }],
  };
  const dashboard = {
    company_id: "c",
    name: "דוגמה",
    vat_registered: true,
    basis: "cash",
    from: null,
    to: null,
    income_agorot: 100,
    direct_agorot: 40,
    shared_agorot: 0,
    overhead_agorot: 0,
    expense_agorot: 40,
    net_profit_agorot: 60,
    prev_income_agorot: null,
    prev_expense_agorot: null,
    prev_net_agorot: null,
    active_projects: 1,
    review_count: 0,
  };

  it("reads groups[] with bigint agorot and each project's group_id", () => {
    const parsed = dashboardSchema.parse({ ...dashboard, projects: [row], groups: [group] });
    expect(parsed.groups?.[0]?.profit_agorot).toBe(60n);
    expect(parsed.groups?.[0]?.by_currency[0]?.profit_minor).toBe(60n);
    expect(parsed.projects[0]?.group_id).toBe("g");
  });

  it("parses a payload from before groups", () => {
    const parsed = dashboardSchema.parse({ ...dashboard, projects: [{ ...row, group_id: undefined }] });
    expect(parsed.groups).toBeUndefined();
    expect(parsed.projects[0]?.group_id).toBeUndefined();
  });

  it("reads one group with its projects", () => {
    const parsed = projectGroupDetailSchema.parse({ ...group, basis: "cash", from: null, to: null, projects: [row] });
    expect(parsed.projects[0]?.id).toBe("p");
    expect(parsed.income_agorot).toBe(100n);
  });
});

// FLOW-508: the Mercury status schema is written by hand; it must keep the view's columns.
type ConnectorStatusRow = Database["public"]["Views"]["connector_connection_status"]["Row"];

describe("mercuryStatusSchema", () => {
  it("has exactly the columns of connector_connection_status", () => {
    expectTypeOf<keyof MercuryStatus>().toEqualTypeOf<keyof ConnectorStatusRow>();
    const row: Record<keyof ConnectorStatusRow, null> = {
      account_labels: null,
      company_id: null,
      connected: null,
      import_from: null,
      last_error: null,
      last_sync_at: null,
      next_attempt_at: null,
      provider: null,
      skip_count: null,
      syncing: null,
    };
    expect(Object.keys(mercuryStatusSchema.shape).sort()).toEqual(Object.keys(row).sort());
  });
});
