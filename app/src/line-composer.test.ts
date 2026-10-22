import { describe, expect, it } from "vitest";
import { formatAmountText } from "@flow/shared";
import { SAMPLE_COPIES } from "./dev/journal-composer-sample";
import {
  bookingPayload,
  composerAccounts,
  composerBalance,
  composerHold,
  composerRefusal,
  copySideText,
  legNote,
  legsFromEntry,
  nextLeg,
  undoParts,
  type ComposerLeg,
} from "./line-composer";

/** FLOW-955. The composer's pure logic. Invented figures; USD cents. */
const leg = (side: ComposerLeg["side"], amount: string, accountId: string | null = "a"): ComposerLeg => ({ key: amount + side, accountId, projectId: null, side, amount });

describe("the accounts a line can take", () => {
  const accounts = composerAccounts({
    accounts: [
      { id: "bank", name: "Bank/Clearing", type: "asset", system: true, is_bank: true, excluded_from_pnl: true, hidden: false, bookable: true, posts_to: null },
      { id: "close", name: "Closing costs", type: "expense", system: false, is_bank: false, excluded_from_pnl: false, hidden: false, bookable: true, posts_to: null },
      { id: "loan", name: "Loan received", type: "income", system: false, is_bank: false, excluded_from_pnl: true, hidden: false, bookable: true, posts_to: "lp" },
      { id: "lp", name: "Loan principal", type: "liability", system: true, is_bank: false, excluded_from_pnl: true, hidden: false, bookable: true, posts_to: null },
      { id: "sus", name: "Suspense", type: "asset", system: true, is_bank: false, excluded_from_pnl: true, hidden: false, bookable: false, posts_to: null },
      { id: "old", name: "Old", type: "expense", system: false, is_bank: false, excluded_from_pnl: false, hidden: true, bookable: true, posts_to: null },
    ],
  });

  it("leaves out the bank (שורה 1), what book_line can't take, and hidden categories", () => {
    expect(accounts.map((account) => account.id)).toEqual(["close", "loan", "lp"]);
  });

  it("names a system account in Hebrew and puts a kept-out category under the account it posts to", () => {
    expect(accounts.find((account) => account.id === "lp")).toEqual({ id: "lp", name: "קרן הלוואה", group: "liability", inPnl: false });
    expect(accounts.find((account) => account.id === "loan")).toEqual({ id: "loan", name: "Loan received", group: "liability", inPnl: false });
    expect(legNote(accounts[0])).toBe("הוצאה · נספר ברווח");
    expect(legNote(accounts[1])).toBe("התחייבות · לא נספר ברווח");
    expect(legNote(undefined)).toBe("בחרו חשבון");
  });
});

describe("the balance", () => {
  // $200,000 in: the bank is a debit.
  const bank = 20_000_000n;

  it("balances when the credits equal the bank and the other debits", () => {
    const legs = [leg("debit", "6500"), leg("credit", "206500")];
    expect(composerBalance(bank, legs)).toEqual({ debit: 20_650_000n, credit: 20_650_000n, diff: 0n, complete: true, balanced: true });
    expect(composerHold(bank, legs)).toEqual({ kind: "balanced", total: 20_650_000n });
  });

  it("says which side is short, and by how much", () => {
    expect(composerHold(bank, [leg("debit", "6500"), leg("credit", "200000")])).toEqual({ kind: "short", side: "credit", minor: 650_000n });
    expect(composerHold(-235_000n, [leg("debit", "1400"), leg("debit", "600")])).toEqual({ kind: "short", side: "debit", minor: 35_000n });
  });

  it("waits for an account and an amount on every line", () => {
    expect(composerHold(bank, [leg("credit", "200000", null), leg("debit", "1")]).kind).toBe("short");
    expect(composerHold(bank, [leg("debit", "0.01"), leg("credit", "200000.01", null)])).toEqual({ kind: "incomplete" });
    expect(composerHold(bank, [])).toEqual({ kind: "short", side: "credit", minor: bank });
  });

  it("one line on its own is an assignment, not an entry", () => {
    expect(composerHold(bank, [leg("credit", "200000")])).toEqual({ kind: "single", total: bank });
  });

  it("+ שורה נוספת takes the short side and what is missing", () => {
    expect(nextLeg(bank, [leg("debit", "6500")])).toMatchObject({ side: "credit", amount: "206500", accountId: null });
    expect(nextLeg(-235_000n, [leg("debit", "1400.25")])).toMatchObject({ side: "debit", amount: "949.75" });
    expect(nextLeg(bank, [leg("debit", "6500"), leg("credit", "206500")])).toMatchObject({ side: "credit", amount: "" });
  });
});

describe("the save and its undo", () => {
  it("books the bank as it moved, then each line signed (a debit positive)", () => {
    const legs: ComposerLeg[] = [
      { key: "1", accountId: "close", projectId: "p1", side: "debit", amount: "6500" },
      { key: "2", accountId: "loan", projectId: null, side: "credit", amount: "206500" },
    ];
    expect(bookingPayload("bank", 20_000_000n, legs)).toEqual([
      { account_id: "bank", amount_minor: 20_000_000 },
      { account_id: "close", amount_minor: 650_000, project_id: "p1" },
      { account_id: "loan", amount_minor: -20_650_000 },
    ]);
    expect(bookingPayload("bank", 1n, [leg("debit", "1", null)])).toBeNull();
  });

  it("ביטול sends the parts before back, a credit part still a credit", () => {
    expect(undoParts([
      { category_id: "c1", project_id: "p1", amount_minor: 100n, gross_up: false },
      { category_id: "c2", project_id: null, amount_minor: 50n, gross_up: true },
    ])).toEqual([
      { category_id: "c1", project_id: "p1", amount_minor: 100 },
      { category_id: "c2", project_id: null, amount_minor: 50, gross_up: true },
    ]);
  });

  it("server legs become lines on their side with positive amounts", () => {
    const lines = legsFromEntry([
      { account_id: "close", project_id: "p1", amount_minor: 600_000n },
      { account_id: "loan", project_id: "p1", amount_minor: -20_600_000n },
    ]);
    expect(lines.map(({ accountId, side, amount }) => ({ accountId, side, amount }))).toEqual([
      { accountId: "close", side: "debit", amount: "6000" },
      { accountId: "loan", side: "credit", amount: "206000" },
    ]);
  });

  it("each refusal reads in the composer's words", () => {
    expect(composerRefusal("legs do not balance")).toBe("הפקודה לא מאוזנת. בדקו את הסכומים.");
    expect(composerRefusal("book_line: one category leg on an existing line — use assign_expense")).toMatch(/שיוך רגיל/);
    expect(composerRefusal("line has an open review")).toMatch(/ממתינה לאישור/);
    expect(composerRefusal("something else")).toBe("לא הצלחנו לשמור את הפקודה.");
  });
});

describe("the copy sheet", () => {
  it("writes a past line's sides compactly, the bank as בנק", () => {
    const copy = SAMPLE_COPIES.lines[0];
    if (copy == null) throw new Error("sample");
    const money = (minor: bigint) => formatAmountText(minor, "USD", { detail: true });
    expect(copySideText(copy, "debit", money)).toBe("בנק $150,000 · עלויות סגירה $4,500");
    expect(copySideText(copy, "credit", money)).toBe("הלוואה · Example $154,500");
  });
});
