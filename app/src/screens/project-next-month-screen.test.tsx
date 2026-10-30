import { formatAmountText } from "@flow/shared";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JUNIPER_NEXT, JUNIPER_NEXT_EDITED, JUNIPER_NEXT_LOAN } from "../dev/project-next-month-sample";
import { JUNIPER_PROFIT } from "../dev/project-profit-sample";
import type { ForecastLoan } from "../project-next-loans";
import type { NextMonthSample } from "../project-next-month-query";
import { applyForecastEdits, cashForecast, nextMonthForecast } from "../project-next-month";
import { renderWithProviders } from "../test-render";
import { loanOutlook } from "./loan-outlook";
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

describe("the next-month card and chart on the project's profit page (spec-fcwide)", () => {
  it("shows November's two figures with their captions and the net in grey, and opens the next-month page", () => {
    const { container } = renderProfit(JUNIPER_PROFIT);
    const card = screen.getByRole("link", { name: /^צפי נובמבר/ });
    expect(card.getAttribute("href")).toBe("/projects/juniper-ct/profit/next");
    expect(card.getAttribute("aria-label")).toBe("צפי נובמבר: הכנסות צפויות $4,150, הוצאות צפויות $1,865, רווח צפוי +$2,285 – פירוט ועריכה");
    expect(within(card).getByText("צפי")).toBeTruthy();
    expect(within(card).getByText("פירוט ועריכה")).toBeTruthy();
    expect(within(card).getByText("2 שכירויות קבועות")).toBeTruthy();
    expect(within(card).getByText("מול $1,740 בספטמבר")).toBeTruthy();
    const net = container.querySelector(".ui-fc-net");
    expect(net?.textContent).toBe("רווח צפוי+$2,285");
    expect(net?.querySelector(".ui-income")).toBeNull();
    expect(container.querySelector(".ui-fc-col .ui-income")?.textContent).toBe("+$4,150");
  });

  it("draws income as a grey $0 when none is expected, and a loss with its minus", () => {
    const loss = { ...JUNIPER_NEXT, expected: { ...JUNIPER_NEXT.expected, recurring: JUNIPER_NEXT.expected.recurring.filter((party) => party.direction === "expense") } };
    const { container } = renderProfit({ ...JUNIPER_PROFIT, next: loss });
    const zero = container.querySelector(".ui-fc-col-zero");
    expect(zero?.textContent).toBe("הכנסות צפויות$0אין הכנסה צפויה");
    expect(zero?.querySelector(".ui-income")).toBeNull();
    expect(container.querySelector(".ui-fc-net")?.textContent).toBe("רווח צפוי−$1,865");
  });

  it("counts the user's edits in its figures", () => {
    const { container } = renderProfit({ ...JUNIPER_PROFIT, next: JUNIPER_NEXT_EDITED });
    expect(container.querySelector(".ui-fc-net")?.textContent).toBe("רווח צפוי+$1,185");
  });

  it("charts May to October with November's forecast last, under the card and above the month rows", () => {
    const { container } = renderProfit(JUNIPER_PROFIT);
    const chart = screen.getByRole("img", { name: /^הכנסות והוצאות לפי חודש, מאי עד אוקטובר\. מאי: .*\. צפי נובמבר: הכנסות \$4,150, הוצאות \$1,865$/ });
    const labels = Array.from(chart.querySelectorAll(".ui-fc-bar-label")).map((label) => label.textContent);
    expect(labels).toEqual(["מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳ · צפי"]);
    expect(chart.querySelectorAll(".ui-fc-ahead")).toHaveLength(1);
    expect(screen.getByText("הכנסות והוצאות לפי חודש · מאי עד אוקטובר וצפי")).toBeTruthy();
    // October to date (+$6,302) is the tallest bar; November's expenses ($1,865) on the same scale.
    const october = chart.children[5] as HTMLElement;
    expect((october.querySelector(".ui-fc-bar-in") as HTMLElement).style.blockSize).toBe("108px");
    expect((chart.children[6]?.querySelector(".ui-fc-bar-out") as HTMLElement).style.blockSize).toBe("32px");
    const card = container.querySelector(".ui-fc-card");
    const months = container.querySelector(".ui-pp-months");
    expect(card?.compareDocumentPosition(chart)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(chart.compareDocumentPosition(months as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("hides the card when the project expects nothing next month, and keeps the chart", () => {
    const empty = { ...JUNIPER_NEXT, expected: { ...JUNIPER_NEXT.expected, recurring: [] }, categoryMonths: null };
    const { container } = renderProfit({ ...JUNIPER_PROFIT, next: empty });
    expect(container.querySelector(".ui-fc-card")).toBeNull();
    expect(screen.getByRole("img", { name: /^הכנסות והוצאות לפי חודש/ })).toBeTruthy();
    expect(container.querySelector(".ui-pp-months")).not.toBeNull();
  });

  it("is hidden in the by-category order", () => {
    const { container } = renderProfit(JUNIPER_PROFIT, "/projects/juniper-ct/profit?by=category");
    expect(container.querySelector(".ui-fc-card")).toBeNull();
    expect(screen.queryByRole("img", { name: /^הכנסות והוצאות לפי חודש/ })).toBeNull();
  });
});

describe("ProjectNextMonthScreen", () => {
  it("names the month, the project and the count, with Back to the project's profit", () => {
    renderNext();
    expect(screen.getByRole("heading", { name: "צפי נובמבר" })).toBeTruthy();
    expect(screen.getByText("Juniper Ct · עוד לא התחיל · 6 צפויות")).toBeTruthy();
    expect(screen.getByRole("button", { name: "חזרה לרווח Juniper Ct" })).toBeTruthy();
  });

  it("adds the summary card up: expected in and out, the monthly share and the profit after it", () => {
    const { container } = renderNext();
    const rows = Array.from(container.querySelectorAll(".ui-pp-row")).map((row) => row.textContent);
    // No loan: cash and profit are the same, so no רווח צפוי row and no לא נספר ברווח row (FLOW-991).
    expect(rows).toEqual([
      "צפוי להיכנס+$4,150",
      "צפוי לצאת$1,865",
      "חלק בהוצאות הכלליות$152",
      "רווח אחרי הוצאות כלליות$2,133",
    ]);
    expect(container.querySelector(".ui-pn-figure-label")?.textContent).toBe("תזרים צפוי");
    expect(container.querySelector(".ui-pp-figure")?.textContent).toBe("+$2,285");
    expect(screen.queryByText("לא נספר ברווח")).toBeNull();
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
    expect(screen.queryByRole("radiogroup", { name: "סידור" })).toBeNull();
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

  it("goes back to Flow's forecast for November: the edits made for that month, with an undo", async () => {
    const undo = { drop: [], put: JUNIPER_NEXT_EDITED.edits };
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "reset_project_forecast" ? { removed: 3, undo } : null, error: null }));
    renderNext(JUNIPER_NEXT_EDITED);
    fireEvent.click(screen.getByRole("button", { name: "חזרה לצפי של Flow" }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith("reset_project_forecast", { p_project_id: "juniper-ct", p_month: "2026-11" }); });
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

describe("the next-month page with a loan (decision 0190)", () => {
  it("shows the loan's interest and escrow from its schedule, under לפי ההלוואה, and says so in the note", () => {
    const { container } = renderNext(JUNIPER_NEXT_LOAN);
    const rows = Array.from(container.querySelectorAll(".ui-pn-rows .ui-row"));
    expect(rows.map((row) => row.querySelector(".ui-row-title")?.textContent)).toEqual([
      "M. Ortiz",
      "S. Kim",
      "ריבית הלוואות",
      "מסים וביטוח",
      "תיקונים ותחזוקה",
      "חשמל ומים",
      "לא נספר ברווח",
    ]);
    expect(rows[2]?.textContent).toContain("לפי ההלוואה");
    const next = loanOutlook(JUNIPER_NEXT_LOAN.loans?.[0] as ForecastLoan, JUNIPER_NEXT_LOAN.today)?.next;
    expect(next?.dueDate).toBe("2026-11-01");
    expect(rows[2]?.textContent).toContain(`−${formatAmountText(next?.interestMinor ?? 0n, "USD")}`);
    expect(rows[3]?.textContent).toContain("לפי ההלוואה");
    expect(rows[3]?.textContent).toContain(`−${formatAmountText(next?.escrowMinor ?? 0n, "USD")}`);
    expect(rows[4]?.textContent).toContain("ממוצע 3 חודשים");
    expect(screen.getByText("לפי הקבועים של הנכס, לוח ההלוואה וממוצע 6 החודשים האחרונים לכל קטגוריה. נגיעה בשורה משנה אותה או מסירה אותה.")).toBeTruthy();
  });

  it("FLOW-991: leads with the cash and names the profit, so each card that opens it finds its number", () => {
    const forecast = applyForecastEdits(nextMonthForecast({
      projectId: JUNIPER_PROFIT.project.id,
      currency: "USD",
      today: JUNIPER_NEXT_LOAN.today,
      recurring: JUNIPER_NEXT_LOAN.expected.recurring,
      categoryMonths: JUNIPER_NEXT_LOAN.categoryMonths,
      loans: JUNIPER_NEXT_LOAN.loans ?? [],
      categories: JUNIPER_NEXT_LOAN.categories ?? [],
    }), JUNIPER_NEXT_LOAN.edits ?? []);
    const cash = cashForecast(forecast);
    expect(forecast.cashOnlyMinor > 0n).toBe(true);
    const { container, unmount } = renderNext(JUNIPER_NEXT_LOAN);
    const rows = Array.from(container.querySelectorAll(".ui-pp-row")).map((row) => row.textContent);
    // The headline is the project page card's cash; the רווח צפוי row is the profit page card's net.
    expect(container.querySelector(".ui-pp-figure")?.textContent).toBe(formatAmountText(cash.netMinor, "USD", { plus: cash.netMinor > 0n, direction: cash.netMinor > 0n ? "income" : undefined }));
    expect(rows[1]).toBe(`צפוי לצאת${formatAmountText(cash.expenseMinor, "USD")}`);
    expect(rows[2]).toBe(`רווח צפוי${formatAmountText(forecast.netMinor, "USD", { plus: forecast.netMinor > 0n, direction: forecast.netMinor > 0n ? "income" : undefined })}`);
    // The rows add up to the headline: the profit's rows and the one row the profit leaves out.
    const kept = Array.from(container.querySelectorAll(".ui-pn-rows .ui-row")).at(-1);
    expect(kept?.textContent).toContain("לא נספר ברווח");
    expect(kept?.textContent).toContain(`−${formatAmountText(forecast.cashOnlyMinor, "USD")}`);
    unmount();
    renderProfit({ ...JUNIPER_PROFIT, next: JUNIPER_NEXT_LOAN });
    const card = screen.getByRole("link", { name: /^צפי נובמבר/ });
    const figures = Array.from(card.querySelectorAll(".ui-fc-col > .ui-num")).map((figure) => figure.textContent);
    expect(`צפוי להיכנס${figures[0] ?? ""}`).toBe(rows[0]);
    expect(card.querySelector(".ui-fc-net > .ui-num")?.textContent).toBe(rows[2]?.replace("רווח צפוי", ""));
  });
});
