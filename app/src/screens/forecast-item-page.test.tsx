import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { monthForecastBoardSample, monthForecastSample, type ForecastSampleKind } from "../forecast-sample";
import { renderWithProviders } from "../test-render";
import { sheetStack } from "../ui/back";
import { type ForecastSample, ForecastScreen } from "./forecast-screen";

const rpc = vi.hoisted(() => vi.fn((_name: string, _args?: unknown) => Promise.resolve({ data: null, error: null })));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({ rpc }),
}));

function Where() {
  const location = useLocation();
  const state: unknown = location.state;
  return <output data-testid="where" data-layers={sheetStack(state).join(" ")}>{location.pathname}</output>;
}

/** The app's tree: the list at /forecast, a row's page at /forecast/item/<key> over it. */
function renderForecast(sample: ForecastSample, route = "/forecast") {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/forecast" element={<ForecastScreen sample={sample} />}>
          <Route path="item/:itemKey" element={null} />
        </Route>
      </Routes>
      <Where />
    </>,
    { route },
  );
}

const board = () => monthForecastBoardSample("board");
const plain = (kind: ForecastSampleKind) => monthForecastSample(kind);

/** The When sheet has closed and its history entry is gone, so Back and שמירה act on the page. */
async function sheetGone() {
  await waitFor(() => { expect(screen.queryByRole("radiogroup", { name: "מתי צפוי" })).toBeNull(); });
  await waitFor(() => { expect(screen.getByTestId("where").dataset.layers).toBe(""); });
}

function openNorthgate() {
  fireEvent.click(screen.getByRole("button", { name: "Northgate Co, +$12,500" }));
}

describe("ForecastItemPage (MonthForecastEdit)", () => {
  it("opens a row's page at its own path, over the list, with the board's late invoice", () => {
    renderForecast(board());
    openNorthgate();
    expect(screen.getByTestId("where").textContent).toBe("/forecast/item/invoice%3Ainv-1043");
    expect(document.querySelector(".ui-forecast-screen")?.classList.contains("ui-forecast-screen-paged")).toBe(true);
    expect(screen.getByRole("heading", { name: "Northgate Co" })).toBe(document.activeElement);
    expect(screen.getByText("צפי · באיחור 34 ימים").classList.contains("ui-forecast-page-status-late")).toBe(true);
    expect(screen.getByRole("textbox", { name: "סכום צפוי" })).toHaveValue("+$12,500");
    expect(screen.getByText("אוקטובר · הכנסה · חשבונית פתוחה")).toBeTruthy();
    expect(screen.getByText("הכנסה מלקוחות")).toBeTruthy();
    expect(document.querySelector(".ui-forecast-page-project .ui-icon-row-value")?.textContent).toBe("Northgate Co");
    expect(screen.getByRole("button", { name: "מתי צפוי: השבוע" }).textContent).toContain("עבר המועד הרגיל");
    expect(screen.getByRole("link", { name: "חשבונית #1043, פתיחת החשבונית" })).toHaveAttribute("href", "/unpaid");
    expect(screen.getByText("משנה רק את הצפי. החשבונית עצמה לא משתנה.")).toBeTruthy();
  });

  it("names a recurring charge's month, source and hint, and its missing project and category", () => {
    renderForecast(plain("positive"));
    fireEvent.click(screen.getByRole("button", { name: /^לקוח לדוגמה,/ }));
    expect(screen.getByText("צפי · אוקטובר").classList.contains("ui-forecast-page-status-late")).toBe(false);
    expect(screen.getByText("אוקטובר · הכנסה · קבוע")).toBeTruthy();
    expect(screen.getByText("כללי")).toBeTruthy();
    expect(screen.getByText("ללא קטגוריה")).toBeTruthy();
    expect(screen.getByRole("link", { name: "חיוב קבוע, פתיחת החיוב בקבועים" })).toHaveAttribute("href", "/recurring");
    expect(screen.getByText("משנה רק את הצפי של אוקטובר. החיוב הקבוע לא משתנה.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "מתי צפוי: עד 31/10" }).textContent).toContain("בצפי של אוקטובר");
  });

  it("an expense reads plain with a minus", () => {
    renderForecast(plain("positive"));
    fireEvent.click(screen.getByRole("button", { name: /^ספק לדוגמה א׳,/ }));
    const input = screen.getByRole("textbox", { name: "סכום צפוי" });
    expect(input).toHaveValue("−₪4,200");
    expect(input.classList.contains("ui-forecast-page-input-in")).toBe(false);
    expect(screen.getByText("אוקטובר · הוצאה · קבוע")).toBeTruthy();
  });

  it("saves an edited amount for this week, closes the page and says so", async () => {
    rpc.mockClear();
    renderForecast(board());
    openNorthgate();
    const input = screen.getByRole("textbox", { name: "סכום צפוי" });
    fireEvent.change(input, { target: { value: "+$13,0000" } });
    expect(input).toHaveValue("+$130,000");
    fireEvent.change(input, { target: { value: "+$13,000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(screen.getByTestId("where").textContent).toBe("/forecast");
    expect(screen.queryByRole("textbox", { name: "סכום צפוי" })).toBeNull();
    await screen.findByText("הצפי עודכן");
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("set_forecast_item", {
        p_month: "2026-10",
        p_item_key: "invoice:inv-1043",
        p_patch: { amount_minor: 1300000, due_on: "2026-10-17", moved_out: false },
      });
    });
  });

  it("opens the מתי צפוי sheet, and a pick sets the draft and closes it", async () => {
    rpc.mockClear();
    renderForecast(board());
    openNorthgate();
    fireEvent.click(screen.getByRole("button", { name: "מתי צפוי: השבוע" }));
    const group = await screen.findByRole("radiogroup", { name: "מתי צפוי" });
    expect(screen.getByText("Northgate Co · בצפי של אוקטובר")).toBeTruthy();
    expect(within(group).getByRole("radio", { name: /^השבוע/ })).toHaveAttribute("aria-checked", "true");
    expect(within(group).getByText("עבר המועד. נניח שיגיע עד סוף השבוע")).toBeTruthy();
    expect(within(group).getByText("עד סוף החודש")).toBeTruthy();
    expect(within(group).getByText("יוצא מהצפי של אוקטובר ועובר לנובמבר")).toBeTruthy();
    fireEvent.click(within(group).getByRole("radio", { name: /^עד 31\/10/ }));
    await sheetGone();
    // Picking saves nothing: the page's שמירה does.
    expect(rpc.mock.calls.filter(([name]) => name === "set_forecast_item")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "מתי צפוי: עד 31/10" }));
    fireEvent.click(await screen.findByRole("radio", { name: /^לא החודש/ }));
    await sheetGone();
    fireEvent.click(screen.getByRole("button", { name: "מתי צפוי: לא החודש" }));
    fireEvent.click(await screen.findByRole("radio", { name: /^עד 31\/10/ }));
    await sheetGone();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("set_forecast_item", {
        p_month: "2026-10",
        p_item_key: "invoice:inv-1043",
        p_patch: { amount_minor: null, due_on: "2026-10-31", moved_out: false },
      });
    });
  });

  it("moves an item to next month: the page closes, the row folds, then the move is written", async () => {
    rpc.mockClear();
    renderForecast(board());
    openNorthgate();
    fireEvent.click(screen.getByRole("button", { name: "מתי צפוי: השבוע" }));
    fireEvent.click(await screen.findByRole("radio", { name: /^לא החודש/ }));
    await sheetGone();
    expect(screen.getByRole("button", { name: "מתי צפוי: לא החודש" }).textContent).toContain("יוצא מהצפי של אוקטובר");
    expect(screen.getByRole("textbox", { name: "סכום צפוי" })).toBeDisabled();
    // The fold lasts a moment on a loaded machine: watch for it rather than poll for it.
    const li = screen.getByRole("button", { name: "Northgate Co, +$12,500" }).closest("li");
    if (li == null) throw new Error("row");
    let folded = false;
    const watch = new MutationObserver(() => { folded ||= li.classList.contains("ui-forecast-leaving"); });
    watch.observe(li, { attributes: true, attributeFilter: ["class"] });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await screen.findByText("Northgate Co הועבר לחודש הבא");
    await waitFor(() => { expect(folded).toBe(true); });
    watch.disconnect();
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("set_forecast_item", {
        p_month: "2026-10",
        p_item_key: "invoice:inv-1043",
        p_patch: { moved_out: true },
      });
    });
  });

  it("Back closes the page and gives the focus back to the row", async () => {
    renderForecast(board());
    openNorthgate();
    fireEvent.click(screen.getByRole("button", { name: "חזרה לצפי" }));
    expect(screen.getByTestId("where").textContent).toBe("/forecast");
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("button", { name: "Northgate Co, +$12,500" })); });
  });

  it("Escape closes the When sheet first, then the page", async () => {
    renderForecast(board());
    openNorthgate();
    fireEvent.click(screen.getByRole("button", { name: "מתי צפוי: השבוע" }));
    const group = await screen.findByRole("radiogroup", { name: "מתי צפוי" });
    fireEvent.keyDown(group, { key: "Escape" });
    await sheetGone();
    expect(screen.getByTestId("where").textContent).toBe("/forecast/item/invoice%3Ainv-1043");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("where").textContent).toBe("/forecast");
  });

  it("Escape closes the page", () => {
    renderForecast(board());
    openNorthgate();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("where").textContent).toBe("/forecast");
  });

  it("opens from a deep link, and goes back to the list for a key that is not in the month", async () => {
    renderForecast(board(), "/forecast/item/invoice%3Ainv-1043");
    expect(screen.getByRole("heading", { name: "Northgate Co" })).toBeTruthy();
    renderForecast(board(), "/forecast/item/invoice%3Agone");
    await waitFor(() => { expect(screen.getAllByTestId("where").at(-1)?.textContent).toBe("/forecast"); });
  });
});
