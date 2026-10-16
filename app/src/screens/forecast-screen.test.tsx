import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { monthForecastSample } from "../forecast-sample";
import { renderWithProviders } from "../test-render";
import { ForecastScreen } from "./forecast-screen";

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

describe("ForecastScreen", () => {
  it("shows the forecast figure, the cash net today, and both sections", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastSample("positive")} />, { route: "/forecast" });
    // Net 1,200 plus income 9,000 minus charges 6,045 (the small one included): 4,155.
    expect(screen.getAllByText("₪4,155").length).toBeGreaterThan(0);
    expect(screen.getByText("היום ₪1,200")).toBeTruthy();
    expect(screen.getByText("צפוי להיכנס")).toBeTruthy();
    expect(screen.getByText("צפוי לצאת")).toBeTruthy();
  });

  it("opens the change sheet from a row", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastSample("positive")} />, { route: "/forecast" });
    fireEvent.click(screen.getByRole("button", { name: /^לקוח לדוגמה,/ }));
    expect(screen.getByText("סכום צפוי")).toBeTruthy();
    expect(screen.getByRole("button", { name: "שמירה" })).toBeTruthy();
  });

  it("lists a moved item under לא החודש and counts it in the reset line", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastSample("moved")} />, { route: "/forecast" });
    expect(screen.getByText("לא החודש")).toBeTruthy();
    expect(screen.getByText("שינית 1 פריט בצפי")).toBeTruthy();
    expect(screen.getByRole("button", { name: "איפוס" })).toBeTruthy();
  });
});
