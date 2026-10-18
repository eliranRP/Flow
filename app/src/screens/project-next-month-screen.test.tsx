import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JUNIPER_NEXT, JUNIPER_NEXT_EDITED } from "../dev/project-next-month-sample";
import { JUNIPER_PROFIT } from "../dev/project-profit-sample";
import type { NextMonthSample } from "../project-next-month-query";
import { renderWithProviders } from "../test-render";
import { ProjectNextMonthScreen } from "./project-next-month-screen";
import { ProjectProfitScreen, type ProjectProfitSample } from "./project-profit-screen";

const rpc = vi.hoisted(() => vi.fn((_name: string, _args?: unknown) => Promise.resolve<{ data: unknown; error: null }>({ data: null, error: null })));
vi.mock("../lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));

// Lets one test stand for a project whose forecast has nothing to read; the others read the sample.
const noForecast = vi.hoisted(() => ({ on: false }));
vi.mock("../project-next-month-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../project-next-month-query")>();
  return {
    ...actual,
    useNextMonthForecast: (...args: Parameters<typeof actual.useNextMonthForecast>) => {
      const result = actual.useNextMonthForecast(...args);
      return noForecast.on ? { ...result, forecast: null } : result;
    },
  };
});

afterEach(() => {
  noForecast.on = false;
  rpc.mockClear();
});

function renderProfit(sample: ProjectProfitSample, path = "/projects/juniper-ct/profit") {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId/profit" element={<ProjectProfitScreen sample={sample} />} />
    </Routes>,
    { route: path },
  );
}

function renderNext(next: NextMonthSample = JUNIPER_NEXT) {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId/profit/next" element={<ProjectNextMonthScreen sample={{ ...JUNIPER_PROFIT, next }} />} />
    </Routes>,
    { route: "/projects/juniper-ct/profit/next" },
  );
}

describe("the next-month card on the project's profit page", () => {
  it("shows November's net, its totals and basis, and links to the next-month page", () => {
    renderProfit(JUNIPER_PROFIT);
    const card = screen.getByRole("link", { name: /^צפי נובמבר/ });
    expect(card.getAttribute("href")).toBe("/projects/juniper-ct/profit/next");
    expect(card.textContent).toContain("+$2,285");
    expect(within(card).getByText("הכנסות $4,150 · הוצאות $1,865")).toBeTruthy();
    expect(within(card).getByText("2 קבועים ו־4 ממוצעים")).toBeTruthy();
    expect(within(card).getByText("צפי")).toBeTruthy();
  });

  it("says a loss once, with the amount after the word", () => {
    const loss = { ...JUNIPER_NEXT, expected: { ...JUNIPER_NEXT.expected, recurring: JUNIPER_NEXT.expected.recurring.filter((party) => party.direction === "expense") } };
    renderProfit({ ...JUNIPER_PROFIT, next: loss });
    expect(screen.getByRole("link", { name: "צפי נובמבר, הפסד $1,865" })).toBeTruthy();
  });

  it("counts the user's edits in its basis and its figures", () => {
    renderProfit({ ...JUNIPER_PROFIT, next: JUNIPER_NEXT_EDITED });
    const card = screen.getByRole("link", { name: /^צפי נובמבר/ });
    expect(card.textContent).toContain("+$1,185");
    expect(within(card).getByText("2 קבועים ו־3 ממוצעים · ערכת 3")).toBeTruthy();
  });

  it("sits above the month rows", () => {
    const { container } = renderProfit(JUNIPER_PROFIT);
    const card = container.querySelector(".ui-pn-card");
    const months = container.querySelector(".ui-pp-months");
    expect(card).not.toBeNull();
    expect(months).not.toBeNull();
    expect(card?.compareDocumentPosition(months as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("is hidden when the project expects nothing next month", () => {
    const empty = { ...JUNIPER_NEXT, expected: { ...JUNIPER_NEXT.expected, recurring: [] }, categoryMonths: null };
    const { container } = renderProfit({ ...JUNIPER_PROFIT, next: empty });
    expect(container.querySelector(".ui-pn-card")).toBeNull();
    expect(container.querySelector(".ui-pp-months")).not.toBeNull();
  });

  it("is hidden in the by-category order", () => {
    const { container } = renderProfit(JUNIPER_PROFIT, "/projects/juniper-ct/profit?by=category");
    expect(container.querySelector(".ui-pn-card")).toBeNull();
  });
});

describe("ProjectNextMonthScreen", () => {
  it("names the month, the project and the count, with Back to the project's profit", () => {
    renderNext();
    expect(screen.getByRole("heading", { name: "צפי נובמבר" })).toBeTruthy();
    expect(screen.getByText("Juniper Ct · עוד לא התחיל · 6 צפויות")).toBeTruthy();
    expect(screen.getByRole("button", { name: "חזרה לרווח Juniper Ct" })).toBeTruthy();
  });

  it("adds the summary card up: expected income and expenses, the monthly share and the profit after it", () => {
    const { container } = renderNext();
    const rows = Array.from(container.querySelectorAll(".ui-pp-row")).map((row) => row.textContent);
    expect(rows).toEqual([
      "הכנסות צפויות+$4,150",
      "הוצאות צפויות$1,865",
      "חלק בהוצאות הכלליות$152",
      "רווח אחרי הוצאות כלליות$2,133",
    ]);
    expect(container.querySelector(".ui-pp-figure")?.textContent).toBe("+$2,285");
    expect(screen.getByText("לפי הקבועים של הנכס וממוצע 6 החודשים האחרונים לכל קטגוריה. נגיעה בשורה משנה אותה או מסירה אותה.")).toBeTruthy();
  });

  it("lists the recurring rows by day and the averages last, each opening its edit page, with no chips", () => {
    const { container } = renderNext();
    const rows = Array.from(container.querySelectorAll(".ui-pn-rows .ui-row"));
    expect(rows.map((row) => row.querySelector(".ui-row-title")?.textContent)).toEqual([
      "M. Ortiz",
      "S. Kim",
      "ריבית הלוואות",
      "תיקונים ותחזוקה",
      "מסים וביטוח",
      "חשמל ומים",
    ]);
    expect(rows[0]?.textContent).toContain("צפוי 01/11 · קבוע");
    expect(rows[0]?.textContent).toContain("+$1,850");
    // The servicer's whole payment (principal included) is not a row: its interest and escrow are.
    expect(rows[2]?.textContent).toContain("ממוצע 6 חודשים");
    expect(rows[2]?.textContent).toContain("−$1,180");
    expect(rows[3]?.textContent).toContain("−$310");
    expect(rows[4]?.textContent).toContain("−$280");
    expect(rows[5]?.textContent).toContain("−$95");
    expect(screen.queryByText("Northgate Mortgage")).toBeNull();
    expect(screen.queryByRole("group", { name: "סידור" })).toBeNull();
    // A tap on a row opens its edit page, the row's key in the path.
    expect(rows.every((row) => row.tagName === "A")).toBe(true);
    expect(rows[3]?.getAttribute("href")).toBe("/projects/juniper-ct/profit/next/edit/avg%3Arepairs");
    expect(screen.getByRole("link", { name: "הוספת קטגוריה לצפי" }).getAttribute("href")).toBe("/projects/juniper-ct/profit/next/add");
    // With no edit, nothing to restore and nothing to reset.
    expect(screen.queryByText(/^הוסרו מהצפי/)).toBeNull();
    expect(screen.queryByRole("button", { name: "חזרה לצפי של Flow" })).toBeNull();
  });

  it("marks a changed row and an added line, and lists a removed row under the rows", () => {
    const { container } = renderNext(JUNIPER_NEXT_EDITED);
    expect(screen.getByText("Juniper Ct · עוד לא התחיל · 6 צפויות")).toBeTruthy();
    expect(container.querySelector(".ui-pp-figure")?.textContent).toBe("+$1,185");
    const rows = Array.from(container.querySelectorAll(".ui-pn-rows .ui-row"));
    const repairs = rows.find((row) => row.textContent.includes("תיקונים ותחזוקה"));
    expect(repairs?.textContent).toContain("−$1,200");
    expect(repairs?.querySelector(".ui-pn-edited")?.textContent).toBe("שינית · היה $310");
    const added = rows.at(-1);
    expect(added?.querySelector(".ui-row-title")?.textContent).toBe("ניהול נכס");
    expect(added?.querySelector(".ui-pn-edited")?.textContent).toBe("הוספת · כל חודש");
    expect(added?.getAttribute("href")).toBe("/projects/juniper-ct/profit/next/edit/add%3Ae-mgmt");
    const off = screen.getByRole("region", { name: "הוסרו מהצפי · 1" });
    expect(within(off).getByText("חשמל ומים")).toBeTruthy();
    expect(off.textContent).toContain("$95 · ממוצע 6 חודשים");
  });

  it("restores a removed row, with an undo", async () => {
    const undo = { drop: [], put: [{ id: "e-power", kind: "remove", row_key: "avg:power", category_id: null, direction: null, amount_minor: null, pace: "once", start_month: "2026-11" }] };
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "restore_project_forecast_row" ? { removed: 1, undo } : null, error: null }));
    renderNext(JUNIPER_NEXT_EDITED);
    fireEvent.click(screen.getByRole("button", { name: "החזרה לצפי: חשמל ומים" }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith("restore_project_forecast_row", { p_project_id: "juniper-ct", p_month: "2026-11", p_row_key: "avg:power" }); });
    expect(await screen.findByText("הוחזר לצפי: חשמל ומים")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith("undo_project_forecast", { p_project_id: "juniper-ct", p_undo: undo }); });
  });

  it("goes back to Flow's forecast: every edit of the project, with an undo", async () => {
    const undo = { drop: [], put: JUNIPER_NEXT_EDITED.edits };
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "reset_project_forecast" ? { removed: 3, undo } : null, error: null }));
    renderNext(JUNIPER_NEXT_EDITED);
    fireEvent.click(screen.getByRole("button", { name: "חזרה לצפי של Flow" }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith("reset_project_forecast", { p_project_id: "juniper-ct" }); });
    expect(await screen.findByText("חזרת לצפי של Flow")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith("undo_project_forecast", { p_project_id: "juniper-ct", p_undo: undo }); });
  });

  it("says there is not enough to forecast when it has nothing to read", () => {
    noForecast.on = true;
    renderNext();
    expect(screen.getByRole("heading", { name: "צפי" })).toBeTruthy();
    expect(screen.getByText("אין עדיין מספיק נתונים לצפי")).toBeTruthy();
  });
});
