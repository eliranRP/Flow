import { describe, expect, it } from "vitest";
import { groupLoansByKind, type LoanListRow } from "./loan-list";
import { loanRowHint, loansAttention } from "./loans-list";

// FLOW-1046: the Loans list's groups by kind, its row lines and its דורש טיפול cards. Invented loans.

function row(id: string, name: string, extra: Partial<LoanListRow> = {}): LoanListRow {
  return { id, name, currency: "USD", balanceMinor: 1_000_000n, flaggedParts: 0, projectId: null, projectName: null, ...extra };
}

describe("groupLoansByKind", () => {
  it("puts the rows in the kinds' order, alphabetical inside each, with no empty group", () => {
    const groups = groupLoansByKind([
      row("d", "שותף", { kind: "demand", balanceMinor: 300n }),
      row("b", "גישור", { kind: "interest_only" }),
      row("m2", "משכנתא ב"),
      row("m1", "משכנתא א", { kind: "amortizing" }),
    ]);
    expect(groups.map((group) => [group.title, group.rows.map((item) => item.id)])).toEqual([
      ["פריסה רגילה", ["m1", "m2"]],
      ["ריבית בלבד", ["b"]],
      ["לפי דרישה", ["d"]],
    ]);
    expect(groups[0]?.totals).toEqual([{ currency: "USD", minor: 2_000_000n }]);
  });

  it("keeps one sum per currency, since two currencies do not add", () => {
    const [group] = groupLoansByKind([row("a", "א"), row("b", "ב", { currency: "ILS", balanceMinor: 5n })]);
    expect(group?.totals).toEqual([{ currency: "USD", minor: 1_000_000n }, { currency: "ILS", minor: 5n }]);
  });

  it("draws a balloon loan in its own group", () => {
    expect(groupLoansByKind([row("a", "א", { kind: "balloon" })]).map((group) => group.title)).toEqual(["בלון"]);
  });
});

describe("loanRowHint", () => {
  it("says the next payment and the project, ממתין לבדיקה first when payments wait", () => {
    expect(loanRowHint(row("a", "א", { projectName: "דירת הגפן", next: { dueDate: "2026-11-20", amountMinor: 524_000n } }))).toBe("הבא 20/11 · $5,240 · דירת הגפן");
    expect(loanRowHint(row("a", "א", { flaggedParts: 2, kind: "demand" }))).toBe("ממתין לבדיקה · בלי תשלום קבוע · בלי פרויקט");
  });

  it("says how and when a closed loan ended", () => {
    expect(loanRowHint(row("a", "א", { status: "paid_off", closedOn: "2026-03-31", projectName: "הנשיא" }))).toBe("נפרעה 03/2026 · הנשיא");
  });
});

describe("loansAttention", () => {
  const href = (id: string) => `/loans/${id}`;

  it("lists the loans waiting for a check, then a payment due within ten days, each keyed by what it counts", () => {
    const rows = [
      row("n", "שטר הזית", { flaggedParts: 1 }),
      row("b", "גישור", { next: { dueDate: "2026-11-15", amountMinor: 131_200n } }),
      row("m", "משכנתא", { next: { dueDate: "2026-11-30", amountMinor: 524_000n } }),
      row("c", "סגורה", { flaggedParts: 3, status: "closed" }),
    ];
    const cards = loansAttention(rows, "2026-11-05", href);
    expect(cards.map((card) => [card.id, card.title, card.to, card.dismissKey])).toEqual([
      ["check:n", "תשלום אחד ממתין לבדיקה · שטר הזית", "/loans/n", "check:1"],
      ["soon:b", "תשלום גישור בעוד 10 ימים · $1,312", "/loans/b", "soon:2026-11-15"],
    ]);
  });

  it("says היום and מחר for the nearest days", () => {
    const cards = loansAttention([
      row("a", "א", { next: { dueDate: "2026-11-05", amountMinor: 100n } }),
      row("b", "ב", { next: { dueDate: "2026-11-06", amountMinor: 100n } }),
    ], "2026-11-05", href);
    expect(cards.map((card) => card.title)).toEqual(["תשלום א היום · $1", "תשלום ב מחר · $1"]);
  });
});
