import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPORTS_BALANCE, REPORTS_BY_PROJECT, REPORTS_EMPTY, REPORTS_STATEMENT, REPORTS_TODAY } from "../dev/reports-sample";
import { renderWithProviders } from "../test-render";
import { ReportsScreen } from "./reports-screen";

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

function renderReports(route = "/reports") {
  return renderWithProviders(<ReportsScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, balance: REPORTS_BALANCE, projects: REPORTS_BY_PROJECT }} />, { route });
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
    const loading = renderWithProviders(<ReportsScreen sample={{ today: REPORTS_TODAY, phase: { kind: "loading" } }} />, { route: "/reports" });
    expect(screen.queryByRole("button", { name: "שיתוף הדוח" })).toBeNull();
    loading.unmount();
    const empty = renderWithProviders(<ReportsScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_EMPTY, balance: REPORTS_BALANCE, projects: REPORTS_BY_PROJECT }} />, { route: "/reports" });
    expect(screen.queryByRole("button", { name: "שיתוף הדוח" })).toBeNull();
    empty.unmount();
    renderWithProviders(<ReportsScreen sample={{ today: REPORTS_TODAY, statement: REPORTS_STATEMENT, balance: { ...REPORTS_BALANCE, currencies: [] }, projects: REPORTS_BY_PROJECT }} />, { route: "/reports?kind=balance" });
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
    renderReports("/reports?scope=by_project");
    fireEvent.click(screen.getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = screen.getByRole("dialog", { name: "שיתוף PDF" });
    expect(within(sheet).getByRole("radio", { name: "פרויקט" })).toBeChecked();
    expect(within(sheet).getByRole("switch", { name: "לפרט קטעים מכווצים" })).toBeEnabled();
    fireEvent.click(within(sheet).getByRole("button", { name: "שיתוף PDF" }));
    await waitFor(() => { expect(invoke.calls).toHaveLength(1); });
    expect(invoke.calls[0]?.body).toMatchObject({ kind: "pnl", columns: "project" });
  });

  it("picks some projects: none picked holds the file back, one picked sends its id", async () => {
    renderReports();
    fireEvent.click(screen.getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = screen.getByRole("dialog", { name: "שיתוף PDF" });
    fireEvent.click(within(sheet).getByRole("switch", { name: "כל הפרויקטים" }));
    expect(within(sheet).getByRole("button", { name: "שיתוף PDF" })).toBeDisabled();
    expect(within(sheet).getByText("בחרו לפחות פרויקט אחד.")).toBeInTheDocument();
    const group = within(sheet).getByRole("group", { name: "פרויקטים" });
    const [first] = within(group).getAllByRole("switch");
    if (first == null) throw new Error("no project switch");
    fireEvent.click(first);
    fireEvent.click(within(sheet).getByRole("button", { name: "שיתוף PDF" }));
    await waitFor(() => { expect(invoke.calls).toHaveLength(1); });
    expect((invoke.calls[0]?.body as { project_ids?: string[] }).project_ids).toHaveLength(1);
  });

  it("by month over all time needs a range, and a wide PDF suggests quarters or Excel", () => {
    renderReports("/reports?period=all");
    fireEvent.click(screen.getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = screen.getByRole("dialog", { name: "שיתוף PDF" });
    fireEvent.click(within(sheet).getByRole("radio", { name: "חודש" }));
    expect(within(sheet).getByRole("button", { name: "שיתוף PDF" })).toBeDisabled();
    expect(within(sheet).getByText("עמודות לפי תקופה צריכות טווח תאריכים: בחרו תקופה במסך.")).toBeInTheDocument();
  });

  it("a year by month in a PDF is 13 columns and fits; a longer range warns", () => {
    renderReports("/reports?period=custom&from=2025-01-01&to=2026-06-30");
    fireEvent.click(screen.getByRole("button", { name: "שיתוף הדוח" }));
    const sheet = screen.getByRole("dialog", { name: "שיתוף PDF" });
    fireEvent.click(within(sheet).getByRole("radio", { name: "חודש" }));
    expect(within(sheet).getByText(/19 עמודות לא נכנסות ברוחב הדף/)).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "שיתוף PDF" })).toBeEnabled();
  });
});
