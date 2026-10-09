import { describe, expect, it } from "vitest";
import {
  assertSumitUrl,
  crmEntityDrift,
  definitionOf,
  documentUrls,
  invoicesMissingLinks,
  isSchemaDrift,
  mapCrmEntity,
  pageShapeDrift,
  SUMIT_ALLOWLIST,
  type SumitDoc,
} from "../../../supabase/functions/_shared/ledger.ts";

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
describe("crmEntityDrift", () => {
  it("is null for a row that maps and for a kind the sync does not read", () => {
    expect(crmEntityDrift(expense(18, -100, -118))).toBeNull();
    expect(crmEntityDrift({ ...expense(18), Accounting_DefinitionEnum: [99] })).toBeNull();
    expect(crmEntityDrift({ Accounting_DefinitionEnum: [99] })).toBeNull();
  });

  it("names the field that broke on a row the sync should read", () => {
    const { Accounting_DefinitionEnum: _definition, ...noDefinition } = expense(18);
    expect(crmEntityDrift(noDefinition)).toBe("Accounting_DefinitionEnum");
    expect(crmEntityDrift({ ...expense(18), ID: "42" })).toBe("ID");
    expect(crmEntityDrift({ ...expense(18), Accounting_DisplayCompanyValue: ["-118"] })).toBe("Accounting_DisplayCompanyValue");
    expect(crmEntityDrift({ ...expense(18), Accounting_DisplayCompanyValueWithoutVAT: [] })).toBe(
      "Accounting_DisplayCompanyValueWithoutVAT",
    );
    expect(crmEntityDrift({ ...expense(18), Accounting_Date: "2026-09-01" })).toBe("Accounting_Date");
    for (const field of ["ID", "Accounting_DisplayCompanyValue", "Accounting_Date"]) {
      expect(mapCrmEntity({ ...expense(18), [field]: null })).toBeNull();
    }
  });
});

describe("isSchemaDrift", () => {
  it("is drift past 1 broken row in 20", () => {
    expect(isSchemaDrift({ mapped: 40, broken: {} })).toBe(false);
    expect(isSchemaDrift({ mapped: 19, broken: { ID: 1 } })).toBe(false);
    expect(isSchemaDrift({ mapped: 18, broken: { ID: 1, Accounting_Date: 1 } })).toBe(true);
    expect(isSchemaDrift({ mapped: 0, broken: { Accounting_DefinitionEnum: 3 } })).toBe(true);
  });

  it("stops a small company on one broken row", () => {
    expect(isSchemaDrift({ mapped: 3, broken: { ID: 1 } })).toBe(true);
  });
});

describe("pageShapeDrift", () => {
  it("is drift when Data is gone or has no row list", () => {
    expect(pageShapeDrift({})).toBe(true);
    expect(pageShapeDrift({ Data: { Rows: [] } })).toBe(true);
    expect(pageShapeDrift({ Data: { HasNextPage: false } })).toBe(true);
  });

  it("reads a null Data or a null or empty row list as an empty company", () => {
    expect(pageShapeDrift({ Data: null })).toBe(false);
    expect(pageShapeDrift({ Data: [] })).toBe(false);
    expect(pageShapeDrift({ Data: { Entities: [] } })).toBe(false);
    expect(pageShapeDrift({ Data: { Entities: null } })).toBe(false);
  });
});

describe("definitionOf", () => {
  it("names the kind, or other when the enum is missing", () => {
    expect(definitionOf({ Accounting_DefinitionEnum: [99] })).toBe("99");
    expect(definitionOf({})).toBe("other");
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
