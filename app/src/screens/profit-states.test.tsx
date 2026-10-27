// FLOW-969 (Profit v2): the profit pages offline (their last read, and the moment it is from) and failed (the
// failure card in place of the figures, with נסו שוב and צריך עזרה?). Invented figures only.
import { screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { COMPANY_PROFIT_SAMPLE } from "../dev/company-profit-sample";
import { JUNIPER_PROFIT } from "../dev/project-profit-sample";
import { renderWithProviders } from "../test-render";
import { israelHourMinute } from "../ui/band-states";
import { CompanyProfitScreen } from "./company-profit-screen";
import { ProjectProfitScreen } from "./project-profit-screen";

const failing = vi.hoisted(() => ({ on: false }));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: () => Promise.resolve(failing.on ? { data: null, error: { message: "boom" } } : { data: null, error: null }),
  }),
}));

const SINCE = Date.UTC(2026, 9, 26, 7, 41);

describe("the profit pages offline", () => {
  it("the company page keeps its figures and says which moment they are from", () => {
    renderWithProviders(<CompanyProfitScreen sample={{ ...COMPANY_PROFIT_SAMPLE, offlineSince: SINCE }} />, { route: "/profit" });
    const line = screen.getByText(/אין חיבור · מוצג המצב/).closest("p");
    expect(line).toHaveTextContent(`אין חיבור · מוצג המצב מ־${israelHourMinute(SINCE)}`);
    expect(screen.getByRole("radiogroup", { name: "סידור" })).toBeInTheDocument();
  });

  it("the project's profit page does too", () => {
    renderWithProviders(<ProjectProfitScreen sample={{ ...JUNIPER_PROFIT, offlineSince: SINCE }} />, { route: `/projects/${JUNIPER_PROFIT.project.id}/profit` });
    expect(screen.getByText(/אין חיבור · מוצג המצב/)).toBeInTheDocument();
  });

  it("no line while online", () => {
    renderWithProviders(<CompanyProfitScreen sample={COMPANY_PROFIT_SAMPLE} />, { route: "/profit" });
    expect(screen.queryByText(/אין חיבור/)).toBeNull();
  });
});

describe("the profit pages when the read fails", () => {
  it("the project's profit page shows the failure card, not stale figures", async () => {
    failing.on = true;
    renderWithProviders(
      <Routes>
        <Route path="/projects/:projectId/profit" element={<ProjectProfitScreen />} />
      </Routes>,
      { route: "/projects/p-fail/profit" },
    );
    expect(await screen.findByRole("heading", { name: "הרווח לא נטען" }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "צריך עזרה?" })).toHaveAttribute("href", "/help");
    failing.on = false;
  });
});
