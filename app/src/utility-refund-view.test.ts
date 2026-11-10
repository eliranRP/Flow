import { describe, expect, it } from "vitest";
import { utilityIncomeSchema } from "./utility-refund-schema";
import type { UtilityBill } from "./utility-refunds";
import {
  billActivity,
  billsByType,
  billStatusLine,
  incomeBillStatus,
  incomeRows,
  refundGroups,
  tenantOwes,
  typeHistory,
  typePattern,
} from "./utility-refund-view";
import { utilityIncomeSample, utilityRefundsSample, utilityTypesSample } from "./screens/utility-refunds-sample";

// FLOW-1159: the bill views' pure helpers, on the invented sample (as of 2026-11-09).
const types = utilityTypesSample();
const byId = (id: string): UtilityBill => {
  const found = types.find((bill) => bill.bill_transaction_id === id);
  if (found == null) throw new Error(id);
  return found;
};

describe("billActivity", () => {
  it("is the later of the bill's date and its payment's", () => {
    expect(billActivity(byId("t-water-11"))).toBe("2026-11-06");
    expect(billActivity(byId("t-power-11"))).toBe("2026-11-04");
  });
});

describe("billStatusLine", () => {
  it("says when a refund came back: the same month within a week, else the date and the days after", () => {
    expect(billStatusLine(byId("t-water-11"))).toBe("הוחזר באותו חודש · 06/11/26");
    expect(billStatusLine(byId("t-water-10"))).toBe("הוחזר באותו חודש · 07/10/26");
    expect(billStatusLine(byId("t-power-09"))).toBe("הוחזר ב־07/10/26 · 33 ימים אחרי");
    expect(billStatusLine({ ...byId("t-power-09"), payment: null })).toBe("הוחזר");
  });

  it("words the other states, one day included", () => {
    expect(billStatusLine(byId("t-sewer-08"))).toBe("נבדק · ראיתי");
    expect(billStatusLine(byId("t-power-10"))).toBe("לא הוחזר · 34 ימים");
    expect(billStatusLine(byId("t-sewer-10"))).toBe("עוד לא הוחזר · 19 ימים");
    expect(billStatusLine({ ...byId("t-power-11"), days: 1 })).toBe("עוד לא הוחזר · יום אחד");
  });
});

describe("billsByType", () => {
  it("groups by category, newest activity first, with what is missing per type", () => {
    const groups = billsByType(types);
    expect(groups.map((group) => group.name)).toEqual(["מים", "חשמל", "ביוב"]);
    expect(groups[1]?.bills.map((bill) => bill.bill_transaction_id)).toEqual(["t-power-11", "t-power-09", "t-power-10"]);
    expect(groups[0]?.bills.map((bill) => bill.bill_transaction_id)).toEqual(["t-water-11", "t-water-10", "t-water-09"]);
    expect(groups.map((group) => group.missing)).toEqual([
      [],
      [{ currency: "USD", minor: 29_730n }],
      [{ currency: "USD", minor: 6_430n }],
    ]);
    expect(groups[0]?.latest).toBe("2026-11-06");
  });

  it("names a bill with no category", () => {
    expect(billsByType([{ ...byId("t-power-10"), category_id: null, category_name: null }])[0]?.name).toBe("בלי קטגוריה");
  });

  it("tenantOwes sums the bills not refunded and waiting, per currency", () => {
    expect(tenantOwes(types)).toEqual([{ currency: "USD", minor: 36_160n }]);
    expect(tenantOwes([{ ...byId("t-power-10"), currency: "ILS" }, byId("t-sewer-10")])).toEqual([
      { currency: "ILS", minor: 18_890n },
      { currency: "USD", minor: 6_430n },
    ]);
  });
});

describe("typePattern and typeHistory", () => {
  it("gives the type's usual days to a refund, and whether this bill is past it", () => {
    expect(typePattern(types, byId("t-power-10"))).toBe("בדרך כלל חשמל מוחזר כ־33 ימים אחרי החשבון. החשבון הזה כבר מעבר לזה.");
    expect(typePattern(types, byId("t-power-11"))).toBe("בדרך כלל חשמל מוחזר כ־33 ימים אחרי החשבון. החשבון הזה עוד בטווח.");
    // (2 + 1 + 33) / 3 = 12.
    expect(typePattern(types, byId("t-water-11"))).toBe("בדרך כלל מים מוחזר כ־12 ימים אחרי החשבון.");
  });

  it("says so when the type has no refund yet at the property", () => {
    const gas = { ...byId("t-power-10"), category_id: "c-gas", category_name: "גז" };
    expect(typePattern([...types, gas], gas)).toBe("עוד אין החזרים קודמים של גז בנכס.");
  });

  it("lists the type's bills at the property, newest activity first", () => {
    expect(typeHistory(types, byId("t-power-10")).map((bill) => bill.bill_transaction_id)).toEqual(["t-power-11", "t-power-09", "t-power-10"]);
    expect(typeHistory([...types, { ...byId("t-power-11"), bill_transaction_id: "elsewhere", project_id: "p-other" }], byId("t-power-10"))).toHaveLength(3);
  });
});

describe("incomeBillStatus", () => {
  it("reads the bill's state, with its refund's date from the line in the window", () => {
    const income = utilityIncomeSample();
    expect(incomeBillStatus(income)).toBe("לא הוחזר · 34 ימים");
    expect(incomeBillStatus({ ...income, bill: { ...income.bill, state: "refunded", payment_transaction_id: "pay-rent-10" } })).toBe("הוחזר באותו חודש · 07/10/26");
    // A refund outside the window has no line: just "הוחזר".
    expect(incomeBillStatus({ ...income, bill: { ...income.bill, state: "refunded", payment_transaction_id: "pay-far" } })).toBe("הוחזר");
  });
});

describe("incomeRows", () => {
  const income = utilityIncomeSample();

  it("lists the payments newest first with the bill's marker at its date", () => {
    const rows = incomeRows(income, income.bill);
    expect(rows.map((row) => row.key)).toEqual(["pay-rent-11", "pay-rent-10", "bill:t-power-10", "pay-rent-09", "pay-power-08"]);
    expect(rows[2]).toEqual({ kind: "bill", key: "bill:t-power-10", date: "2026-10-06", label: "החשבון · 06/10/26" });
  });

  it("names the bill's part and the bills it paid back, or that it has none, and the other parts", () => {
    const [november, october, , september, august] = incomeRows(income, income.bill);
    expect(october).toMatchObject({
      title: "RentRedi · 07/10/26",
      hit: "חשמל $180.20 · החזיר את 04/09/26",
      hitMissing: false,
      others: "שכירות $1,750 · מים $122.80 · ביוב $68.40",
      amount: "+$2,121.40",
      refund: false,
    });
    expect(november).toMatchObject({ hit: "בלי חשמל", hitMissing: true, others: "שכירות $1,750 · מים $143.70" });
    expect(september).toMatchObject({ hit: "בלי חשמל", hitMissing: true, others: "שכירות" });
    // A line not split, filed to the bill's category, counts whole.
    expect(august).toMatchObject({ title: "Zelle · 12/08/26", hit: "חשמל $95", hitMissing: false, others: null });
  });

  it("marks the bill's own refund", () => {
    const rows = incomeRows(income, { ...income.bill, payment_transaction_id: "pay-rent-11" });
    expect(rows.filter((row) => row.kind === "payment" && row.refund).map((row) => row.key)).toEqual(["pay-rent-11"]);
  });

  it("reads the server's JSON", () => {
    const json: unknown = JSON.parse(JSON.stringify(income, (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value)));
    expect(utilityIncomeSchema.parse(json)).toEqual(income);
  });
});

describe("refundGroups", () => {
  it("lists each property's open bills newest first", () => {
    const pine = refundGroups(utilityRefundsSample()).find((group) => group.projectId === "p-pine-4");
    expect(pine?.open.map((bill) => bill.bill_transaction_id)).toEqual(["b-net-pine", "b-water-pine"]);
  });
});
