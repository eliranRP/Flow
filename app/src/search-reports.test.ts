import { describe, expect, it } from "vitest";
import { normalizeReportText, reportShortcuts } from "./search-reports";

const PROJECT = "a0000000-0000-4000-8000-000000000163";
const projects = [{ id: PROJECT, name: "Cedar St" }, { id: "b0000000-0000-4000-8000-000000000163", name: "שיפוץ לדוגמה" }];
const titles = (text: string) => reportShortcuts(text, projects).map((row) => row.title);

describe("the search's report shortcuts (FLOW-163)", () => {
  it("opens the balance sheet for מאזן and the P&L for רווח והפסד, on every project", () => {
    expect(reportShortcuts("מאזן", projects)).toEqual([
      { key: "balance", title: "מאזן", hint: "כל הפרויקטים · היום", to: "/reports?kind=balance" },
    ]);
    expect(reportShortcuts("רווח והפסד", projects)).toEqual([
      { key: "pnl", title: "רווח והפסד", hint: "כל הפרויקטים · השנה", to: "/reports" },
    ]);
  });

  it("reads the close forms: a דוח before it, gershayim, English names, the start of a word", () => {
    for (const text of ["דוח רווח והפסד", "דו״ח רווח והפסד", "רו\"ה", "רוו״ה", "דו”ח רווח והפסד", "רו”ה", "P&L", "pnl", "Profit and loss", "רווח", "רוו"]) {
      expect(titles(text), text).toEqual(["רווח והפסד"]);
    }
    for (const text of ["Balance sheet", "balance", "Balance", "דוח מאזן", "  מאזן  ", "מאז"]) {
      expect(titles(text), text).toEqual(["מאזן"]);
    }
  });

  it("offers both reports for דוחות and its forms", () => {
    for (const text of ["דוחות", "דוח", "דו״חות", "Reports", "דוחו"]) {
      expect(titles(text), text).toEqual(["רווח והפסד", "מאזן"]);
    }
  });

  it("opens the report on a project when its name is beside the report's", () => {
    expect(reportShortcuts("מאזן cedar", projects)).toEqual([
      { key: `balance-${PROJECT}`, title: "מאזן · Cedar St", hint: "היום", to: `/reports?kind=balance&scope=project&project=${PROJECT}` },
    ]);
    expect(titles("דוח רווח והפסד של שיפוץ")).toEqual(["רווח והפסד · שיפוץ לדוגמה"]);
    expect(titles("דוחות Cedar")).toEqual(["רווח והפסד · Cedar St", "מאזן · Cedar St"]);
    // A name that matches no project leaves the report on every project.
    expect(titles("מאזן אחר")).toEqual(["מאזן"]);
  });

  it("names no report for other text, too short a start, or a report word inside another word", () => {
    for (const text of ["", " ", "מא", "ר", "חומרי בניין", "Cedar", "מאזניים", "1200", "pa", "דוח חניה", "דו״ח שמאי", "statement fee", "pro", "inc", "sta", "rep", "bal"]) {
      expect(titles(text), text).toEqual([]);
    }
  });

  it("reads a Hebrew prefix letter on a report's word (FLOW-169)", () => {
    for (const text of ["המאזן", "במאזן", "למאזן", "ומאזן", "והמאזן", "דוח המאזן", "בדוח מאזן"]) {
      expect(titles(text), text).toEqual(["מאזן"]);
    }
    for (const text of ["ברווח והפסד", "הרווח והפסד", "לדוח רווח והפסד"]) {
      expect(titles(text), text).toEqual(["רווח והפסד"]);
    }
    expect(titles("הדוחות")).toEqual(["רווח והפסד", "מאזן"]);
    // The letters come off only when a report's word is left: these are other words.
    for (const text of ["מאזניים", "המאזניים", "ממאזניים", "מרווה", "הרווחים", "בבל"]) {
      expect(titles(text), text).toEqual([]);
    }
  });

  it("ignores punctuation around and between the words (FLOW-169)", () => {
    for (const text of ["מאזן?", "מאזן.", "(מאזן)", "מאזן!?", "המאזן?"]) {
      expect(titles(text), text).toEqual(["מאזן"]);
    }
    expect(titles("רווח והפסד, Cedar")).toEqual(["רווח והפסד · Cedar St"]);
    expect(titles("P&L: cedar")).toEqual(["רווח והפסד · Cedar St"]);
    expect(titles("מאזן - שיפוץ")).toEqual(["מאזן · שיפוץ לדוגמה"]);
  });

  it("reads a prefix letter on the project's name (FLOW-169)", () => {
    expect(titles("מאזן לשיפוץ")).toEqual(["מאזן · שיפוץ לדוגמה"]);
    expect(titles("רווח והפסד בשיפוץ")).toEqual(["רווח והפסד · שיפוץ לדוגמה"]);
    expect(titles("דוחות לשיפוץ")).toEqual(["רווח והפסד · שיפוץ לדוגמה", "מאזן · שיפוץ לדוגמה"]);
    // A name that starts with one of the letters matches as typed first.
    const own = [{ id: PROJECT, name: "הדר לדוגמה" }];
    expect(reportShortcuts("מאזן הדר", own).map((row) => row.title)).toEqual(["מאזן · הדר לדוגמה"]);
  });

  it("shows the balance sheet for English balance only as the whole query or in balance sheet (FLOW-169)", () => {
    expect(titles("balance")).toEqual(["מאזן"]);
    expect(titles("balance sheet cedar")).toEqual(["מאזן · Cedar St"]);
    for (const text of ["balance transfer", "opening balance", "balance cedar", "balances"]) {
      expect(titles(text), text).toEqual([]);
    }
  });

  it("opens the rows on the search's project chip (FLOW-169)", () => {
    const chip = { id: "b0000000-0000-4000-8000-000000000163", name: "שיפוץ לדוגמה" };
    expect(reportShortcuts("מאזן", projects, "", chip)).toEqual([
      { key: `balance-${chip.id}`, title: "מאזן · שיפוץ לדוגמה", hint: "היום", to: `/reports?kind=balance&scope=project&project=${chip.id}` },
    ]);
    expect(reportShortcuts("דוחות", projects, "", chip).map((row) => row.title)).toEqual(["רווח והפסד · שיפוץ לדוגמה", "מאזן · שיפוץ לדוגמה"]);
    // A project typed beside the report's name wins over the chip.
    expect(reportShortcuts("מאזן cedar", projects, "", chip).map((row) => row.title)).toEqual(["מאזן · Cedar St"]);
    // A line's own text stays a line's text with the chip on.
    expect(reportShortcuts("דוח חניה", projects, "", chip)).toEqual([]);
  });

  it("keeps a preview query on the link", () => {
    expect(reportShortcuts("מאזן", [], "?preview=empty")[0]?.to).toBe("/reports?kind=balance&preview=empty");
    expect(reportShortcuts("רווח והפסד", [], "?preview=empty")[0]?.to).toBe("/reports?preview=empty");
  });

  it("normalizes case, quotes and spaces", () => {
    expect(normalizeReportText("  P&L   ׳דו״ח׳ ")).toBe("p&l דוח");
  });
});
