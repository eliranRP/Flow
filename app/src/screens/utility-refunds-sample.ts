import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { RpcClient } from "../recurring-actions";
import type { ScheduleRow } from "../recurring-schedule";
import type { UtilityBill, UtilityIncome, UtilityMonth, UtilityPayer, UtilityPayment } from "../utility-refunds";

/**
 * FLOW-1154: a story's page goes offline once its read (the query key's first part) has data, so it shows that data
 * with the offline line and the moment it is from. The network comes back when the story leaves.
 */
export function useOfflineOnceRead(key: string): void {
  const client = useQueryClient();
  useEffect(() => {
    const cache = client.getQueryCache();
    const check = () => {
      if (cache.findAll({ queryKey: [key] }).some((query) => query.state.data != null)) onlineManager.setOnline(false);
    };
    check();
    const stop = cache.subscribe(check);
    return () => {
      stop();
      onlineManager.setOnline(true);
    };
  }, [client, key]);
}

/**
 * FLOW-1135: the V3-UtilityRefunds board's sample, for the stories and the tests. Invented properties, suppliers,
 * payers and amounts only.
 */
export const GEFEN = "p-gefen-3";
export const PINE = "p-pine-4";

function payment(id: string, date: string, minor: bigint, party: string, category: string, project: string | null): UtilityPayment {
  return {
    transaction_id: id, doc_date: date, amount_minor: minor, currency: "USD", description: "Zelle", party, project_id: project,
    project_name: project === GEFEN ? "דירת הגפן 3" : project === PINE ? "Pine Ave 4" : null,
    category_id: `c-${category}`, category_name: category, split: false, parts: [],
  };
}

function bill(over: Partial<UtilityBill> & Pick<UtilityBill, "bill_transaction_id" | "project_id" | "supplier_name" | "amount_minor" | "doc_date" | "days" | "state">): UtilityBill {
  return {
    project_name: over.project_id === GEFEN ? "דירת הגפן 3" : "Pine Ave 4",
    supplier_id: `s-${String(over.supplier_name)}`,
    currency: "USD",
    category_id: "c-power-water",
    category_name: "חשמל ומים",
    source: null,
    no_rent: false,
    payment: null,
    wrong_category: false,
    keep_category: false,
    refiled: false,
    ...over,
  };
}

/**
 * Two refunds the owner matched that are filed elsewhere (the fix cards: the rent with the bill, and a payment on
 * no project), and four bills not refunded.
 */
export function utilityRefundsSample(): UtilityBill[] {
  return [
    bill({
      bill_transaction_id: "b-water-gefen", project_id: GEFEN, supplier_name: "City Water", amount_minor: 8_420n, doc_date: "2026-09-14", days: 56,
      state: "refunded", source: "owner", wrong_category: true,
      payment: payment("pay-zelle-a", "2026-10-02", 188_420n, "Tenant A", "שכירות", GEFEN),
    }),
    bill({
      bill_transaction_id: "b-power-pine", project_id: PINE, supplier_name: "Power Co", amount_minor: 9_710n, doc_date: "2026-09-05", days: 65,
      state: "refunded", source: "owner", wrong_category: true,
      payment: payment("pay-zelle-b", "2026-09-12", 9_710n, "Tenant B", "הכנסה אחרת", null),
    }),
    bill({ bill_transaction_id: "b-power-gefen", project_id: GEFEN, supplier_name: "Power Co", amount_minor: 12_840n, doc_date: "2026-09-03", days: 67, state: "not_refunded" }),
    bill({ bill_transaction_id: "b-gas-gefen", project_id: GEFEN, supplier_name: "Gas Co", amount_minor: 4_600n, doc_date: "2026-08-20", days: 81, state: "not_refunded", category_name: "גז" }),
    bill({ bill_transaction_id: "b-water-pine", project_id: PINE, supplier_name: "City Water", amount_minor: 6_100n, doc_date: "2026-08-11", days: 90, state: "not_refunded", no_rent: true }),
    bill({ bill_transaction_id: "b-net-pine", project_id: PINE, supplier_name: "Net Co", amount_minor: 5_999n, doc_date: "2026-09-30", days: 40, state: "not_refunded", category_name: "אינטרנט" }),
  ];
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

/** The income window as the server clamps it: 1 to 6 months, 2 by default. */
function clampMonths(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? Math.min(Math.max(value, 1), 6) : 2;
}

/** The sample as the server's JSON: amounts in minor units as digit strings, as the schemas read them. */
function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_, item: unknown) => (typeof item === "bigint" ? item.toString() : item)));
}

/**
 * A stand-in for Flow's server in the stories (UtilityClientProvider): the utility reads answer from the sample
 * (one property's with p_project_id), and every write succeeds, so a story's answer shows its toast with ביטול.
 */
export function storyUtilityClient(
  bills: UtilityBill[] = utilityRefundsSample(),
  utilities: UtilityPayer[] = utilityPayersSample(),
  months: UtilityMonth[] = utilityMonthsSample(),
  income: UtilityIncome = utilityIncomeSample(),
): RpcClient {
  const rpc = (name: string, args: Record<string, unknown> = {}) => {
    const project = typeof args.p_project_id === "string" ? args.p_project_id : null;
    const own = bills.filter((bill) => project == null || bill.project_id === project);
    const data = name === "list_utility_refunds" ? { as_of: "2026-11-09", bills: asJson(own) }
      : name === "list_utility_payers" ? { project_id: project, utilities: asJson(utilities) }
        : name === "list_utility_months" ? { project_id: args.p_project, as_of: "2026-11-09", months: asJson(months) }
        // FLOW-1159: the income around a bill; the window as the server clamps it (1..6 months).
        : name === "list_utility_income" ? { ...(asJson(income) as object), months: clampMonths(args.p_months) }
        : name === "mark_utility_refunds_seen" ? { bill_transaction_ids: own.filter((bill) => bill.state === "not_refunded").map((bill) => bill.bill_transaction_id) }
          : name === "set_utility_payer" ? { prior: null }
            : null;
    return Promise.resolve({ data, error: null });
  };
  return { rpc } as unknown as RpcClient;
}

/** FLOW-1142: the rent payment split by category: the rent on the property, the bill's part, and a part on another property. */
export function utilitySplitSample(): UtilityBill[] {
  return utilityRefundsSample().map((bill) => (bill.payment?.transaction_id !== "pay-zelle-a" ? bill : {
    ...bill,
    payment: {
      ...bill.payment,
      split: true,
      parts: [
        { category_id: "c-שכירות", category_name: "שכירות", project_id: GEFEN, project_name: "דירת הגפן 3", amount_minor: 170_000n },
        { category_id: "c-power-water", category_name: "חשמל ומים", project_id: GEFEN, project_name: "דירת הגפן 3", amount_minor: 8_420n },
        { category_id: "c-שכירות", category_name: "שכירות", project_id: PINE, project_name: "Pine Ave 4", amount_minor: 10_000n },
      ],
    },
  }));
}

/**
 * FLOW-1144 (the V3-Project-UtilityMonths board's months): November all back (FLOW-1146: its rent split into the rent and
 * the water the tenant paid with it), October with Gas Co not refunded, September
 * all back, and July with no rent. Newest first, as the read sends them.
 */
export function utilityMonthsSample(): UtilityMonth[] {
  const rent = (id: string, date: string, minor: bigint, parts: { category_name: string; amount_minor: bigint }[] = []) => ({
    transaction_id: id, doc_date: date, amount_minor: minor, currency: "USD", party: "RentRedi", category_name: "הכנסות שכירות", parts,
  });
  const bill = (id: string, date: string, minor: bigint, supplier: string, category: string, state: string) => ({
    bill_transaction_id: id, doc_date: date, amount_minor: minor, currency: "USD", supplier_name: supplier, category_name: category, state,
  });
  return [
    { month: "2026-11-01", rent_in: 183_660n, bills_paid: 8_660n, not_refunded: 0n, rent_lines: [rent("m-rent-11", "2026-11-06", 183_660n, [{ category_name: "הכנסות שכירות", amount_minor: 175_000n }, { category_name: "מים וביוב", amount_minor: 8_660n }])], bills: [bill("m-water-11", "2026-11-02", 8_660n, "City Water", "חשמל ומים", "refunded")] },
    {
      month: "2026-10-01", rent_in: 205_486n, bills_paid: 30_486n, not_refunded: 8_036n, rent_lines: [rent("m-rent-10", "2026-10-07", 205_486n)],
      bills: [bill("m-water-10", "2026-10-04", 22_450n, "City Water", "חשמל ומים", "refunded"), bill("m-gas-10", "2026-10-03", 8_036n, "Gas Co", "גז", "waiting")],
    },
    { month: "2026-09-01", rent_in: 195_000n, bills_paid: 26_333n, not_refunded: 0n, rent_lines: [rent("m-rent-09", "2026-09-10", 195_000n)], bills: [bill("m-water-09", "2026-09-05", 26_333n, "City Water", "חשמל ומים", "refunded")] },
    { month: "2026-07-01", rent_in: 0n, bills_paid: 6_100n, not_refunded: 6_100n, rent_lines: [], bills: [bill("m-water-07", "2026-07-08", 6_100n, "City Water", "חשמל ומים", "not_refunded")] },
  ];
}

/**
 * FLOW-1159 (V3-J-B3-ByType, V3-J-A3-Bill): every bill of one property, as list_utility_refunds with all gives them:
 * three types (חשמל, מים, ביוב) over September to November, each state. September's bills came back late with
 * October's rent (its water part also pays October's water, the same week: back the same month); November's water
 * came back with November's rent two days after it; October's power is not refunded; October's sewer and November's
 * power are still waiting; August's sewer was closed with ראיתי. As of 2026-11-09.
 */
export function utilityTypesSample(): UtilityBill[] {
  const part = (category: string, name: string, minor: bigint) => ({ category_id: category, category_name: name, project_id: GEFEN, project_name: "דירת הגפן 3", amount_minor: minor });
  const october = {
    ...payment("pay-rent-10", "2026-10-07", 212_140n, "RentRedi", "שכירות", GEFEN), description: null, split: true,
    parts: [part("c-שכירות", "שכירות", 175_000n), part("c-power", "חשמל", 18_020n), part("c-water", "מים", 12_280n), part("c-sewer", "ביוב", 6_840n)],
  };
  const november = {
    ...payment("pay-rent-11", "2026-11-06", 189_370n, "RentRedi", "שכירות", GEFEN), description: null, split: true,
    parts: [part("c-שכירות", "שכירות", 175_000n), part("c-water", "מים", 14_370n)],
  };
  const type = (category: string, name: string, supplier: string) => ({ category_id: category, category_name: name, supplier_name: supplier, supplier_id: `s-${supplier}` });
  const power = type("c-power", "חשמל", "City Light");
  const water = type("c-water", "מים", "City Water");
  const sewer = type("c-sewer", "ביוב", "Sewer Co");
  const back = { state: "refunded" as const, source: "auto" as const };
  return [
    bill({ ...power, bill_transaction_id: "t-power-11", project_id: GEFEN, amount_minor: 10_840n, doc_date: "2026-11-04", days: 5, state: "waiting" }),
    bill({ ...water, ...back, bill_transaction_id: "t-water-11", project_id: GEFEN, amount_minor: 14_370n, doc_date: "2026-11-04", days: 5, payment: november }),
    bill({ ...sewer, bill_transaction_id: "t-sewer-10", project_id: GEFEN, amount_minor: 6_430n, doc_date: "2026-10-21", days: 19, state: "waiting" }),
    bill({ ...power, bill_transaction_id: "t-power-10", project_id: GEFEN, amount_minor: 18_890n, doc_date: "2026-10-06", days: 34, state: "not_refunded" }),
    bill({ ...water, ...back, bill_transaction_id: "t-water-10", project_id: GEFEN, amount_minor: 6_050n, doc_date: "2026-10-06", days: 34, payment: october }),
    bill({ ...sewer, ...back, bill_transaction_id: "t-sewer-09", project_id: GEFEN, amount_minor: 6_840n, doc_date: "2026-09-22", days: 48, payment: october }),
    bill({ ...power, ...back, bill_transaction_id: "t-power-09", project_id: GEFEN, amount_minor: 18_020n, doc_date: "2026-09-04", days: 66, payment: october }),
    bill({ ...water, ...back, bill_transaction_id: "t-water-09", project_id: GEFEN, amount_minor: 6_230n, doc_date: "2026-09-04", days: 66, payment: october }),
    bill({ ...sewer, bill_transaction_id: "t-sewer-08", project_id: GEFEN, amount_minor: 6_170n, doc_date: "2026-08-24", days: 77, state: "seen", source: "owner" }),
  ];
}

/**
 * FLOW-1159 (V3-J-Income): the money in around October's power bill (utilityTypesSample's t-power-10), two months
 * each way, newest first: November's and October's rent split with the bills they paid back, September's rent not
 * split, and an August payment filed to חשמל whole.
 */
export function utilityIncomeSample(): UtilityIncome {
  const part = (category: string, name: string, minor: bigint) => ({ category_id: category, category_name: name, amount_minor: minor });
  const refunded = (id: string, date: string, minor: bigint, category: string, name: string) => ({ bill_transaction_id: id, doc_date: date, amount_minor: minor, category_id: category, category_name: name });
  const line = (id: string, date: string, minor: bigint, party: string | null, category: [string, string]) => ({
    transaction_id: id, doc_date: date, amount_minor: minor, currency: "USD", party, description: party == null ? "Zelle" : null, project_id: GEFEN,
    category_id: category[0], category_name: category[1], parts: [] as ReturnType<typeof part>[], refunded_bills: [] as ReturnType<typeof refunded>[],
  });
  const rent: [string, string] = ["c-שכירות", "שכירות"];
  return {
    as_of: "2026-11-09", months: 2, from: "2026-08-06", to: "2026-12-06",
    bill: {
      bill_transaction_id: "t-power-10", doc_date: "2026-10-06", amount_minor: 18_890n, currency: "USD", category_id: "c-power", category_name: "חשמל",
      supplier_name: "City Light", project_id: GEFEN, project_name: "דירת הגפן 3", state: "not_refunded", days: 34, payment_transaction_id: null,
    },
    lines: [
      {
        ...line("pay-rent-11", "2026-11-06", 189_370n, "RentRedi", rent),
        parts: [part("c-שכירות", "שכירות", 175_000n), part("c-water", "מים", 14_370n)],
        refunded_bills: [refunded("t-water-11", "2026-11-04", 14_370n, "c-water", "מים")],
      },
      {
        ...line("pay-rent-10", "2026-10-07", 212_140n, "RentRedi", rent),
        parts: [part("c-שכירות", "שכירות", 175_000n), part("c-power", "חשמל", 18_020n), part("c-water", "מים", 12_280n), part("c-sewer", "ביוב", 6_840n)],
        refunded_bills: [
          refunded("t-power-09", "2026-09-04", 18_020n, "c-power", "חשמל"),
          refunded("t-water-09", "2026-09-04", 6_230n, "c-water", "מים"),
          refunded("t-sewer-09", "2026-09-22", 6_840n, "c-sewer", "ביוב"),
          refunded("t-water-10", "2026-10-06", 6_050n, "c-water", "מים"),
        ],
      },
      line("pay-rent-09", "2026-09-10", 175_000n, "RentRedi", rent),
      line("pay-power-08", "2026-08-12", 9_500n, null, ["c-power", "חשמל"]),
    ],
  };
}
