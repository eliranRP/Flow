import type { FiledTodayRow } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { readTxnList } from "../txn-nav";
import { groupByKey } from "../ui/month-groups";
import { ToastProvider } from "../ui/toast";
import { FILED_NO_PROJECT, FiledTodayScreen } from "./filed-today-screen";

/** FLOW-334: שויכו היום under one head per project, with its count and total. */

const line = (id: string, project: string | null, minor: bigint, category = "חומרים", direction: "income" | "expense" = "expense"): FiledTodayRow => ({
  id,
  description: `Line ${id}`,
  doc_date: "2026-09-29",
  amount_net: minor,
  direction,
  supplier_name: `Supplier ${id}`,
  project_name: project,
  category_name: category,
});

const ROWS = [
  line("a", "Project A", -350_000n),
  line("b", "Project B", -120_000n, "הובלה"),
  line("c", "Project A", -84_050n),
  line("d", null, -2_500n, "עמלות"),
  line("e", "Project A", 1_000_000n, "עבודות", "income"),
];

function CardProbe() {
  const location = useLocation();
  return <p data-testid="ids">{readTxnList(location.state)?.ids.join(",") ?? "none"}</p>;
}

function renderList(rows: FiledTodayRow[]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/review/filed"]}>
          <Routes>
            <Route path="/review/filed" element={<FiledTodayScreen sample={rows} />} />
            <Route path="/transactions/:transactionId" element={<CardProbe />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("groupByKey", () => {
  it("keeps the order each key first appears and the rows' order inside it", () => {
    const groups = groupByKey(
      ROWS,
      (row) => ({ key: row.project_name ?? "", title: row.project_name ?? "none" }),
      (row) => ({ minor: row.amount_net, currency: "ILS", direction: row.direction }),
      true,
    );
    expect(groups.map((group) => group.title)).toEqual(["Project A", "Project B", "none"]);
    expect(groups[0]?.rows.map((row) => row.id)).toEqual(["a", "c", "e"]);
    expect(groups[0]?.totals).toEqual([{ currency: "ILS", incomeMinor: 1_000_000n, expenseMinor: 434_050n }]);
  });

  it("draws a lone group too", () => {
    const groups = groupByKey([ROWS[0]], () => ({ key: "k", title: "t" }), () => ({ minor: 1n, currency: "ILS", direction: "expense" }));
    expect(groups).toHaveLength(1);
  });
});

describe("FiledTodayScreen by project", () => {
  it("puts each project's rows under its head with the count and the total", () => {
    renderList(ROWS);
    const heads = screen.getAllByRole("heading", { level: 2 }).map((head) => head.textContent);
    expect(heads).toEqual(["Project A", "Project B", FILED_NO_PROJECT]);
    const projectA = screen.getByRole("group", { name: "Project A" });
    expect(projectA).toHaveTextContent("3 תנועות");
    expect(within(projectA).getByText("₪10,000.00")).toHaveClass("ui-income");
    expect(within(projectA).getByText("−₪4,340.50")).toBeInTheDocument();
    const projectB = screen.getByRole("group", { name: "Project B" });
    expect(projectB).toHaveTextContent("תנועה אחת");
    expect(within(projectB).getByText("−₪1,200.00")).toBeInTheDocument();
  });

  it("keeps only the category in each row's hint", () => {
    renderList(ROWS);
    const row = screen.getByRole("link", { name: /Supplier b/ });
    expect(row).toHaveTextContent("הובלה");
    expect(row).not.toHaveTextContent("Project B");
  });

  it("steps through the rows in the order drawn", () => {
    renderList(ROWS);
    fireEvent.click(screen.getByRole("link", { name: /Supplier c/ }));
    expect(screen.getByTestId("ids")).toHaveTextContent("a,c,e,b,d");
  });
});
