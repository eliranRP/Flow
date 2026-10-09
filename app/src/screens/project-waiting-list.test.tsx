import type { ProjectWaitingRow } from "@flow/shared";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ProjectWaitingList } from "./review-screen";
import { KEPT_OUT } from "./screen-shared";

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
});
