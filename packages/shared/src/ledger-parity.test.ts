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
});
