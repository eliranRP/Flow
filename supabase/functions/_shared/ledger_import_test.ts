// FLOW-505: SUMIT writes only documents dated on or after the import start.
import { docsFromImportStart, type SumitDoc } from "./ledger.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

function doc(sumitId: number, date: string): SumitDoc {
  return {
    key: `k-${sumitId}`,
    sumit_id: sumitId,
    kind: "exp",
    date,
    gross: 100,
    wo: 100,
    vat: null,
    bud: null,
    bud_name: null,
    orig: null,
    cust: null,
    cust_name: "Example Supplies",
    number: null,
    desc: "",
  };
}

const docs = [doc(1, "2026-02-28"), doc(2, "2026-03-01"), doc(3, "2026-09-30")];

Deno.test("no import start keeps every document", () => {
  assertEquals(docsFromImportStart(docs, null).map((d) => d.sumit_id), [1, 2, 3]);
});

Deno.test("an import start drops older documents and keeps the start day", () => {
  assertEquals(docsFromImportStart(docs, "2026-03-01").map((d) => d.sumit_id), [2, 3]);
  assertEquals(docsFromImportStart(docs, "2026-10-01").map((d) => d.sumit_id), []);
});
