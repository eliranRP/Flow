import { describe, expect, it } from "vitest";
import { birchLaneReturns, birchLaneReturnsBeforeRent, birchLaneReturnsCashOut } from "../dev/returns-sample";
import type { PropertyReturns } from "./project-returns-data";
import { DEAL_METRIC_KEYS, FLIP_GROUPS, RENT_GROUPS, anyMetricPage, anyMetricValue, dealMetricCaption, dealMetricPage, dealMetricValue } from "./project-returns-deal";
import { METRIC_KEYS, partPage, profitFormula } from "./project-returns-info";
import { PERCENT_KINDS, SELLING_EMPTY, SELLING_RANGE, percentVerdict } from "./project-returns-sheets";
import { sellingSample } from "./project-investment-screen";

/* FLOW-1068 (decision 0260): the deal metrics, the net profit and the costs of selling. Invented figures. */

const noArv: PropertyReturns = {
  ...birchLaneReturns,
  inputs: { ...birchLaneReturns.inputs, arvMinor: null },
  deal: { ...birchLaneReturns.deal, sellingCostMinor: null, netProfitMinor: null },
  metrics: { ...birchLaneReturns.metrics, flipRoiBp: null, flipRoiYearBp: null, arvMarginBp: null, rule70Minor: null },
};

describe("the deal metrics", () => {
  it("groups every metric once: a rental's return, risk and price, a renovation's return and price", () => {
    const rent = RENT_GROUPS.flatMap((group) => group.metrics);
    const flip = FLIP_GROUPS.flatMap((group) => group.metrics);
    expect(new Set([...rent, ...flip])).toEqual(new Set([...METRIC_KEYS, ...DEAL_METRIC_KEYS]));
    expect(rent.length + flip.length).toBe(METRIC_KEYS.length + DEAL_METRIC_KEYS.length);
  });

  it("reads each figure as the server worked it out", () => {
    expect(dealMetricValue("roe", birchLaneReturns)).toEqual({ kind: "text", text: "65.8%" });
    expect(dealMetricValue("multiple", birchLaneReturns)).toEqual({ kind: "text", text: "0.90x" });
    expect(dealMetricValue("grm", birchLaneReturns)).toEqual({ kind: "text", text: "7.7" });
    expect(dealMetricValue("flip-roi", birchLaneReturns)).toEqual({ kind: "text", text: "102.2%" });
    expect(dealMetricValue("rule-70", birchLaneReturns)).toEqual({ kind: "money", minor: -2_930_000n, income: false });
  });

  it("asks for the ARV when a renovation's figures need it, and never reads 0", () => {
    for (const metric of ["flip-roi", "flip-roi-year", "arv-margin", "rule-70"] as const) {
      expect(dealMetricValue(metric, noArv)).toEqual({ kind: "missing", add: "arv", note: undefined });
    }
    expect(dealMetricCaption("rule-70", noArv)).toBe("ARV × 70% פחות השיפוץ, מול מה ששולם");
  });

  it("waits for the first rent on the figures that read the statement, and keeps the rest", () => {
    for (const metric of ["roe", "break-even", "grm", "expense-ratio"] as const) {
      expect(dealMetricValue(metric, birchLaneReturnsBeforeRent)).toEqual({ kind: "note", text: "לפני השכירות הראשונה" });
    }
    expect(dealMetricValue("ltv", birchLaneReturnsBeforeRent).kind).toBe("text");
  });

  it("reads ∞ for a return on no money in", () => {
    expect(dealMetricValue("roi-since", birchLaneReturnsCashOut)).toEqual({ kind: "text", text: "∞" });
    expect(dealMetricValue("multiple", birchLaneReturnsCashOut)).toEqual({ kind: "text", text: "∞" });
  });

  it("draws each page's division, and none for a missing figure", () => {
    expect(dealMetricPage("roe", birchLaneReturns).result?.text).toBe("⁦$19,745 ÷ $30,000⁩");
    expect(dealMetricPage("break-even", birchLaneReturns).result?.text).toBe("⁦$18,000 ÷ $24,000⁩");
    expect(dealMetricPage("flip-roi-year", birchLaneReturns).result?.text).toBe("⁦102.2% × 365 ÷ 296⁩");
    expect(dealMetricPage("rule-70", birchLaneReturns).result?.text).toBe("⁦$155,700 − $185,000⁩");
    expect(dealMetricPage("arv-margin", noArv).result).toBeNull();
    // One entry point for both kinds of metric.
    expect(anyMetricPage("coc", birchLaneReturns).title).toBe("תשואה על המזומן");
    expect(anyMetricValue("ltv", birchLaneReturns)).toEqual({ kind: "text", text: "87.5%" });
  });
});

describe("the net profit", () => {
  it("takes the selling costs, the purchase, the renovation and the holding from the ARV", () => {
    const formula = profitFormula(birchLaneReturns);
    expect(formula.rows.map((row) => row.key)).toEqual(["arv", "selling", "purchase", "rehab", "holding"]);
    expect(formula.rows.find((row) => row.key === "selling")?.target).toEqual({ kind: "edit", field: "selling_cost" });
    expect(formula.rows.find((row) => row.key === "selling")?.hint).toBe("8% מה־ARV · הערכה · עריכה");
    expect(formula.result?.value).toEqual({ kind: "money", minor: 3_710_000n, income: false });
    expect(partPage("profit", birchLaneReturns).title).toBe("רווח נקי צפוי");
  });

  it("sets the costs of selling in sample mode as the server does, and null goes back to 8%", () => {
    const six = sellingSample(birchLaneReturns, 600);
    expect(six.deal).toMatchObject({ sellingCostBp: 600, sellingCostDefault: false, sellingCostMinor: 1_860_000n, netProfitMinor: 4_330_000n });
    expect(sellingSample(six, null).deal).toMatchObject({ sellingCostBp: 800, sellingCostDefault: true, netProfitMinor: 3_710_000n });
  });

  it("keeps the selling cost between 0 and 30%, and an empty one asks to go back to the default", () => {
    const kind = PERCENT_KINDS.selling;
    expect(percentVerdict(null, "6", kind)).toEqual({ kind: "save", bp: 600 });
    expect(percentVerdict(null, "31", kind)).toEqual({ kind: "hold", message: SELLING_RANGE });
    expect(percentVerdict(600, "", kind)).toEqual({ kind: "hold", message: SELLING_EMPTY });
  });
});
