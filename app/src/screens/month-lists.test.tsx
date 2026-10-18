import type { ReviewRow } from "@flow/shared";
import { screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ProjectCategoryScreen, ReviewAllList } from "./flow-screens";
import { renderWithProviders } from "../test-render";

/** FLOW-302 wiring: each list hands MonthList the amount, currency, and completeness its rows show. */

function wrap(node: ReactNode) {
  return renderWithProviders(node);
}

function totalsOf(month: string): string | null {
  const group = screen.getByRole("group", { name: month });
  return group.querySelector(".ui-month-totals")?.textContent ?? null;
}

describe("review list rows (FLOW-365 flat list)", () => {
  const review = (id: string, doc_date: string, amount_net: bigint, direction: "income" | "expense", currency?: string): ReviewRow => ({
    id,
    transaction_id: `t-${id}`,
    description: `Review ${id}`,
    doc_date,
    amount_net,
    ...(currency == null ? {} : { currency }),
    direction,
    reason: null,
    project_id: null,
    category_id: null,
    supplier_name: null,
  });
  const amountsOf = (container: HTMLElement) => [...container.querySelectorAll(".ui-review-all-amount")].map((node) => node.textContent);

  it("lists every row in order with no month groups, and counts them in the subtitle", () => {
    const { container } = wrap(<ReviewAllList
      rows={[
        review("a", "2026-08-03", 10_000n, "income", "USD"),
        review("b", "2026-08-04", -25_000n, "expense"),
        review("c", "2026-09-01", -5_000n, "expense"),
      ]}
      search=""
      backTo="/review"
    />);
    expect(screen.queryAllByRole("group")).toHaveLength(0);
    expect(container.querySelectorAll(".ui-review-all-row")).toHaveLength(3);
    expect(screen.getByText("3 פריטים מחכים · הקישו על פריט כדי לפתוח אותו")).toBeTruthy();
    expect(amountsOf(container)).toEqual(["+$100", "₪250", "₪50"]);
  });

  it("shows exact cents on each row", () => {
    const { container } = wrap(<ReviewAllList
      rows={[
        review("a", "2026-08-03", -10_050n, "expense"),
        review("b", "2026-08-04", -10_050n, "expense"),
      ]}
      search=""
      backTo="/review"
    />);
    expect(amountsOf(container)).toEqual(["₪100.50", "₪100.50"]);
  });
});

describe("review list row details (FLOW-305, flat list)", () => {
  const base: ReviewRow = {
    id: "s1",
    transaction_id: "t-s1",
    description: "Northwind Traders",
    doc_date: "2026-09-29",
    amount_net: -120_050n,
    currency: "USD",
    direction: "expense",
    reason: null,
    project_id: "p1",
    category_id: "c1",
    project_name: "וילה לדוגמה",
    category_name: "חומרים",
    supplier_name: null,
    line_status: "pending",
    source: "mercury",
  };

  it("shows the payee, the date and source, and the amount in its currency", () => {
    const { container } = wrap(<ReviewAllList rows={[base]} search="" backTo="/review" />);
    const row = container.querySelector(".ui-review-all-row");
    expect(row?.querySelector(".ui-review-all-title")?.textContent).toBe("Northwind Traders");
    expect(row?.querySelector(".ui-review-all-meta")?.textContent).toBe("29/09/2026 · בנק");
    expect(row?.querySelector(".ui-review-all-amount")?.textContent).toBe("$1,200.50");
    expect(row?.querySelector(".ui-review-all-amount")?.getAttribute("dir")).toBe("ltr");
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it("flags a row without a project and labels an invoice row with its document source", () => {
    const { container } = wrap(<ReviewAllList
      rows={[{ ...base, description: "לקוח לדוגמה", amount_net: 500_000n, currency: "ILS", direction: "income", line_status: "posted", source: "sumit", doc_kind: "invoice", project_id: null, project_name: null, category_id: null, category_name: null }]}
      search=""
      backTo="/review"
    />);
    const row = container.querySelector(".ui-review-all-row");
    expect(row?.querySelector(".ui-review-all-meta")?.textContent).toBe("29/09/2026 · חשבונית · חסר פרויקט");
    expect(row?.querySelector(".ui-review-all-amount")?.textContent).toBe("+₪5,000");
    expect(row?.querySelector(".ui-review-all-amount")?.classList.contains("ui-review-all-in")).toBe(true);
  });
});

describe("category drill-down months", () => {
  const sample = {
    categoryName: "חומרים",
    projectName: "Sample project",
    pageSize: 2,
    rows: [
      { id: "t1", description: "Line 1", doc_date: "2026-09-14", amount_net: -100_000n },
      { id: "t2", description: "Line 2", doc_date: "2026-08-20", amount_net: -200_000n },
      { id: "t3", description: "Line 3", doc_date: "2026-08-02", amount_net: -300_000n },
    ],
  };

  it("hides the last month's total while עוד תנועות can still load rows", () => {
    wrap(<ProjectCategoryScreen sample={sample} backTo="/projects/a" />);
    expect(totalsOf("ספטמבר 2026")).toBe("הוצאות ₪1,000");
    expect(totalsOf("אוגוסט 2026")).toBeNull();
  });

  it("shows a USD drill-down in dollars", () => {
    wrap(<ProjectCategoryScreen sample={{ ...sample, currency: "USD", pageSize: undefined }} backTo="/projects/a" />);
    expect(totalsOf("אוגוסט 2026")).toBe("הוצאות $5,000");
    expect(screen.getByText("Line 1").closest(".ui-row")?.querySelector(".ui-num")?.textContent).toBe("$1,000"); // FLOW-339: a cost list carries no minus
  });

  it("totals the last month once every row is shown", () => {
    wrap(<ProjectCategoryScreen sample={{ ...sample, pageSize: undefined }} backTo="/projects/a" />);
    expect(totalsOf("אוגוסט 2026")).toBe("הוצאות ₪5,000");
  });

  it("puts the lines' total in the subtitle, and the count once every row is shown (FLOW-334)", () => {
    const { unmount } = wrap(<ProjectCategoryScreen sample={sample} backTo="/projects/a" />);
    const subtitle = () => document.querySelector("header p.t-label")?.textContent ?? "";
    expect(subtitle()).toContain("₪");
    expect(subtitle()).not.toMatch(/תנועות|תנועה אחת/);
    unmount();
    wrap(<ProjectCategoryScreen sample={{ ...sample, pageSize: undefined }} backTo="/projects/a" />);
    expect(subtitle()).toMatch(new RegExp(`· ${String(sample.rows.length)} תנועות$`));
  });
});
