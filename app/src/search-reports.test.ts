import { describe, expect, it } from "vitest";
import { normalizeReportText, reportShortcuts } from "./search-reports";

const PROJECT = "a0000000-0000-4000-8000-000000000163";
const projects = [{ id: PROJECT, name: "Cedar St" }, { id: "b0000000-0000-4000-8000-000000000163", name: "שיפוץ לדוגמה" }];
const titles = (text: string) => reportShortcuts(text, projects).map((row) => row.title);

describe("the search's report shortcuts (FLOW-163)", () => {
  it("opens the balance sheet for מאזן and the P&L for רווח והפסד, on every project", () => {
    expect(reportShortcuts("מאזן", projects)).toEqual([
      { key: "balance", kind: "balance", title: "מאזן", hint: "כל הפרויקטים · היום", to: "/reports?kind=balance" },
    ]);
    expect(reportShortcuts("רווח והפסד", projects)).toEqual([
      { key: "pnl", kind: "pnl", title: "רווח והפסד", hint: "כל הפרויקטים · השנה", to: "/reports" },
    ]);
  });

  it("reads the close forms: a דוח before it, gershayim, English names, the start of a word", () => {
    for (const text of ["דוח רווח והפסד", "דו״ח רווח והפסד", "רו\"ה", "P&L", "pnl", "Profit and loss", "רווח", "רוו"]) {
      expect(titles(text), text).toEqual(["רווח והפסד"]);
    }
    for (const text of ["Balance sheet", "balance", "bal", "דוח מאזן", "  מאזן  ", "מאז"]) {
      expect(titles(text), text).toEqual(["מאזן"]);
    }
  });

  it("offers both reports for דוחות and its forms", () => {
    for (const text of ["דוחות", "דוח", "דו״חות", "Reports", "rep"]) {
      expect(titles(text), text).toEqual(["רווח והפסד", "מאזן"]);
    }
  });

  it("opens the report on a project when its name is beside the report's", () => {
    expect(reportShortcuts("מאזן cedar", projects)).toEqual([
      { key: `balance-${PROJECT}`, kind: "balance", title: "מאזן · Cedar St", hint: "היום", to: `/reports?kind=balance&scope=project&project=${PROJECT}` },
    ]);
    expect(titles("דוח רווח והפסד של שיפוץ")).toEqual(["רווח והפסד · שיפוץ לדוגמה"]);
    expect(titles("דוחות Cedar")).toEqual(["רווח והפסד · Cedar St", "מאזן · Cedar St"]);
    // A name that matches no project leaves the report on every project.
    expect(titles("מאזן אחר")).toEqual(["מאזן"]);
  });

  it("names no report for other text, too short a start, or a report word inside another word", () => {
    for (const text of ["", " ", "מא", "ר", "חומרי בניין", "Cedar", "מאזניים", "1200", "pa"]) {
      expect(titles(text), text).toEqual([]);
    }
  });

  it("keeps a preview query on the link", () => {
    expect(reportShortcuts("מאזן", [], "?preview=empty")[0]?.to).toBe("/reports?kind=balance&preview=empty");
    expect(reportShortcuts("רווח והפסד", [], "?preview=empty")[0]?.to).toBe("/reports?preview=empty");
  });

  it("normalizes case, quotes and spaces", () => {
    expect(normalizeReportText("  P&L   ׳דו״ח׳ ")).toBe("p&l דוח");
  });
});
