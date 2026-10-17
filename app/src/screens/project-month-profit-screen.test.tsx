import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { JUNIPER_MONTH_PROFIT } from "../dev/profit-month-sample";
import { sideMinor } from "../cash-lines-groups";
import { ProjectMonthProfitScreen, type ProjectMonthProfitSample } from "./project-month-profit-screen";

function renderAt(path: string, sample: ProjectMonthProfitSample) {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:projectId/profit/:month" element={<ProjectMonthProfitScreen sample={sample} />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ProjectMonthProfitScreen", () => {
  it("the month's counted lines add up to its profit", () => {
    const total = JUNIPER_MONTH_PROFIT.lines.reduce((sum, line) => sum + sideMinor(line, "kept"), 0n);
    expect(total).toBe(379_560n);
  });

  it("lists the lines by day, newest day first, under the default date order", () => {
    const { container } = renderAt("/projects/juniper-ct/profit/2026-10", JUNIPER_MONTH_PROFIT);
    const heads = Array.from(container.querySelectorAll(".ui-lines-group-title")).map((head) => head.textContent);
    expect(heads).toEqual(["10/10", "08/10", "06/10", "04/10", "03/10", "01/10"]);
    expect(screen.getByRole("heading", { name: /רווח/ })).toBeTruthy();
  });

  it("the category order keeps each category closed until it is tapped", () => {
    const { container } = renderAt("/projects/juniper-ct/profit/2026-10?order=category", JUNIPER_MONTH_PROFIT);
    const heads = Array.from(container.querySelectorAll(".ui-lines-group-head[aria-expanded]"));
    expect(heads.map((head) => head.getAttribute("aria-expanded"))).toEqual(["false", "false", "false", "false", "false"]);
    expect(container.querySelectorAll("a[href^=\"/transactions/\"]")).toHaveLength(0);
    const first = heads[0];
    if (first == null) throw new Error("no category head");
    fireEvent.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll("a[href^=\"/transactions/\"]").length).toBeGreaterThan(0);
  });
});
