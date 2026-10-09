import { describe, expect, it } from "vitest";
import {
  LOAN_REFUSALS,
  loanDeleteConsequence,
  loanFailure,
  loanPartsText,
  loanRefusalOf,
  loanRefusalPlace,
  loanRefusalText,
} from "./loan-copy";

const migrations = import.meta.glob<string>("../../../supabase/migrations/*.sql", { query: "?raw", import: "default", eager: true });

/** The body of the newest definition of a function. */
function latestBody(pattern: RegExp): string {
  const names = Object.keys(migrations).sort().reverse();
  for (const name of names) {
    const sql = migrations[name] ?? "";
    const start = sql.search(pattern);
    if (start < 0) continue;
    const body = sql.slice(start);
    const open = body.indexOf("$$");
    const close = body.indexOf("$$", open + 2);
    return body.slice(open, close);
  }
  throw new Error(`not found: ${pattern.source}`);
}

function raised(body: string): string[] {
  return [...new Set([...body.matchAll(/raise exception '([^']+)'/g)].map((match) => match[1] ?? ""))];
}

describe("loan refusal copy (FLOW-106 §5)", () => {
  it("has Hebrew for every reason save_loan_split, delete_loan and restore_loan raise", () => {
    const reasons = [
      ...raised(latestBody(/create (or replace )?function public\.save_loan_split\(/)),
      ...raised(latestBody(/create (or replace )?function public\.delete_loan\(/)),
      ...raised(latestBody(/create (or replace )?function public\.restore_loan\(/)),
      ...raised(latestBody(/create (or replace )?function private\.loan_restore\(/)),
    ];
    expect(reasons.length).toBeGreaterThan(10);
    const known: readonly string[] = LOAN_REFUSALS;
    const missing = [...new Set(reasons)].filter((reason) => !known.includes(reason));
    expect(missing, `no Hebrew copy for: ${missing.join(", ")}`).toEqual([]);
  });

  it("has Hebrew for every loan reason mcp_refused passes through", () => {
    const body = latestBody(/create (or replace )?function private\.mcp_refused\(/);
    const list = /when p_message in \(([\s\S]*?)\) then p_message/.exec(body)?.[1] ?? "";
    const reasons = [...list.matchAll(/'([^']+)'/g)].map((match) => match[1] ?? "");
    const loanish = reasons.filter((reason) => /loan|closed_on|payment|fees|rate before|later payment|fit the loan/.test(reason));
    expect(loanish.length).toBeGreaterThan(10);
    for (const reason of loanish) {
      const copy = loanRefusalOf(new Error(reason));
      expect(copy, `no Hebrew copy for mcp_refused reason: ${reason}`).not.toBeNull();
    }
  });

  it("writes every reason in Hebrew without the code", () => {
    for (const reason of LOAN_REFUSALS) {
      const copy = loanRefusalText(reason);
      expect(copy).toMatch(/[֐-׿]/);
      expect(copy).not.toContain(reason);
    }
  });

  it("names the date, the target and the amounts when it knows them", () => {
    expect(loanRefusalText("loan_closed", { closedOn: "2025-11-30" })).toBe("ההלוואה נסגרה ב־30/11/2025. אפשר לשייך רק תשלומים עד התאריך הזה.");
    expect(loanRefusalText("a loan uses this category for a part the other category cannot take", { target: "עלויות סגירה" }))
      .toBe("הלוואה משתמשת בקטגוריה הזו, ו־עלויות סגירה לא מתאימה לאותו חלק. החליפו קודם את הקטגוריה בהלוואה.");
    expect(loanRefusalText("rate before the loan start", { startDate: "2026-03-01" })).toBe("התאריך לפני תחילת ההלוואה (01/03/2026).");
    expect(loanRefusalText("loan_split_sum", { currency: "USD", lineMinor: 400_000n, missingMinor: 5_000n })).toBe("החלקים צריכים להסתכם ב־$4,000. חסרים $50.");
    expect(loanRefusalText("loan_split_sum", { currency: "USD", overMinor: 1_250n })).toBe("עוברים את השורה ב־$12.50.");
  });

  it("reads the reason from a trigger, a check or an RPC message", () => {
    expect(loanRefusalOf(new Error("loan_payments_after_close"))).toBe("loan_payments_after_close");
    expect(loanRefusalOf(new Error('new row for relation "loans" violates check constraint "loans_kind_chk"'))).toBe("loans_kind_chk");
    expect(loanRefusalOf(new Error('new row for relation "loans" violates check constraint "loans_closed_chk"'))).toBe("loans_closed_chk");
    expect(loanRefusalOf(new Error("loan closed"))).toBe("loan closed");
    expect(loanRefusalOf(new Error("loan cannot be restored"))).toBe("loan cannot be restored");
    expect(loanRefusalOf(Object.assign(new Error("permission denied"), { code: "42501" }))).toBe("forbidden");
    expect(loanRefusalOf(new Error("Failed to fetch"))).toBeNull();
  });

  it("puts each refusal where plan §5 says", () => {
    expect(loanRefusalPlace("loan_payments_after_close")).toBe("status");
    expect(loanRefusalPlace("loan_category_not_allowed")).toBe("category");
    expect(loanRefusalPlace("loan_payment_below_interest")).toBe("kind");
    expect(loanRefusalPlace("rate before the loan start")).toBe("rate");
    expect(loanRefusalPlace("fees category required")).toBe("editor");
    expect(loanRefusalPlace("forbidden")).toBe("toast");
  });

  it("is final for a refusal and offers ניסיון חוזר for a dropped connection", () => {
    expect(loanFailure(Object.assign(new Error("denied"), { code: "42501" }))).toEqual({ message: "אין הרשאה לעדכן הלוואה.", retry: false });
    expect(loanFailure(new Error("Failed to fetch"))).toEqual({ message: "השינוי לא נשמר", retry: true });
  });

  it("counts the payments a delete sends back", () => {
    expect(loanDeleteConsequence(0)).toBe("אין תשלומים משויכים. שינויי הריבית יימחקו איתה.");
    expect(loanDeleteConsequence(1)).toBe("תשלום אחד יחזור לקטגוריה שלו.");
    expect(loanDeleteConsequence(3)).toBe("3 תשלומים יחזרו לקטגוריה שלהם.");
    expect(loanPartsText(4)).toBe("4 חלקים");
  });
});
