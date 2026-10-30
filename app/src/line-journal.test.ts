import { describe, expect, it } from "vitest";
import { journalSides, legKeptOut, legName, legTypeLabel, parseLineJournal } from "./line-journal";

/** FLOW-954: the line's journal entry as get_line_journal returns it. Invented legs. */
const payload = {
  transaction_id: "t1",
  currency: "USD",
  balanced: true,
  booked_by_ai: true,
  legs: [
    { ordinal: 1, account_id: "a1", account_name: "ריבית", account_type: "expense", system: false, is_bank: false, in_pnl: true, category_name: "ריבית", project_id: "p1", project_name: "Alpha", amount_minor: 140000 },
    { ordinal: 2, account_id: "a2", account_name: "Escrow", account_type: "asset", system: true, is_bank: false, in_pnl: false, category_name: null, project_id: "p1", project_name: "Alpha", amount_minor: 60000 },
    { ordinal: 3, account_id: "a3", account_name: "Bank/Clearing", account_type: "asset", system: true, is_bank: true, in_pnl: false, category_name: null, project_id: null, project_name: null, amount_minor: -200000 },
  ],
};

describe("the line's journal (FLOW-954)", () => {
  it("parses the read, amounts as bigints, and null for no line", () => {
    const journal = parseLineJournal(payload);
    expect(journal?.legs.map((leg) => leg.amount_minor)).toEqual([140000n, 60000n, -200000n]);
    expect(journal?.booked_by_ai).toBe(true);
    expect(parseLineJournal(null)).toBeNull();
  });

  it("debits then credits, each in ledger order, and what the debits add up to", () => {
    const journal = parseLineJournal(payload);
    if (journal == null) throw new Error("no journal");
    const sides = journalSides(journal.legs);
    expect(sides.debit.map((leg) => leg.ordinal)).toEqual([1, 2]);
    expect(sides.credit.map((leg) => leg.ordinal)).toEqual([3]);
    expect(sides.total).toBe(200000n);
  });

  it("names a leg: the bank account, a system account in Hebrew, or the category", () => {
    const journal = parseLineJournal(payload);
    if (journal == null) throw new Error("no journal");
    const [interest, escrow, bank] = journal.legs;
    if (interest == null || escrow == null || bank == null) throw new Error("legs");
    expect(legName(bank, "Example Checking ••1234")).toBe("Example Checking ••1234");
    expect(legName(bank, null)).toBe("בנק");
    expect(legName(escrow, null)).toBe("פיקדון מסים וביטוח");
    expect(legName({ account_name: "Loan principal", is_bank: false, system: true, category_name: null }, null)).toBe("קרן הלוואה");
    // A kept-out leg on a system account names the category that posted there (FLOW-953 binding).
    expect(legName({ account_name: "Property", is_bank: false, system: true, category_name: "רכישת נכס" }, null)).toBe("נכסים · רכישת נכס");
    // The escrow account already says "מסים וביטוח", so its category is not repeated.
    expect(legName({ account_name: "Escrow", is_bank: false, system: true, category_name: "מסים וביטוח" }, null)).toBe("פיקדון מסים וביטוח");
    // A shorter word inside the account name is still a different category; empty says nothing.
    expect(legName({ account_name: "Property", is_bank: false, system: true, category_name: "נכס" }, null)).toBe("נכסים · נכס");
    expect(legName({ account_name: "Loan principal", is_bank: false, system: true, category_name: "הלוואה" }, null)).toBe("קרן הלוואה");
    expect(legName({ account_name: "Escrow", is_bank: false, system: true, category_name: "פיקדון" }, null)).toBe("פיקדון מסים וביטוח · פיקדון");
    expect(legName({ account_name: "Property", is_bank: false, system: true, category_name: "  " }, null)).toBe("נכסים");
    expect(legName(interest, null)).toBe("ריבית");
    // FLOW-177: the last two system accounts have Hebrew names too.
    expect(legName({ account_name: "Accumulated depreciation", is_bank: false, system: true, category_name: null }, null)).toBe("פחת שנצבר");
    expect(legName({ account_name: "Bank/Clearing", is_bank: false, system: true, category_name: null }, null)).toBe("בנק");
    expect([interest, escrow, bank].map(legTypeLabel)).toEqual(["הוצאה", "נכס", "בנק"]);
    expect(legTypeLabel({ account_type: "liability", is_bank: false })).toBe("התחייבות");
    expect(legTypeLabel({ account_type: "income", is_bank: false })).toBe("הכנסה");
    expect(legTypeLabel({ account_type: "equity", is_bank: false })).toBe("הון");
  });

  it("only a leg that is neither the bank nor in profit is kept out", () => {
    const journal = parseLineJournal(payload);
    if (journal == null) throw new Error("no journal");
    expect(journal.legs.map(legKeptOut)).toEqual([false, true, false]);
  });
});
