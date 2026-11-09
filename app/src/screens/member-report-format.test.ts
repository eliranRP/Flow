import { computeMemberShare } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { MEMBER_CONFIG, MEMBER_LOANS, MEMBER_PROPERTIES } from "../dev/member-report-sample";
import { applyPatch, parseMemberReport } from "../use-member-report";
import {
  bpText,
  memberIndex,
  modeOf,
  ppmText,
  profitFormula,
  propertyProfitFormula,
  propertySaleFormula,
  quoteRateText,
  refiFormula,
  saleFormula,
  sellingHint,
  spreadText,
  verdictText,
} from "./member-report-format";
import { drillOf } from "./member-report-parts";
import { draftMembers, draftTotalBp, membersDraft, membersProblem, percentToUnits, spreadOptions, withLoanOwner } from "./member-report-sheets";

const result = computeMemberShare(MEMBER_CONFIG, MEMBER_PROPERTIES);

describe("member report words", () => {
  it("writes rates, percents and spreads", () => {
    expect(ppmText(58_800)).toBe("5.88%");
    expect(quoteRateText(61_250)).toBe("6.125%");
    expect(quoteRateText(62_500)).toBe("6.25%");
    expect(bpText(7500)).toBe("75%");
    expect(bpText(250)).toBe("2.5%");
    expect(spreadText(150)).toBe("+1.5");
  });

  it("says how far each quote is from the expected rate", () => {
    expect(result.quotes.map(verdictText)).toEqual([
      "מעל הצפוי ב־0.37%",
      "מעל הצפוי ב־0.12% · קרוב",
      "מתחת לצפוי ב־0.08% · הצעה טובה",
    ]);
  });

  it("reads the member and the mode from the address", () => {
    expect(memberIndex("?member=2", 3)).toBe(2);
    expect(memberIndex("?member=5", 3)).toBe(0);
    expect(memberIndex("", 0)).toBe(0);
    expect(modeOf("?mode=refi")).toBe("refi");
    expect(modeOf("?mode=other")).toBe("sell");
  });
});

describe("member report formulas", () => {
  it("ends the sale with the member's part, and with the company's whole before ownership", () => {
    const member = result.members[0];
    if (member == null) throw new Error("no member");
    const sale = saleFormula(result, member);
    expect(sale.rows.map((r) => r.label)).toEqual(["שווי הנכסים", "עלויות מכירה", "סילוק הלוואות", "הון נקי", "החלק של Member A"]);
    expect(sale.rows.at(-1)).toMatchObject({ value: { minor: 17_284_500n } });
    expect(sale.result).toBeNull();
    const whole = saleFormula(result, null);
    expect(whole.rows).toHaveLength(4);
    expect(whole.rows.at(-1)).toMatchObject({ label: "לכל השותפים", value: { minor: 34_569_000n } });
  });

  it("ends the refinance with the cash it frees", () => {
    expect(refiFormula(result, null).rows.at(-1)).toMatchObject({ value: { minor: 13_450_500n } });
  });

  it("opens every row's parts: each row names its sheet", () => {
    const member = { name: "Member A", ownershipBp: 5000 };
    expect(saleFormula(result, result.members[0] ?? null).rows.map((r) => r.target)).toEqual(
      ["value", "selling", "loans", "net", "share"].map((sheet) => ({ kind: "sheet", sheet })));
    expect(refiFormula(result, result.members[0] ?? null).rows.map((r) => r.target)).toEqual(
      ["loan", "payoff", "closing", "cash", "share"].map((sheet) => ({ kind: "sheet", sheet })));
    // Before ownership, the company's whole opens the net (or the cash freed).
    expect(saleFormula(result, null).rows.at(-1)?.target).toEqual({ kind: "sheet", sheet: "net" });
  });

  it("names the selling cost's percent, its range, and the default", () => {
    expect(sellingHint(result.properties)).toBe("7% · תיווך, סגירה ומסים");
    const mixed = computeMemberShare(MEMBER_CONFIG, MEMBER_PROPERTIES.map((p, i) => (i === 0 ? { ...p, selling_cost_bp: 800 } : p)));
    expect(sellingHint(mixed.properties)).toBe("7%–8% · תיווך, סגירה ומסים");
    const defaults = computeMemberShare(MEMBER_CONFIG, MEMBER_PROPERTIES.map((p) => ({ ...p, selling_cost_bp: null })));
    expect(sellingHint(defaults.properties)).toBe("8% · ברירת מחדל · תיווך, סגירה ומסים");
    expect(sellingHint([])).toBe("תיווך, סגירה ומסים");
  });
});

describe("a row's parts", () => {
  it("takes every figure from the result, with its total", () => {
    const selling = drillOf("selling", "sell", result, "USD");
    expect(selling.lines.map((l) => l.minor)).toEqual(result.properties.map((p) => p.sellingCostMinor));
    expect(selling.lines[0]?.hint).toBe("7% × $420,000");
    expect(selling.total).toBe(result.totals.sellingCostMinor);
    expect(drillOf("net", "sell", result, "USD").lines[0]?.hint).toBe("$420,000 − $29,400 − $268,000");
    expect(drillOf("value", "sell", result, "USD").lines[0]?.hint).toBe("הערכה מ־01/11/2026");
  });

  it("puts a property that is not refinanced apart, and leaves it out of the total", () => {
    const deep = computeMemberShare(MEMBER_CONFIG, [{ ...MEMBER_PROPERTIES[0], loan_balance_minor: 40_000_000n } as typeof MEMBER_PROPERTIES[number], ...MEMBER_PROPERTIES.slice(1)]);
    const cash = drillOf("cash", "refi", deep, "USD");
    expect(cash.lines.map((l) => l.title)).toEqual(["Juniper Ct", "Sable Ct"]);
    expect(cash.rest?.lines.map((l) => l.title)).toEqual(["Birch Lane"]);
    expect(cash.total).toBe(deep.totals.cashOutMinor);
  });

  it("gives every member's share of the total", () => {
    const share = drillOf("share", "sell", result, "USD");
    expect(share.lines.map((l) => [l.title, l.minor])).toEqual(result.members.map((m) => [m.name, m.saleMinor]));
    expect(share.lines[1]?.hint).toBe("30% × $345,690");
    expect(drillOf("share", "refi", result, "USD").total).toBe(result.totals.cashOutMinor);
  });
});

describe("member report sheets", () => {
  it("reads a typed percent into its units", () => {
    expect(percentToUnits("6.125", 3, 10_000, 300_000)).toBe(61_250);
    expect(percentToUnits("75", 2, 100, 10_000)).toBe(7500);
    expect(percentToUnits("6.1234", 3, 10_000, 300_000)).toBeNull();
    expect(percentToUnits("101", 2, 100, 10_000)).toBeNull();
    expect(percentToUnits("abc", 2, 100, 10_000)).toBeNull();
  });

  it("saves the members only when named, unique, valid and at exactly 10000 basis points", () => {
    expect(membersProblem([{ name: "A", percent: "60" }, { name: "B", percent: "40" }])).toBeNull();
    expect(membersProblem([{ name: "A", percent: "60" }, { name: "B", percent: "30" }])).toBe("חסרים 10% עד 100%.");
    expect(membersProblem([{ name: "A", percent: "33.33" }, { name: "B", percent: "33.33" }, { name: "C", percent: "33.33" }])).toBe("חסרים 0.01% עד 100%.");
    expect(membersProblem([{ name: "A", percent: "60.5" }, { name: "B", percent: "40" }])).toBe("עודף של 0.5% מעל 100%.");
    expect(membersProblem([{ name: "A", percent: "50" }, { name: "a", percent: "50" }])).toBe("שני שותפים באותו שם.");
    expect(membersProblem([{ name: "A", percent: "33.333" }, { name: "B", percent: "66.667" }])).toBe("בעלות היא בין 0 ל־100%, עד שתי ספרות אחרי הנקודה.");
    expect(membersProblem([{ name: " ", percent: "100" }])).toBe("לכל שותף צריך שם.");
    expect(membersProblem([])).toBeNull();
  });

  it("opens and saves a split in basis points unchanged", () => {
    const stored = [{ name: "A", ownership_bp: 3333 }, { name: "B", ownership_bp: 3333 }, { name: "C", ownership_bp: 3334 }];
    const draft = membersDraft(stored);
    expect(draft.map((m) => m.percent)).toEqual(["33.33", "33.33", "33.34"]);
    expect(draftTotalBp(draft)).toBe(10_000);
    expect(membersProblem(draft)).toBeNull();
    expect(draftMembers(draft)).toEqual(stored);
    const quarter = [{ name: "A", ownership_bp: 2525 }, { name: "B", ownership_bp: 7475 }];
    expect(draftMembers(membersDraft(quarter))).toEqual(quarter);
  });

  it("offers +1.5 and +2.0, and a stored spread that is neither", () => {
    expect(spreadOptions(150).map((o) => o.label)).toEqual(["+1.5", "+2.0"]);
    expect(spreadOptions(175).map((o) => [o.value, o.label])).toEqual([["150", "+1.5"], ["175", "+1.75"], ["200", "+2.0"]]);
    expect(spreadOptions(250).map((o) => o.label)).toEqual(["+1.5", "+2.0", "+2.5"]);
  });

  it("merges a patch the way the server does: a null part clears it", () => {
    expect(applyPatch({ quote_date: "2026-11-03", rate_rule: { tenor_years: 10 } }, { quote_date: null, rate_rule: { tenor_years: 5 } }))
      .toEqual({ rate_rule: { tenor_years: 5 } });
  });
});

describe("parseMemberReport", () => {
  it("reads amounts as bigints and the owner flag", () => {
    const read = parseMemberReport({
      config: null,
      properties: [{ project_id: "p", name: "Birch Lane", currency: "USD", value_minor: 42_000_000, value_date: null, selling_cost_bp: null, loan_balance_minor: "26800000", loans_other_currency: false }],
      can_edit: false,
    });
    expect(read.properties[0]?.loan_balance_minor).toBe(26_800_000n);
    expect(read.canEdit).toBe(false);
    // Before #1079 deploys the Treasury's times are absent: both read as null.
    expect([read.treasuryFetchedAt, read.treasuryRequestedAt]).toEqual([null, null]);
    const fetched = parseMemberReport({ config: null, properties: [], can_edit: true, treasury_fetched_at: "2026-11-09T07:30:00Z", treasury_requested_at: null });
    expect(fetched.treasuryFetchedAt).toBe("2026-11-09T07:30:00Z");
  });
});

describe("all-in, profit and the members' loans (FLOW-1124)", () => {
  const withLoans = computeMemberShare(MEMBER_CONFIG, MEMBER_PROPERTIES, [], MEMBER_LOANS);
  const a = withLoans.members[0] ?? null;

  it("repays the members' loans, then ends with the member's total", () => {
    const sale = saleFormula(withLoans, a);
    expect(sale.rows.map((r) => r.label)).toEqual([
      "שווי הנכסים", "עלויות מכירה", "סילוק הלוואות", "החזר הלוואות שותפים", "הון נקי", "החלק של Member A", "הלוואות של Member A", "סה״כ ל־Member A",
    ]);
    expect(sale.rows.map((r) => (r.value.kind === "money" ? r.value.minor : null))).toEqual([
      108_300_000n, -7_581_000n, -64_150_000n, -7_000_000n, 29_569_000n, 14_784_500n, 5_000_000n, 19_784_500n,
    ]);
    expect(sale.rows.map((r) => r.target)).toEqual(
      ["value", "selling", "loans", "member_loans", "net", "share", "member_loans", "total"].map((sheet) => ({ kind: "sheet", sheet })));
  });

  it("counts the profit against the all-in, and the member's part", () => {
    const profit = profitFormula(withLoans, a);
    expect(profit.rows.map((r) => [r.label, r.value.kind === "money" ? r.value.minor : null])).toEqual([
      ["שווי הנכסים", 108_300_000n],
      ["עלויות מכירה", -7_581_000n],
      ["עלות כוללת", -82_000_000n],
      ["רווח", 18_719_000n],
      ["החלק של Member A", 9_359_500n],
    ]);
    expect(profitFormula(withLoans, null).rows.at(-1)).toMatchObject({ label: "רווח לכל השותפים", target: { kind: "sheet", sheet: "profit" } });
  });

  it("opens each new row's parts", () => {
    expect(drillOf("all_in", "sell", withLoans, "USD").lines[0]?.hint).toBe("$270,000 + $25,000 + $5,000");
    expect(drillOf("profit", "sell", withLoans, "USD").lines.map((l) => l.minor)).toEqual([9_060_000n, 2_945_000n, 6_714_000n]);
    expect(drillOf("member_loans", "sell", withLoans, "USD").lines.map((l) => [l.title, l.hint, l.minor])).toEqual([
      ["Member A note", "Member A · של החברה", 5_000_000n],
      ["Member B note", "Member B · Juniper Ct", 2_000_000n],
    ]);
    const net = drillOf("net", "sell", withLoans, "USD");
    expect(net.lines.at(-1)).toMatchObject({ title: "Member A note", minor: -5_000_000n });
    expect(net.lines.reduce((sum, l) => sum + l.minor, 0n)).toBe(net.total);
    expect(drillOf("loans", "sell", withLoans, "USD").lines[1]?.hint).toBe("יתרות היום · בלי הלוואת שותף $20,000");
    expect(drillOf("total", "sell", withLoans, "USD").lines[0]).toMatchObject({ hint: "$147,845 + $50,000", minor: 19_784_500n });
    expect(drillOf("profit_share", "sell", withLoans, "USD").lines[1]?.minor).toBe(withLoans.members[1]?.profitMinor);
  });

  it("shows a property's member loan apart, and its profit, or none without a purchase", () => {
    const juniper = withLoans.properties[1];
    if (juniper == null) throw new Error("no property");
    expect(propertySaleFormula(juniper, null).rows.map((r) => r.label)).toEqual(["שווי", "עלויות מכירה", "סילוק הלוואות", "החזר הלוואת שותף"]);
    expect(propertyProfitFormula(juniper, null)?.result).toMatchObject({ value: { minor: 2_945_000n } });
    expect(propertyProfitFormula({ ...juniper, allInMinor: null, profitMinor: null }, null)).toBeNull();
  });

  it("gives a loan to one member in the draft, and saves each member's loans", () => {
    const draft = membersDraft(MEMBER_CONFIG.members ?? []);
    const moved = withLoanOwner(draft, "d0000000-0000-4000-8000-000000000001", 2);
    expect(moved.map((m) => m.loanIds)).toEqual([[], ["d0000000-0000-4000-8000-000000000002"], ["d0000000-0000-4000-8000-000000000001"]]);
    expect(draftMembers(withLoanOwner(moved, "d0000000-0000-4000-8000-000000000001", -1))[2]).toEqual({ name: "Member C", ownership_bp: 2000 });
    expect(draftMembers(draft)[0]).toEqual({ name: "Member A", ownership_bp: 5000, loan_ids: ["d0000000-0000-4000-8000-000000000001"] });
  });
});

describe("a refinance pays a member's loan back (FLOW-1129)", () => {
  const withLoans = computeMemberShare(MEMBER_CONFIG, MEMBER_PROPERTIES, [], MEMBER_LOANS);
  const b = withLoans.members[1] ?? null;

  it("shows the members' loans apart from the payoff, then the member's total", () => {
    const refi = refiFormula(withLoans, b);
    expect(refi.rows.map((r) => r.label)).toEqual([
      "הלוואה חדשה", "סילוק הלוואות", "החזר הלוואות שותפים", "עלויות סגירה", "כסף שמשתחרר", "החלק של Member B", "הלוואות של Member B", "סה״כ ל־Member B",
    ]);
    expect(refi.rows.find((r) => r.key === "member_loans")?.value).toMatchObject({ minor: -2_000_000n });
    expect(refi.rows.at(-1)?.value).toMatchObject({ minor: (b?.refinanceMinor ?? 0n) + 2_000_000n });
  });

  it("puts the properties not refinanced apart, with their own sum", () => {
    const deep = computeMemberShare(MEMBER_CONFIG, [{ ...MEMBER_PROPERTIES[0], loan_balance_minor: 40_000_000n } as typeof MEMBER_PROPERTIES[number], ...MEMBER_PROPERTIES.slice(1)], [], MEMBER_LOANS);
    const payoff = drillOf("payoff", "refi", deep, "USD");
    expect(payoff.lines.map((l) => l.title)).toEqual(["Juniper Ct", "Sable Ct"]);
    expect(payoff.lines.reduce((sum, l) => sum + l.minor, 0n)).toBe(payoff.total);
    expect(payoff.rest).toMatchObject({ title: "לא ממוחזרים · לא נספרים", total: 40_000_000n });
    expect(payoff.lines[0]?.hint).toBe("יתרות היום · בלי הלוואת שותף $20,000");
    expect(drillOf("member_loans", "refi", deep, "USD").lines.map((l) => l.title)).toEqual(["Member B note"]);
    expect(drillOf("total", "refi", deep, "USD").lines[1]?.minor).toBe(deep.members[1]?.refiTotalMinor);
  });
});
