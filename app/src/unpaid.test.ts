import type { UnpaidRow } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { unpaidDocumentUrl, unpaidOpenGross, unpaidOpenRows, unpaidTotals } from "./unpaid";

function row(id: string, gross: bigint, extra: Partial<UnpaidRow> = {}): UnpaidRow {
  return {
    id,
    description: "חשבונית לדוגמה",
    doc_date: "2026-09-01",
    project_name: null,
    customer_name: null,
    open_gross_agorot: gross,
    open_net_agorot: gross,
    ...extra,
  };
}

describe("unpaid totals (FLOW-330)", () => {
  it("adds the open gross per currency, ILS first, and leaves marked rows out", () => {
    const rows = [
      row("a", 50_000n),
      row("b", 20_000n, { currency: "USD" }),
      row("c", 30_000n, { marked_paid_at: "2026-10-01T10:00:00Z" }),
      row("d", 10_000n, { currency: "EUR" }),
      row("e", 5_000n, { currency: "USD", marked_paid_at: "2026-10-02T10:00:00Z" }),
    ];
    expect(unpaidOpenRows(rows).map((open) => open.id)).toEqual(["a", "b", "d"]);
    expect(unpaidTotals(rows)).toEqual([
      { currency: "ILS", minor: 50_000n },
      { currency: "EUR", minor: 10_000n },
      { currency: "USD", minor: 20_000n },
    ]);
    expect(unpaidOpenGross(rows)).toBe(50_000n);
  });

  it("keeps ILS at zero and drops another currency whose rows are all marked", () => {
    const rows = [
      row("a", 50_000n, { marked_paid_at: "2026-10-01T10:00:00Z" }),
      row("b", 20_000n, { currency: "USD", marked_paid_at: "2026-10-01T10:00:00Z" }),
    ];
    expect(unpaidTotals(rows)).toEqual([{ currency: "ILS", minor: 0n }]);
    expect(unpaidOpenRows(rows)).toHaveLength(0);
  });

  it("reads a credit note's minus as an open amount, as the list shows it", () => {
    expect(unpaidTotals([row("a", -12_000n)])).toEqual([{ currency: "ILS", minor: 12_000n }]);
  });
});

describe("unpaid document link (FLOW-335)", () => {
  it("keeps only an https link on SUMIT's pay host", () => {
    expect(unpaidDocumentUrl({ document_url: "https://pay.sumit.co.il/doc/abc" })).toBe("https://pay.sumit.co.il/doc/abc");
    expect(unpaidDocumentUrl({ document_url: null })).toBeNull();
    expect(unpaidDocumentUrl({})).toBeNull();
    expect(unpaidDocumentUrl({ document_url: "http://pay.sumit.co.il/doc/abc" })).toBeNull();
    expect(unpaidDocumentUrl({ document_url: "https://pay.sumit.co.il.example.com/doc" })).toBeNull();
    expect(unpaidDocumentUrl({ document_url: "https://example.com/?https://pay.sumit.co.il/" })).toBeNull();
    expect(unpaidDocumentUrl({ document_url: "javascript:alert(1)" })).toBeNull();
  });
});
