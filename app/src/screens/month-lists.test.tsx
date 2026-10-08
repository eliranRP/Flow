import type { ProjectDetail, ReviewRow } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../ui/toast";
import { ProjectCategoryScreen, ProjectDetailScreen, ReviewAllList } from "./flow-screens";

/** FLOW-302 wiring: each list hands MonthList the amount, currency, and completeness its rows show. */

type Txn = NonNullable<ProjectDetail>["transactions"][number];

function wrap(node: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter>{node}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function project(transactions: Txn[]): NonNullable<ProjectDetail> {
  return {
    id: "p-sample",
    name: "Sample project",
    status: "active",
    state_label: "פעיל",
    budget_agorot: null,
    income_agorot: 0n,
    direct_agorot: 0n,
    shared_agorot: 0n,
    profit_agorot: 0n,
    categories: [],
    pending_count: 0,
    transactions,
  };
}

const txn = (id: string, doc_date: string, amount_net: bigint, direction: string, currency?: string): Txn => ({
  id,
  description: `Line ${id}`,
  doc_date,
  amount_net,
  ...(currency == null ? {} : { currency }),
  direction,
  category: null,
});

function totalsOf(month: string): string | null {
  const group = screen.getByRole("group", { name: month });
  return group.querySelector(".ui-month-totals")?.textContent ?? null;
}

describe("project recent list months", () => {
  it("totals stored-negative expenses with a minus, a missing currency as ₪, and USD apart", () => {
    wrap(<ProjectDetailScreen sample={project([
      txn("a", "2026-09-14", 1_200_000n, "income"),
      txn("b", "2026-09-10", -350_000n, "expense", "ILS"),
      txn("c", "2026-09-08", -40_000n, "expense", "USD"),
      txn("d", "2026-08-20", -220_000n, "expense"),
    ])} />);
    expect(totalsOf("ספטמבר 2026")).toBe("הכנסות ₪12,000הוצאות −₪3,500הוצאות −$400");
    expect(totalsOf("אוגוסט 2026")).toBe("הוצאות −₪2,200");
  });

  it("shows only the name of the last month when get_project hit its 40-line cap", () => {
    const rows = Array.from({ length: 40 }, (_, index) =>
      txn(`r${String(index)}`, index < 20 ? "2026-09-10" : "2026-08-10", -10_000n, "expense"));
    wrap(<ProjectDetailScreen sample={project(rows)} />);
    expect(totalsOf("ספטמבר 2026")).toBe("הוצאות −₪2,000");
    expect(totalsOf("אוגוסט 2026")).toBeNull();
  });

  it("leaves lines kept out of the P&L out of the month totals", () => {
    wrap(<ProjectDetailScreen sample={project([
      txn("a", "2026-09-14", 1_200_000n, "income"),
      { ...txn("b", "2026-09-12", 500_000n, "income"), kept_out: true },
      txn("c", "2026-09-10", -350_000n, "expense"),
      { ...txn("d", "2026-08-20", 300_000n, "income"), kept_out: true },
      txn("e", "2026-08-18", -220_000n, "expense"),
    ])} />);
    expect(totalsOf("ספטמבר 2026")).toBe("הכנסות ₪12,000הוצאות −₪3,500");
    expect(totalsOf("אוגוסט 2026")).toBe("הוצאות −₪2,200");
  });

  it("adds this project's parts of a line split by category, with the line's sign", () => {
    wrap(<ProjectDetailScreen sample={project([
      { ...txn("a", "2026-09-14", -1_200_000n, "expense"), parts_minor: 800_000n },
      { ...txn("b", "2026-09-12", 900_000n, "income"), parts_minor: 300_000n },
      txn("c", "2026-09-10", -100_000n, "expense"),
      { ...txn("d", "2026-08-20", -500_000n, "expense"), parts_minor: null },
    ])} />);
    expect(totalsOf("ספטמבר 2026")).toBe("הכנסות ₪3,000הוצאות −₪9,000");
    expect(totalsOf("אוגוסט 2026")).toBe("הוצאות −₪5,000");
  });

  it("takes a signed share as it comes: a reversal part is already minus (decision 0138)", () => {
    wrap(<ProjectDetailScreen sample={project([
      // A supplier refund filed as income: 70.00 left as income, 30.00 put back against expenses.
      { ...txn("a", "2026-09-14", 10_000n, "income"), parts_minor: 4_000n },
      // An expense line whose reversal parts outweigh its own on this project: money comes back.
      { ...txn("b", "2026-09-12", -600_000n, "expense"), parts_minor: -50_000n },
      // An income line whose share here is below zero: money goes out.
      { ...txn("c", "2026-08-20", 1_000_000n, "income"), parts_minor: -200_000n },
    ])} />);
    expect(totalsOf("ספטמבר 2026")).toBe("הכנסות ₪540");
    expect(totalsOf("אוגוסט 2026")).toBe("הוצאות −₪2,000");
  });

  it("marks a kept-out line on the row and opens the lines without an extra tap (FLOW-411)", () => {
    wrap(<ProjectDetailScreen sample={project([
      { ...txn("a", "2026-09-14", -150_000n, "expense"), kept_out: true, category: "ציוד" },
      txn("b", "2026-08-12", -100_000n, "expense"),
    ])} />);
    expect(screen.queryByText("תנועות אחרונות")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "כל הקטגוריות" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Line a/ })).toHaveTextContent(/מחוץ לרווח · ציוד/);
  });

  it("totals the last month when the list is under the cap", () => {
    const rows = Array.from({ length: 39 }, (_, index) =>
      txn(`r${String(index)}`, index < 20 ? "2026-09-10" : "2026-08-10", -10_000n, "expense"));
    wrap(<ProjectDetailScreen sample={project(rows)} />);
    expect(totalsOf("אוגוסט 2026")).toBe("הוצאות −₪1,900");
  });
});

describe("review list months", () => {
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

  it("totals each currency by direction, with a missing currency as ₪", () => {
    wrap(<ReviewAllList
      rows={[
        review("a", "2026-08-03", 10_000n, "income", "USD"),
        review("b", "2026-08-04", -25_000n, "expense"),
        review("c", "2026-09-01", -5_000n, "expense"),
      ]}
      search=""
      backTo="/review"
    />);
    // FLOW-305: the statement rows show cents, so the month total shows exact cents too.
    expect(totalsOf("אוגוסט 2026")).toBe("הוצאות −₪250.00הכנסות $100.00");
  });

  it("adds exact cents, so the month matches its statement rows", () => {
    wrap(<ReviewAllList
      rows={[
        review("a", "2026-08-03", -10_050n, "expense"),
        review("b", "2026-08-04", -10_050n, "expense"),
        review("c", "2026-09-01", -5_000n, "expense"),
      ]}
      search=""
      backTo="/review"
    />);
    expect(totalsOf("אוגוסט 2026")).toBe("הוצאות −₪201.00");
  });
});

describe("review list statement rows (FLOW-305)", () => {
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

  it("draws the avatar, pending chip, suggestion, amount and method, and names the row in reading order", () => {
    wrap(<ReviewAllList rows={[base]} search="" backTo="/review" />);
    const link = screen.getByRole("link", { name: /Northwind Traders/ });
    expect(link.getAttribute("aria-label")).toBe("Northwind Traders, בנק, הצעה: וילה לדוגמה · חומרים, הוצאה −$1,200.50, בהמתנה");
    expect(link.querySelector(".ui-avatar")?.textContent).toBe("NT");
    expect(link.querySelector(".ui-avatar")?.getAttribute("aria-hidden")).toBe("true");
    expect(link.querySelector(".ui-status")?.textContent).toBe("בהמתנה");
    expect(link.querySelector(".ui-statement-suggest")?.textContent).toBe("✦ וילה לדוגמה · חומרים");
    expect(link.querySelector(".ui-statement-method")?.textContent).toBe("בנק");
    expect(link.querySelector(".ui-row-title")?.getAttribute("dir")).toBe("ltr");
    expect(link.querySelector(".t-amount")?.textContent).toBe("−$1,200.50");
    expect(screen.getByRole("heading", { level: 3 }).textContent).toMatch(/29\/09/);
  });

  it("labels a SUMIT invoice row with its document kind and green income with no plus", () => {
    wrap(<ReviewAllList
      rows={[{ ...base, description: "לקוח לדוגמה", amount_net: 500_000n, currency: "ILS", direction: "income", line_status: "posted", source: "sumit", doc_kind: "invoice", project_name: null, category_name: null }]}
      search=""
      backTo="/review"
    />);
    const link = screen.getByRole("link", { name: /לקוח לדוגמה/ });
    expect(link.querySelector(".ui-statement-method")?.textContent).toBe("חשבונית");
    expect(link.querySelector(".ui-status")).toBeNull();
    expect(link.querySelector(".ui-statement-line")).toBeNull();
    expect(link.querySelector(".ui-income")?.textContent).toBe("₪5,000.00");
    expect(link.textContent).not.toContain("+");
    expect(link.getAttribute("aria-label")).toBe("לקוח לדוגמה, חשבונית, הכנסה ₪5,000.00");
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
    expect(totalsOf("ספטמבר 2026")).toBe("הוצאות −₪1,000");
    expect(totalsOf("אוגוסט 2026")).toBeNull();
  });

  it("shows a USD drill-down in dollars", () => {
    wrap(<ProjectCategoryScreen sample={{ ...sample, currency: "USD", pageSize: undefined }} backTo="/projects/a" />);
    expect(totalsOf("אוגוסט 2026")).toBe("הוצאות −$5,000");
    expect(screen.getByText("Line 1").closest(".ui-row")?.querySelector(".ui-num")?.textContent).toBe("−$1,000.00");
  });

  it("totals the last month once every row is shown", () => {
    wrap(<ProjectCategoryScreen sample={{ ...sample, pageSize: undefined }} backTo="/projects/a" />);
    expect(totalsOf("אוגוסט 2026")).toBe("הוצאות −₪5,000");
  });
});
