import { describe, expect, it } from "vitest";
import { birchLaneReturns } from "../dev/returns-sample";
import { countTag } from "../ui/attention-cards";
import type { BannerRow } from "../ui/banner";
import { attentionRows, changeRow } from "./attention-rows";
import type { LoanListRow } from "./loan-list";
import { loansAttention } from "./loans-list";
import { projectAttentionRows } from "./project-attention";
import { investmentAttentionRows } from "./project-returns-cards";

// FLOW-1097 (the owner's choice B): under 360px each דורש טיפול card is a short title and a tag. Invented rows.

const short = (rows: readonly BannerRow[]) => rows.map((row) => [row.short, row.tag]);

describe("countTag", () => {
  it("says one in the singular and two or more with the number", () => {
    expect(countTag(1, "תשלום אחד", "תשלומים")).toBe("תשלום אחד");
    expect(countTag(2, "תשלום אחד", "תשלומים")).toBe("2 תשלומים");
    expect(countTag(12, "תשלום אחד", "תשלומים")).toBe("12 תשלומים");
  });
});

describe("attentionRows' short titles (Home and a project)", () => {
  it("names what is needed and tags the count or the total", () => {
    const rows = attentionRows({ pending: 7, transfers: 2, unpaidCount: 3, unpaidGross: 2_130_000n, currency: "USD", missingCount: 2, missingIncome: 1, search: "" });
    expect(short(rows)).toEqual([
      ["לאישור", "7 פריטים"],
      ["לבדיקה", "2 העברות"],
      ["לגבייה", "$21,300"],
      ["לא הגיעו", "2 חשבונות"],
      ["לא הגיעו", "הכנסה אחת"],
    ]);
  });

  it("says one in the singular, and tags the count when the invoices have no one total", () => {
    const rows = attentionRows({ pending: 1, transfers: 1, unpaidCount: 1, unpaidGross: 0n, missingCount: 1, missingIncome: 2, search: "" });
    expect(short(rows)).toEqual([
      ["לאישור", "פריט אחד"],
      ["לבדיקה", "העברה אחת"],
      ["לגבייה", "חשבונית אחת"],
      ["לא הגיעו", "חשבון אחד"],
      ["לא הגיעו", "2 הכנסות"],
    ]);
    const mixed = attentionRows({ pending: 0, unpaidCount: 4, unpaidGross: 100_000n, unpaidOther: [{ currency: "EUR", minor: 50_000n }], search: "" });
    expect(short(mixed)).toEqual([["לגבייה", "4 חשבוניות"]]);
  });

  it("tags the changed charges with their count, and one change with its new amount", () => {
    const change = { id: "t1", title: "חשמל עלה", down: false, now: "₪2,550", usual: "₪1,850", href: "/transactions/t1" };
    expect(short(attentionRows({ pending: 0, unpaidCount: 0, unpaidGross: 0n, changes: [change, { ...change, id: "t2" }, { ...change, id: "t3" }, { ...change, id: "t4" }], search: "" }))).toEqual([["חיובים קבועים השתנו", "4"]]);
    expect(short([changeRow(change)])).toEqual([["חשמל עלה", "₪2,550"]]);
  });

  it("tags a project's budget row", () => {
    const rows = (spent: number) => projectAttentionRows({ projectId: "p1", pending: 0, late: [], changes: [], search: "", budget: { budget_minor: 100_000, spent_minor: spent } });
    expect(short(rows(85_000))).toEqual([["תקציב", "מעל 80%"]]);
    expect(short(rows(120_000))).toEqual([["תקציב", "חריגה"]]);
  });
});

describe("loansAttention's short titles", () => {
  const row = (id: string, name: string, extra: Partial<LoanListRow> = {}): LoanListRow => ({ id, name, currency: "USD", balanceMinor: 1_000_000n, flaggedParts: 0, projectId: null, projectName: null, ...extra });

  it("says לבדיקה with the payments' count, and a payment due soon by its loan and when", () => {
    const cards = loansAttention([
      row("a", "משכנתא אלון", { flaggedParts: 2 }),
      row("b", "שטר הזית", { flaggedParts: 1 }),
      row("c", "הלוואת ציוד", { next: { dueDate: "2026-11-15", amountMinor: 131_200n } }),
      row("d", "גישור", { next: { dueDate: "2026-11-07", amountMinor: 100n } }),
    ], "2026-11-07", (id) => `/loans/${id}`);
    expect(short(cards)).toEqual([
      ["לבדיקה", "2 תשלומים"],
      ["לבדיקה", "תשלום אחד"],
      ["גישור", "היום"],
      ["הלוואת ציוד", "8 ימים"],
    ]);
    // The full title is still the card's name.
    expect(cards[0]?.title).toBe("2 תשלומים ממתינים לבדיקה · משכנתא אלון");
  });
});

describe("investmentAttentionRows' short titles", () => {
  const r = birchLaneReturns;

  it("names the missing input and tags it חסר, or the last value's date", () => {
    const rows = investmentAttentionRows("rent", { ...r, missing: ["value_history", "land", "tax_bracket", "purchase"], inputs: { ...r.inputs, valueDate: "2026-10-01", landSuggestion: null } }, "/b", "", false);
    expect(short(rows)).toEqual([
      ["עדכון שווי", "01/10/2026"],
      ["שווי הקרקע", "חסר"],
      ["מדרגת מס", "חסרה"],
      ["מחיר רכישה", "חסר"],
    ]);
  });

  it("tags a renovation's typed ARV as an estimate", () => {
    const rows = investmentAttentionRows("flip", { ...r, inputs: { ...r.inputs, arvMinor: 50_000_000n, purchaseMinor: null } }, "/b", "", false);
    expect(short(rows)).toEqual([["ARV", "הערכה"], ["מחיר רכישה", "חסר"]]);
  });
});
