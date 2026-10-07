import type { ProjectDetail, ReviewRow } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
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
    fireEvent.click(screen.getByText("תנועות אחרונות"));
    expect(totalsOf("ספטמבר 2026")).toBe("הכנסות ₪12,000הוצאות −₪3,500הוצאות −$400");
    expect(totalsOf("אוגוסט 2026")).toBe("הוצאות −₪2,200");
  });

  it("shows only the name of the last month when get_project hit its 40-line cap", () => {
    const rows = Array.from({ length: 40 }, (_, index) =>
      txn(`r${String(index)}`, index < 20 ? "2026-09-10" : "2026-08-10", -10_000n, "expense"));
    wrap(<ProjectDetailScreen sample={project(rows)} />);
    fireEvent.click(screen.getByText("תנועות אחרונות"));
    expect(totalsOf("ספטמבר 2026")).toBe("הוצאות −₪2,000");
    expect(totalsOf("אוגוסט 2026")).toBeNull();
  });

  it("totals the last month when the list is under the cap", () => {
    const rows = Array.from({ length: 39 }, (_, index) =>
      txn(`r${String(index)}`, index < 20 ? "2026-09-10" : "2026-08-10", -10_000n, "expense"));
    wrap(<ProjectDetailScreen sample={project(rows)} />);
    fireEvent.click(screen.getByText("תנועות אחרונות"));
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
    expect(totalsOf("אוגוסט 2026")).toBe("הוצאות −₪250הכנסות $100");
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

  it("totals the last month once every row is shown", () => {
    wrap(<ProjectCategoryScreen sample={{ ...sample, pageSize: undefined }} backTo="/projects/a" />);
    expect(totalsOf("אוגוסט 2026")).toBe("הוצאות −₪5,000");
  });
});
