import { computeMemberProjection, computeMemberShare } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { MEMBER_CONFIG, MEMBER_LOANS, MEMBER_PROJECTION_INPUTS, MEMBER_PROPERTIES } from "../dev/member-report-sample";
import { forecastDrill } from "./member-report-forecast";
import { forecastDraft, forecastFormula, forecastYear, projectionFromDraft, propertyYearFormula, signedBp, missingByReason, untilFormula, withHidden } from "./member-report-forecast-format";

/* FLOW-1127: the forecast tab's formulas and its assumptions draft. */

const share = computeMemberShare(MEMBER_CONFIG, MEMBER_PROPERTIES, [], MEMBER_LOANS);
const projection = computeMemberProjection({
  config: MEMBER_CONFIG, properties: MEMBER_PROPERTIES, loans: MEMBER_LOANS, inputs: MEMBER_PROJECTION_INPUTS.properties,
  asOf: MEMBER_PROJECTION_INPUTS.asOf, today: MEMBER_PROJECTION_INPUTS.today, expectedRatePpm: share.rate.expectedPpm,
});
const minor = (v: { kind: string }) => (v.kind === "money" ? (v as unknown as { minor: bigint }).minor : 0n);

describe("the forecast's החישוב", () => {
  it("adds up: new loan − loans − members' loans − closing = what the members split; their part, loans and total", () => {
    const a = projection.members[0] ?? null;
    const rows = forecastFormula(projection, a).rows;
    expect(rows.map((r) => r.label)).toEqual([
      "הלוואה חדשה", "סילוק הלוואות", "החזר הלוואות שותפים", "עלויות סגירה", "כסף שמשתחרר לשותפים", "החלק של Member A", "הלוואות של Member A", "סה״כ ל־Member A",
    ]);
    const [loan, payoff, repaid, closing, split] = rows.map((r) => minor(r.value));
    expect((loan ?? 0n) + (payoff ?? 0n) + (repaid ?? 0n) + (closing ?? 0n)).toBe(split);
    expect(minor(rows.at(-1)?.value ?? { kind: "x" })).toBe(a?.totalMinor);
    expect(forecastYear(projection)).toBe(2036);
  });

  it("opens each row's parts, whose lines add up to its total", () => {
    for (const key of ["loan", "payoff", "closing", "split", "share", "total", "member_loans"] as const) {
      const d = forecastDrill(key, projection);
      expect(d.lines.reduce((s, l) => s + l.minor, 0n)).toBe(d.total);
    }
  });

  it("says the rate is today's, not a forecast, and shows the DSCR", () => {
    const text = untilFormula(projection, null).rows.map((r) => r.hint).join(" ");
    expect(text).toContain("הריבית הצפויה היום, לא תחזית");
    expect(untilFormula(projection, null).rows.map((r) => r.key)).toEqual(["cash", "payment", "dscr"]);
  });

  it("states one property's year, ending with its cash flow", () => {
    const y = projection.properties[0]?.years[0];
    if (y == null) throw new Error("no year");
    const f = propertyYearFormula(y, projection);
    const sum = f.rows.filter((r) => r.key !== "noi").reduce((s, r) => s + minor(r.value), 0n);
    expect(sum).toBe(y.cashFlowMinor);
    expect(f.result).toMatchObject({ value: { minor: y.cashFlowMinor } });
  });
});

describe("the assumptions draft", () => {
  it("starts at the defaults and saves nothing when nothing changed", () => {
    const d = forecastDraft(undefined);
    expect([d.growth.rent, d.growth.insurance, d.maintenance, d.stayMonths, d.emptyMonths, d.turnoverCost, d.rate]).toEqual(["3", "5", "5", 24, "1", "2000", ""]);
    expect(projectionFromDraft(d)).toEqual({ projection: null });
  });

  it("saves only what differs, with a year's own change, and reads it back", () => {
    const d = forecastDraft(undefined);
    d.growth.rent = "4";
    d.byYear.rent[1] = "8";
    d.rate = "6.25";
    d.categoryTypes = { "e0000000-0000-4000-8000-000000000003": "other" };
    const built = projectionFromDraft(d);
    expect(built).toEqual({ projection: { rent_growth_bp: 400, by_year: { rent: { "2": 800 } }, rate_ppm: 62_500, category_types: { "e0000000-0000-4000-8000-000000000003": "other" } } });
    if (!("projection" in built) || built.projection == null) throw new Error("not built");
    expect(forecastDraft(built.projection).byYear.rent[1]).toBe("8");
  });

  it("names the first value that is not valid", () => {
    const d = forecastDraft(undefined);
    d.growth.tax = "40";
    expect(projectionFromDraft(d)).toEqual({ invalid: "מס נכס" });
    expect(signedBp("-2.5", -2000, 3000)).toBe(-250);
    expect(signedBp("abc", -2000, 3000)).toBeNull();
  });
});

describe("withHidden", () => {
  it("keeps the refinance's years, LTV, closing and term the sheet doesn't show", () => {
    expect(withHidden({ years: 5, ltv_bp: 7000, closing_bp: 200, term_years: 25, rent_growth_bp: 300 }, { rent_growth_bp: 400 }))
      .toEqual({ years: 5, ltv_bp: 7000, closing_bp: 200, term_years: 25, rent_growth_bp: 400 });
  });
  it("is null when nothing is set", () => {
    expect(withHidden(undefined, null)).toBeNull();
    expect(withHidden({ rent_growth_bp: 300 }, null)).toBeNull();
  });
});

describe("missingByReason", () => {
  it("groups the properties left out under one line per reason, in the order the reasons first appear", () => {
    expect(missingByReason([
      { projectId: "a", name: "A St", reason: "rent" },
      { projectId: "b", name: "B St", reason: "value" },
      { projectId: "c", name: "C St", reason: "rent" },
    ])).toEqual([
      { reason: "אין שכירות ב־3 החודשים האחרונים", names: ["A St", "C St"] },
      { reason: "אין שווי", names: ["B St"] },
    ]);
  });
});
