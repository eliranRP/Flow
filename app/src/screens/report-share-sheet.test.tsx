import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPORTS_BALANCE, REPORTS_BY_PROJECT, REPORTS_EMPTY, REPORTS_STATEMENT, REPORTS_TODAY } from "../dev/reports-sample";
import { renderWithProviders } from "../test-render";
import { BalanceReportScreen } from "./reports-balance-screen";
import { PnlReportScreen } from "./reports-screen";

/** Stubs the browser's share calls only (jsdom has neither). */
function stubShare(canShare: (() => boolean) | undefined, share: (() => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "canShare", { value: canShare, configurable: true });
  Object.defineProperty(navigator, "share", { value: share, configurable: true });
}


const invoke = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; body: unknown }>,
  impl: (): Promise<{ data: unknown; error: unknown; response?: Response }> => Promise.resolve({ data: null, error: new Error("down") }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    functions: {
      invoke: (name: string, options: { body: unknown }) => {
        invoke.calls.push({ name, body: options.body });
        return invoke.impl();
      },
    },
  }),
}));

beforeEach(() => {
  invoke.calls = [];
  invoke.impl = () => Promise.resolve({ data: null, error: new Error("down") });
});

const MAPLE = "a0000000-0000-4000-8000-000000000162";

function renderReports(route = "/reports/pnl") {
  const drilled = { ...REPORTS_STATEMENT, project_id: MAPLE, project_name: "Maple Ave" };
  return renderWithProviders(<PnlReportScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, byProject: REPORTS_BY_PROJECT, drilled }} />, { route });
}

describe("ReportShareSheet", () => {
  it("shares the report on screen as a PDF, with the screen's period", async () => {
    const share = vi.fn(() => Promise.resolve());
    stubShare(() => true, share);
    invoke.impl = () => Promise.resolve({
      data: new Blob(["%PDF-"]),
      error: null,
      response: new Response(null, { headers: { "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent("רווח-והפסד_2026-01-01_2026-10-31_כל-הפרויקטים.pdf")}` } }),
    });
    renderReports();
    fireEvent.click(screen.getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = screen.getByRole("dialog", { name: "שיתוף PDF" });
    expect(within(sheet).getByRole("switch", { name: "רווח והפסד" })).toBeChecked();
    expect(within(sheet).getByRole("switch", { name: "מאזן" })).not.toBeChecked();
    fireEvent.click(within(sheet).getByRole("button", { name: "שיתוף PDF" }));
    await waitFor(() => { expect(share).toHaveBeenCalledOnce(); });
    expect(invoke.calls).toEqual([{ name: "flow-mcp/report", body: { kind: "pnl", format: "pdf", from: "2026-01-01", to: "2026-10-31", expand: true } }]);
    const sent = (share.mock.calls[0] as unknown as [{ files: File[] }])[0].files[0];
    expect(sent?.name).toBe("רווח-והפסד_2026-01-01_2026-10-31_כל-הפרויקטים.pdf");
    expect(sent?.type).toBe("application/pdf");
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "שיתוף PDF" })).toBeNull(); });
    stubShare(undefined, undefined);
  });

  it("takes both reports into an Excel file, needs at least one, and says when the file failed", async () => {
    renderReports();
    fireEvent.click(screen.getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = screen.getByRole("dialog", { name: "שיתוף PDF" });
    fireEvent.click(within(sheet).getByRole("radio", { name: "Excel" }));
    const excel = screen.getByRole("dialog", { name: "שיתוף Excel" });
    fireEvent.click(within(excel).getByRole("switch", { name: "רווח והפסד" }));
    expect(within(excel).getByRole("button", { name: "שיתוף Excel" })).toBeDisabled();
    expect(within(excel).getByText("בחרו לפחות דוח אחד.")).toBeInTheDocument();
    fireEvent.click(within(excel).getByRole("switch", { name: "רווח והפסד" }));
    fireEvent.click(within(excel).getByRole("switch", { name: "מאזן" }));
    fireEvent.click(within(excel).getByRole("button", { name: "שיתוף Excel" }));
    expect(await screen.findByText("הקובץ לא נוצר. נסו שוב.")).toBeInTheDocument();
    // From the P&L, the balance sheet ends on the period's last day: the server's default, so no as_of.
    expect(invoke.calls[0]?.body).toEqual({ kind: "both", format: "xlsx", from: "2026-01-01", to: REPORTS_TODAY, expand: true });
    expect(screen.getByRole("dialog", { name: "שיתוף Excel" })).toBeInTheDocument();
  });

  it("says to wait a minute when the file limit is reached", async () => {
    invoke.impl = () => Promise.resolve({ data: null, error: Object.assign(new Error("429"), { context: new Response("{}", { status: 429 }) }) });
    renderReports();
    fireEvent.click(screen.getByRole("button", { name: "שיתוף הדוח" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "שיתוף PDF" })).getByRole("button", { name: "שיתוף PDF" }));
    expect(await screen.findByText("נוצרו הרבה קבצים בדקה האחרונה. נסו שוב בעוד דקה.")).toBeInTheDocument();
  });

  it("has nothing to share before the report is in, or when it is empty", () => {
    const loading = renderWithProviders(<PnlReportScreen sample={{ today: REPORTS_TODAY, phase: { kind: "loading" } }} />, { route: "/reports/pnl" });
    expect(screen.queryByRole("button", { name: "שיתוף הדוח" })).toBeNull();
    loading.unmount();
    const empty = renderWithProviders(<PnlReportScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_EMPTY, byProject: REPORTS_BY_PROJECT }} />, { route: "/reports/pnl" });
    expect(screen.queryByRole("button", { name: "שיתוף הדוח" })).toBeNull();
    empty.unmount();
    renderWithProviders(<BalanceReportScreen sample={{ today: REPORTS_TODAY, balance: { ...REPORTS_BALANCE, currencies: [] }, projects: REPORTS_BY_PROJECT }} />, { route: "/reports/balance" });
    expect(screen.queryByRole("button", { name: "שיתוף הדוח" })).toBeNull();
  });

  it("keeps a file the phone would not share yet, and sends it on the next tap without making it again", async () => {
    const share = vi.fn((): Promise<void> => Promise.reject(new DOMException("needs a tap", "NotAllowedError")));
    stubShare(() => true, share);
    invoke.impl = () => Promise.resolve({ data: new Blob(["%PDF-"]), error: null, response: new Response(null) });
    renderReports();
    fireEvent.click(screen.getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = screen.getByRole("dialog", { name: "שיתוף PDF" });
    fireEvent.click(within(sheet).getByRole("button", { name: "שיתוף PDF" }));
    const again = await within(sheet).findByRole("button", { name: "שליחת הקובץ" });
    expect(screen.queryByText("הקובץ לא נוצר. נסו שוב.")).toBeNull();
    share.mockImplementationOnce(() => Promise.resolve());
    fireEvent.click(again);
    await waitFor(() => { expect(share).toHaveBeenCalledTimes(2); });
    expect(invoke.calls).toHaveLength(1);
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "שיתוף PDF" })).toBeNull(); });
    stubShare(undefined, undefined);
  });

  it("by project on screen: a column per project; sub-categories still offered (FLOW-993)", async () => {
    renderReports("/reports/pnl?view=project");
    fireEvent.click(screen.getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = screen.getByRole("dialog", { name: "שיתוף PDF" });
    expect(within(sheet).getByRole("radio", { name: "פרויקט" })).toBeChecked();
    expect(within(sheet).getByRole("switch", { name: "לפרט קטעים מכווצים" })).toBeEnabled();
    fireEvent.click(within(sheet).getByRole("button", { name: "שיתוף PDF" }));
    await waitFor(() => { expect(invoke.calls).toHaveLength(1); });
    expect(invoke.calls[0]?.body).toMatchObject({ kind: "pnl", columns: "project" });
  });

  it("picks some projects: turning off every project starts from all of them, none picked holds the file back with the reason in the foot (FLOW-456)", async () => {
    renderReports();
    fireEvent.click(screen.getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = screen.getByRole("dialog", { name: "שיתוף PDF" });
    fireEvent.click(within(sheet).getByRole("switch", { name: "כל הפרויקטים" }));
    const button = within(sheet).getByRole("button", { name: "שיתוף PDF" });
    expect(button).toBeEnabled();
    const group = within(sheet).getByRole("group", { name: "פרויקטים" });
    const switches = within(group).getAllByRole("switch");
    expect(switches.map((item) => (item as HTMLInputElement).checked)).toEqual([true, true, true, true]);
    for (const item of switches) fireEvent.click(item);
    expect(button).toBeDisabled();
    // The reason sits in the sheet's foot, above the button, as a status: not at the end of the scrolling body.
    const why = within(sheet).getByRole("status");
    expect(why.textContent).toBe("בחרו לפחות פרויקט אחד.");
    expect(why.closest(".ui-sheet-foot")).toBe(button.closest(".ui-sheet-foot"));
    expect(why.closest(".ui-sheet-body")).toBeNull();
    const [first] = switches;
    if (first == null) throw new Error("no project switch");
    fireEvent.click(first);
    expect(why.textContent).toBe("");
    fireEvent.click(button);
    await waitFor(() => { expect(invoke.calls).toHaveLength(1); });
    expect((invoke.calls[0]?.body as { project_ids?: string[] }).project_ids).toHaveLength(1);
  });

  it("on a project's report, turning every project back off starts from that project (FLOW-456)", () => {
    renderReports(`/reports/pnl?view=project&project=${MAPLE}`);
    fireEvent.click(screen.getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = screen.getByRole("dialog", { name: "שיתוף PDF" });
    const all = within(sheet).getByRole("switch", { name: "כל הפרויקטים" });
    fireEvent.click(all);
    fireEvent.click(all);
    const group = within(sheet).getByRole("group", { name: "פרויקטים" });
    expect(within(group).getAllByRole("switch").filter((item) => (item as HTMLInputElement).checked)).toHaveLength(1);
    expect(within(group).getByRole("switch", { name: "Maple Ave" })).toBeChecked();
    expect(within(sheet).getByRole("button", { name: "שיתוף PDF" })).toBeEnabled();
  });

  it("by month over all time needs a range, and a wide PDF suggests quarters or Excel", () => {
    renderReports("/reports/pnl?period=all");
    fireEvent.click(screen.getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = screen.getByRole("dialog", { name: "שיתוף PDF" });
    fireEvent.click(within(sheet).getByRole("radio", { name: "חודש" }));
    expect(within(sheet).getByRole("button", { name: "שיתוף PDF" })).toBeDisabled();
    expect(within(sheet).getByText("עמודות לפי תקופה צריכות טווח תאריכים: בחרו תקופה במסך.")).toBeInTheDocument();
  });

  it("a range of 18 months by month in a PDF is 19 columns with the total, and warns", () => {
    renderReports("/reports/pnl?period=custom&from=2025-01-01&to=2026-06-30");
    fireEvent.click(screen.getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = screen.getByRole("dialog", { name: "שיתוף PDF" });
    fireEvent.click(within(sheet).getByRole("radio", { name: "חודש" }));
    expect(within(sheet).getByText(/19 עמודות לא נכנסות ברוחב הדף/)).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "שיתוף PDF" })).toBeEnabled();
  });

  it("by month over more than 36 columns is held back, and the sheet says the most", () => {
    renderReports("/reports/pnl?period=custom&from=2024-01-01&to=2027-01-31");
    fireEvent.click(screen.getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = screen.getByRole("dialog", { name: "שיתוף PDF" });
    fireEvent.click(within(sheet).getByRole("radio", { name: "חודש" }));
    expect(within(sheet).getByText("עד 36 עמודות: בחרו תקופה קצרה יותר או עמודות ארוכות יותר.")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "שיתוף PDF" })).toBeDisabled();
  });
});
