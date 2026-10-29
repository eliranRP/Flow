import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverFile, fetchReportFile, fileNameOf, reportFileArgs, type ShareChoice } from "./report-share";
import { reportStateOf } from "./reports";

const invoke = vi.hoisted(() => ({ result: { data: null as unknown, error: null as unknown, response: undefined as Response | undefined } }));

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
const PDF: ShareChoice = { pnl: true, balance: false, expand: true, format: "pdf" };

afterEach(() => {
  stubShare(undefined, undefined);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the report file's arguments", () => {
  it("takes the screen's period and projects for the P&L", () => {
    expect(reportFileArgs(reportStateOf(new URLSearchParams("")), TODAY, PDF)).toEqual({ kind: "pnl", format: "pdf", from: "2026-01-01", to: "2026-10-29", expand: true });
    expect(reportFileArgs(reportStateOf(new URLSearchParams("period=all&scope=by_project")), TODAY, { ...PDF, expand: false })).toEqual({ kind: "pnl", format: "pdf", expand: false, by_project: true });
    expect(reportFileArgs(reportStateOf(new URLSearchParams(`scope=project&project=${ID}`)), TODAY, PDF).project_id).toBe(ID);
  });

  it("takes the screen's date for the balance sheet, and both reports into one CSV", () => {
    const state = reportStateOf(new URLSearchParams("kind=balance&asof=last_month"));
    expect(reportFileArgs(state, TODAY, { ...PDF, pnl: false, balance: true })).toEqual({ kind: "balance", format: "pdf", as_of: "2026-09-30" });
    expect(reportFileArgs(state, TODAY, { ...PDF, balance: true, format: "csv" })).toEqual({ kind: "both", format: "csv", from: "2026-01-01", to: "2026-10-29", expand: true, as_of: "2026-09-30" });
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

  it("puts back the byte-order mark Excel needs, which the text read drops", async () => {
    invoke.result = { data: "סעיף,סכום\r\n", error: null, response: new Response(null, { headers: { "content-disposition": "attachment; filename*=UTF-8''%D7%93.csv" } }) };
    const file = await fetchReportFile({ format: "csv" });
    expect([...new Uint8Array(await file.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(file.name).toBe("ד.csv");
    expect(file.type).toBe("text/csv");
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
  });

  it("downloads where there is no share sheet", async () => {
    stubShare(undefined, undefined);
    const create = vi.fn(() => "blob:report");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    expect(await deliverFile(new File(["a"], "דוחות.csv"), "דוחות")).toBe("saved");
    expect(click).toHaveBeenCalledOnce();
  });
});
