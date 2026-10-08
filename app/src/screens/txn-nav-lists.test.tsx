import type { ProjectDetail } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { readTxnList } from "../txn-nav";
import { ToastProvider } from "../ui/toast";
import { ProjectCategoryScreen, ProjectDetailScreen } from "./flow-screens";

/** FLOW-303 wiring: each list hands the card its rows in the order shown, and the list is there on Back. */

type Txn = NonNullable<ProjectDetail>["transactions"][number];

function CardProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  const list = readTxnList(location.state);
  return (
    <div>
      <p data-testid="card">{location.pathname}</p>
      <p data-testid="ids">{list?.ids.join(",") ?? "none"}</p>
      <p data-testid="from">{list?.from ?? "none"}</p>
      <button type="button" onClick={() => { void navigate(-1); }}>back</button>
    </div>
  );
}

function wrap(entry: string, path: string, node: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path={path} element={node} />
            <Route path="/transactions/:transactionId" element={<CardProbe />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const txn = (id: string, doc_date: string): Txn => ({
  id,
  description: `Line ${id}`,
  doc_date,
  amount_net: -10_000n,
  direction: "expense",
  category: null,
});

const project: NonNullable<ProjectDetail> = {
  id: "p1",
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
  transactions: [txn("a", "2026-09-14"), txn("b", "2026-09-10"), txn("c", "2026-08-20")],
};

describe("lists that open a card with prev and next", () => {
  it("the project's recent list sends its rows and is still open on Back", () => {
    wrap("/projects/p1", "/projects/:projectId", <ProjectDetailScreen sample={project} />);
    fireEvent.click(screen.getByRole("link", { name: /Line b/ }));
    expect(screen.getByTestId("card")).toHaveTextContent("/transactions/b");
    expect(screen.getByTestId("ids")).toHaveTextContent("a,b,c");
    expect(screen.getByTestId("from")).toHaveTextContent("/projects/p1");
    fireEvent.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByRole("link", { name: /Line a/ })).toBeInTheDocument();
  });

  it("the category drill-down sends the rows it shows", () => {
    wrap("/projects/p1/categories/c1", "/projects/:projectId/categories/:categoryId", (
      <ProjectCategoryScreen
        backTo="/projects/p1"
        sample={{
          categoryName: "חומרים",
          projectName: "Sample project",
          pageSize: 2,
          rows: [
            { id: "t1", description: "Line 1", doc_date: "2026-09-14", amount_net: -100_000n },
            { id: "t2", description: "Line 2", doc_date: "2026-08-20", amount_net: -200_000n },
            { id: "t3", description: "Line 3", doc_date: "2026-08-02", amount_net: -300_000n },
          ],
        }}
      />
    ));
    fireEvent.click(screen.getByRole("link", { name: /Line 2/ }));
    expect(screen.getByTestId("ids")).toHaveTextContent(/^t1,t2$/);
    expect(screen.getByTestId("from")).toHaveTextContent("/projects/p1/categories/c1");
  });
});
