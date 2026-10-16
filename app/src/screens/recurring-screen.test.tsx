import { describe, expect, it } from "vitest";
import type { ScheduleRow } from "../recurring-schedule";
import { recurringView } from "./recurring-screen";

/** The brief's rule-25 fixture as the server returns it (invented names, USD, today 2026-10-11). */
const row = (over: Partial<ScheduleRow> & Pick<ScheduleRow, "party_id" | "party_name" | "state" | "typical_amount_minor" | "typical_day">): ScheduleRow => ({
  direction: "expense",
  currency: "USD",
  amount_minor: null,
  pace: "month",
  next_due_month: "2026-10",
  expected_by: "2026-10-31",
  project_id: null,
  project_name: null,
  category_id: null,
  category_name: null,
  ...over,
});

const FIXTURE: ScheduleRow[] = [
  row({ party_id: "power", party_name: "Brightline Power", state: "late", typical_amount_minor: 18600, typical_day: 3, project_name: "Birch Lane", category_name: "חשמל ומים" }),
  row({ party_id: "rent-elm", party_name: "Elm Row unit 2", direction: "income", state: "late", typical_amount_minor: 165000, typical_day: 1, project_name: "Elm Row", category_name: "שכירות" }),
  row({ party_id: "hoa", party_name: "Juniper Pointe HOA", state: "soon", typical_amount_minor: 31000, typical_day: 15, project_name: "Juniper Ct", category_name: "אחזקה" }),
  row({ party_id: "internet", party_name: "Harborlink Internet", state: "soon", typical_amount_minor: 13000, typical_day: 18, category_name: "משרד" }),
  row({ party_id: "insurance", party_name: "Keystone Mutual", state: "soon", typical_amount_minor: 21200, typical_day: 20, project_name: "Juniper Ct", category_name: "ביטוח ומסים" }),
  row({ party_id: "waste", party_name: "Clearway Waste", state: "soon", typical_amount_minor: 8800, typical_day: 25, project_name: "Sable Ct", category_name: "אחזקה" }),
  row({ party_id: "software", party_name: "Docsuite", state: "soon", typical_amount_minor: 3600, typical_day: 28, category_name: "משרד" }),
  row({ party_id: "water", party_name: "Bayside Water Utility", state: "arrived", typical_amount_minor: 10300, amount_minor: 14200, typical_day: 5, project_name: "Elm Row", category_name: "חשמל ומים" }),
  row({ party_id: "phone", party_name: "Signalpoint Mobile", state: "arrived", typical_amount_minor: 8400, amount_minor: 8400, typical_day: 6, category_name: "משרד" }),
  row({ party_id: "pest", party_name: "Brightside Pest", state: "arrived", typical_amount_minor: 6500, amount_minor: 6500, typical_day: 2, project_name: "Birch Lane", category_name: "אחזקה" }),
  row({ party_id: "rent-birch", party_name: "Birch Lane rent", direction: "income", state: "arrived", typical_amount_minor: 210000, amount_minor: 210000, typical_day: 1, project_name: "Birch Lane", category_name: "שכירות" }),
  row({ party_id: "rent-juniper", party_name: "Juniper Ct rent", direction: "income", state: "arrived", typical_amount_minor: 185000, amount_minor: 185000, typical_day: 1, project_name: "Juniper Ct", category_name: "שכירות" }),
  row({ party_id: "lawn", party_name: "Fernway Lawn", state: "later", typical_amount_minor: 12000, typical_day: 12, pace: "2months", next_due_month: "2026-12", project_name: "Juniper Ct", category_name: "אחזקה" }),
  row({ party_id: "pinecrest", party_name: "Pinecrest Insurance", state: "later", typical_amount_minor: 54000, typical_day: 10, pace: "quarter", next_due_month: "2027-01", project_name: "Sable Ct", category_name: "ביטוח ומסים" }),
  row({ party_id: "tax", party_name: "Bay County Tax", state: "later", typical_amount_minor: 342000, typical_day: 30, pace: "year", next_due_month: "2026-11", project_name: "Birch Lane", category_name: "ביטוח ומסים" }),
];

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
});
