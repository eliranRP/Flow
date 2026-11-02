import type { RecurringChange } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { SAMPLE_RECURRING_THIS_MONTH } from "../forecast-sample";
import { projectAttentionRows } from "./project-attention";
import { RecurringChangesScreen } from "./recurring-changes-screen";

// Two changes: the power bill up 38%, and the arnona bill as a drop.
const [power, arnona] = SAMPLE_RECURRING_THIS_MONTH;
if (power == null || arnona == null) throw new Error("sample");
const TWO: RecurringChange[] = [power, { ...arnona, change_percent: -30, amount_minor: -91_000n }];

function withQuery(node: ReactNode) {
  return <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>;
}

function renderAt(path: string) {
  return render(withQuery(
    <MemoryRouter initialEntries={[path]}>
      <RecurringChangesScreen sample={TWO} />
    </MemoryRouter>,
  ));
}

describe("חיובים שהשתנו (FLOW-1021)", () => {
  it("lists only the changed charges, each with its amount, its usual one and its payment", () => {
    renderAt("/recurring/changes");
    expect(screen.getByRole("heading", { name: "חיובים שהשתנו" })).toBeTruthy();
    const links = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/transactions/"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/transactions/t-power-oct", "/transactions/t-arnona-oct"]);
    expect(links[0]?.textContent).toContain("חשמל עלה");
    expect(links[0]?.textContent).toContain("₪2,550 במקום ₪1,850");
    expect(links[1]?.textContent).toContain("ארנונה עירונית ירד");
    expect(links[1]?.textContent).toContain("₪910 במקום ₪1,300");
  });

  it("narrows to the project named in the address", () => {
    renderAt("/recurring/changes?project=p2");
    const links = screen.getAllByRole("link").filter((link) => link.getAttribute("href")?.startsWith("/transactions/"));
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/transactions/t-arnona-oct"]);
  });

  it("says so when nothing changed", () => {
    render(withQuery(
      <MemoryRouter>
        <RecurringChangesScreen sample={[]} />
      </MemoryRouter>,
    ));
    expect(screen.getByText("אין שינויים")).toBeTruthy();
  });

  it("opens the project's own list from the project page", () => {
    const changes = TWO.map((row) => ({ ...row, project_id: "p1" }));
    const [row] = projectAttentionRows({ projectId: "p1", pending: 0, late: [], changes, search: "" });
    expect(row?.to).toBe("/recurring/changes?project=p1");
  });
});
