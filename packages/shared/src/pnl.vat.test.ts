import { describe, expect, it } from "vitest";
import { netFromGrossAgorot } from "./money.ts";
import { demoDataSchema, normalizeSumitDocument, type DemoData, type DemoSumitDoc } from "./pnl.ts";

function doc(partial: Partial<DemoSumitDoc> & Pick<DemoSumitDoc, "key" | "kind" | "gross">): DemoSumitDoc {
  return {
    sumit_id: partial.sumit_id ?? 1,
    date: "2026-04-01",
    wo: partial.wo ?? partial.gross,
    vat: partial.vat === undefined ? null : partial.vat,
    bud: partial.bud === undefined ? 1 : partial.bud,
    orig: partial.orig === undefined ? null : partial.orig,
    cust: partial.cust === undefined ? null : partial.cust,
    cust_name: null,
    number: null,
    desc: partial.desc ?? "חומר",
    ...partial,
  };
}

function fixture(documents: DemoSumitDoc[]): DemoData {
  return demoDataSchema.parse({
    company: { name: "בדיקה", company_id: 1, vat_rate: 0.18 },
    projects: { p: { name: "פרויקט", budget_section_id: 1 } },
    customers: {},
    suppliers: {
      s: { name: "ספק", company_number: null, vat_able: true, sumit_id: 9 },
    },
    shared_alloc_worker_days: {},
    documents: documents.map((sumit) => ({ sumit })),
  });
}

function line(documents: DemoSumitDoc[], key: string) {
  const demo = fixture(documents);
  const found = demo.documents.map((document) => normalizeSumitDocument(document.sumit, demo)).find((item) => item.key === key);
  if (!found) throw new Error(`missing ${key}`);
  return found;
}

describe("linked receipt VAT", () => {
  const invoice18 = doc({
    key: "INV-18",
    sumit_id: 10,
    kind: "inv",
    gross: 1180,
    wo: 1000,
    vat: 18,
  });
  const invoice0 = doc({
    key: "INV-0",
    sumit_id: 11,
    kind: "inv",
    gross: 1000,
    wo: 1000,
    vat: 0,
  });

  it("nets a receipt at the linked invoice rate of 18%", () => {
    const receipt = line(
      [
        invoice18,
        doc({ key: "REC-18", sumit_id: 20, kind: "rec", gross: 1180, wo: 1180, orig: 10 }),
      ],
      "REC-18",
    );
    expect(receipt.netAgorot).toBe(100_000n);
    expect(receipt.vatAgorot).toBe(18_000n);
    expect(receipt.vatStatus).toBe("derived");
  });

  it("keeps a receipt at 0% when the linked invoice is exempt", () => {
    const receipt = line(
      [
        invoice0,
        doc({ key: "REC-0", sumit_id: 21, kind: "rec", gross: 1000, wo: 1000, orig: 11 }),
      ],
      "REC-0",
    );
    expect(receipt.netAgorot).toBe(100_000n);
    expect(receipt.vatAgorot).toBe(0n);
  });

  it("falls back to the company rate when the linked invoice is missing", () => {
    const receipt = line(
      [doc({ key: "REC-MISS", sumit_id: 22, kind: "rec", gross: 1180, wo: 1180, orig: 999 })],
      "REC-MISS",
    );
    expect(receipt.netAgorot).toBe(100_000n);
    expect(receipt.vatAgorot).toBe(18_000n);
  });
});

describe("credit notes and refunds", () => {
  it("keeps a credit note negative and uses its source net", () => {
    const credit = line(
      [doc({ key: "CRED", sumit_id: 30, kind: "cred", gross: -118, wo: -100, vat: 18 })],
      "CRED",
    );
    expect(credit.grossAgorot).toBe(-11_800n);
    expect(credit.netAgorot).toBe(-10_000n);
    expect(credit.vatStatus).toBe("source");
  });

  it("keeps a positive expense refund and assumes 18% when VAT was not split", () => {
    const refund = line(
      [doc({ key: "REFUND", sumit_id: 31, kind: "exp", gross: 118, wo: 118, vat: null, cust: 9 })],
      "REFUND",
    );
    expect(refund.grossAgorot).toBe(11_800n);
    expect(refund.netAgorot).toBe(10_000n);
    expect(refund.vatStatus).toBe("assumed");
  });

  it("assumes 18% when vat is 0 and the supplier is VAT-able", () => {
    const expense = line(
      [doc({ key: "ZERO", sumit_id: 32, kind: "exp", gross: -1000, wo: -1000, vat: 0, cust: 9 })],
      "ZERO",
    );
    expect(expense.vatStatus).toBe("assumed");
    expect(expense.netAgorot).toBe(netFromGrossAgorot(-100_000n, 1800));
    expect(expense.grossAgorot).toBe(-100_000n);
    expect(expense.netAgorot).not.toBe(expense.grossAgorot);
  });

  it("exempts an expense only when the supplier is VAT-exempt", () => {
    const demo = demoDataSchema.parse({
      company: { name: "בדיקה", company_id: 1, vat_rate: 0.18 },
      projects: { p: { name: "פרויקט", budget_section_id: 1 } },
      customers: {},
      suppliers: {
        s: { name: "פטור", company_number: null, vat_able: false, sumit_id: 9 },
      },
      shared_alloc_worker_days: {},
      documents: [
        {
          sumit: doc({
            key: "EXEMPT",
            sumit_id: 33,
            kind: "exp",
            gross: -1000,
            wo: -1000,
            vat: 0,
            cust: 9,
          }),
        },
      ],
    });
    const sumit = demo.documents[0]?.sumit;
    if (!sumit) throw new Error("missing exempt document");
    const exempt = normalizeSumitDocument(sumit, demo);
    expect(exempt.vatStatus).toBe("derived");
    expect(exempt.netAgorot).toBe(exempt.grossAgorot);
    expect(exempt.vatAgorot).toBe(0n);
  });
});
