import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { monthForecastBoardSample, monthForecastSample } from "../forecast-sample";
import { renderWithProviders } from "../test-render";
import { ForecastScreen } from "./forecast-screen";

const rpc = vi.hoisted(() => vi.fn((_name: string, _args?: unknown) => Promise.resolve({ data: null, error: null })));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({ rpc }),
}));

describe("ForecastScreen", () => {
  it("shows the forecast figure, the cash net today, and both sections", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastSample("positive")} />, { route: "/forecast" });
    // Net 1,200 plus income 9,000 minus charges 6,045 (the small one included): 4,155.
    expect(screen.getAllByText("₪4,155").length).toBeGreaterThan(0);
    const today = document.querySelector(".ui-forecast-today bdi");
    expect(today?.textContent).toBe("₪1,200");
    expect(today?.getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("צפוי להיכנס")).toBeTruthy();
    expect(screen.getByText("צפוי לצאת")).toBeTruthy();
  });

  it("keeps each amount LTR, so a minus sits at the start of the figure", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastSample("negative")} />, { route: "/forecast" });
    const big = document.querySelector(".ui-forecast-big bdi");
    expect(big?.getAttribute("dir")).toBe("ltr");
    expect(big?.textContent.startsWith("₪")).toBe(true);
    const today = document.querySelector(".ui-forecast-today bdi");
    expect(today?.getAttribute("dir")).toBe("ltr");
    expect(today?.textContent.startsWith("−₪")).toBe(true);
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
    expect(screen.getByText("שינית פריט אחד בצפי")).toBeTruthy();
    expect(screen.getByRole("button", { name: "איפוס" })).toBeTruthy();
  });

  it("counts two changed items in the reset line", () => {
    // The board's changed frame with its count doubled: the copy is the only thing under test.
    const sample = monthForecastBoardSample("changed");
    const twice = { ...sample, data: { ...sample.data, build: { ...sample.data.build, changed: 2 } } };
    renderWithProviders(<ForecastScreen sample={twice} />, { route: "/forecast" });
    expect(screen.getByText("שינית 2 פריטים בצפי")).toBeTruthy();
  });

  it("draws a moved item as one muted button with its name and amount, and no total on the head", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastBoardSample("changed")} />, { route: "/forecast" });
    const head = screen.getByText("לא החודש");
    const section = head.closest("section");
    expect(section).toBeTruthy();
    expect(head.parentElement?.querySelector(".ui-forecast-section-total")).toBeNull();
    const row = within(section as HTMLElement).getByRole("button", { name: "Northgate Co, +$12,500" });
    expect(row.querySelector(".ui-forecast-initial")).toBeNull();
    expect(row.querySelector("bdi")?.getAttribute("dir")).toBe("ltr");
    expect(row.textContent).toBe("Northgate Co+$12,500");
  });

  it("keeps the reset row in place with no changes: hidden, and its button disabled", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastSample("positive")} />, { route: "/forecast" });
    const line = document.querySelector(".ui-forecast-changed");
    expect(line).toBeTruthy();
    expect(line?.getAttribute("aria-hidden")).toBe("true");
    expect(line?.classList.contains("ui-forecast-changed-on")).toBe(false);
    const reset = line?.querySelector("button");
    expect(reset?.disabled).toBe(true);
  });

  it("resets to Flow's numbers with an undo that sends each captured override back", async () => {
    rpc.mockClear();
    const sample = monthForecastBoardSample("changed");
    renderWithProviders(<ForecastScreen sample={sample} />, { route: "/forecast" });
    fireEvent.click(screen.getByRole("button", { name: "איפוס" }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith("reset_forecast_month", { p_month: "2026-10" }); });
    await screen.findByText("הצפי חזר לחישוב של Flow");
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("set_forecast_item", {
        p_month: "2026-10",
        p_item_key: "invoice:inv-1043",
        p_patch: { amount_minor: null, due_on: null, moved_out: true },
      });
    });
    expect(rpc.mock.calls.filter(([name]) => name === "set_forecast_item")).toHaveLength(1);
  });

  it("says everything arrived in the board's copy, with no figures, sections or footnote", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastBoardSample("empty")} />, { route: "/forecast" });
    expect(screen.getByText("הכל כבר הגיע")).toBeTruthy();
    expect(screen.getByText("אוקטובר · נכון ל־30/10")).toBeTruthy();
    expect(screen.getByText(/הצפי לנובמבר ייפתח ב־1 בחודש/)).toBeTruthy();
    expect(document.querySelector(".ui-forecast-big")).toBeNull();
    expect(document.querySelector(".ui-forecast-today")).toBeNull();
    expect(document.querySelector(".ui-forecast-changed")).toBeNull();
    expect(document.querySelector(".ui-forecast-foot")).toBeNull();
    expect(document.querySelector(".ui-forecast-compact")).toBeNull();
  });

  it("gives the footnote no link", () => {
    renderWithProviders(<ForecastScreen sample={monthForecastSample("positive")} />, { route: "/forecast" });
    const foot = document.querySelector(".ui-forecast-foot");
    expect(foot?.textContent).toContain("הקישו על פריט כדי לשנות סכום או מועד.");
    expect(foot?.querySelector("a")).toBeNull();
  });
});
