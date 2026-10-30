import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverFile, fetchReportFile, fileNameOf, periodCount, reportFileArgs, shareChoiceOf, TooManyFiles, type ShareChoice } from "./report-share";
import { reportStateOf } from "./reports";

type InvokeResult = { data: unknown; error: unknown; response?: Response };
const invoke = vi.hoisted((): { result: InvokeResult } => ({ result: { data: null, error: null } }));

vi.mock("./lib/supabase", () => ({
  getSupabase: () => ({ functions: { invoke: () => Promise.resolve(invoke.result) } }),
}));

/** Stubs the browser's share calls only (jsdom has neither). */
function stubShare(canShare: (() => boolean) | undefined, share: (() => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "canShare", { value: canShare, configurable: true });
  Object.defineProperty(navigator, "share", { value: share, configurable: true });
}


const TODAY = "2026-10-29";
const ID = "a0000000-0000-4000-8000-000000000162";
const PDF: ShareChoice = { pnl: true, balance: false, expand: true, format: "pdf", columns: "total", projectIds: null };

afterEach(() => {
  stubShare(undefined, undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the report file's arguments", () => {
  it("takes the screen's period and projects for the P&L", () => {
    expect(reportFileArgs(reportStateOf(new URLSearchParams("")), TODAY, PDF)).toEqual({ kind: "pnl", format: "pdf", from: "2026-01-01", to: "2026-10-29", expand: true });
    expect(reportFileArgs(reportStateOf(new URLSearchParams("period=all")), TODAY, { ...PDF, expand: false, columns: "project" })).toEqual({ kind: "pnl", format: "pdf", expand: false, columns: "project" });
    expect(reportFileArgs(reportStateOf(new URLSearchParams("")), TODAY, { ...PDF, projectIds: [ID] }).project_ids).toEqual([ID]);
  });

  it("starts from the screen: by project as columns, one project as the filter (FLOW-993)", () => {
    expect(shareChoiceOf("pnl", "by_project", null)).toMatchObject({ columns: "project", projectIds: null });
    expect(shareChoiceOf("balance", "project", ID)).toMatchObject({ pnl: false, balance: true, columns: "total", projectIds: [ID] });
  });

  it("by period: the P&L's range, or for the balance sheet alone its date's year; no as_of", () => {
    expect(reportFileArgs(reportStateOf(new URLSearchParams("")), TODAY, { ...PDF, balance: true, columns: "quarter" })).toEqual({ kind: "both", format: "pdf", columns: "quarter", from: "2026-01-01", to: TODAY, expand: true });
    const balance = reportStateOf(new URLSearchParams("kind=balance&asof=last_month"));
    expect(reportFileArgs(balance, TODAY, { ...PDF, pnl: false, balance: true, columns: "month" })).toEqual({ kind: "balance", format: "pdf", columns: "month", from: "2026-01-01", to: "2026-09-30" });
    // All time has no range: the sheet says so and sends nothing.
    expect(reportFileArgs(reportStateOf(new URLSearchParams("period=all")), TODAY, { ...PDF, columns: "month" })).not.toHaveProperty("from");
  });

  it("counts the columns as the server does", () => {
    expect(periodCount("month", { from: "2026-01-01", to: "2026-10-29" })).toBe(10);
    expect(periodCount("quarter", { from: "2025-11-01", to: "2026-02-28" })).toBe(2);
    expect(periodCount("year", { from: "2024-03-01", to: "2026-10-31" })).toBe(3);
  });

  it("takes the screen's date for the balance sheet, and both reports into one workbook", () => {
    const state = reportStateOf(new URLSearchParams("kind=balance&asof=last_month"));
    expect(reportFileArgs(state, TODAY, { ...PDF, pnl: false, balance: true })).toEqual({ kind: "balance", format: "pdf", as_of: "2026-09-30" });
    expect(reportFileArgs(state, TODAY, { ...PDF, balance: true, format: "xlsx" })).toEqual({ kind: "both", format: "xlsx", from: "2026-01-01", to: "2026-10-29", expand: true, as_of: "2026-09-30" });
  });

  it("from the P&L, both reports end on the period's last day (the server's default)", () => {
    const args = reportFileArgs(reportStateOf(new URLSearchParams("period=last_month&asof=last_year")), TODAY, { ...PDF, balance: true });
    expect(args).toEqual({ kind: "both", format: "pdf", from: "2026-09-01", to: "2026-09-30", expand: true });
  });
});

describe("the file", () => {
  it("is named by the route's UTF-8 file name", () => {
    expect(fileNameOf(`attachment; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent("מאזן_2026-10-31_כל-הפרויקטים.pdf")}`)).toBe("מאזן_2026-10-31_כל-הפרויקטים.pdf");
    expect(fileNameOf('attachment; filename="report.pdf"')).toBeNull();
    expect(fileNameOf(null)).toBeNull();
  });

  it("an Excel file comes back as a Blob and keeps its bytes, name and type", async () => {
    invoke.result = { data: new Blob([new Uint8Array([0x50, 0x4b, 3, 4])]), error: null, response: new Response(null, { headers: { "content-disposition": "attachment; filename*=UTF-8''%D7%93.xlsx" } }) };
    const file = await fetchReportFile({ format: "xlsx" });
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0x50, 0x4b, 3, 4]);
    expect(file.name).toBe("ד.xlsx");
    expect(file.type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    // Text means the route sent no file.
    invoke.result = { data: "oops", error: null };
    await expect(fetchReportFile({ format: "xlsx" })).rejects.toThrow();
  });

  it("tells the file limit apart from a failure", async () => {
    invoke.result = { data: null, error: Object.assign(new Error("429"), { context: new Response("{}", { status: 429 }) }) };
    await expect(fetchReportFile({ format: "pdf" })).rejects.toBeInstanceOf(TooManyFiles);
    invoke.result = { data: null, error: Object.assign(new Error("502"), { context: new Response("{}", { status: 502 }) }) };
    await expect(fetchReportFile({ format: "pdf" })).rejects.not.toBeInstanceOf(TooManyFiles);
  });

  it("goes to the phone's share sheet when it takes files, and a closed share sheet is no failure", async () => {
    const file = new File(["%PDF-"], "report.pdf", { type: "application/pdf" });
    const share = vi.fn(() => Promise.resolve());
    stubShare(() => true, share);
    expect(await deliverFile(file, "רווח והפסד")).toBe("shared");
    expect(share).toHaveBeenCalledWith({ files: [file], title: "רווח והפסד" });
    share.mockImplementationOnce(() => Promise.reject(new DOMException("closed", "AbortError")));
    expect(await deliverFile(file, "רווח והפסד")).toBe("cancelled");
    share.mockImplementationOnce(() => Promise.reject(new DOMException("needs a tap", "NotAllowedError")));
    expect(await deliverFile(file, "רווח והפסד")).toBe("blocked");
    // Refused again on the kept file: it downloads instead.
    share.mockImplementationOnce(() => Promise.reject(new DOMException("needs a tap", "NotAllowedError")));
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:report"), revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    expect(await deliverFile(file, "רווח והפסד", { download: true })).toBe("saved");
    expect(click).toHaveBeenCalledOnce();
  });

  it("downloads where there is no share sheet", async () => {
    stubShare(undefined, undefined);
    const create = vi.fn(() => "blob:report");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    expect(await deliverFile(new File(["a"], "דוחות.xlsx"), "דוחות")).toBe("saved");
    expect(click).toHaveBeenCalledOnce();
  });
});
