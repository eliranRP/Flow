import { describe, expect, it } from "vitest";
import {
  chequeProblem,
  entryRpcArgs,
  isEntryReady,
  matchLine,
  newNameProblem,
  NO_PROJECT,
  orderChips,
  parseAmountMinor,
  parseDisplayDate,
  payeeProblem,
  planSave,
  todayDisplayDate,
  type BankMatch,
  type EntryDraft,
} from "./add-entry";

const READY: EntryDraft = {
  direction: "out",
  amount: "409.01",
  payee: "Ajax Hardware",
  date: "10/10/2026",
  method: "cash",
  cheque: "",
  projectId: "p-1",
  categoryId: "c-1",
};

describe("parseAmountMinor", () => {
  it("reads whole and decimal amounts as minor units", () => {
    expect(parseAmountMinor("409.01")).toBe(40901);
    expect(parseAmountMinor("2,400.00")).toBe(240000);
    expect(parseAmountMinor("350")).toBe(35000);
    expect(parseAmountMinor("0.5")).toBe(50);
  });
  it("refuses zero, empty, too many decimals and letters", () => {
    expect(parseAmountMinor("")).toBeNull();
    expect(parseAmountMinor("0")).toBeNull();
    expect(parseAmountMinor("0.00")).toBeNull();
    expect(parseAmountMinor("1.234")).toBeNull();
    expect(parseAmountMinor("12a")).toBeNull();
    expect(parseAmountMinor("-5")).toBeNull();
  });
});

describe("dates", () => {
  it("reads a real day from dd/mm/yyyy and refuses the rest", () => {
    expect(parseDisplayDate("10/10/2026")).toBe("2026-10-10");
    expect(parseDisplayDate("31/02/2026")).toBeNull();
    expect(parseDisplayDate("2026-10-10")).toBeNull();
    expect(parseDisplayDate("")).toBeNull();
  });
  it("gives today", () => {
    expect(todayDisplayDate(new Date(2026, 9, 5, 12))).toBe("05/10/2026");
  });
});

describe("isEntryReady", () => {
  it("is true only when the amount, payee, project and category are set", () => {
    expect(isEntryReady(READY)).toBe(true);
    expect(isEntryReady({ ...READY, amount: "" })).toBe(false);
    expect(isEntryReady({ ...READY, payee: " A " })).toBe(false);
    expect(isEntryReady({ ...READY, projectId: null })).toBe(false);
    expect(isEntryReady({ ...READY, categoryId: null })).toBe(false);
  });
  it("counts בלי פרויקט as a project and needs a cheque number for a cheque", () => {
    expect(isEntryReady({ ...READY, projectId: NO_PROJECT })).toBe(true);
    expect(isEntryReady({ ...READY, method: "cheque", cheque: "" })).toBe(false);
    expect(isEntryReady({ ...READY, method: "cheque", cheque: "1048" })).toBe(true);
    expect(chequeProblem("10 48")).toBe(true);
  });
});

describe("names", () => {
  it("refuses a short, hidden or repeated name, ignoring case and spaces", () => {
    expect(newNameProblem("A", [])).toBe("short");
    expect(newNameProblem("Site​Beta", [])).toBe("hidden");
    expect(newNameProblem(" Harbor  Rd ", ["harbor  rd"])).toBe("duplicate");
    expect(newNameProblem("Ferry Ln", ["Harbor Rd"])).toBeNull();
    expect(payeeProblem("Ajax Hardware")).toBeNull();
    expect(payeeProblem("A")).toBe("short");
  });
  it("keeps the last chips at the end", () => {
    expect(orderChips(["Harbor", "בלי פרויקט", "Ferry", "New"], ["בלי פרויקט"])).toEqual(["Harbor", "Ferry", "New", "בלי פרויקט"]);
  });
});

describe("planSave", () => {
  const match: BankMatch = { id: "t-9", description: "Ajax Hardware", doc_date: "2026-10-10", amount_minor: 40901, source: "sumit" };
  it("attaches a matched receipt to its line and adds none", () => {
    expect(planSave("receipt", match, true)).toEqual({ kind: "attach", transactionId: "t-9" });
  });
  it("makes one line otherwise, with the document when there is one", () => {
    expect(planSave("receipt", null, true)).toEqual({ kind: "create", attachDocument: true });
    expect(planSave("receipt", undefined, false)).toEqual({ kind: "create", attachDocument: false });
    expect(planSave("cash", match, true)).toEqual({ kind: "create", attachDocument: false });
  });
  it("names the bank line in the match box", () => {
    const money = (minor: number) => (minor / 100).toFixed(2);
    expect(matchLine(match, money)).toBe("Ajax Hardware · −409.01 · 10/10 · SUMIT");
  });
});

describe("entryRpcArgs", () => {
  it("signs by direction, sends no project for בלי פרויקט and the cheque number only for a cheque", () => {
    expect(entryRpcArgs({ ...READY, projectId: NO_PROJECT }, "cash")).toMatchObject({ p_direction: "expense", p_project_id: null, p_cheque_number: null });
    expect(entryRpcArgs({ ...READY, direction: "in", method: "cheque", cheque: " 1048 " }, "cash")).toMatchObject({
      p_direction: "income",
      p_method: "cheque",
      p_cheque_number: "1048",
    });
    expect(entryRpcArgs(READY, "receipt")).toMatchObject({ p_method: "cash", p_amount_minor: 40901, p_doc_date: "2026-10-10" });
  });
});
