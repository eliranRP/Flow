import type { MissingBill, PartyCharges, RecurringChange } from "@flow/shared";
import { describe, expect, it } from "vitest";
import {
  amountOf,
  bannerText,
  changeFor,
  changeLine,
  chargeAlert,
  chargeHref,
  ignoredText,
  metaOf,
  monthsThrough,
  shiftMonth,
  statusOf,
} from "./recurring-charge";
import { RECURRING_CHANGES_FIXTURE, RECURRING_FIXTURE, RECURRING_MISSING_FIXTURE } from "./recurring-sample";
import type { ScheduleRow } from "./recurring-schedule";

const row = (id: string): ScheduleRow => {
  const found = RECURRING_FIXTURE.find((item) => item.party_id === id);
  if (found == null) throw new Error(id);
  return found;
};
const WATER = row("water");
const POWER = row("power");
const ELM = row("rent-elm");
const TODAY = "2026-10-11";

describe("the charge's status and meta (FLOW-447c)", () => {
  it("an arrived expense reads its day, and its meta the full date and the kind", () => {
    expect(statusOf(WATER, "2026-10-05")).toEqual({ text: "שולם 05/10", tone: "accent" });
    expect(metaOf(WATER, "2026-10-05")).toBe("05/10/2026 · הוצאה");
  });

  it("an arrived income reads התקבל, with the income kind", () => {
    const income = row("rent-birch");
    expect(statusOf(income, "2026-10-01")).toEqual({ text: "התקבל 01/10", tone: "accent" });
    expect(metaOf(income, "2026-10-01")).toBe("01/10/2026 · הכנסה");
  });

  it("a late bill reads לא הגיע in the bad tone, and its meta the usual amount, not paid yet", () => {
    expect(statusOf(POWER, null)).toEqual({ text: "לא הגיע", tone: "bad" });
    expect(metaOf(POWER, null)).toBe("הוצאה · הסכום הרגיל, עוד לא שולם");
    expect(metaOf(ELM, null)).toBe("הכנסה · הסכום הרגיל, עוד לא התקבל");
  });

  it("a bill due later this month reads צפוי, and a later one the month it is next due", () => {
    expect(statusOf(row("hoa"), null).text).toBe("צפוי ב־15/10");
    expect(statusOf(row("lawn"), null).text).toBe("הבא ב־12/2026");
  });
});

describe("the banner and the ignored line (FLOW-447c)", () => {
  it("counts the late days from the usual day, for an expense and for an income", () => {
    expect(bannerText(POWER, { kind: "missing", key: "k", active: true }, TODAY)).toBe("החשבון באיחור 8 ימים");
    expect(bannerText(ELM, { kind: "missing", key: "k", active: true }, TODAY)).toBe("התקבול באיחור 10 ימים");
  });

  it("says how far a change is, up or down", () => {
    const change = { kind: "change" as const, key: "k", active: true };
    expect(bannerText(WATER, change, TODAY)).toBe("גבוה ב־38% מהרגיל");
    const down = { ...WATER, amount_minor: 8000, typical_amount_minor: 10000 };
    expect(bannerText(down, change, TODAY)).toBe("נמוך ב־20% מהרגיל");
  });

  it("gives the grey line for each kind of ignore", () => {
    expect(ignoredText("missing")).toBe("התעלמת מההתראה. היא תחזור אם גם החיוב הבא יאחר.");
    expect(ignoredText("change")).toBe("התעלמת מההתראה. היא תחזור בשינוי הבא.");
  });
});

describe("the change (FLOW-447c)", () => {
  it("is the percent of an arrival against its usual amount, and null for anything else", () => {
    expect(changeFor(WATER)).toBe(38);
    expect(changeFor(POWER)).toBeNull();
  });

  it("reads כרגיל below 20%, and the words up or down above it, red only when it hurts", () => {
    expect(changeLine({ ...WATER, amount_minor: 10400 }, "USD", true).change).toBe("כרגיל");
    const up = changeLine(WATER, "USD", true);
    expect(up.change).toBe("עלה ב־38%");
    expect(up.hurts).toBe(true);
    expect(changeLine(WATER, "USD", false).hurts).toBe(false);
    const incomeDown = changeLine({ ...row("rent-birch"), amount_minor: 168000 }, "ILS", true);
    expect(incomeDown.change).toBe("ירד ב־20%");
    expect(incomeDown.hurts).toBe(true);
  });
});

describe("monthsThrough (FLOW-447c)", () => {
  const months = (list: [string, bigint][]): PartyCharges["months"] => list.map(([month, amount_minor]) => ({ month, amount_minor }));

  it("pads a late bill's window up to this month, with zero", () => {
    const window = months([["2026-05", 1n], ["2026-06", 2n], ["2026-07", 3n], ["2026-08", 4n], ["2026-09", 5n]]);
    const padded = monthsThrough(window, "2026-10");
    expect(padded.map((entry) => entry.month)).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(padded.at(-1)?.amount_minor).toBe(0n);
  });

  it("keeps the newest six, dropping the oldest", () => {
    const window = months([["2026-04", 9n], ["2026-05", 1n], ["2026-06", 2n], ["2026-07", 3n], ["2026-08", 4n], ["2026-09", 5n]]);
    const padded = monthsThrough(window, "2026-10");
    expect(padded).toHaveLength(6);
    expect(padded[0]?.month).toBe("2026-05");
    expect(padded.at(-1)?.month).toBe("2026-10");
  });

  it("shifts a YYYY-MM month across a year end", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", 2)).toBe("2027-01");
  });
});

describe("chargeAlert (FLOW-447c)", () => {
  const bill = (party: string): MissingBill => {
    const found = RECURRING_MISSING_FIXTURE.find((item) => item.party_id === party);
    if (found == null) throw new Error(party);
    return found;
  };
  const change: RecurringChange[] = RECURRING_CHANGES_FIXTURE;

  it("a late bill that is listed alerts with its key and its suggestion", () => {
    expect(chargeAlert(POWER, RECURRING_MISSING_FIXTURE, change, "tx-power-09")).toEqual({
      kind: "missing",
      key: "expense:power:USD:2026-10",
      active: true,
      suggestion: bill("power").suggestion,
    });
  });

  it("a late bill that is not listed was ignored, and keeps the key to bring it back", () => {
    const without = RECURRING_MISSING_FIXTURE.filter((item) => item.party_id !== "power");
    expect(chargeAlert(POWER, without, change, "tx-power-09")).toEqual({ kind: "missing", key: "expense:power:USD:2026-10", active: false });
  });

  it("with no missing read, a late bill still alerts, with no key", () => {
    expect(chargeAlert(POWER, undefined, change, null)).toEqual({ kind: "missing", key: null, active: true });
  });

  it("a change of 20% or more keys its alert by the arrival, and is ignored once it leaves the list", () => {
    expect(chargeAlert(WATER, RECURRING_MISSING_FIXTURE, change, "tx-water-10")).toEqual({ kind: "change", key: "tx-water-10", active: true });
    expect(chargeAlert(WATER, RECURRING_MISSING_FIXTURE, [], "tx-water-10")).toEqual({ kind: "change", key: "tx-water-10", active: false });
  });

  it("a change under 20% raises no alert at all", () => {
    expect(chargeAlert({ ...WATER, amount_minor: 10400 }, RECURRING_MISSING_FIXTURE, change, "tx")).toBeNull();
  });
});

describe("chargeHref and amountOf (FLOW-447c)", () => {
  it("the charge page's path, with the preview query when there is one", () => {
    expect(chargeHref("expense", "power")).toBe("/recurring/expense/power");
    expect(chargeHref("income", "rent-elm", "?preview=loading")).toBe("/recurring/income/rent-elm?preview=loading");
  });

  it("an arrival is the amount it came at; a bill not paid yet is the usual amount, muted", () => {
    expect(amountOf(WATER)).toEqual({ minor: 14200n, muted: false });
    expect(amountOf(POWER)).toEqual({ minor: 18600n, muted: true });
  });
});
