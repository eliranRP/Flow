import { describe, expect, it } from "vitest";
import { assertSumitUrl, documentUrls, invoicesMissingLinks, mapCrmEntity, SUMIT_ALLOWLIST, type SumitDoc } from "../../../supabase/functions/_shared/ledger.ts";

function expense(vat: number | null, wo = -118, gross = -118): Record<string, unknown> {
  return {
    ID: 42,
    Accounting_DefinitionEnum: [13],
    Accounting_DisplayCompanyValue: [gross],
    Accounting_DisplayCompanyValueWithoutVAT: [wo],
    ...(vat == null ? {} : { Accounting_VATRate: [vat] }),
    Accounting_Date: ["2026-09-01T00:00:00"],
    Accounting_Description: ["עלות משותפת: בדיקה"],
    Accounting_Customer: [{ ID: 7, Name: "ספק" }],
  };
}

describe("assertSumitUrl", () => {
  it("accepts the constant paths", () => {
    for (const url of SUMIT_ALLOWLIST) expect(() => { assertSumitUrl(url); }).not.toThrow();
  });

  it("rejects a trailing path, a parent segment, another host, and a different case", () => {
    const base = SUMIT_ALLOWLIST[0];
    for (const url of [
      `${base}extra`,
      base.replace("/listfolders/", "/../listentities/"),
      base.replace("api.sumit.co.il", "evil.example"),
      base.toUpperCase(),
    ]) {
      expect(() => { assertSumitUrl(url); }).toThrow(/allowlisted/);
    }
  });
});

describe("mapCrmEntity", () => {
  it("keeps an explicit zero VAT rate and drops a missing expense split", () => {
    expect(mapCrmEntity(expense(0))?.vat).toBe(0);
    expect(mapCrmEntity(expense(null))?.vat).toBeNull();
    expect(mapCrmEntity(expense(18, -118, -118))?.vat).toBeNull();
    expect(mapCrmEntity(expense(18, -100, -118))?.vat).toBe(18);
  });
});
describe("documentUrls", () => {
  it("maps DocumentID to a pay.sumit.co.il link and drops anything else", () => {
    const urls = documentUrls({
      Documents: [
        { DocumentID: 11, DocumentDownloadURL: "https://pay.sumit.co.il/example/doc-11" },
        { DocumentID: 12, DocumentDownloadURL: "https://evil.example/doc-12" },
        { DocumentID: 13, DocumentDownloadURL: "http://pay.sumit.co.il/example/doc-13" },
        { DocumentID: 14, DocumentDownloadURL: "https://pay.sumit.co.il/a b" },
        { DocumentID: "15", DocumentDownloadURL: "https://pay.sumit.co.il/example/doc-15" },
        { DocumentID: 16, DocumentDownloadURL: `https://pay.sumit.co.il/${"x".repeat(600)}` },
        null,
      ],
    });
    expect([...urls]).toEqual([[11, "https://pay.sumit.co.il/example/doc-11"]]);
  });

  it("returns an empty map for a missing or malformed page", () => {
    expect(documentUrls(null).size).toBe(0);
    expect(documentUrls({ Documents: "x" }).size).toBe(0);
  });
});

describe("invoicesMissingLinks", () => {
  function doc(sumit_id: number, kind: SumitDoc["kind"], gross: number, date: string, orig: number | null = null): SumitDoc {
    return { key: String(sumit_id), sumit_id, kind, date, gross, wo: gross, vat: null, bud: null, bud_name: null, orig, cust: null, cust_name: null, number: null, desc: "" };
  }

  it("lists open invoices with no stored link and their earliest date", () => {
    const docs = [
      doc(1, "inv", 100, "2026-06-05"),
      doc(2, "inv", 100, "2026-06-01"),
      doc(3, "rec", 100, "2026-06-10", 2),
      doc(4, "inv", 100, "2026-06-03"),
      doc(5, "inv", 100, "2026-06-02"),
      doc(6, "cred", -40, "2026-06-11", 5),
    ];
    expect(invoicesMissingLinks(docs, new Set(["4"]))).toEqual({ ids: [1, 5], from: "2026-06-02" });
  });

  it("needs no call when every open invoice has a link", () => {
    expect(invoicesMissingLinks([doc(1, "inv", 100, "2026-06-05")], new Set(["1"]))).toEqual({ ids: [], from: null });
  });
});
