import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JUNIPER_NEXT, JUNIPER_NEXT_EDITED, JUNIPER_NEXT_LOAN, JUNIPER_NEXT_SECOND_RENT } from "../dev/project-next-month-sample";
import { JUNIPER_PROFIT } from "../dev/project-profit-sample";
import type { ForecastLoan } from "../project-next-loans";
import { draftOf } from "../project-next-edit";
import { renderWithProviders } from "../test-render";
import { loanOutlook } from "./loan-outlook";
import { ProjectNextEditScreen, type ProjectNextEditSample } from "./project-next-edit-screen";

const rpc = vi.hoisted(() => vi.fn((_name: string, _args?: unknown) => Promise.resolve<{ data: unknown; error: null }>({ data: null, error: null })));
vi.mock("../lib/supabase", () => ({ getSupabase: () => ({ rpc }) }));

afterEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(() => Promise.resolve({ data: null, error: null }));
});

const UNDO = { drop: ["new-edit"], put: [] };

function renderEdit(preset: Partial<ProjectNextEditSample> = {}, add = false, query = "") {
  const sample: ProjectNextEditSample = { ...JUNIPER_PROFIT, next: JUNIPER_NEXT, ...preset };
  const path = add ? `/projects/juniper-ct/profit/next/add${query}` : `/projects/juniper-ct/profit/next/edit/x${query}`;
  return renderWithProviders(
    <Routes>
      <Route path="/forecast" element={<p>the month-end forecast</p>} />
      <Route path="/recurring" element={<p>the recurring list</p>} />
      <Route path="/projects/:projectId/profit/next" element={<p>the forecast page</p>} />
      <Route path="/projects/:projectId/profit/next/add" element={<ProjectNextEditScreen add sample={sample} />} />
      <Route path="/projects/:projectId/profit/next/edit/:rowKey" element={<ProjectNextEditScreen sample={sample} />} />
    </Routes>,
    { route: path },
  );
}

function amountField() {
  return screen.getByRole("textbox", { name: "סכום צפוי" });
}

describe("ProjectNextEditScreen, a row's edit page", () => {
  it("shows the row: its pill, name, amount, meta, project and category, pace and its months in the project", () => {
    renderEdit({ rowKey: "avg:repairs" });
    expect(screen.getByText("צפי · נובמבר")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "תיקונים ותחזוקה" })).toBeTruthy();
    expect(amountField()).toHaveValue("310");
    expect(screen.getByText("נובמבר · הוצאה · ממוצע 6 חודשים")).toBeTruthy();
    expect(screen.getByText("Juniper Ct")).toBeTruthy();
    // The forecast has nothing by category, so a row's category is a fact, not a control.
    expect(screen.queryByRole("button", { name: /^קטגוריה/ })).toBeNull();
    expect(screen.getByRole("button", { name: "כל כמה זמן: פעם אחת" })).toBeTruthy();
    expect(screen.getByText("רק בצפי של נובמבר")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "בפרויקט, 5 החודשים האחרונים" })).toBeTruthy();
    expect(screen.getByText("כמו הרגיל")).toBeTruthy();
    expect(screen.getByText("Flow ממשיך ללמוד מהתנועות. השינוי שלך גובר על הממוצע.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "הסרה מהצפי" })).toBeTruthy();
  });

  it("saves a new amount for November, goes back with a toast, and undoes it", async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "set_project_forecast_edit" ? { edit: {}, undo: UNDO } : null, error: null }));
    renderEdit({ rowKey: "avg:repairs" });
    fireEvent.change(amountField(), { target: { value: "1200" } });
    expect(amountField()).toHaveValue("1,200");
    expect(screen.getByText("גבוה ב־$890")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("set_project_forecast_edit", {
        p_project_id: "juniper-ct",
        p_month: "2026-11",
        p_edit: { row_key: "avg:repairs", amount_minor: 120_000, pace: "once" },
      });
    });
    expect(await screen.findByText("the forecast page")).toBeTruthy();
    expect(screen.getByText("עודכן לנובמבר: תיקונים ותחזוקה")).toBeTruthy();
    // FLOW-969 (decision 0219): the toast hangs under the header.
    expect(screen.getByText("עודכן לנובמבר: תיקונים ותחזוקה").closest<HTMLElement>("[data-place]")?.dataset.place).toBe("top");
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith("undo_project_forecast", { p_project_id: "juniper-ct", p_undo: UNDO }); });
  });

  it("picks a pace in כל כמה זמן, the next month counted from November, and saves on it", async () => {
    renderEdit({ rowKey: "avg:repairs" });
    fireEvent.click(screen.getByRole("button", { name: "כל כמה זמן: פעם אחת" }));
    const sheet = await screen.findByRole("dialog", { name: "כל כמה זמן" });
    expect(within(sheet).getByText("לא יחזור בצפי של החודשים הבאים")).toBeTruthy();
    expect(within(sheet).getByText("הבא בדצמבר")).toBeTruthy();
    expect(within(sheet).getByText("הבא בינואר")).toBeTruthy();
    expect(within(sheet).getByText("הבא בנובמבר 2027")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("radio", { name: /כל רבעון/ }));
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "כל כמה זמן" })).toBeNull(); });
    expect(screen.getByRole("button", { name: "כל כמה זמן: כל רבעון" })).toBeTruthy();
    expect(screen.getByText("הוצאה קבועה בצפי")).toBeTruthy();
    expect(screen.getByText("מנובמבר · הבא בפברואר")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("set_project_forecast_edit", expect.objectContaining({ p_edit: { row_key: "avg:repairs", amount_minor: 31_000, pace: "quarter" } }));
    });
    expect(await screen.findByText("עודכן כל רבעון: תיקונים ותחזוקה")).toBeTruthy();
  });

  it("says a recurring charge itself does not change, and has no months of income to show", () => {
    renderEdit({ rowKey: "rec:income:c-kim" });
    expect(screen.getByRole("heading", { level: 1, name: "S. Kim" })).toBeTruthy();
    expect(amountField()).toHaveValue("2,300");
    expect(screen.getByText("צפוי 03/11 · הכנסה · קבוע")).toBeTruthy();
    expect(screen.getByText("שכירות")).toBeTruthy();
    expect(screen.getByText("אין תנועות בקטגוריה הזו בפרויקט ב־6 החודשים האחרונים.")).toBeTruthy();
    expect(screen.getByText("הקבוע עצמו לא משתנה. זה משנה רק את הצפי של הפרויקט.")).toBeTruthy();
  });

  it("takes the row out of the forecast, with a toast", async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "remove_project_forecast_row" ? { edit: {}, undo: UNDO } : null, error: null }));
    renderEdit({ rowKey: "avg:power" });
    fireEvent.click(screen.getByRole("button", { name: "הסרה מהצפי" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("remove_project_forecast_row", { p_project_id: "juniper-ct", p_month: "2026-11", p_row_key: "avg:power" });
    });
    expect(await screen.findByText("הוסר מהצפי מנובמבר והלאה: חשמל ומים")).toBeTruthy();
    // FLOW-969: the removal can be taken back, from under the header, and its ביטול sends the undo.
    expect(screen.getByText("הוסר מהצפי מנובמבר והלאה: חשמל ומים").closest<HTMLElement>("[data-place]")?.dataset.place).toBe("top");
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith("undo_project_forecast", { p_project_id: "juniper-ct", p_undo: UNDO }); });
  });

  it("leaves for the forecast page at once, before the server answers (decision 0219)", () => {
    rpc.mockImplementation(() => new Promise(() => undefined));
    renderEdit({ rowKey: "avg:power" });
    fireEvent.click(screen.getByRole("button", { name: "הסרה מהצפי" }));
    expect(screen.getByText("the forecast page")).toBeTruthy();
  });

  it("says so when the row is no longer in the forecast", () => {
    renderEdit({ rowKey: "avg:gone" });
    expect(screen.getByText("השורה הזו כבר לא בצפי.")).toBeTruthy();
  });
});

describe("ProjectNextEditScreen, a new line", () => {
  it("needs a category first: save opens the category sheet and writes nothing", async () => {
    renderEdit({}, true);
    expect(screen.getByText("חדש בצפי · נובמבר")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "שורה חדשה בצפי" })).toBeTruthy();
    expect(screen.getByText("נובמבר · הוצאה · נוסף על ידך")).toBeTruthy();
    expect(screen.getByRole("button", { name: "קטגוריה בחרו קטגוריה" })).toBeTruthy();
    expect(screen.getByText("בחרו קטגוריה כדי לראות את התנועות הקודמות שלה בפרויקט.")).toBeTruthy();
    expect(screen.getByText("השורה נכנסת לצפי של Juniper Ct בלבד. לא נוצרת תנועה.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "הסרה מהצפי" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "הוספה לצפי" }));
    const sheet = await screen.findByRole("dialog", { name: "קטגוריה" });
    expect(within(sheet).getByText("בצפי של Juniper Ct • נובמבר")).toBeTruthy();
    expect(rpc).not.toHaveBeenCalledWith("set_project_forecast_edit", expect.anything());
  });

  it("offers the project's categories with their hints, the rest after, and adds the picked one", async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "set_project_forecast_edit" ? { edit: {}, undo: UNDO } : null, error: null }));
    renderEdit({}, true);
    fireEvent.click(screen.getByRole("button", { name: "קטגוריה בחרו קטגוריה" }));
    const sheet = await screen.findByRole("dialog", { name: "קטגוריה" });
    expect(within(sheet).getByText("מוצעות לפרויקט")).toBeTruthy();
    expect(within(sheet).getByText("כל הקטגוריות")).toBeTruthy();
    expect(within(sheet).getByRole("radio", { name: /ניהול נכס/ }).textContent).toContain("כל חודש · $305");
    // A category the forecast already counts is offered too, and says so (decision 0259).
    expect(within(sheet).getByRole("radio", { name: /תיקונים ותחזוקה/ }).textContent).toContain("כבר בצפי · $310");
    fireEvent.click(within(sheet).getByRole("radio", { name: /ניהול נכס/ }));
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "קטגוריה" })).toBeNull(); });
    expect(screen.getByRole("heading", { level: 1, name: "ניהול נכס" })).toBeTruthy();
    // The line starts at the category's usual month in the project.
    expect(amountField()).toHaveValue("305");
    expect(screen.getByText("כמו הרגיל")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "הוספה לצפי" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("set_project_forecast_edit", {
        p_project_id: "juniper-ct",
        p_month: "2026-11",
        p_edit: { category_id: "property-mgmt", amount_minor: 30_500, pace: "once" },
      });
    });
    expect(await screen.findByText("נוסף לצפי: ניהול נכס")).toBeTruthy();
  });

  it("adds a second line in an income category the forecast already counts: offered with its amount, an income (decision 0259)", async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "set_project_forecast_edit" ? { edit: {}, undo: UNDO } : null, error: null }));
    renderEdit({}, true, "?pace=month");
    fireEvent.click(screen.getByRole("button", { name: "קטגוריה בחרו קטגוריה" }));
    const sheet = await screen.findByRole("dialog", { name: "קטגוריה" });
    // The two tenants' rents are in the forecast: שכירות is still offered, with what the forecast has for it.
    const rent = within(sheet).getByRole("radio", { name: /^שכירות/ });
    expect(rent.textContent).toContain("כבר בצפי · $4,150");
    fireEvent.click(rent);
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "קטגוריה" })).toBeNull(); });
    // Picking it makes the new line an income: the sign, the repeat row and the meta line.
    expect(screen.getByRole("heading", { level: 1, name: "שכירות" })).toBeTruthy();
    expect(screen.getByText("הכנסה קבועה בצפי")).toBeTruthy();
    expect(screen.getByText("נובמבר · הכנסה · נוסף על ידך")).toBeTruthy();
    fireEvent.change(amountField(), { target: { value: "1000" } });
    expect(screen.getByText("+$")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "הוספה לצפי" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("set_project_forecast_edit", {
        p_project_id: "juniper-ct",
        p_month: "2026-11",
        p_edit: { category_id: "rent", amount_minor: 100_000, pace: "month" },
      });
    });
    expect(await screen.findByText("נוסף לצפי: שכירות")).toBeTruthy();
  });

  it("removes the added second line by its own key, leaving the category's other lines (decision 0259)", async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "remove_project_forecast_row" ? { edit: null, undo: UNDO } : null, error: null }));
    renderWithProviders(
      <Routes>
        <Route path="/projects/:projectId/profit/next" element={<p>the forecast page</p>} />
        <Route path="/projects/:projectId/profit/next/edit/:rowKey" element={<ProjectNextEditScreen sample={{ ...JUNIPER_PROFIT, next: JUNIPER_NEXT_SECOND_RENT, rowKey: "add:e-rent-2" }} />} />
      </Routes>,
      { route: "/projects/juniper-ct/profit/next/edit/add:e-rent-2" },
    );
    expect(screen.getByText("נובמבר · הכנסה · הוספת · כל חודש")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "הסרה מהצפי" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("remove_project_forecast_row", { p_project_id: "juniper-ct", p_month: "2026-11", p_row_key: "add:e-rent-2" });
    });
  });

  it("adds a line for this month from the תזרים צפוי screen, and goes back there (FLOW-1006)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T09:00:00Z"));
    try {
      rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "set_project_forecast_edit" ? { edit: {}, undo: UNDO } : null, error: null }));
      renderEdit({ categoryId: "property-mgmt" }, true, "?month=2026-10&back=forecast");
      expect(screen.getByText("רק בצפי של אוקטובר")).toBeTruthy();
      fireEvent.change(amountField(), { target: { value: "171.76" } });
      fireEvent.click(screen.getByRole("button", { name: "הוספה לצפי" }));
      await waitFor(() => {
        expect(rpc).toHaveBeenCalledWith("set_project_forecast_edit", expect.objectContaining({ p_month: "2026-10" }));
      });
      expect(await screen.findByText("the month-end forecast")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("adds a monthly line from קבועים: it starts at כל חודש and goes back there (FLOW-1011)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T09:00:00Z"));
    try {
      rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "set_project_forecast_edit" ? { edit: {}, undo: UNDO } : null, error: null }));
      renderEdit({ categoryId: "property-mgmt" }, true, "?month=2026-10&back=recurring&pace=month");
      expect(screen.getByRole("button", { name: "כל כמה זמן: כל חודש" })).toBeTruthy();
      fireEvent.change(amountField(), { target: { value: "729" } });
      fireEvent.click(screen.getByRole("button", { name: "הוספה לצפי" }));
      await waitFor(() => {
        expect(rpc).toHaveBeenCalledWith("set_project_forecast_edit", expect.objectContaining({ p_month: "2026-10", p_edit: { category_id: "property-mgmt", amount_minor: 72_900, pace: "month" } }));
      });
      expect(await screen.findByText("the recurring list")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a month that has ended, or one past the forecast's", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-20T09:00:00Z"));
    try {
      renderEdit({ categoryId: "property-mgmt" }, true, "?month=2026-09");
      expect(screen.getByText("רק בצפי של נובמבר")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("edits a row of a month after next (?month=) for that month, and goes back to that month's page (FLOW-1066)", async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "set_project_forecast_edit" ? { edit: {}, undo: UNDO } : null, error: null }));
    renderEdit({ rowKey: "avg:repairs" }, false, "?month=2027-03");
    expect(screen.getByText("צפי · מרץ")).toBeTruthy();
    fireEvent.change(amountField(), { target: { value: "400" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("set_project_forecast_edit", {
        p_project_id: "juniper-ct",
        p_month: "2027-03",
        p_edit: { row_key: "avg:repairs", amount_minor: 40_000, pace: "once" },
      });
    });
    expect(await screen.findByText("the forecast page")).toBeTruthy();
  });

  it("adds a line for a month after next, and ignores a month past the forecast's (FLOW-1066)", async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "set_project_forecast_edit" ? { edit: {}, undo: UNDO } : null, error: null }));
    renderEdit({ categoryId: "property-mgmt" }, true, "?month=2027-10");
    expect(screen.getByText("חדש בצפי · אוקטובר")).toBeTruthy();
    fireEvent.change(amountField(), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "הוספה לצפי" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("set_project_forecast_edit", expect.objectContaining({ p_month: "2027-10" }));
    });
  });

  it("keeps next month for a month past the forecast", () => {
    renderEdit({ categoryId: "property-mgmt" }, true, "?month=2027-11");
    expect(screen.getByText("חדש בצפי · נובמבר")).toBeTruthy();
  });

  it("asks for an amount when the picked category has no usual month", async () => {
    renderEdit({ categoryId: "c-3" }, true);
    expect(screen.getByRole("heading", { level: 1, name: "גז" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "הוספה לצפי" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("כתבו סכום");
    expect(rpc).not.toHaveBeenCalledWith("set_project_forecast_edit", expect.anything());
  });

  it("searches the categories, and creates one the company lacks and picks it", async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "create_category" ? "new-category" : null, error: null }));
    renderEdit({ sheet: "category" }, true);
    const sheet = await screen.findByRole("dialog", { name: "קטגוריה" });
    const search = within(sheet).getByRole("searchbox", { name: "חיפוש קטגוריה" });
    fireEvent.change(search, { target: { value: "ביטוח" } });
    expect(within(sheet).getByText("תוצאות")).toBeTruthy();
    expect(within(sheet).getAllByRole("radio").map((radio) => radio.querySelector(".ui-fe-choice-name")?.textContent)).toEqual(["ביטוח", "מסים וביטוח", "ביטוח עסק", "החזר ביטוח"]);
    fireEvent.change(search, { target: { value: "שמירה" } });
    expect(within(sheet).getByText('אין קטגוריה בשם "שמירה"')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: '+ יצירת קטגוריה "שמירה"' }));
    await waitFor(() => { expect(rpc).toHaveBeenCalledWith("create_category", { p_name: "שמירה", p_kind: "expense" }); });
    expect(await screen.findByRole("heading", { level: 1, name: "שמירה" })).toBeTruthy();
  });
});

describe("ProjectNextEditScreen, a loan row (decision 0190)", () => {
  it("shows the loan's interest for November, from its schedule, and that the loan itself stays", () => {
    renderEdit({ next: JUNIPER_NEXT_LOAN, rowKey: "avg:loan-interest" });
    expect(screen.getByRole("heading", { level: 1, name: "ריבית הלוואות" })).toBeTruthy();
    const next = loanOutlook(JUNIPER_NEXT_LOAN.loans?.[0] as ForecastLoan, JUNIPER_NEXT_LOAN.today)?.next;
    expect(amountField()).toHaveValue(draftOf(next?.interestMinor ?? 0n));
    expect(screen.getByText("נובמבר · הוצאה · לפי ההלוואה")).toBeTruthy();
    expect(screen.getByText("ההלוואה עצמה לא משתנה. השינוי שלך גובר על לוח ההלוואה בצפי.")).toBeTruthy();
  });
});

describe("ProjectNextEditScreen, an added line's pace (FLOW-1010)", () => {
  it("starts at the line's own pace, so saving a new amount keeps it repeating", async () => {
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === "set_project_forecast_edit" ? { edit: {}, undo: UNDO } : null, error: null }));
    renderWithProviders(
      <Routes>
        <Route path="/projects/:projectId/profit/next" element={<p>the forecast page</p>} />
        <Route path="/projects/:projectId/profit/next/edit/:rowKey" element={<ProjectNextEditScreen sample={{ ...JUNIPER_PROFIT, next: JUNIPER_NEXT_EDITED, rowKey: "add:e-mgmt" }} />} />
      </Routes>,
      { route: "/projects/juniper-ct/profit/next/edit/add:e-mgmt" },
    );
    expect(screen.getByRole("button", { name: "כל כמה זמן: כל חודש" })).toBeTruthy();
    fireEvent.change(amountField(), { target: { value: "320" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith("set_project_forecast_edit", expect.objectContaining({ p_edit: { row_key: "add:e-mgmt", amount_minor: 32_000, pace: "month" } }));
    });
  });
});
