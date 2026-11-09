import type { RpcClient } from "../recurring-actions";
import type { ScheduleRow } from "../recurring-schedule";
import type { UtilityBill, UtilityPayer, UtilityPayment } from "../utility-refunds";

/**
 * FLOW-1135: the V3-UtilityRefunds board's sample, for the stories and the tests. Invented properties, suppliers,
 * payers and amounts only.
 */
export const GEFEN = "p-gefen-3";
export const PINE = "p-pine-4";

function payment(id: string, date: string, minor: bigint, party: string, category: string, project: string | null): UtilityPayment {
  return { transaction_id: id, doc_date: date, amount_minor: minor, currency: "USD", description: "Zelle", party, project_id: project, category_id: `c-${category}`, category_name: category, split: false };
}

function bill(over: Partial<UtilityBill> & Pick<UtilityBill, "bill_transaction_id" | "project_id" | "supplier_name" | "amount_minor" | "doc_date" | "days" | "state">): UtilityBill {
  return {
    project_name: over.project_id === GEFEN ? "דירת הגפן 3" : "Pine Ave 4",
    supplier_id: `s-${String(over.supplier_name)}`,
    currency: "USD",
    category_id: "c-power-water",
    category_name: "חשמל ומים",
    source: null,
    rule: null,
    group_bill_transaction_ids: [],
    no_rent: false,
    payment: null,
    wrong_category: false,
    keep_category: false,
    refiled: false,
    ...over,
  };
}

export function utilityRefundsSample(): UtilityBill[] {
  return [
    bill({
      bill_transaction_id: "b-water-gefen", project_id: GEFEN, supplier_name: "City Water", amount_minor: 8_420n, doc_date: "2026-09-14", days: 56,
      state: "suggested", rule: "rent_and_bills", wrong_category: true,
      payment: payment("pay-zelle-a", "2026-10-02", 188_420n, "Tenant A", "שכירות", GEFEN),
    }),
    bill({
      bill_transaction_id: "b-power-pine", project_id: PINE, supplier_name: "Power Co", amount_minor: 9_710n, doc_date: "2026-09-05", days: 65,
      state: "suggested", rule: "bill", wrong_category: true,
      payment: payment("pay-zelle-b", "2026-09-12", 9_710n, "Tenant B", "הכנסה אחרת", null),
    }),
    bill({ bill_transaction_id: "b-power-gefen", project_id: GEFEN, supplier_name: "Power Co", amount_minor: 12_840n, doc_date: "2026-09-03", days: 67, state: "not_refunded" }),
    bill({ bill_transaction_id: "b-gas-gefen", project_id: GEFEN, supplier_name: "Gas Co", amount_minor: 4_600n, doc_date: "2026-08-20", days: 81, state: "not_refunded", category_name: "גז" }),
    bill({ bill_transaction_id: "b-water-pine", project_id: PINE, supplier_name: "City Water", amount_minor: 6_100n, doc_date: "2026-08-11", days: 90, state: "not_refunded", no_rent: true }),
    bill({ bill_transaction_id: "b-net-pine", project_id: PINE, supplier_name: "Net Co", amount_minor: 5_999n, doc_date: "2026-09-30", days: 40, state: "not_refunded", category_name: "אינטרנט" }),
  ];
}

/** A suggestion the owner already said yes to: the payment sits under שכירות, so the fix shows. */
export function utilityFixSample(): UtilityBill[] {
  const [first] = utilityRefundsSample();
  return first == null ? [] : [{ ...first, state: "refunded", source: "owner" }];
}

function payer(name: string, usual: bigint | null, over: Partial<UtilityPayer> = {}): UtilityPayer {
  return {
    supplier_id: `s-${name}`, supplier_name: name, currency: "USD", payer: "tenant", added: false, found: true, usual_minor: usual,
    bill_count: usual == null ? 0 : 6, last_bill_date: usual == null ? null : "2026-10-03", category_id: "c-power-water", category_name: "חשמל ומים", ...over,
  };
}

export function utilityPayersSample(): UtilityPayer[] {
  return [
    payer("City Water", 8_000n),
    payer("Power Co", 12_000n),
    payer("Gas Co", 4_500n, { category_id: "c-gas", category_name: "גז" }),
    payer("Net Co", null, { payer: "company", added: true, found: false, category_id: "c-net", category_name: "אינטרנט" }),
  ];
}

/** The property's recurring expenses הוספת ספק offers (one of them is a utility already). */
export function utilityScheduleSample(): ScheduleRow[] {
  const row = (party: string, name: string, minor: number, category: string): ScheduleRow => ({
    direction: "expense", party_id: party, party_name: name, currency: "USD", state: "arrived", typical_amount_minor: minor,
    amount_minor: minor, typical_day: 5, pace: "month", next_due_month: "2026-11-01", expected_by: "2026-11-05",
    project_id: GEFEN, project_name: "דירת הגפן 3", category_id: `c-${category}`, category_name: category,
  });
  return [row("s-City Water", "City Water", 8_000, "חשמל ומים"), row("s-Trash Co", "Trash Co", 3_500, "פינוי אשפה")];
}

/** The sample as the server's JSON: amounts in minor units as digit strings, as the schemas read them. */
function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_, item: unknown) => (typeof item === "bigint" ? item.toString() : item)));
}

/**
 * A stand-in for Flow's server in the stories (UtilityClientProvider): the utility reads answer from the sample
 * (one property's with p_project_id), and every write succeeds, so a story's answer shows its toast with ביטול.
 */
export function storyUtilityClient(bills: UtilityBill[] = utilityRefundsSample(), utilities: UtilityPayer[] = utilityPayersSample()): RpcClient {
  const rpc = (name: string, args: Record<string, unknown> = {}) => {
    const project = typeof args.p_project_id === "string" ? args.p_project_id : null;
    const own = bills.filter((bill) => project == null || bill.project_id === project);
    const data = name === "list_utility_refunds" ? { as_of: "2026-11-09", bills: asJson(own) }
      : name === "list_utility_payers" ? { project_id: project, utilities: asJson(utilities) }
        : name === "mark_utility_refunds_seen" ? { bill_transaction_ids: own.filter((bill) => bill.state === "not_refunded").map((bill) => bill.bill_transaction_id) }
          : name === "set_utility_payer" ? { prior: null }
            : null;
    return Promise.resolve({ data, error: null });
  };
  return { rpc } as unknown as RpcClient;
}
