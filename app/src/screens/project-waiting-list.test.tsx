import type { ProjectWaitingRow } from "@flow/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ProjectWaitingList } from "./review-screen";
import { KEPT_OUT } from "./screen-shared";
import { readTxnList } from "../txn-nav";

function CardState() {
  const location = useLocation();
  return <p data-testid="list">{JSON.stringify(readTxnList(location.state))}</p>;
}

const line: ProjectWaitingRow = {
  review_id: null,
  transaction_id: "t-doc",
  description: "חשבונית 2231",
  doc_date: "2026-10-05",
  amount_net: 184_000n,
  direction: "expense",
  reason: null,
  project_id: "a",
  category_id: null,
  category_name: null,
  supplier_name: null,
  source: "sumit",
};

describe("ProjectWaitingList (FLOW-124, FLOW-125)", () => {
  it("passes the line's source and kept_out on to its row", () => {
    render(
      <MemoryRouter>
        <ProjectWaitingList
          search=""
          rows={[
            { ...line, transaction_id: "t-bank", description: "Bank line", source: "mercury" },
            { ...line, transaction_id: "t-out", description: "Kept out line", kept_out: true },
            line,
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole("img", { name: KEPT_OUT })).toHaveLength(1);
    const outRow = screen.getByText("Kept out line").closest("a");
    expect(outRow?.querySelector(`[aria-label="${KEPT_OUT}"]`)).not.toBeNull();
    const bankIcon = screen.getByText("Bank line").closest("a")?.querySelector(".ui-row-icon svg")?.outerHTML;
    const docIcon = screen.getByText("חשבונית 2231").closest("a")?.querySelector(".ui-row-icon svg")?.outerHTML;
    expect(bankIcon).toBeDefined();
    expect(bankIcon).not.toBe(docIcon);
  });

  it("shows a dollar line in dollars (FLOW-408)", () => {
    render(
      <MemoryRouter>
        <ProjectWaitingList search="" rows={[{ ...line, transaction_id: "t-usd", description: "USD line", currency: "USD" }, line]} />
      </MemoryRouter>,
    );
    const usdRow = screen.getByText("USD line").closest("a");
    expect(usdRow?.textContent).toContain("$");
    expect(usdRow?.textContent).not.toContain("₪");
    expect(screen.getByText("חשבונית 2231").closest("a")?.textContent).toContain("₪");
  });

  it("opens a card with the list's card rows, so ˄ ˅ and a swipe walk them; a change to review stays out (FLOW-314)", () => {
    render(
      <MemoryRouter initialEntries={["/projects/a/waiting"]}>
        <Routes>
          <Route
            path="/projects/a/waiting"
            element={(
              <ProjectWaitingList
                search=""
                rows={[
                  { ...line, transaction_id: "t1", description: "שורה 1", doc_date: "2026-10-07" },
                  { ...line, transaction_id: "t2", description: "שינוי", review_id: "r2", doc_date: "2026-10-06" },
                  { ...line, transaction_id: "t3", description: "שורה 3", doc_date: "2026-10-05" },
                ]}
              />
            )}
          />
          <Route path="/transactions/:id" element={<CardState />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("שורה 3"));
    expect(JSON.parse(screen.getByTestId("list").textContent)).toEqual({ ids: ["t1", "t3"], from: "/projects/a/waiting" });
  });
});
