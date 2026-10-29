import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverFile, fileNameOf, reportFileArgs, type ShareChoice } from "./report-share";
import { reportStateOf } from "./reports";

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
});

describe("the file", () => {
  it("is named by the route's UTF-8 file name", () => {
    expect(fileNameOf(`attachment; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent("מאזן_2026-10-31_כל-הפרויקטים.pdf")}`)).toBe("מאזן_2026-10-31_כל-הפרויקטים.pdf");
    expect(fileNameOf('attachment; filename="report.pdf"')).toBeNull();
    expect(fileNameOf(null)).toBeNull();
  });

  it("goes to the phone's share sheet when it takes files, and a closed share sheet is no failure", async () => {
    const file = new File(["%PDF-"], "report.pdf", { type: "application/pdf" });
    const share = vi.fn(() => Promise.resolve());
    stubShare(() => true, share);
    expect(await deliverFile(file, "רווח והפסד")).toBe("shared");
    expect(share).toHaveBeenCalledWith({ files: [file], title: "רווח והפסד" });
    share.mockImplementationOnce(() => Promise.reject(new DOMException("closed", "AbortError")));
    expect(await deliverFile(file, "רווח והפסד")).toBe("cancelled");
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
