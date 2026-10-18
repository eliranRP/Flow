import { describe, expect, it } from "vitest";
import { RECURRING_FIXTURE as FIXTURE, RECURRING_MISSING_FIXTURE as MISSING } from "../recurring-sample";
import { alertState } from "../recurring-schedule";
import { recurringView } from "./recurring-screen";

describe("recurringView (rule-25 fixture)", () => {
  const view = recurringView(FIXTURE, "2026-10-11");

  it("shows the month and the count, and the outflow the board does", () => {
    expect(view.subtitle).toBe("אוקטובר 2026 • 15 קבועים");
    expect(view.outflow.total).toBe(125300n);
    expect(view.outflow.paid).toBe(29100n);
    expect(view.outflow.toCome).toBe(96200n);
  });

  it("leads with the two late charges, each with its lateness", () => {
    expect(view.late.map((item) => [item.name, item.hint])).toEqual([
      ["Brightline Power", "באיחור 8 ימים"],
      ["Elm Row unit 2", "באיחור 10 ימים"],
    ]);
  });

  it("keeps late charges out of the group rows but counts them in the group's monthly cost", () => {
    const monthly = Object.fromEntries(view.groups.map((group) => [group.title, group.monthlyMinor]));
    expect(monthly).toEqual({ "חשמל ומים": 28900n, אחזקה: 52300n, משרד: 25000n, "ביטוח ומסים": 67700n, שכירות: 560000n });
    const names = view.groups.flatMap((group) => group.rows.map((item) => item.name));
    expect(names).not.toContain("Brightline Power");
    expect(names).not.toContain("Elm Row unit 2");
  });

  it("narrows to one project, named, with its own count", () => {
    const birch = recurringView(FIXTURE, "2026-10-11", "p-birch-lane");
    expect(birch.project).toBe("Birch Lane");
    expect(birch.subtitle).toBe("אוקטובר 2026 • 4 קבועים");
    const names = [...birch.late, ...birch.groups.flatMap((group) => group.rows)].map((item) => item.name);
    expect(names.sort()).toEqual(["Bay County Tax", "Birch Lane rent", "Brightline Power", "Brightside Pest"]);
  });

  it("shows a change of 20% or more as the bad-news hint", () => {
    const bayside = view.groups.flatMap((group) => group.rows).find((item) => item.name === "Bayside Water Utility");
    expect(bayside?.hint).toBe("▲ 38%");
    expect(bayside?.minor).toBe(14200n);
    expect(bayside?.paid).toBe(true);
  });

  it("names a charge by its project, or by its category when it has none", () => {
    const places = Object.fromEntries(view.groups.flatMap((group) => group.rows).map((item) => [item.name, item.place]));
    expect(places["Juniper Pointe HOA"]).toBe("Juniper Ct");
    expect(places["Harborlink Internet"]).toBe("משרד");
  });

  it("reads the server's negative expenses as the same amounts as positive ones", () => {
    const signed = FIXTURE.map((item) => (item.direction === "expense" ? { ...item, typical_amount_minor: -item.typical_amount_minor, amount_minor: item.amount_minor == null ? null : -item.amount_minor } : item));
    expect(recurringView(signed, "2026-10-11")).toEqual(view);
  });
});

describe("recurringView with the late bills (FLOW-447b)", () => {

  it("a late charge with a bill in missing_bills is active: keyed, with its suggestion", () => {
    const view = recurringView(FIXTURE, "2026-10-11", null, alertState(FIXTURE, MISSING));
    const power = view.late.find((item) => item.id === "power");
    expect(power?.alertKey).toBe("expense:power:USD:2026-10");
    expect(power?.suggestion).toEqual({ name: "Brightline Energy Svcs", partyId: "power-alt", minor: 19100n, date: "08/10" });
    expect(power?.href).toBe("/recurring/expense/power");
    expect(view.late.find((item) => item.id === "rent-elm")?.suggestion).toBeNull();
  });

  it("a dismissed late charge leaves the late section, is grey with no lateness, keeps its group's cost and the outflow", () => {
    const bills = MISSING.filter((bill) => bill.party_id !== "power");
    const view = recurringView(FIXTURE, "2026-10-11", null, alertState(FIXTURE, bills));
    expect(view.late.map((item) => item.id)).toEqual(["rent-elm"]);
    const power = view.groups.flatMap((group) => group.rows).find((item) => item.id === "power");
    expect(power?.paid).toBe(false);
    expect(power?.hint).toBeUndefined();
    expect(power?.href).toBe("/recurring/expense/power");
    const monthly = Object.fromEntries(view.groups.map((group) => [group.title, group.monthlyMinor]));
    expect(monthly["חשמל ומים"]).toBe(28900n);
    expect(view.outflow.total).toBe(125300n);
  });

  it("with no missing_bills data (a failed read) every late charge stays active, with no key to ignore it by", () => {
    const view = recurringView(FIXTURE, "2026-10-11", null, alertState(FIXTURE, undefined));
    expect(view.late.map((item) => [item.id, item.alertKey])).toEqual([
      ["power", null],
      ["rent-elm", null],
    ]);
  });
});
