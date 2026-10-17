import type { MissingBill } from "@flow/shared";
import type { ScheduleRow } from "./recurring-schedule";

/** The brief's rule-25 fixture as the server returns it (invented names, USD, today 2026-10-11). */
const row = (over: Partial<ScheduleRow> & Pick<ScheduleRow, "party_id" | "party_name" | "state" | "typical_amount_minor" | "typical_day">): ScheduleRow => ({
  direction: "expense",
  currency: "USD",
  amount_minor: null,
  pace: "month",
  next_due_month: "2026-10",
  expected_by: "2026-10-31",
  // The fixture's project ids are slugs of their names; the server's ids are not.
  project_id: over.project_name == null ? null : `p-${over.project_name.replace(/ /g, "-").toLowerCase()}`,
  project_name: null,
  category_id: null,
  category_name: null,
  ...over,
});

export const RECURRING_FIXTURE: ScheduleRow[] = [
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

/**
 * FLOW-447b: the late bills `missing_bills` returns for the fixture. The power bill has a suggestion
 * (a party under another name); the rent's late bill has none. A late row missing from this list is
 * one the user ignored.
 */
export const RECURRING_MISSING_FIXTURE: MissingBill[] = [
  {
    supplier_id: "power",
    supplier_name: "Brightline Power",
    currency: "USD",
    typical_amount_minor: -18600n,
    typical_day: 3,
    expected_by: "2026-10-03",
    months_seen: 6,
    last_doc_date: "2026-09-03",
    project_id: "p-birch-lane",
    category_id: null,
    project_name: "Birch Lane",
    category_name: "חשמל ומים",
    direction: "expense",
    party_id: "power",
    party_name: "Brightline Power",
    pace: "month",
    due_month: "2026-10",
    alert_key: "expense:power:USD:2026-10",
    suggestion: { party_id: "power-alt", party_name: "Brightline Energy Svcs", doc_date: "2026-10-08", amount_minor: 19100n },
  },
  {
    supplier_id: "rent-elm",
    supplier_name: "Elm Row unit 2",
    currency: "USD",
    typical_amount_minor: 165000n,
    typical_day: 1,
    expected_by: "2026-10-01",
    months_seen: 6,
    last_doc_date: "2026-09-01",
    project_id: "p-elm-row",
    category_id: null,
    project_name: "Elm Row",
    category_name: "שכירות",
    direction: "income",
    party_id: "rent-elm",
    party_name: "Elm Row unit 2",
    pace: "month",
    due_month: "2026-10",
    alert_key: "income:rent-elm:USD:2026-10",
    suggestion: null,
  },
];
