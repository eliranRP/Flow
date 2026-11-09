import { computeMemberShare } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { MEMBER_CONFIG, MEMBER_PROPERTIES } from "../dev/member-report-sample";
import { parseMemberReport } from "../use-member-report";
import { bpText, memberIndex, modeOf, ppmText, quoteRateText, refiFormula, saleFormula, spreadText, verdictText } from "./member-report-format";
import { applyPatch } from "./member-report-screen";
import { membersProblem, percentToUnits } from "./member-report-sheets";

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
    const sale = saleFormula(result, { name: member.name, ownershipBp: member.ownershipBp }, member.saleMinor);
    expect(sale.rows.map((r) => r.label)).toEqual(["שווי הנכסים", "עלויות מכירה", "סילוק הלוואות", "הון נקי"]);
    expect(sale.result).toMatchObject({ label: "החלק של Member A", value: { minor: 17_284_500n } });
    const whole = saleFormula(result, null, null);
    expect(whole.rows).toHaveLength(3);
    expect(whole.result).toMatchObject({ label: "לכל השותפים", value: { minor: 34_569_000n } });
  });

  it("ends the refinance with the cash it frees", () => {
    expect(refiFormula(result, null, null).result).toMatchObject({ value: { minor: 13_450_500n } });
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

  it("saves the members only when named, unique and at 100%", () => {
    expect(membersProblem([{ name: "A", percent: 60 }, { name: "B", percent: 40 }])).toBeNull();
    expect(membersProblem([{ name: "A", percent: 60 }, { name: "B", percent: 30 }])).toBe("חסרים 10% עד 100%.");
    expect(membersProblem([{ name: "A", percent: 60 }, { name: "B", percent: 50 }])).toBe("עודף של 10% מעל 100%.");
    expect(membersProblem([{ name: "A", percent: 50 }, { name: "a", percent: 50 }])).toBe("שני שותפים באותו שם.");
    expect(membersProblem([{ name: " ", percent: 100 }])).toBe("לכל שותף צריך שם.");
    expect(membersProblem([])).toBeNull();
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
  });
});
