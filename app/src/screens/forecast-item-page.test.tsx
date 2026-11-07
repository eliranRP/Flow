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
    expect(screen.getByRole("link", { name: "חשבונית #1043, פתיחת החשבונית" })).toHaveAttribute("href", "/unpaid/inv-1043");
    expect(screen.getByText("משנה רק את הצפי. החשבונית עצמה לא משתנה.")).toBeTruthy();
  });

  it("names a recurring charge's month, source and hint, and its missing project and category", () => {
    renderForecast(plain("positive"));
    fireEvent.click(screen.getByRole("button", { name: /^לקוח לדוגמה,/ }));
    expect(screen.getByText("צפי · אוקטובר").classList.contains("ui-forecast-page-status-late")).toBe(false);
    expect(screen.getByText("אוקטובר · הכנסה · קבוע")).toBeTruthy();
    expect(screen.getByText("כללי")).toBeTruthy();
    expect(screen.getByText("ללא קטגוריה")).toBeTruthy();
    expect(screen.getByRole("link", { name: "חיוב קבוע, פתיחת החיוב בקבועים" })).toHaveAttribute("href", "/recurring/income/retainer");
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
    // Digits only, grouped by thousands; a fraction keeps its digits.
    fireEvent.change(input, { target: { value: "+$1234567.5x" } });
    expect(input).toHaveValue("+$1,234,567.5");
    fireEvent.change(input, { target: { value: "+$13,000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירת השינוי בצפי" }));
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
    // FLOW-970: the toast hangs under the header, and the write's answer never replaces its ביטול.
    expect(document.querySelector(".ui-toast-host")).toHaveAttribute("data-place", "top");
    expect(screen.getByRole("button", { name: "ביטול" })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "שמירת השינוי בצפי" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("set_forecast_item", {
        p_month: "2026-10",
        p_item_key: "invoice:inv-1043",
        p_patch: { amount_minor: null, due_on: "2026-10-31", moved_out: false },
      });
    });
  });

  it("a save right after a pick, before the sheet's history step, closes the page for good", async () => {
    rpc.mockClear();
    renderForecast(board());
    openNorthgate();
    fireEvent.click(screen.getByRole("button", { name: "מתי צפוי: השבוע" }));
    fireEvent.click(await screen.findByRole("radio", { name: /^עד 31\/10/ }));
    // No wait: the sheet is still closing (the page is still behind its modal) and its entry may still be on the history.
    fireEvent.click(screen.getByRole("button", { name: "שמירת השינוי בצפי", hidden: true }));
    await waitFor(() => { expect(screen.getByTestId("where").textContent).toBe("/forecast"); });
    await waitFor(() => { expect(screen.getByTestId("where").dataset.layers).toBe(""); });
    // Settled: still the list, the page gone and the row back on screen.
    await new Promise((resolve) => { setTimeout(resolve, 400); });
    expect(screen.getByTestId("where").textContent).toBe("/forecast");
    expect(screen.queryByRole("textbox", { name: "סכום צפוי" })).toBeNull();
    expect(document.querySelector(".ui-forecast-screen")?.classList.contains("ui-forecast-screen-paged")).toBe(false);
    expect(screen.getByRole("button", { name: "Northgate Co, +$12,500" })).toBeTruthy();
    expect(rpc.mock.calls.filter(([name]) => name === "set_forecast_item")).toEqual([
      ["set_forecast_item", { p_month: "2026-10", p_item_key: "invoice:inv-1043", p_patch: { amount_minor: null, due_on: "2026-10-31", moved_out: false } }],
    ]);
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
    fireEvent.click(screen.getByRole("button", { name: "שמירת השינוי בצפי" }));
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

  it("a ביטול before the fold ends sends nothing: the move is cancelled, not written then undone", async () => {
    rpc.mockClear();
    renderForecast(board());
    openNorthgate();
    fireEvent.click(screen.getByRole("button", { name: "מתי צפוי: השבוע" }));
    fireEvent.click(await screen.findByRole("radio", { name: /^לא החודש/ }));
    await sheetGone();
    fireEvent.click(screen.getByRole("button", { name: "שמירת השינוי בצפי" }));
    await screen.findByText("Northgate Co הועבר לחודש הבא");
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    // Past the fold (280ms) and its two frames: still no write, and the row stays in the list.
    await new Promise((resolve) => { setTimeout(resolve, 500); });
    expect(rpc.mock.calls.filter(([name]) => name === "set_forecast_item")).toHaveLength(0);
    const li = screen.getByRole("button", { name: "Northgate Co, +$12,500" }).closest("li");
    expect(li).not.toHaveClass("ui-forecast-leaving");
  });

  it("Back closes the page and gives the focus back to the row", async () => {
    renderForecast(board());
    openNorthgate();
    fireEvent.click(screen.getByRole("button", { name: "חזרה לתזרים צפוי" }));
    expect(screen.getByTestId("where").textContent).toBe("/forecast");
    await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("button", { name: "Northgate Co, +$12,500" })); });
  });

  it("keeps the list's query on the invoice's link", () => {
    renderForecast(board(), "/forecast?from=home");
    openNorthgate();
    expect(screen.getByRole("link", { name: "חשבונית #1043, פתיחת החשבונית" })).toHaveAttribute("href", "/unpaid/inv-1043?from=home");
  });

  it("puts the list back where it was scrolled, then focuses the row", async () => {
    let y = 600;
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((_x: number, top: number) => { y = top; });
    try {
      renderForecast(board());
      openNorthgate();
      // The app's ScrollMemory starts the page at the top (ui/scroll-memory.test.tsx).
      y = 0;
      fireEvent.click(screen.getByRole("button", { name: "חזרה לתזרים צפוי" }));
      await waitFor(() => { expect(document.activeElement).toBe(screen.getByRole("button", { name: "Northgate Co, +$12,500" })); });
      expect(scrollTo).toHaveBeenLastCalledWith(0, 600);
      expect(y).toBe(600);
    } finally {
      scrollTo.mockRestore();
      Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
    }
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

describe("ForecastItemPage, כל כמה זמן (FLOW-1010)", () => {
  function withAddedLine(lineStart: string): ForecastSample {
    const sample = board();
    const base = sample.data.build.income[0];
    if (base == null) throw new Error("no income item");
    const added = { ...base, key: "added:e-1", kind: "added" as const, name: "הכנסות שכירות", usual: 72_900n, minor: 72_900n, project_id: "p-green", project_name: null, pace: "once", line_start: lineStart, overridden: false, moved_out: false, late_days: 0, expected_on: null, due_on: null };
    const build = { ...sample.data.build, items: [...sample.data.build.items, added], income: [added, ...sample.data.build.income] };
    return { ...sample, data: { ...sample.data, build } };
  }

  async function pickMonthly() {
    fireEvent.click(await screen.findByRole("button", { name: "כל כמה זמן: פעם אחת" }));
    const sheet = await screen.findByRole("dialog", { name: "כל כמה זמן" });
    // The radios: פעם אחת, כל חודש, כל חודשיים, כל רבעון, כל שנה.
    const month = within(sheet).getAllByRole("radio").find((radio) => {
      const text = radio.textContent;
      return text.startsWith("כל חודש") && !text.startsWith("כל חודשיים");
    });
    if (month == null) throw new Error("no monthly radio");
    fireEvent.click(month);
    await sheetGone();
  }

  it("makes a line added this month repeat: the pace pick is a draft, and שמירת השינוי בצפי writes the line (FLOW-1012)", async () => {
    rpc.mockClear();
    renderForecast(withAddedLine("2026-10"), `/forecast/item/${encodeURIComponent("added:e-1")}`);
    expect(await screen.findByText("משנה רק את הצפי של אוקטובר. השורה בצפי של הפרויקט לא משתנה.")).toBeInTheDocument();
    await pickMonthly();
    // Nothing is written yet, and the page no longer says the project's line stays as it is.
    expect(rpc).not.toHaveBeenCalledWith("set_project_forecast_edit", expect.anything());
    expect(screen.getByRole("button", { name: "כל כמה זמן: כל חודש" })).toBeInTheDocument();
    expect(screen.queryByText(/השורה בצפי של הפרויקט לא משתנה/)).toBeNull();
    expect(screen.getByText("משנה את הצפי של אוקטובר, ואת השורה בצפי של הפרויקט מאוקטובר והלאה.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שמירת השינוי בצפי" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("set_project_forecast_edit", {
        p_project_id: "p-green",
        p_month: "2026-10",
        p_edit: { row_key: "add:e-1", amount_minor: 72_900, pace: "month" },
      });
    });
    // A pace pick alone leaves this month's amount and date as they were.
    expect(rpc).not.toHaveBeenCalledWith("set_forecast_item", expect.anything());
  });

  it("saves a pace pick and a new amount together: the line's pace and this month's amount, then closes (FLOW-1012)", async () => {
    rpc.mockClear();
    renderForecast(withAddedLine("2026-10"), `/forecast/item/${encodeURIComponent("added:e-1")}`);
    await pickMonthly();
    fireEvent.change(screen.getByRole("textbox", { name: "סכום צפוי" }), { target: { value: "+$800" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירת השינוי בצפי" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("set_project_forecast_edit", {
        p_project_id: "p-green",
        p_month: "2026-10",
        p_edit: { row_key: "add:e-1", amount_minor: 72_900, pace: "month" },
      });
    });
    await waitFor(() => {
      const patches = rpc.mock.calls.filter(([name]) => name === "set_forecast_item").map(([, args]) => args as { p_item_key: string; p_patch: { amount_minor: number | null; moved_out: boolean } });
      expect(patches.map((args) => [args.p_item_key, args.p_patch.amount_minor, args.p_patch.moved_out])).toEqual([["added:e-1", 80_000, false]]);
    });
    await waitFor(() => { expect(screen.getByTestId("where")).toHaveTextContent(/^\/forecast$/); });
    expect(screen.queryByRole("button", { name: "שמירת השינוי בצפי" })).toBeNull();
  });

  /** The pace write answers with its undo; the rest answer with nothing. */
  function paceAnswers(pace: () => Promise<{ data: unknown; error: unknown }> = () => Promise.resolve({ data: { undo: { drop: ["e-9"], put: [] } }, error: null })) {
    rpc.mockImplementation((name: string) => (name === "set_project_forecast_edit" ? pace() : Promise.resolve({ data: null, error: null })) as Promise<{ data: null; error: null }>);
  }

  /** The forecast's writes, in the order sent, each with its patch or its undo (the reads that refresh are left out). */
  const sent = () => rpc.mock.calls.filter(([name]) => name === "set_forecast_item" || name === "undo_project_forecast").map(([name, args]) => [name, (args as { p_patch?: unknown; p_undo?: unknown } | undefined)?.p_patch ?? (args as { p_undo?: unknown } | undefined)?.p_undo ?? null]);

  it("gives a save of the pace and the amount one toast, whose ביטול undoes the amount, then the pace (FLOW-1018)", async () => {
    rpc.mockClear();
    paceAnswers();
    try {
      renderForecast(withAddedLine("2026-10"), `/forecast/item/${encodeURIComponent("added:e-1")}`);
      await pickMonthly();
      fireEvent.change(screen.getByRole("textbox", { name: "סכום צפוי" }), { target: { value: "+$800" } });
      fireEvent.click(screen.getByRole("button", { name: "שמירת השינוי בצפי" }));
      await screen.findByText("הצפי עודכן");
      await waitFor(() => { expect(rpc).toHaveBeenCalledWith("set_project_forecast_edit", expect.anything()); });
      // The pace write's answer adds no toast of its own: "הצפי עודכן" and its ביטול stay.
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      expect(screen.queryByText("הכנסות שכירות: כל חודש")).toBeNull();
      expect(screen.getAllByRole("button", { name: "ביטול" })).toHaveLength(1);
      rpc.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
      await waitFor(() => {
        expect(sent()).toEqual([
          ["set_forecast_item", { reset: true }],
          ["undo_project_forecast", { drop: ["e-9"], put: [] }],
        ]);
      });
    } finally {
      rpc.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    }
  });

  it("sends the pace's undo once its write is back, when ביטול comes first (FLOW-1018)", async () => {
    rpc.mockClear();
    let answer: (value: { data: unknown; error: unknown }) => void = () => undefined;
    paceAnswers(() => new Promise((resolve) => { answer = resolve; }));
    try {
      renderForecast(withAddedLine("2026-10"), `/forecast/item/${encodeURIComponent("added:e-1")}`);
      await pickMonthly();
      fireEvent.change(screen.getByRole("textbox", { name: "סכום צפוי" }), { target: { value: "+$800" } });
      fireEvent.click(screen.getByRole("button", { name: "שמירת השינוי בצפי" }));
      fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
      await waitFor(() => { expect(sent()).toContainEqual(["set_forecast_item", { reset: true }]); });
      expect(rpc).not.toHaveBeenCalledWith("undo_project_forecast", expect.anything());
      answer({ data: { undo: { drop: ["e-9"], put: [] } }, error: null });
      await waitFor(() => { expect(sent().at(-1)).toEqual(["undo_project_forecast", { drop: ["e-9"], put: [] }]); });
      expect(sent().filter(([name]) => name === "undo_project_forecast")).toHaveLength(1);
    } finally {
      rpc.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    }
  });

  it("says a failed pace write failed, and sends no undo for it: the ביטול undid the amount only (FLOW-1018)", async () => {
    rpc.mockClear();
    let answer: (value: { data: unknown; error: unknown }) => void = () => undefined;
    paceAnswers(() => new Promise((resolve) => { answer = resolve; }));
    try {
      renderForecast(withAddedLine("2026-10"), `/forecast/item/${encodeURIComponent("added:e-1")}`);
      await pickMonthly();
      fireEvent.change(screen.getByRole("textbox", { name: "סכום צפוי" }), { target: { value: "+$800" } });
      fireEvent.click(screen.getByRole("button", { name: "שמירת השינוי בצפי" }));
      fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
      await waitFor(() => { expect(sent()).toContainEqual(["set_forecast_item", { reset: true }]); });
      answer({ data: null, error: { message: "boom" } });
      expect(await screen.findByText("לא הצלחנו לעדכן את הצפי")).toBeInTheDocument();
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      expect(rpc).not.toHaveBeenCalledWith("undo_project_forecast", expect.anything());
    } finally {
      rpc.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    }
  });

  it("says so when the pace write fails after the save: the failure replaces הצפי עודכן (FLOW-1018)", async () => {
    rpc.mockClear();
    paceAnswers(() => Promise.resolve({ data: null, error: { message: "boom" } }));
    try {
      renderForecast(withAddedLine("2026-10"), `/forecast/item/${encodeURIComponent("added:e-1")}`);
      await pickMonthly();
      fireEvent.change(screen.getByRole("textbox", { name: "סכום צפוי" }), { target: { value: "+$800" } });
      fireEvent.click(screen.getByRole("button", { name: "שמירת השינוי בצפי" }));
      expect(await screen.findByText("לא הצלחנו לעדכן את הצפי")).toBeInTheDocument();
      expect(sent()).toEqual([["set_forecast_item", { amount_minor: 80_000, due_on: "2026-10-31", moved_out: false }]]);
      expect(rpc).not.toHaveBeenCalledWith("undo_project_forecast", expect.anything());
    } finally {
      rpc.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    }
  });

  it("keeps a pace pick alone on its own toast, whose ביטול undoes the pace (FLOW-1018)", async () => {
    rpc.mockClear();
    paceAnswers();
    try {
      renderForecast(withAddedLine("2026-10"), `/forecast/item/${encodeURIComponent("added:e-1")}`);
      await pickMonthly();
      fireEvent.click(screen.getByRole("button", { name: "שמירת השינוי בצפי" }));
      await screen.findByText("הכנסות שכירות: כל חודש");
      expect(screen.queryByText("הצפי עודכן")).toBeNull();
      rpc.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
      await waitFor(() => { expect(sent()).toEqual([["undo_project_forecast", { drop: ["e-9"], put: [] }]]); });
    } finally {
      rpc.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    }
  });

  it("keeps an amount change alone on הצפי עודכן, whose ביטול undoes only the amount (FLOW-1018)", async () => {
    rpc.mockClear();
    renderForecast(withAddedLine("2026-10"), `/forecast/item/${encodeURIComponent("added:e-1")}`);
    fireEvent.change(await screen.findByRole("textbox", { name: "סכום צפוי" }), { target: { value: "+$800" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירת השינוי בצפי" }));
    await screen.findByText("הצפי עודכן");
    await waitFor(() => { expect(sent()).toEqual([["set_forecast_item", { amount_minor: 80_000, due_on: "2026-10-31", moved_out: false }]]); });
    rpc.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(sent()).toEqual([["set_forecast_item", { reset: true }]]); });
  });

  it("a save that moves the line out with a pace pick: one toast, whose ביטול undoes the move, then the pace (FLOW-1018)", async () => {
    rpc.mockClear();
    paceAnswers();
    try {
      renderForecast(withAddedLine("2026-10"), `/forecast/item/${encodeURIComponent("added:e-1")}`);
      await pickMonthly();
      fireEvent.click(screen.getByRole("button", { name: /^מתי צפוי:/ }));
      fireEvent.click(await screen.findByRole("radio", { name: /^לא החודש/ }));
      await sheetGone();
      fireEvent.click(screen.getByRole("button", { name: "שמירת השינוי בצפי" }));
      await screen.findByText(/^הכנסות שכירות הוצא מהצפי של /);
      await waitFor(() => { expect(sent()).toEqual([["set_forecast_item", { moved_out: true }]]); });
      expect(screen.queryByText("הכנסות שכירות: כל חודש")).toBeNull();
      expect(screen.getAllByRole("button", { name: "ביטול" })).toHaveLength(1);
      rpc.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
      await waitFor(() => {
        expect(sent()).toEqual([
          ["set_forecast_item", { reset: true }],
          ["undo_project_forecast", { drop: ["e-9"], put: [] }],
        ]);
      });
    } finally {
      rpc.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    }
  });

  it("writes nothing for a pace pick the page leaves without saving (FLOW-1012)", async () => {
    rpc.mockClear();
    renderForecast(withAddedLine("2026-10"), `/forecast/item/${encodeURIComponent("added:e-1")}`);
    await pickMonthly();
    fireEvent.click(screen.getByRole("button", { name: "חזרה לתזרים צפוי" }));
    await waitFor(() => { expect(screen.getByTestId("where")).toHaveTextContent(/^\/forecast$/); });
    expect(rpc).not.toHaveBeenCalledWith("set_project_forecast_edit", expect.anything());
  });

  it("names an added line as a thing: שורה בצפי (FLOW-1013)", async () => {
    renderForecast(withAddedLine("2026-10"), `/forecast/item/${encodeURIComponent("added:e-1")}`);
    expect(await screen.findByText("אוקטובר · הכנסה · שורה בצפי")).toBeInTheDocument();
  });

  it("shows the pace of a line added in an earlier month, and opens the project's forecast to change it", async () => {
    renderForecast(withAddedLine("2026-09"), `/forecast/item/${encodeURIComponent("added:e-1")}`);
    const row = await screen.findByRole("link", { name: "כל כמה זמן: פעם אחת" });
    expect(row).toHaveAttribute("href", "/projects/p-green/profit/next");
  });

  it("shows a recurring charge's pace and opens the charge, where it is set", async () => {
    const sample = board();
    const charge = sample.data.build.items.find((item) => item.kind === "recurring");
    if (charge == null) throw new Error("no recurring item");
    renderForecast(sample, `/forecast/item/${encodeURIComponent(charge.key)}`);
    const row = await screen.findByRole("link", { name: "כל כמה זמן: כל חודש" });
    expect(row.getAttribute("href")).toMatch(/^\/recurring\//);
  });

  it("has no pace row on an invoice", async () => {
    const sample = board();
    const invoice = sample.data.build.items.find((item) => item.kind === "invoice");
    if (invoice == null) throw new Error("no invoice");
    renderForecast(sample, `/forecast/item/${encodeURIComponent(invoice.key)}`);
    await screen.findByRole("button", { name: /^מתי צפוי/ });
    expect(screen.queryByRole("link", { name: /^כל כמה זמן/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^כל כמה זמן/ })).toBeNull();
  });
});
