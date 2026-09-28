import { describe, expect, it } from "vitest";
import { assertSumitUrl, mapCrmEntity, SUMIT_ALLOWLIST } from "../../../supabase/functions/_shared/ledger.ts";

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
  it("accepts only the two constant paths", () => {
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