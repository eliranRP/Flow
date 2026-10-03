import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deriveLine, type SumitDoc } from "../../../supabase/functions/_shared/ledger.ts";
import { decodeKek, openApiKey, sealApiKey } from "../../../supabase/functions/_shared/envelope.ts";
import { demoDataSchema, normalizeSumitDocument, type DemoData } from "./pnl.ts";

const fixture = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/demo-data.json");
const demo = demoDataSchema.parse(JSON.parse(readFileSync(fixture, "utf8")));

function toDoc(raw: DemoData["documents"][number]["sumit"]): SumitDoc {
  return {
    key: raw.key,
    sumit_id: raw.sumit_id,
    kind: raw.kind,
    date: raw.date,
    gross: raw.gross,
    wo: raw.wo,
    vat: raw.vat,
    bud: raw.bud,
    bud_name: null,
    orig: raw.orig,
    cust: raw.cust,
    cust_name: raw.cust_name,
    number: raw.number,
    desc: raw.desc,
  };
}

describe("edge ledger matches the shared P&L", () => {
  it("nets every Flow Test document the same way", () => {
    const projects = new Map<number, string>();
    for (const [key, project] of Object.entries(demo.projects)) {
      projects.set(project.budget_section_id, key);
    }
    const exempt = new Set<number>();
    for (const supplier of Object.values(demo.suppliers)) {
      if (supplier.sumit_id != null && !supplier.vat_able) exempt.add(supplier.sumit_id);
    }
    const byId = new Map(demo.documents.map((document) => [document.sumit.sumit_id, toDoc(document.sumit)]));
    for (const document of demo.documents) {
      const expected = normalizeSumitDocument(document.sumit, demo);
      const doc = toDoc(document.sumit);
      const line = deriveLine(
        doc,
        doc.bud == null ? null : (projects.get(doc.bud) ?? null),
        doc.cust != null && exempt.has(doc.cust),
        1800,
        byId,
      );
      expect(line.netAgorot, document.sumit.key).toBe(expected.netAgorot);
      expect(line.grossAgorot, document.sumit.key).toBe(expected.grossAgorot);
      expect(line.vatStatus, document.sumit.key).toBe(expected.vatStatus);
      expect(line.role, document.sumit.key).toBe(expected.role);
    }
  });
});

describe("SUMIT envelope", () => {
  it("round-trips the API key and does not leave it in the ciphertext hex", async () => {
    const kek = decodeKek(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"));
    const secret = "unit-test-key-not-a-real-sumit-secret";
    const sealed = await sealApiKey(secret, kek, "1");
    expect(sealed.keyCiphertext.includes(secret)).toBe(false);
    expect(sealed.dekCiphertext.startsWith("\\x")).toBe(true);
    await expect(openApiKey(sealed, kek)).resolves.toBe(secret);
  });

  it("binds version 2 to the company and still opens a version 1 seal", async () => {
    const kek = decodeKek(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"));
    const secret = "unit-test-key-not-a-real-sumit-secret";
    const company = "11111111-1111-1111-1111-111111111111";
    const sealed = await sealApiKey(secret, kek, "2", company);
    await expect(openApiKey(sealed, kek, company)).resolves.toBe(secret);
    await expect(openApiKey(sealed, kek, "22222222-2222-2222-2222-222222222222")).rejects.toThrow();
    await expect(openApiKey(sealed, kek)).rejects.toThrow();
    const legacy = await sealApiKey(secret, kek, "1");
    await expect(openApiKey(legacy, kek)).resolves.toBe(secret);
    await expect(openApiKey(legacy, kek, company)).resolves.toBe(secret);
  });

  it("stores the KEK id and the envelope format separately", async () => {
    const kek = decodeKek(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"));
    const secret = "unit-test-key-not-a-real-sumit-secret";
    const company = "11111111-1111-1111-1111-111111111111";
    const sealed = await sealApiKey(secret, kek, "1", company, "2");
    expect(sealed.kekVersion).toBe("1");
    expect(sealed.envelopeVersion).toBe("2");
    await expect(openApiKey(sealed, kek, company)).resolves.toBe(secret);
    const oldFormat = await sealApiKey(secret, kek, "2", company);
    const { envelopeVersion: _dropped, ...withoutFormat } = oldFormat;
    await expect(openApiKey(withoutFormat, kek, company)).resolves.toBe(secret);
  });

  it("binds version 3 to the company and the provider", async () => {
    const kek = decodeKek(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64"));
    const secret = "unit-test-key-not-a-real-sumit-secret";
    const company = "11111111-1111-1111-1111-111111111111";
    const other = "22222222-2222-2222-2222-222222222222";
    const sealed = await sealApiKey(secret, kek, "1", company, "3", "sumit");
    expect(sealed.kekVersion).toBe("1");
    expect(sealed.envelopeVersion).toBe("3");
    expect(sealed.keyCiphertext.includes(secret)).toBe(false);
    await expect(openApiKey(sealed, kek, company, "sumit")).resolves.toBe(secret);
    await expect(openApiKey(sealed, kek, other, "sumit")).rejects.toThrow();
    await expect(openApiKey(sealed, kek, company, "mercury")).rejects.toThrow();
    await expect(openApiKey(sealed, kek, company)).rejects.toThrow();
    await expect(openApiKey(sealed, kek)).rejects.toThrow();
    await expect(sealApiKey(secret, kek, "1", company, "3")).rejects.toThrow();
    await expect(sealApiKey(secret, kek, "1", undefined, "4", "sumit")).rejects.toThrow();
    const format2 = await sealApiKey(secret, kek, "2", company);
    await expect(openApiKey(format2, kek, company, "sumit")).resolves.toBe(secret);
    const format1 = await sealApiKey(secret, kek, "1");
    await expect(openApiKey(format1, kek)).resolves.toBe(secret);
  });
});
